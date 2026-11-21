package selfupdate

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestVersionRules(t *testing.T) {
	for _, bad := range []string{"", "v1.0.0", "1.0.0/../x", "1.0.0 ", "../1", "1.0.0;rm", strings.Repeat("1", 41)} {
		if ValidVersion(bad) {
			t.Errorf("%q must be refused: it is passed to a shell script as an argument", bad)
		}
	}
	for _, good := range []string{"0.1.52", "1.2.3-standalone.4", "10.0.0"} {
		if !ValidVersion(good) {
			t.Errorf("%q must be accepted", good)
		}
	}
	for _, c := range []struct {
		a, b string
		want int
	}{
		{"0.1.51", "0.1.52", -1}, {"0.1.52", "0.1.52", 0}, {"0.1.10", "0.1.9", 1}, {"1.0.0", "0.9.99", 1},
		{"0.1.52-standalone.3", "0.1.52", -1}, {"0.1.52-standalone.3", "0.1.52-standalone.10", -1},
	} {
		got, err := Compare(c.a, c.b)
		if err != nil || got != c.want {
			t.Errorf("Compare(%s, %s) = %d, %v; want %d", c.a, c.b, got, err, c.want)
		}
	}
	if _, err := Compare("0.1.52", "latest"); err == nil {
		t.Error("an unrecognized version must be an error, not equal")
	}
}

func TestTheInstallCommandIsThePublishedOneAndNotAnythingElse(t *testing.T) {
	t.Setenv(scriptBaseEnv, "")
	if got := scriptURL("darwin"); got != "https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/install.sh" {
		t.Errorf("unix: %s", got)
	}
	if got := scriptURL("linux"); !strings.HasSuffix(got, "/scripts/install.sh") {
		t.Errorf("linux: %s", got)
	}
	if got := scriptURL("windows"); got != "https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/install.ps1" {
		t.Errorf("windows: %s", got)
	}
	t.Setenv(scriptBaseEnv, "http://127.0.0.1:9999/x/")
	if got := scriptURL("darwin"); got != "http://127.0.0.1:9999/x/install.sh" {
		t.Errorf("test override: %s", got)
	}
}

// launches records what the fake launcher was asked to run.
type launches struct {
	mu   sync.Mutex
	list []plan
	err  error
}

func (l *launches) add(p plan) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.list = append(l.list, p)
	return l.err
}
func (l *launches) all() []plan {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]plan(nil), l.list...)
}

// installed makes a data directory that looks like a registered standalone installation.
func installed(t *testing.T, current string) (*Updater, *launches) {
	t.Helper()
	dir := t.TempDir()
	exe := filepath.Join(t.TempDir(), "local-ai-agent")
	os.WriteFile(exe, []byte("x"), 0o755)
	os.WriteFile(filepath.Join(dir, "installation.json"), []byte(`{"executable":"`+filepath.ToSlash(exe)+`"}`), 0o600)
	plans := &launches{}
	u := New(dir, exe, current)
	u.goos = "darwin"
	u.launch = plans.add
	return u, plans
}

func TestUpdateRunsTheInstallCommandPinnedToTheOfferedVersion(t *testing.T) {
	t.Setenv(scriptBaseEnv, "")
	u, plans := installed(t, "0.1.52")
	status, err := u.Start("0.1.53")
	if err != nil {
		t.Fatal(err)
	}
	if status.Phase != PhaseInstalling || status.Target != "0.1.53" || status.Current != "0.1.52" || !status.Supported {
		t.Fatalf("right after the request: %+v", status)
	}
	if len(plans.all()) != 1 {
		t.Fatalf("launched %d times", len(plans.all()))
	}
	p := plans.all()[0]
	if p.Version != "0.1.53" || !strings.HasSuffix(p.ScriptURL, "/scripts/install.sh") || p.LogFile != filepath.Join(u.Dir, "logs", "update.log") {
		t.Fatalf("plan: %+v", p)
	}
	if info, err := os.Stat(filepath.Dir(p.ExitFile)); err != nil || !info.IsDir() {
		t.Fatal("the scratch directory for the update must exist before the installer starts")
	}

	// The command failed and the installer put the old service back: this process is still 0.1.52.
	os.WriteFile(p.ExitFile, []byte("1\n"), 0o600)
	os.WriteFile(u.logPath(), []byte("cp: NOTICE.md: No such file\nInstallation failed; restarting Local AI Agent...\n"), 0o600)
	s := u.Status()
	if s.Phase != PhaseFailed || !strings.Contains(s.Error, "code 1") || !strings.Contains(s.Log, "NOTICE.md") {
		t.Fatalf("a failed installer must be reported with its output: %+v", s)
	}
	if _, err := os.Stat(filepath.Join(u.workRoot(), "0.1.53")); !os.IsNotExist(err) {
		t.Fatal("the scratch directory is removed once the result is known")
	}
}

