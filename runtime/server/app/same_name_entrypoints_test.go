package app

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"mindfs/server/internal/api"
	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/preferences"
)

func sameNameHomePreferences(t *testing.T, base string) *preferences.Store {
	t.Helper()
	t.Setenv("HOME", base)
	t.Setenv("USERPROFILE", base)
	t.Setenv("IDE_AGENT_DATA_DIR", filepath.Join(base, "config"))
	prefs, err := preferences.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := prefs.UpdateNewProjectMetaLocation(fs.MetaLocationHome); err != nil {
		t.Fatal(err)
	}
	return prefs
}

func TestSameNameGitWorktreeRegistrationUsesOwnHomeMetadata(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not found")
	}
	base := t.TempDir()
	prefs := sameNameHomePreferences(t, base)
	project := filepath.Join(base, "Z", "project")
	parent := filepath.Join(base, "D")
	mkdirAll(t, project)
	mkdirAll(t, parent)
	runAppTestGit(t, project, "init")
	runAppTestGit(t, project, "config", "user.email", "test@example.com")
	runAppTestGit(t, project, "config", "user.name", "Test User")
	if err := os.WriteFile(filepath.Join(project, "README.md"), []byte("base\n"), 0600); err != nil {
		t.Fatal(err)
	}
	runAppTestGit(t, project, "add", "README.md")
	runAppTestGit(t, project, "commit", "-m", "initial")
	registry := fs.NewRegistry(filepath.Join(base, "registry.json"))
	root, err := registry.UpsertWithMetaLocation(project, fs.MetaLocationHome)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := root.EnsureMetaDir(); err != nil {
		t.Fatal(err)
	}
	if err := root.WriteMetaFile("history.jsonl", []byte("original history\n")); err != nil {
		t.Fatal(err)
	}
	service := &usecase.Service{Registry: &api.AppContext{Dirs: registry, Prefs: prefs}}
	created, err := service.CreateGitWorktree(context.Background(), usecase.CreateGitWorktreeInput{
		RootID: root.ID, ParentPath: parent, Name: "project", BranchMode: "new", Register: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Dir.ID == root.ID || created.Dir.Name != root.Name || created.Dir.MetaLocation != fs.MetaLocationHome || created.Dir.MetaDir() == root.MetaDir() {
		t.Fatalf("worktree metadata overlaps original: %+v", created.Dir)
	}
	if _, err := os.Stat(filepath.Join(created.Dir.RootPath, ".mindfs")); !os.IsNotExist(err) {
		t.Fatalf("home worktree created project-local metadata: %v", err)
	}
	if _, err := service.RemoveGitWorktree(context.Background(), usecase.RemoveGitWorktreeInput{RootID: created.Dir.ID}); err != nil {
		t.Fatal(err)
	}
	if roots := registry.List(); len(roots) != 1 || roots[0].ID != root.ID {
		t.Fatalf("worktree removal changed original: %+v", roots)
	}
	data, err := root.ReadMetaFile("history.jsonl")
	if err != nil || string(data) != "original history\n" {
		t.Fatalf("original history changed: %q, %v", data, err)
	}
}

func TestSameNameAutoDiscoveryUsesSeparateHomeMetadata(t *testing.T) {
	base := t.TempDir()
	prefs := sameNameHomePreferences(t, base)
	var paths []string
	for _, parent := range []string{"Z", "D"} {
		path := filepath.Join(base, parent, "project")
		mkdirAll(t, path)
		paths = append(paths, path)
	}
	codexDir := filepath.Join(base, "codex")
	mkdirAll(t, codexDir)
	t.Setenv("CODEX_HOME", codexDir)
	tempDir := filepath.Join(base, "temp")
	mkdirAll(t, tempDir)
	for _, name := range []string{"TMPDIR", "TMP", "TEMP"} {
		t.Setenv(name, tempDir)
	}
	payload, err := json.Marshal(map[string]any{"project-order": paths})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codexDir, ".codex-global-state.json"), payload, 0600); err != nil {
		t.Fatal(err)
	}
	registry := fs.NewRegistry(filepath.Join(base, "registry.json"))
	autoAddExternalProjectRoots(registry, prefs)
	autoAddExternalProjectRoots(registry, prefs)
	roots := registry.List()
	if len(roots) != 2 || roots[0].ID == roots[1].ID || roots[0].Name != roots[1].Name || roots[0].MetaDir() == roots[1].MetaDir() {
		t.Fatalf("same-name auto discovery merged roots: %+v", roots)
	}
	for _, root := range roots {
		if root.MetaLocation != fs.MetaLocationHome {
			t.Fatalf("metadata preference changed: %+v", root)
		}
		if _, err := root.EnsureMetaDir(); err != nil {
			t.Fatalf("metadata belongs to another project: %v", err)
		}
	}
}
