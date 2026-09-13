package api

import (
	"context"
	"errors"
	"os"
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
	ctx := context.Background()
	for name, operation := range map[string]func() error{
		"websocket session worktree": func() error { _, err := app.CreateSessionWorktree(ctx, root.ID, "new", ""); return err },
		"scheduled task worktree":    func() error { _, err := app.CreateTaskWorktree(ctx, root.ID, "task-1", "new", ""); return err },
		"internal registration":      func() error { _, err := app.UpsertRoot(filepath.Join(project, "other")); return err },
		"root removal":               func() error { _, err := app.RemoveRoot(project); return err },
		"root rename":                func() error { _, err := app.RenameRoot(root.ID, "other", project); return err },
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
