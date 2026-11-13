package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"mindfs/server/internal/backend"
	"mindfs/server/internal/remotehost"
)

func TestMacLoginServiceInstallation(t *testing.T) {
	base := t.TempDir()
	source := filepath.Join(base, "package & source")
	prefix := filepath.Join(base, "installed backend")
	home := filepath.Join(base, "home")
	dir := filepath.Join(home, "remote")
	for _, path := range []string{source, home, filepath.Join(source, "web"), filepath.Join(source, "licenses")} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	incoming := filepath.Join(source, "local-ai-agent")
	if output, err := exec.Command("go", "build", "-o", incoming, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v %s", err, output)
	}
	copyFile := func(from, to string) {
		t.Helper()
		data, err := os.ReadFile(from)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(to, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	copyFile("../../../../scripts/standalone/install.sh", filepath.Join(source, "install.sh"))
	for _, name := range []string{"agents.json", "task_template.json", "LICENSE"} {
		copyFile(filepath.Join("../../..", name), filepath.Join(source, name))
	}
	for name, data := range map[string]string{"NOTICE.md": "test package", "web/index.html": "<html><head></head><body>login service test</body></html>"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("HOME", home)
	t.Setenv("IDE_AGENT_REMOTE_HOST_DIR", dir)
	t.Setenv("IDE_AGENT_DATA_DIR", dir)
	t.Setenv("MINDFS_RELAY_BASE_URL", "http://127.0.0.1:1")
	t.Setenv("MINDFS_STATIC_DIR", filepath.Join(prefix, "web"))
	t.Setenv("CODEX_HOME", filepath.Join(home, "codex"))
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(home, "claude"))
	t.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
	executable := filepath.Join(prefix, "local-ai-agent")
	plistDir := filepath.Join(home, "Library", "LaunchAgents")
	run := func(program string, args ...string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		if output, err := exec.CommandContext(ctx, program, args...).CombinedOutput(); err != nil {
			for _, name := range []string{"core.log", "standalone.log"} {
				log, _ := os.ReadFile(filepath.Join(dir, "logs", name))
				t.Logf("%s: %s", name, log)
			}
			t.Fatalf("%s %v: %v %s", program, args, err, output)
		}
	}
	labelPattern := regexp.MustCompile(`<key>Label</key><string>([^<]+)</string>`)
	t.Cleanup(func() {
		// Even a failed assertion must unload these temporary KeepAlive jobs.
		files, _ := filepath.Glob(filepath.Join(plistDir, "*.plist"))
		for _, file := range files {
			data, _ := os.ReadFile(file)
			match := labelPattern.FindSubmatch(data)
			if len(match) == 2 {
				exec.Command("/bin/launchctl", "bootout", fmt.Sprintf("gui/%d/%s", os.Getuid(), match[1])).Run()
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if output, err := exec.CommandContext(ctx, incoming, "-unregister").CombinedOutput(); err != nil {
			t.Errorf("cleanup: %v %s", err, output)
		}
	})
	status := func(name string) (int, error) {
		client := remotehost.NewClient(dir)
		client.DescriptorName = name
		var state struct {
			PID int `json:"pid"`
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		err := client.Call(ctx, "GET", "/control/status", nil, &state)
		return state.PID, err
	}
	wait := func(name string, previous int) int {
		t.Helper()
		deadline := time.Now().Add(35 * time.Second)
		for time.Now().Before(deadline) {
			if pid, err := status(name); err == nil && pid > 0 && pid != previous {
				return pid
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatalf("%s did not start after pid %d", name, previous)
		return 0
	}
	install := func() { run("/bin/sh", filepath.Join(source, "install.sh"), prefix) }
	install()
	corePID, gatewayPID := wait("core.json", 0), wait("host.json", 0)
	files, err := filepath.Glob(filepath.Join(plistDir, "*.plist"))
	if err != nil || len(files) != 2 {
		t.Fatal("expected two login jobs", files, err)
	}
	for _, file := range files {
		run("/usr/bin/plutil", "-lint", file)
		data, _ := os.ReadFile(file)
		if !strings.Contains(string(data), "<key>RunAtLoad</key><true/>") || !strings.Contains(string(data), "<key>SuccessfulExit</key><false/>") {
			t.Fatal("missing login/crash policy")
		}
	}
	address, _ := remotehost.ReadDescriptor(dir)
	core, _ := backend.ReadCore(dir)
	process, _ := os.FindProcess(gatewayPID)
	if err := process.Kill(); err != nil {
		t.Fatal(err)
	}
	gatewayPID = wait("host.json", gatewayPID)
	if after, _ := remotehost.ReadDescriptor(dir); after.URL != address.URL {
		t.Fatal("gateway crash changed its address")
	}
	if after, _ := backend.ReadCore(dir); after != core {
		t.Fatal("gateway crash replaced the local core")
	}
	process, _ = os.FindProcess(corePID)
	if err := process.Kill(); err != nil {
		t.Fatal(err)
	}
	corePID = wait("core.json", corePID)
	if pid, err := status("host.json"); err != nil || pid != gatewayPID {
		t.Fatal("core recovery replaced the gateway", pid, err)
	}
	run(executable, "-stop")
	if _, err := status("host.json"); err == nil {
		t.Fatal("manual stop restarted the gateway")
	}
	for _, file := range files {
		if strings.HasSuffix(file, ".gateway.plist") {
			data, _ := os.ReadFile(file)
			label := labelPattern.FindSubmatch(data)[1]
			if exec.Command("/bin/launchctl", "print", fmt.Sprintf("gui/%d/%s", os.Getuid(), label)).Run() == nil {
				t.Fatal("manual stop retained a loaded gateway job")
			}
		}
	}
	if pid, err := status("core.json"); err != nil || pid != corePID {
		t.Fatal("remote stop affected the core", pid, err)
	}
	run(executable, "-no-browser")
	wait("host.json", 0)
	install()
	if pid := wait("core.json", 0); pid == corePID {
		t.Fatal("update retained the previous core process")
	}
	if after, _ := remotehost.ReadDescriptor(dir); after.URL != address.URL {
		t.Fatal("update changed the address")
	}
	// Loading the saved directory exercises the same RunAtLoad path as login.
	run(executable, "-stop")
	run(executable, "-stop-core")
	run("/bin/launchctl", "bootstrap", fmt.Sprintf("gui/%d", os.Getuid()), plistDir)
	wait("host.json", 0)
	wait("core.json", 0)
	if after, _ := remotehost.ReadDescriptor(dir); after.URL != address.URL {
		t.Fatal("login changed the address")
	}
	// Installing in the extracted directory must also replace the running jobs.
	run("/bin/sh", filepath.Join(source, "install.sh"), source)
	wait("host.json", 0)
	wait("core.json", 0)
	for _, file := range files {
		data, _ := os.ReadFile(file)
		if !strings.Contains(string(data), "package &amp; source/local-ai-agent") {
			t.Fatal("in-place install did not update the job executable")
		}
	}
	// Switching back to the embedded runtime removes autostart, but keeps the
	// installation record so a later IDEA restart can select standalone again.
	installation, _ := os.ReadFile(filepath.Join(dir, "installation.json"))
	run(executable, "--prepare-embedded-core")
	run(executable, "--prepare-embedded-remote")
	for _, name := range []string{"host.json", "core.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatal("switch retained", name, err)
		}
	}
	files, _ = filepath.Glob(filepath.Join(plistDir, "*.plist"))
	if len(files) != 0 {
		t.Fatal("embedded mode retained login jobs", files)
	}
	if saved, _ := os.ReadFile(filepath.Join(dir, "installation.json")); string(saved) != string(installation) {
		t.Fatal("switch lost installation")
	}
	lease, err := backend.Acquire(dir, true)
	if err != nil {
		t.Fatal("embedded writer cannot start", err)
	}
	lease.Close()
	run(incoming, "-install")
	run(incoming, "-no-browser")
	wait("core.json", 0)
	wait("host.json", 0)
	if after, _ := remotehost.ReadDescriptor(dir); after.URL != address.URL {
		t.Fatal("switch changed remote address")
	}
	run(executable, "-unregister")
	files, _ = filepath.Glob(filepath.Join(plistDir, "*.plist"))
	if len(files) != 0 {
		t.Fatal("unregister retained login jobs", files)
	}
	for _, name := range []string{"host.json", "core.json", "installation.json"} {
		if _, err := os.ReadFile(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatal("unregister retained", name, err)
		}
	}
}
