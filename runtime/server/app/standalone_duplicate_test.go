package app

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mindfs/server/internal/api"
	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/fs"
)

// A project already shared by the previous remote entry (A), then added again
// from the standalone UI through a different spelling of the same directory.
// It must stay one project with one conversation history.
func TestStandaloneReaddingProjectThroughAliasKeepsOneProject(t *testing.T) {
	base := t.TempDir()
	real, err := filepath.EvalSymlinks(base)
	if err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(real, "A")
	if err := os.MkdirAll(filepath.Join(project, ".mindfs", "sessions"), 0700); err != nil {
		t.Fatal(err)
	}
	history := filepath.Join(project, ".mindfs", "sessions", "existing.jsonl")
	if err := os.WriteFile(history, []byte("old conversation\n"), 0600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(real, "alias-to-A")
	if err := os.Symlink(project, alias); err != nil {
		t.Skip("symlinks unavailable:", err)
	}

	registry := fs.NewRegistry(filepath.Join(real, "registry.json"))
	writePreviousRemoteProjects(t, real, true, previousRemoteProjectFixture{ID: "old-A", Path: project, Enabled: true})
	if _, err := migrateStandaloneProjects(real, registry); err != nil {
		t.Fatal(err)
	}
	if len(registry.List()) != 1 {
		t.Fatalf("migration should import A once: %+v", registry.List())
	}

	services := &api.AppContext{Dirs: registry}
	control := &standaloneControl{services: services, token: strings.Repeat("a", 64), address: "http://127.0.0.1:7331", version: "test", stop: func() {}}
	open := func(path string) {
		t.Helper()
		input, _ := json.Marshal(map[string]string{"path": path})
		req := httptest.NewRequest("POST", "/control/open-project", bytes.NewReader(input))
		req.Header.Set("Authorization", "Bearer "+control.token)
		response := httptest.NewRecorder()
		control.ServeHTTP(response, req)
		if response.Code != 200 {
			t.Fatalf("open %s: %d %s", path, response.Code, response.Body.String())
		}
	}
	open(project) // new plugin opens A
	open(alias)   // the same directory through a symlink
	if roots := registry.List(); len(roots) != 1 {
		t.Fatalf("open-project produced duplicate projects: %+v", roots)
	}

	// The browser's "add project" path.
	for _, path := range []string{project, alias} {
		if _, err := (&usecase.Service{Registry: services}).AddManagedDir(nil, usecase.AddManagedDirInput{Path: path}); err != nil {
			t.Fatalf("add %s: %v", path, err)
		}
	}
	roots := registry.List()
	if len(roots) != 1 {
		t.Fatalf("browser add produced duplicate projects: %+v", roots)
	}
	if data, _ := os.ReadFile(history); string(data) != "old conversation\n" {
		t.Fatal("conversation history changed")
	}
}

func TestStandaloneReusesExistingAliasIdentityAndHistory(t *testing.T) {
	for _, location := range []string{fs.MetaLocationProject, fs.MetaLocationHome} {
		t.Run(location, func(t *testing.T) {
			base := t.TempDir()
			t.Setenv("HOME", base)
			t.Setenv("USERPROFILE", base)
			project := filepath.Join(base, "real-project")
			if err := os.Mkdir(project, 0700); err != nil {
				t.Fatal(err)
			}
			alias := filepath.Join(base, "old-alias")
			if err := os.Symlink(project, alias); err != nil {
				t.Skip("symlinks unavailable:", err)
			}
			registryPath := filepath.Join(base, "registry.json")
			registry := fs.NewRegistry(registryPath)
			old, err := registry.UpsertWithMetaLocation(alias, location)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := old.EnsureMetaDir(); err != nil {
				t.Fatal(err)
			}
			if err := old.WriteMetaFile("history.jsonl", []byte("existing conversation\n")); err != nil {
				t.Fatal(err)
			}
			// Reload a persisted alias record, as on an upgrade from the old backend.
			registry = fs.NewRegistry(registryPath)
			if err := registry.Load(); err != nil {
				t.Fatal(err)
			}
			services := &api.AppContext{Dirs: registry}
			control := &standaloneControl{services: services, token: strings.Repeat("a", 64)}
			for _, path := range []string{project, alias, project} {
				input, _ := json.Marshal(map[string]string{"path": path})
				req := httptest.NewRequest("POST", "/control/open-project", bytes.NewReader(input))
				req.Header.Set("Authorization", "Bearer "+control.token)
				response := httptest.NewRecorder()
				control.ServeHTTP(response, req)
				var opened struct {
					RootID string `json:"root_id"`
				}
				if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &opened) != nil || opened.RootID != old.ID {
					t.Fatalf("open-project changed identity: %d %s", response.Code, response.Body.String())
				}
				added, err := (&usecase.Service{Registry: services}).AddManagedDir(nil, usecase.AddManagedDirInput{Path: path})
				if err != nil || added.Dir.ID != old.ID || added.Dir.MetaLocation != location || added.Dir.RootPath != old.RootPath {
					t.Fatalf("browser add changed identity: %+v, %v", added, err)
				}
			}
			roots := registry.List()
			if len(roots) != 1 || roots[0].ID != old.ID || roots[0].MetaDir() != old.MetaDir() {
				t.Fatalf("old identity was not preserved: %+v", roots)
			}
			if data, err := os.ReadFile(filepath.Join(old.MetaDir(), "history.jsonl")); err != nil || string(data) != "existing conversation\n" {
				t.Fatalf("history changed: %q, %v", data, err)
			}
			if location == fs.MetaLocationHome {
				if _, err := os.Stat(filepath.Join(project, ".mindfs")); !os.IsNotExist(err) {
					t.Fatalf("browser add created an unused project metadata directory: %v", err)
				}
			}
		})
	}
}
