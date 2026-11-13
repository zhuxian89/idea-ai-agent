//go:build darwin

package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// A managed job starts from launchd's working directory, so a relative option typed in the
// user's shell must reach the job as an absolute path.
func TestManagedStartRecordsAbsolutePaths(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, "remote")
	project := filepath.Join(home, "work", "project")
	if err := os.MkdirAll(project, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "work", "agents.json"), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(home, "local-ai-agent")
	if output, err := exec.Command("go", "build", "-o", executable, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, output)
	}
	t.Setenv("HOME", home)
	t.Setenv("IDE_AGENT_REMOTE_HOST_DIR", dir)
	t.Setenv("MINDFS_RELAY_BASE_URL", "http://127.0.0.1:1")
	t.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
	plistDir := filepath.Join(home, "Library", "LaunchAgents")
	label := regexp.MustCompile(`<key>Label</key><string>([^<]+)</string>`)
	t.Cleanup(func() {
		// These are temporary KeepAlive jobs: unload them even if an assertion failed.
		files, _ := filepath.Glob(filepath.Join(plistDir, "*.plist"))
		for _, file := range files {
			data, _ := os.ReadFile(file)
			if match := label.FindSubmatch(data); match != nil && strings.HasPrefix(string(match[1]), "dev.ideaagent.") {
				exec.Command("/bin/launchctl", "bootout", "gui/"+strconv.Itoa(os.Getuid())+"/"+string(match[1])).Run()
			}
		}
	})
	run := func(cwd string, args ...string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, executable, args...)
		command.Dir = cwd
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("%v: %v\n%s", args, err, output)
		}
	}
	run(home, "-install")
	run(filepath.Join(home, "work"), "-no-browser", "-addr", "127.0.0.1:0", "-agent-config", "agents.json", "project")

	files, _ := filepath.Glob(filepath.Join(plistDir, "*.gateway.plist"))
	if len(files) != 1 {
		t.Fatalf("expected one gateway job, found %v", files)
	}
	data, _ := os.ReadFile(files[0])
	// The recorded job must name the absolute locations, not the bare relative ones.
	resolved, _ := filepath.EvalSymlinks(filepath.Join(home, "work"))
	for _, want := range []string{filepath.Join(resolved, "agents.json"), filepath.Join(resolved, "project")} {
		if !strings.Contains(string(data), "<string>"+want+"</string>") && !strings.Contains(string(data), "<string>"+filepath.Join(filepath.Join(home, "work"), filepath.Base(want))+"</string>") {
			t.Fatalf("managed job does not record the absolute path %s:\n%s", want, data)
		}
	}
	for _, relative := range []string{"<string>agents.json</string>", "<string>project</string>"} {
		if strings.Contains(string(data), relative) {
			t.Fatalf("managed job still holds a relative path %s", relative)
		}
	}
}
