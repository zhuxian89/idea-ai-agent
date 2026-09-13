package api

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"mindfs/server/internal/fs"
)

func TestIDEProjectLockCoversInternalWorkflows(t *testing.T) {
	project := t.TempDir()
	registryPath := filepath.Join(t.TempDir(), "registry.json")
	registry := fs.NewRegistry(registryPath)
	root, err := registry.Upsert(project)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(registryPath)
	if err != nil {
		t.Fatal(err)
	}
	app := &AppContext{Dirs: registry, ProjectLocked: true}
	for name, operation := range map[string]func() error{
		"internal registration": func() error { _, err := app.UpsertRoot(filepath.Join(project, "other")); return err },
		"root removal":          func() error { _, err := app.RemoveRoot(project); return err },
		"root rename":           func() error { _, err := app.RenameRoot(root.ID, "other", project); return err },
	} {
		t.Run(name, func(t *testing.T) {
			if err := operation(); !errors.Is(err, ErrProjectLocked) {
				t.Fatalf("expected locked project error, got %v", err)
			}
		})
	}
	after, err := os.ReadFile(registryPath)
	if err != nil || string(before) != string(after) {
		t.Fatal("locked registry was mutated")
	}
	if _, err := os.Stat(filepath.Join(project, ".worktree")); !os.IsNotExist(err) {
		t.Fatal("worktree workflow touched the filesystem")
	}
	if got := app.ListRoots(); len(got) != 1 || got[0].ID != root.ID {
		t.Fatal("current project was not preserved")
	}
}

func TestIDEProjectSupportsSessionAndTaskWorktrees(t *testing.T) {
	project := t.TempDir()
	for _, args := range [][]string{{"init", "-q", project}, {"-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "initial"}} {
		if output, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git: %s: %v", output, err)
		}
	}
	registry := fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json"))
	root, err := registry.Upsert(project)
	if err != nil {
		t.Fatal(err)
	}
	app := &AppContext{Dirs: registry, ProjectLocked: true}
	first, err := app.CreateSessionWorktree(context.Background(), root.ID, "new", "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := app.CreateTaskWorktree(context.Background(), root.ID, "task-test", "new", "")
	if err != nil {
		t.Fatal(err)
	}
	if first.Path == second.Path {
		t.Fatal("worktrees should isolate concurrent tasks")
	}
	for _, path := range []string{first.Path, second.Path} {
		if _, err := os.Stat(filepath.Join(path, ".git")); err != nil {
			t.Fatal(err)
		}
	}
	if len(app.ListRoots()) != 1 {
		t.Fatal("worktree changed the IDE project registry")
	}
}
