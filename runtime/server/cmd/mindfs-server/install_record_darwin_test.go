//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"testing"
)

// -install is what the installer scripts use to decide a first installation is done:
// a registration that fails must not leave an installation record behind.
func TestInstallRecordsOnlyAfterRegistration(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, "remote")
	// A file where ~/Library should be makes the LaunchAgent registration fail.
	if err := os.WriteFile(filepath.Join(home, "Library"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("IDE_AGENT_REMOTE_HOST_DIR", dir)

	if err := runCLI([]string{"-install"}); err == nil {
		t.Fatal("registration should have failed")
	}
	if _, err := os.Stat(filepath.Join(dir, "installation.json")); !os.IsNotExist(err) {
		t.Fatalf("a failed registration left an installation record: %v", err)
	}
}
