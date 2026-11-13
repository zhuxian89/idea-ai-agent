package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mindfs/server/internal/fs"
)

type previousRemoteProjectFixture struct {
	ID            string `json:"project_id"`
	Path          string `json:"path"`
	Enabled       bool   `json:"enabled"`
	SharingPaused bool   `json:"sharing_paused,omitempty"`
}

func writePreviousRemoteProjects(t *testing.T, dir string, enabled bool, projects ...previousRemoteProjectFixture) []byte {
	t.Helper()
	data, err := json.Marshal(struct {
		Enabled  bool                           `json:"enabled"`
		Projects []previousRemoteProjectFixture `json:"projects"`
	}{enabled, projects})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "projects.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestStandaloneImportsPreviousRemoteProjectsOnce(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "first")
	existing := filepath.Join(dir, "existing")
	paused := filepath.Join(dir, "paused")
	disabled := filepath.Join(dir, "disabled")
	for _, path := range []string{first, existing, paused, disabled} {
		if err := os.MkdirAll(filepath.Join(path, ".mindfs", "sessions"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	history := filepath.Join(first, ".mindfs", "sessions", "existing.jsonl")
	if err := os.WriteFile(history, []byte("existing conversation\n"), 0600); err != nil {
		t.Fatal(err)
	}
	registryPath := filepath.Join(dir, "registry.json")
	registry := fs.NewRegistry(registryPath)
	before, err := registry.Upsert(existing)
	if err != nil {
		t.Fatal(err)
	}
	source := writePreviousRemoteProjects(t, dir, true,
		previousRemoteProjectFixture{ID: "old-first", Path: first, Enabled: true},
		previousRemoteProjectFixture{ID: "old-alias", Path: first, Enabled: true},
		previousRemoteProjectFixture{ID: "old-existing", Path: existing, Enabled: true},
		previousRemoteProjectFixture{ID: "old-paused", Path: paused, Enabled: true, SharingPaused: true},
		previousRemoteProjectFixture{ID: "old-disabled", Path: disabled},
		previousRemoteProjectFixture{ID: "old-missing", Path: filepath.Join(dir, "missing"), Enabled: true})
	migration, err := migrateStandaloneProjects(dir, registry)
	if err != nil {
		t.Fatal(err)
	}
	if len(registry.List()) != 2 || len(migration.Projects) != 3 {
		t.Fatalf("unexpected imported projects: %+v aliases: %+v", registry.List(), migration.Projects)
	}
	after, _ := registry.Get(before.ID)
	if after != before {
		t.Fatal("existing independent project was changed")
	}
	if current, err := os.ReadFile(history); err != nil || string(current) != "existing conversation\n" {
		t.Fatal("conversation data changed", err)
	}
	if current, err := os.ReadFile(filepath.Join(dir, "projects.json")); err != nil || !bytes.Equal(current, source) {
		t.Fatal("previous project list was changed", err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".mindfs")); !os.IsNotExist(err) {
		t.Fatal("conversation storage was created in the independent config directory")
	}
	imported, _ := registry.Get("first")
	if _, err := registry.Remove(imported.RootPath); err != nil {
		t.Fatal(err)
	}
	remotePath := filepath.Join(dir, "remote-access.json")
	if err := os.WriteFile(remotePath, []byte(`{"enabled":false}`), 0600); err != nil {
		t.Fatal(err)
	}
	reloaded := fs.NewRegistry(registryPath)
	if err := reloaded.Load(); err != nil {
		t.Fatal(err)
	}
	secondMigration, err := migrateStandaloneProjects(dir, reloaded)
	if err != nil {
		t.Fatal(err)
	}
	canonicalFirst, err := filepath.EvalSymlinks(first)
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.List()) != 1 || secondMigration.Projects["old-first"] != canonicalFirst {
		t.Fatal("restart restored a removed project or discarded link aliases")
	}
	if data, _ := os.ReadFile(remotePath); string(data) != `{"enabled":false}` {
		t.Fatal("restart overwrote the independent remote setting")
	}
}

func TestStandaloneImportsRemoteEnabledStateWithoutOverwritingSettings(t *testing.T) {
	for _, tc := range []struct {
		name     string
		previous bool
		existing string
		want     bool
	}{
		{name: "enabled", previous: true, want: true},
		{name: "disabled", previous: false, want: false},
		{name: "independent setting", previous: true, existing: `{"enabled":false}`, want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			writePreviousRemoteProjects(t, dir, tc.previous)
			remotePath := filepath.Join(dir, "remote-access.json")
			if tc.existing != "" {
				if err := os.WriteFile(remotePath, []byte(tc.existing), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := migrateStandaloneProjects(dir, fs.NewRegistry(filepath.Join(dir, "registry.json"))); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(remotePath)
			if err != nil {
				t.Fatal(err)
			}
			var saved struct{ Enabled bool }
			if err := json.Unmarshal(data, &saved); err != nil || saved.Enabled != tc.want {
				t.Fatal("wrong remote enabled state", string(data), err)
			}
		})
	}
}

func TestStandaloneMigrationReportsInvalidSourceAndNameConflicts(t *testing.T) {
	t.Run("invalid source", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "projects.json"), []byte("{invalid"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := migrateStandaloneProjects(dir, fs.NewRegistry(filepath.Join(dir, "registry.json"))); err == nil {
			t.Fatal("invalid previous projects accepted")
		}
		if _, err := os.Stat(filepath.Join(dir, "standalone-migration.json")); !os.IsNotExist(err) {
			t.Fatal("failed migration was marked complete")
		}
	})
	t.Run("same name at another path", func(t *testing.T) {
		dir := t.TempDir()
		first, second := filepath.Join(dir, "a", "project"), filepath.Join(dir, "b", "project")
		for _, path := range []string{first, second} {
			if err := os.MkdirAll(path, 0700); err != nil {
				t.Fatal(err)
			}
		}
		registry := fs.NewRegistry(filepath.Join(dir, "registry.json"))
		before, err := registry.Upsert(first)
		if err != nil {
			t.Fatal(err)
		}
		writePreviousRemoteProjects(t, dir, true, previousRemoteProjectFixture{ID: "old", Path: second, Enabled: true})
		if _, err := migrateStandaloneProjects(dir, registry); err == nil || !strings.Contains(err.Error(), "already managed") {
			t.Fatal("project conflict was not reported", err)
		}
		if after, _ := registry.Get(before.ID); before != after {
			t.Fatal("existing project overwritten by import")
		}
	})
}

func TestStandaloneOldProjectLinksKeepProjectSessionAndRelayPrefix(t *testing.T) {
	dir := t.TempDir()
	project := filepath.Join(dir, "original project")
	registry := fs.NewRegistry(filepath.Join(dir, "registry.json"))
	root, err := registry.Upsert(project)
	if err != nil {
		t.Fatal(err)
	}
	handler := (&standaloneMigration{Projects: map[string]string{"old-id": project}}).projectLinks(registry)
	for _, base := range []string{"http://127.0.0.1:7331", "https://relay.example/n/node-id"} {
		for _, suffix := range []string{"/p/old-id", "/p/old-id/"} {
			request := httptest.NewRequest("GET", "http://127.0.0.1:7331"+suffix+"?root=old&session=existing&file=src%2FApp.tsx", nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusTemporaryRedirect {
				t.Fatal("old link did not redirect", response.Code)
			}
			location, err := url.Parse(response.Header().Get("Location"))
			if err != nil {
				t.Fatal(err)
			}
			browserURL, _ := url.Parse(base + suffix)
			resolved := browserURL.ResolveReference(location)
			if !strings.HasPrefix(resolved.String(), base+"/?") || resolved.Query().Get("root") != root.ID || resolved.Query().Get("session") != "existing" || resolved.Query().Get("file") != "src/App.tsx" {
				t.Fatal("old location was lost", resolved.String())
			}
		}
	}
	for _, tc := range []struct{ method, path string }{{"GET", "/p/unknown/"}, {"GET", "/p/old-id/api/sessions"}, {"POST", "/p/old-id/"}} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, nil))
		if response.Code != 404 {
			t.Fatal("invalid navigation accepted", tc, response.Code)
		}
	}
	if _, err := registry.Remove(project); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/p/old-id/", nil))
	if response.Code != 404 {
		t.Fatal("removed project was reopened by its old link")
	}
}
