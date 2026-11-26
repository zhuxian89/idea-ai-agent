package api

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestMain(m *testing.M) {
	os.Exit(runAPITests(m))
}

func runAPITests(m *testing.M) int {
	dir, err := os.MkdirTemp("", "mindfs-api-test-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "create isolated API test directory:", err)
		return 1
	}
	defer os.RemoveAll(dir)

	// Tests run from an Agent session can inherit the live backend's overrides.
	// A test that needs a different layout can still use t.Setenv.
	for key, value := range map[string]string{
		"IDE_AGENT_DATA_DIR":        filepath.Join(dir, "data"),
		"IDE_AGENT_REMOTE_HOST_DIR": "",
		"MINDFS_AGENTS_CONFIG":      "",
		"HOME":                      dir,
		"USERPROFILE":               dir,
		"XDG_CONFIG_HOME":           filepath.Join(dir, "config"),
		"APPDATA":                   filepath.Join(dir, "config"),
		"CODEX_HOME":                "",
		"CLAUDE_CONFIG_DIR":         "",
	} {
		if err := os.Setenv(key, value); err != nil {
			fmt.Fprintf(os.Stderr, "set isolated API test environment %s: %v\n", key, err)
			return 1
		}
	}
	return m.Run()
}
