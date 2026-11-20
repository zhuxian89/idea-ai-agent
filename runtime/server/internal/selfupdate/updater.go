package selfupdate

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Phase string

const (
	PhaseIdle       Phase = "idle"
	PhaseInstalling Phase = "installing"
	PhaseDone       Phase = "done"
	PhaseFailed     Phase = "failed"
)

// ErrBusy is returned while an earlier update is still running.
var ErrBusy = errors.New("an update is already running")

// installTimeout is how long an installer may run before the update counts as failed.
const installTimeout = 20 * time.Minute

// Status is what the page shows. The data service restarts during an update, so the state lives
// in a file next to the other data and is judged again by whichever process starts afterwards.
type Status struct {
	Supported bool   `json:"supported"`
	Phase     Phase  `json:"phase"`
	Current   string `json:"current"`
	Target    string `json:"target,omitempty"`
	Error     string `json:"error,omitempty"`
	Log       string `json:"log,omitempty"`
}

type record struct {
	Phase     Phase  `json:"phase"`
	Target    string `json:"target"`
	From      string `json:"from"`
	Error     string `json:"error,omitempty"`
	StartedAt int64  `json:"started_at"`
	ExitFile  string `json:"exit_file,omitempty"`
}

// plan is everything the detached installer needs.
type plan struct {
	ScriptURL string // the published install script (install.sh or install.ps1)
	Version   string // the release to install; the script otherwise reads the default from a cached file
	ExitFile  string // the wrapper writes the installer's exit code here
	LogFile   string
	Dir       string // the data directory
	WorkDir   string // scratch space for this update
}

// The fixed online entry points: the same commands a person pastes into a terminal.
const (
	defaultScriptBase = "https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/"
	scriptBaseEnv     = "LOCAL_AI_AGENT_INSTALL_SCRIPT_BASE_URL" // test override
)

func scriptURL(goos string) string {
	base := defaultScriptBase
	if value := strings.TrimRight(os.Getenv(scriptBaseEnv), "/"); value != "" {
		base = value + "/"
	}
	if goos == "windows" {
		return base + "install.ps1"
	}
	return base + "install.sh"
}

type Updater struct {
	Dir        string // data directory (installation.json, logs, update state)
	Executable string // this process's executable, inside the installation
	Current    string // version of this process

	goos   string
	launch func(plan) error
	now    func() time.Time

	mu sync.Mutex
}

func New(dir, executable, current string) *Updater {
	return &Updater{Dir: dir, Executable: executable, Current: current, goos: runtime.GOOS, launch: launchDetached, now: time.Now}
}

func (u *Updater) statePath() string { return filepath.Join(u.Dir, "update-state.json") }
func (u *Updater) logPath() string   { return filepath.Join(u.Dir, "logs", "update.log") }
func (u *Updater) workRoot() string  { return filepath.Join(u.Dir, "update") }

func (u *Updater) load() (record, bool) {
	data, err := os.ReadFile(u.statePath())
	if err != nil {
		return record{}, false
	}
	var r record
	if json.Unmarshal(data, &r) != nil || r.Phase == "" {
		return record{}, false
	}
	return r, true
}

