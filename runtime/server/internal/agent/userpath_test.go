package agent

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestUserBinDirsPerPlatform(t *testing.T) {
	env := func(values map[string]string) func(string) string {
		return func(key string) string { return values[key] }
	}

	windows := userBinDirs("windows", `C:\Users\Administrator`, env(map[string]string{
		"USERPROFILE": `C:\Users\Administrator\`, "APPDATA": `C:\Users\Administrator\AppData\Roaming`, "LOCALAPPDATA": `C:\Users\Administrator\AppData\Local`,
	}))
	want := []string{`C:\Users\Administrator\.local\bin`, `C:\Users\Administrator\AppData\Roaming\npm`, `C:\Users\Administrator\AppData\Local\agy\bin`}
	if len(windows) != len(want) {
		t.Fatalf("windows: %v", windows)
	}
	for i := range want {
		if windows[i] != want[i] {
			t.Errorf("windows[%d] = %q, want %q", i, windows[i], want[i])
		}
	}
	if got := userBinDirs("windows", `C:\Users\u`, env(nil)); len(got) != 1 || got[0] != `C:\Users\u\.local\bin` {
		t.Errorf("without APPDATA the home directory is still searched: %v", got)
	}

	if got := userBinDirs("linux", "/root", env(nil)); got[0] != filepath.Join("/root", ".local", "bin") {
		t.Errorf("a root service must search /root/.local/bin: %v", got)
	}
	if got := userBinDirs("darwin", "/Users/u", env(nil)); got[0] != "/Users/u/.local/bin" || len(got) != 3 {
		t.Errorf("darwin: %v", got)
	}
	if userBinDirs("linux", "", env(nil)) != nil {
		t.Error("no home directory, nothing to add")
	}
}

func TestExtendPathKeepsOrderAndNeverDuplicates(t *testing.T) {
	got := extendPath("/usr/bin:/home/u/.local/bin:/bin", []string{"/home/u/.local/bin", "/usr/local/bin"}, ":", false)
	if got != "/usr/bin:/home/u/.local/bin:/bin:/usr/local/bin" {
		t.Fatalf("existing entries keep their order and position: %s", got)
	}
	if got := extendPath("", []string{"/a", "/b"}, ":", false); got != "/a:/b" {
		t.Fatalf("empty PATH: %s", got)
	}
	if got := extendPath("/a::/a", nil, ":", false); got != "/a" {
		t.Fatalf("blank and repeated entries are dropped: %s", got)
	}
	// Windows paths ignore case, so C:\Tools and c:\tools are the same directory.
	if got := extendPath(`C:\Windows;c:\users\u\.local\bin`, []string{`C:\Users\u\.local\bin`}, ";", true); got != `C:\Windows;c:\users\u\.local\bin` {
		t.Fatalf("case-insensitive match: %s", got)
	}
	if got := extendPath("/a", []string{"/A"}, ":", false); got != "/a:/A" {
		t.Fatalf("Unix paths are case-sensitive: %s", got)
	}
}

// The failure this exists for: an Agent installed after the service started, into a directory
// that was not on the service's PATH, must be found by the same lookup the probe uses.
func TestAgentInstalledIntoUserBinAfterStartIsDetected(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("PATH", "")
	if err := AddUserBinDirsToPath(); err != nil {
		t.Fatal(err)
	}
	name := "zz-agent-under-test"
	status := probeInstallStatus(name, Definition{Name: name, Command: name}, time.Now().UTC())
	if status.Installed {
		t.Fatal("nothing is installed yet")
	}
	bin := filepath.Join(home, ".local", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	file := name
	if os.PathSeparator == '\\' {
		file += ".exe"
	}
	if err := os.WriteFile(filepath.Join(bin, file), []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if status := probeInstallStatus(name, Definition{Name: name, Command: name}, time.Now().UTC()); !status.Installed {
		t.Fatalf("the program in ~/.local/bin was not found: %+v", status)
	}
}