func TestANewProcessReportsDone(t *testing.T) {
	u, plans := installed(t, "0.1.52")
	if _, err := u.Start("0.1.53"); err != nil {
		t.Fatal(err)
	}
	// After the restart the process that reads the state is the new version.
	after := New(u.Dir, u.Executable, "0.1.53")
	if s := after.Status(); s.Phase != PhaseInstalling {
		t.Fatalf("before the installer has returned: %+v", s)
	}
	if err := os.WriteFile(plans.all()[0].ExitFile, []byte("0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if s := after.Status(); s.Phase != PhaseDone || s.Target != "0.1.53" || s.Current != "0.1.53" {
		t.Fatalf("after the update: %+v", s)
	}
	if s := after.Status(); s.Phase != PhaseDone {
		t.Fatalf("done stays done on the next read: %+v", s)
	}
}

func TestACommandThatExitsZeroWithoutChangingTheVersionIsNotSuccess(t *testing.T) {
	u, plans := installed(t, "0.1.52")
	u.Start("0.1.53")
	// `curl | sh` style failures look like this: nothing ran, nothing failed loudly.
	os.WriteFile(plans.all()[0].ExitFile, []byte("0\n"), 0o600)
	if s := u.Status(); s.Phase != PhaseFailed || !strings.Contains(s.Error, "did not change") {
		t.Fatalf("%+v", s)
	}
}

func TestAnInstallerThatNeverFinishesFails(t *testing.T) {
	u, _ := installed(t, "0.1.52")
	if _, err := u.Start("0.1.53"); err != nil {
		t.Fatal(err)
	}
	u.now = func() time.Time { return time.Now().Add(installTimeout + time.Minute) }
	if s := u.Status(); s.Phase != PhaseFailed || !strings.Contains(s.Error, "in time") {
		t.Fatalf("%+v", s)
	}
}

func TestALauncherThatCannotStartIsReportedAndAllowsARetry(t *testing.T) {
	u, plans := installed(t, "0.1.52")
	plans.err = os.ErrPermission
	if _, err := u.Start("0.1.53"); err == nil {
		t.Fatal("the failure must reach the caller")
	}
	if s := u.Status(); s.Phase != PhaseFailed || !strings.Contains(s.Error, "start the installer") {
		t.Fatalf("%+v", s)
	}
	plans.err = nil
	if _, err := u.Start("0.1.53"); err != nil {
		t.Fatalf("a failed start must not block the next attempt: %v", err)
	}
}

func TestStartRefusesWhatShouldNotBeInstalled(t *testing.T) {
	u, plans := installed(t, "0.1.52")
	for _, version := range []string{"0.1.52", "0.1.51", "latest", "../0.1.53", "0.1.53;reboot", ""} {
		if _, err := u.Start(version); err == nil {
			t.Errorf("version %q must be refused", version)
		}
	}
	if s := u.Status(); s.Phase != PhaseIdle || len(plans.all()) != 0 {
		t.Fatalf("a refused request leaves no trace: %+v", s)
	}
	stranger := New(t.TempDir(), "/somewhere/else/local-ai-agent", "0.1.52")
	if _, err := stranger.Start("0.1.53"); err == nil {
		t.Error("a backend with no installation record must not replace anything")
	}
	other, _ := installed(t, "0.1.52")
	other.Executable = filepath.Join(t.TempDir(), "elsewhere")
	if _, err := other.Start("0.1.53"); err == nil || !strings.Contains(err.Error(), "registered") {
		t.Errorf("a copy that is not the registered installation: %v", err)
	}
}

func TestOnlyOneUpdateAtATime(t *testing.T) {
	u, plans := installed(t, "0.1.52")
	if _, err := u.Start("0.1.53"); err != nil {
		t.Fatal(err)
	}
	if _, err := u.Start("0.1.53"); err == nil || !strings.Contains(err.Error(), "already running") {
		t.Fatalf("a second request while one runs: %v", err)
	}
	if _, err := u.Start("0.1.54"); err == nil {
		t.Fatal("still refused while the installer runs")
	}
	if len(plans.all()) != 1 {
		t.Fatalf("one installer, not %d", len(plans.all()))
	}
}

func TestLatestReadsThePublishedVersionTheNodeWouldInstall(t *testing.T) {
	var served string
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if served == "404" {
			http.NotFound(w, r)
			return
		}
		fmt.Fprint(w, served)
	}))
	defer server.Close()
	t.Setenv(scriptBaseEnv, server.URL+"/scripts")
	u := New(t.TempDir(), "/x/local-ai-agent", "0.1.52")

	served = "0.1.53\n"
	version, err := u.Latest(context.Background())
	if err != nil || version != "0.1.53" || gotPath != "/scripts/standalone/version.txt" {
		t.Fatalf("version=%q err=%v path=%q", version, err, gotPath)
	}

	served = "0.1.54-standalone.2"
	if version, err = u.Latest(context.Background()); err != nil || version != "0.1.54-standalone.2" {
		t.Fatalf("standalone build number: %q %v", version, err)
	}

	for _, bad := range []string{"<html>blocked</html>", "", "v0.1.53", "0.1", strings.Repeat("1", 400)} {
		served = bad
		if _, err := u.Latest(context.Background()); err == nil || !strings.Contains(err.Error(), "not a release number") {
			t.Fatalf("%q must be refused as a version, got %v", bad, err)
		}
	}

	served = "404"
	if _, err := u.Latest(context.Background()); err == nil || !strings.Contains(err.Error(), "HTTP 404") {
		t.Fatalf("an HTTP failure must name the status, got %v", err)
	}

	server.Close()
	if _, err := u.Latest(context.Background()); err == nil || !strings.Contains(err.Error(), "could not reach") {
		t.Fatalf("an unreachable server must say so, got %v", err)
	}
}

func TestLatestGivesUpWhenAskedToStop(t *testing.T) {
	hang := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-hang }))
	defer server.Close()
	defer close(hang)
	t.Setenv(scriptBaseEnv, server.URL)
	u := New(t.TempDir(), "/x/local-ai-agent", "0.1.52")
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	if _, err := u.Latest(ctx); err == nil {
		t.Fatal("a cancelled lookup must fail")
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("the lookup ignored its context")
	}
}
