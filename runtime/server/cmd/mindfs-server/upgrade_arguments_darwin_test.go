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

// An upgrade runs -install and then a plain -no-browser start. The start must reuse the
// options the managed job was registered with instead of rewriting them with defaults.
func TestPlainStartKeepsSavedGatewayArguments(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, "remote")
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
		files, _ := filepath.Glob(filepath.Join(plistDir, "*.plist"))
		for _, file := range files {
			data, _ := os.ReadFile(file)
			if match := label.FindSubmatch(data); match != nil && strings.HasPrefix(string(match[1]), "dev.ideaagent.") {
				exec.Command("/bin/launchctl", "bootout", "gui/"+strconv.Itoa(os.Getuid())+"/"+string(match[1])).Run()
			}
		}
	})
	run := func(args ...string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		if output, err := exec.CommandContext(ctx, executable, args...).CombinedOutput(); err != nil {
			t.Fatalf("%v: %v\n%s", args, err, output)
		}
	}
	run("-install")
	run("-no-browser", "-no-relayer")
	run("-stop")
	run("-install")
	run("-no-browser")

	files, _ := filepath.Glob(filepath.Join(plistDir, "*.gateway.plist"))
	if len(files) != 1 {
		t.Fatalf("expected one gateway job, found %v", files)
	}
	data, _ := os.ReadFile(files[0])
	if !strings.Contains(string(data), "<string>-no-relayer=true</string>") {
		t.Fatalf("the plain start replaced the saved gateway options:\n%s", data)
	}
	run("-stop")
}
