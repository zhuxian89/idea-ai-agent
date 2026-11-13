package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mindfs/server/internal/api"
	"mindfs/server/internal/fs"
)

func TestStandaloneProjectsAndLegacyMetadata(t *testing.T) {
	dir := t.TempDir()
	registry := fs.NewRegistry(filepath.Join(dir, "registry.json"))
	services := &api.AppContext{Dirs: registry}
	control := &standaloneControl{services: services, token: strings.Repeat("a", 64), address: "http://127.0.0.1:7331", version: "test", stop: func() {}}
	var roots []string
	for _, name := range []string{"first", "second"} {
		project := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Join(project, ".mindfs", "sessions"), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(project, ".mindfs", "sessions", "existing.jsonl"), []byte("old conversation\n"), 0600); err != nil {
			t.Fatal(err)
		}
		legacyDir := filepath.Join(dir, "legacy-"+name)
		legacy := fs.NewRegistry(filepath.Join(legacyDir, "registry.json"))
		if _, err := legacy.Upsert(project); err != nil {
			t.Fatal(err)
		}
		before, _ := os.ReadFile(filepath.Join(legacyDir, "registry.json"))
		input, _ := json.Marshal(map[string]string{"path": project, "legacy_data_dir": legacyDir})
		for i := 0; i < 2; i++ {
			req := httptest.NewRequest("POST", "/control/open-project", bytes.NewReader(input))
			req.Header.Set("Authorization", "Bearer "+control.token)
			response := httptest.NewRecorder()
			control.ServeHTTP(response, req)
			if response.Code != 200 {
				t.Fatalf("open: %d %s", response.Code, response.Body.String())
			}
		}
		after, _ := os.ReadFile(filepath.Join(legacyDir, "registry.json"))
		if !bytes.Equal(before, after) {
			t.Fatal("legacy registry was modified")
		}
		data, _ := os.ReadFile(filepath.Join(project, ".mindfs", "sessions", "existing.jsonl"))
		if string(data) != "old conversation\n" {
			t.Fatal("existing session was modified")
		}
		roots = append(roots, name)
	}
	reloaded := fs.NewRegistry(filepath.Join(dir, "registry.json"))
	if err := reloaded.Load(); err != nil {
		t.Fatal(err)
	}
	if len(reloaded.List()) != 2 {
		t.Fatal("multiple projects did not survive reload")
	}
	for _, id := range roots {
		if _, ok := reloaded.Get(id); !ok {
			t.Fatal("missing project", id)
		}
	}
	response := httptest.NewRecorder()
	control.ServeHTTP(response, httptest.NewRequest("POST", "/control/open-project", nil))
	if response.Code != 401 {
		t.Fatal("unauthorized control access was accepted")
	}
}

func TestStandaloneLocalAndRemoteBoundaries(t *testing.T) {
	token := strings.Repeat("a", 64)
	registry := fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json"))
	services := &api.AppContext{Dirs: registry}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	handler := standaloneAccess(token, services, next)
	req := httptest.NewRequest("GET", "http://127.0.0.1:7331/?ide_token="+token+"&ide=1&ide_chrome=1", nil)
	req = req.WithContext(context.WithValue(req.Context(), http.LocalAddrContextKey, &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 7331}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != 303 || strings.Contains(response.Header().Get("Location"), token) || !strings.Contains(response.Header().Get("Location"), "ide=1") {
		t.Fatal("invalid login redirect", response.Code)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly {
		t.Fatal("missing private session cookie")
	}
	for _, tc := range []struct {
		path, origin, host, header string
		cookie                     bool
		want                       int
	}{
		{path: "/api/dirs", want: 401},
		{path: "/api/dirs", cookie: true, want: 204},
		{path: "/api/dirs", cookie: true, origin: "https://another.example", want: 403},
		{path: "/api/dirs", cookie: true, host: "another.example", want: 403},
		{path: "/api/git/related-file/compare", header: token, want: 204},
		{path: "/api/dirs", header: token, want: 401},
	} {
		req := httptest.NewRequest("GET", "http://127.0.0.1:7331"+tc.path, nil)
		req = req.WithContext(context.WithValue(req.Context(), http.LocalAddrContextKey, &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 7331}))
		if tc.cookie {
			req.AddCookie(cookies[0])
		}
		if tc.host != "" {
			req.Host = tc.host
		}
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("X-MindFS-Local-CLI-Token", tc.header)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != tc.want {
			t.Fatalf("local boundary %+v: %d", tc, response.Code)
		}
	}
	for _, path := range []string{"/control/status", "/control/stop", "/api/idea/remote", "/api/relay/bind", "/api/app/update"} {
		response := httptest.NewRecorder()
		standaloneRemote(next).ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != 404 {
			t.Fatal("remote control exposure", path, response.Code)
		}
	}
	response = httptest.NewRecorder()
	standaloneRemote(next).ServeHTTP(response, httptest.NewRequest("POST", "/api/dirs", nil))
	if response.Code != 204 {
		t.Fatal("standalone remote project management was blocked")
	}
}

func TestStandaloneReusesHomeMetadata(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	project := filepath.Join(t.TempDir(), "home-project")
	if err := os.MkdirAll(project, 0700); err != nil {
		t.Fatal(err)
	}
	project, err := filepath.EvalSymlinks(project)
	if err != nil {
		t.Fatal(err)
	}
	legacyDir := t.TempDir()
	legacy := fs.NewRegistry(filepath.Join(legacyDir, "registry.json"))
	root, err := legacy.UpsertWithMetaLocation(project, fs.MetaLocationHome)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := root.EnsureMetaDir(); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(root.MetaDir(), "history.txt")
	if err := os.WriteFile(sentinel, []byte("keep me"), 0600); err != nil {
		t.Fatal(err)
	}
	services := &api.AppContext{Dirs: fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json"))}
	standaloneDir := t.TempDir()
	writePreviousRemoteProjects(t, standaloneDir, true, previousRemoteProjectFixture{ID: "old-home", Path: project, Enabled: true})
	if _, err := migrateStandaloneProjects(standaloneDir, services.Dirs); err != nil {
		t.Fatal(err)
	}
	imported, ok := services.Dirs.Get(root.ID)
	if !ok || imported.MetaLocation != fs.MetaLocationHome || imported.MetaDir() != root.MetaDir() {
		t.Fatal("import did not reuse home metadata", imported)
	}
	control := &standaloneControl{services: services, token: strings.Repeat("b", 64)}
	body, _ := json.Marshal(map[string]string{"path": project, "legacy_data_dir": legacyDir})
	req := httptest.NewRequest("POST", "/control/open-project", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+control.token)
	response := httptest.NewRecorder()
	control.ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	opened, ok := services.Dirs.Get(root.ID)
	if !ok || opened.MetaLocation != fs.MetaLocationHome || opened.MetaDir() != root.MetaDir() {
		t.Fatal("home metadata location changed", opened)
	}
	data, err := os.ReadFile(sentinel)
	if err != nil || string(data) != "keep me" {
		t.Fatal("home data was changed", err)
	}
	if _, err := os.Stat(filepath.Join(project, ".mindfs")); !os.IsNotExist(err) {
		t.Fatal("created a second metadata directory")
	}
}