func (u *Updater) save(r record) error {
	data, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(u.Dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(u.Dir, ".update-state-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), u.statePath())
}

// registered reports whether this executable is the installed standalone backend. A development
// build or a copy elsewhere must not replace an installation it does not belong to.
func (u *Updater) registered() error {
	data, err := os.ReadFile(filepath.Join(u.Dir, "installation.json"))
	if err != nil {
		return errors.New("this backend is not an installed standalone service")
	}
	var installed struct {
		Executable string `json:"executable"`
	}
	if err := json.Unmarshal(data, &installed); err != nil || installed.Executable == "" {
		return errors.New("the installation record is unreadable")
	}
	same := func(a, b string) bool {
		if ra, err := filepath.EvalSymlinks(a); err == nil {
			a = ra
		}
		if rb, err := filepath.EvalSymlinks(b); err == nil {
			b = rb
		}
		return filepath.Clean(a) == filepath.Clean(b)
	}
	if !same(installed.Executable, u.Executable) {
		return errors.New("this backend is not the registered installation")
	}
	return nil
}

// Start begins an update to the given version and returns once the work is under way.
func (u *Updater) Start(version string) (Status, error) {
	if !ValidVersion(version) {
		return u.Status(), errors.New("invalid version")
	}
	newer, err := Compare(u.Current, version)
	if err != nil {
		return u.Status(), err
	}
	if newer >= 0 {
		return u.Status(), fmt.Errorf("%s is not newer than the installed %s", version, u.Current)
	}
	if err := u.registered(); err != nil {
		return u.Status(), err
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	if status := u.statusLocked(); status.Phase == PhaseInstalling {
		return status, ErrBusy
	}
	started := u.now().UnixMilli()
	work := filepath.Join(u.workRoot(), version)
	if err := os.RemoveAll(work); err != nil {
		return u.statusLocked(), err
	}
	if err := os.MkdirAll(work, 0o700); err != nil {
		return u.statusLocked(), err
	}
	if err := os.MkdirAll(filepath.Dir(u.logPath()), 0o700); err != nil {
		return u.statusLocked(), err
	}
	if err := os.WriteFile(u.logPath(), nil, 0o600); err != nil {
		return u.statusLocked(), err
	}
	exitFile := filepath.Join(work, "exit-code")
	if err := u.save(record{Phase: PhaseInstalling, Target: version, From: u.Current, StartedAt: started, ExitFile: exitFile}); err != nil {
		return u.statusLocked(), err
	}
	p := plan{ScriptURL: scriptURL(u.goos), Version: version, ExitFile: exitFile, LogFile: u.logPath(), Dir: u.Dir, WorkDir: work}
	if err := u.launch(p); err != nil {
		_ = u.save(record{Phase: PhaseFailed, Target: version, From: u.Current, StartedAt: started, Error: "start the installer: " + err.Error()})
		return u.statusLocked(), err
	}
	return u.statusLocked(), nil
}

// Status judges the recorded update against what is running now. After a successful update the
// new process reports done; after a failed one the installer has restored this version and its
// exit code says what went wrong.
func (u *Updater) Status() Status {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.statusLocked()
}

func (u *Updater) statusLocked() Status {
	status := Status{Supported: true, Phase: PhaseIdle, Current: u.Current}
	r, ok := u.load()
	if !ok {
		return status
	}
	status.Target, status.Phase, status.Error = r.Target, r.Phase, r.Error
	if r.Phase == PhaseInstalling {
		if code, finished := exitCode(r.ExitFile); finished {
			switch {
			case code != 0:
				status.Phase = PhaseFailed
				status.Error = fmt.Sprintf("the installer exited with code %d", code)
			case u.Current == r.Target:
				status.Phase = PhaseDone
			default:
				status.Phase = PhaseFailed
				status.Error = "the installer finished, but the running version did not change"
			}
		} else if u.now().Sub(time.UnixMilli(r.StartedAt)) > installTimeout {
			status.Phase = PhaseFailed
			status.Error = "the installer did not finish in time"
		}
		if status.Phase != PhaseInstalling {
			r.Phase, r.Error = status.Phase, status.Error
			_ = u.save(r)
		}
	}
	if status.Phase == PhaseFailed {
		status.Log = tail(u.logPath(), 3000)
	}
	if status.Phase == PhaseDone || status.Phase == PhaseFailed {
		// Best effort: on Windows the installer may still hold the files for a moment.
		_ = os.RemoveAll(filepath.Join(u.workRoot(), r.Target))
	}
	return status
}

func exitCode(path string) (int, bool) {
	if path == "" {
		return 0, false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	code, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0, false
	}
	return code, true
}

func tail(path string, limit int) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	if len(data) > limit {
		data = data[len(data)-limit:]
	}
	return strings.ToValidUTF8(strings.TrimSpace(string(data)), "�")
}
