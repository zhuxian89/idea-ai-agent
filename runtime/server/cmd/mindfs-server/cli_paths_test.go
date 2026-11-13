package main

import (
	"path/filepath"
	"testing"
)

func TestResolveUserPathsMakesRelativePathsAbsolute(t *testing.T) {
	base := t.TempDir()
	t.Chdir(base)
	config, notify, empty := "agents.json", filepath.Join("scripts", "notify.sh"), ""
	absolute := filepath.Join(base, "already", "absolute.json")
	kept := absolute
	if err := resolveUserPaths(&config, &notify, &empty, &kept); err != nil {
		t.Fatal(err)
	}
	// t.Chdir may report the directory through a symlink (/var vs /private/var), so
	// compare the tails rather than the whole prefix.
	for path, tail := range map[string]string{config: "agents.json", notify: filepath.Join("scripts", "notify.sh")} {
		if !filepath.IsAbs(path) || filepath.Base(path) != filepath.Base(tail) {
			t.Fatalf("not resolved to an absolute path: %q", path)
		}
	}
	if empty != "" {
		t.Fatalf("an unset option must stay empty, got %q", empty)
	}
	if kept != absolute {
		t.Fatalf("an absolute path was rewritten: %q", kept)
	}
}
