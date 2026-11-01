package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mindfs/server/internal/api"
	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/relay"
	"mindfs/server/internal/remotehost"
)

func TestRemoteHostMigrationPreservesLegacyUntilBound(t *testing.T) {
	dataDir, hostDir := t.TempDir(), t.TempDir()
	t.Setenv("IDE_AGENT_DATA_DIR", dataDir)
	t.Setenv("MINDFS_RELAY_BASE_URL", "")
	preference := filepath.Join(dataDir, "remote-access.json")
	if err := os.WriteFile(preference, []byte(`{"enabled":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	manager, err := relay.NewManager("127.0.0.1:1", true, "https://relay.invalid", false)
	if err != nil {
		t.Fatal(err)
	}
	old := e2ee.Config{Enabled: true, NodeID: "legacy-A", PairingSecret: "old-secret"}
	app := &api.AppContext{E2EE: e2ee.NewManager(old), ProjectLocked: true, Relay: manager}
	legacy, err := newRemoteAccessControl(manager, app)
	if err != nil {
		t.Fatal(err)
	}
	bound := false
	var registered remotehost.Registration
	failRegister := false
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer control-secret" {
			t.Error("missing control credential")
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/control/status", "/control/bind":
			_ = json.NewEncoder(w).Encode(remotehost.Status{Status: relay.Status{Bound: bound, Connected: true, NodeURL: "https://relay.test/n/computer/"}, Enabled: true, PairingSecret: "computer-secret", Protocol: 1})
		case "/control/register":
			_ = json.NewDecoder(r.Body).Decode(&registered)
			if failRegister {
				w.WriteHeader(409)
				_, _ = io.WriteString(w, `{"error":"project_owner_conflict"}`)
				return
			}
			_, _ = io.WriteString(w, `{"project_id":"P"}`)
		default:
			_, _ = io.WriteString(w, `{"ok":true}`)
		}
	}))
	defer control.Close()
	descriptor, _ := json.Marshal(remotehost.Descriptor{Protocol: 1, URL: control.URL, Token: "control-secret"})
	if err = os.WriteFile(filepath.Join(hostDir, "host.json"), descriptor, 0600); err != nil {
		t.Fatal(err)
	}
	c, err := newRemoteHostControl(legacy, hostDir, t.TempDir(), "http://127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	if err = c.syncLocked(context.Background()); err != nil {
		t.Fatal(err)
	}
	if registered.Enabled || manager.NoRelayer() || app.E2EE.NodeID() != old.NodeID {
		t.Fatal("opening unified entry must not migrate legacy implicitly")
	}
	w := httptest.NewRecorder()
	c.ServeHTTP(w, httptest.NewRequest("POST", "/api/idea/remote/migrate", strings.NewReader(`{}`)))
	if w.Code != 200 || !c.saved.MigrationPending || manager.NoRelayer() {
		t.Fatalf("binding must preserve legacy: %d %s", w.Code, w.Body.String())
	}
	bound = true
	failRegister = true
	if err = c.syncLocked(context.Background()); err == nil {
		t.Fatal("expected preparation failure")
	}
	if c.saved.Mode != "" || manager.NoRelayer() || app.E2EE.NodeID() != old.NodeID {
		t.Fatal("failed preparation destroyed legacy access")
	}
	failRegister = false
	// Cancelling during binding must survive both this process and restart.
	w = httptest.NewRecorder()
	c.ServeHTTP(w, httptest.NewRequest("POST", "/api/idea/remote/enable", strings.NewReader(`{"enabled":false}`)))
	if w.Code != 200 || c.saved.MigrationPending {
		t.Fatal("disable did not cancel migration")
	}
	if err = c.syncLocked(context.Background()); err != nil {
		t.Fatal(err)
	}
	if c.saved.Mode != "" || c.saved.Enabled {
		t.Fatal("cancelled migration silently re-enabled project")
	}
	w = httptest.NewRecorder()
	c.ServeHTTP(w, httptest.NewRequest("POST", "/api/idea/remote/migrate", strings.NewReader(`{}`)))
	if w.Code != 200 {
		t.Fatalf("migration retry: %d %s", w.Code, w.Body.String())
	}
	if err = c.syncLocked(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !manager.NoRelayer() || c.saved.Mode != "host" || c.saved.MigrationPending || !registered.Enabled || !c.allowed() {
		t.Fatal("migration did not transfer entry")
	}
	if app.E2EE.NodeID() == old.NodeID || app.E2EE.PairingSecret() == old.PairingSecret {
		t.Fatal("legacy browser authority was reused")
	}
	var saved remoteProjectPreference
	bytes, err := os.ReadFile(preference)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(bytes, &saved); err != nil || saved.Mode != "host" || !saved.Enabled {
		t.Fatal("migration not durable", err)
	}
	// Re-loading must never restart the old Relay connector.
	restored, err := newRemoteAccessControl(manager, app)
	if err != nil {
		t.Fatal(err)
	}
	if restored.enabled || !manager.NoRelayer() {
		t.Fatal("migrated project restarted independent relay")
	}
	// An ownership failure is visible and cannot fall back to the old node.
	failRegister = true
	if err = c.syncLocked(context.Background()); err == nil || err.Error() != "project_owner_conflict" {
		t.Fatalf("conflict: %v", err)
	}
	if c.allowed() || !manager.NoRelayer() {
		t.Fatal("owner conflict exposed old/new endpoint")
	}
	control.Close()
	if err = c.syncLocked(context.Background()); err == nil {
		t.Fatal("missing host failure")
	}
	if c.host.Connected {
		t.Fatal("lost host still reported online")
	}
}

func TestRemoteProjectEntryBindsProofToProjectAndRejectsNativeBypass(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("IDE_AGENT_DATA_DIR", dataDir)
	manager, err := relay.NewManager("127.0.0.1:1", true, "https://relay.invalid", false)
	if err != nil {
		t.Fatal(err)
	}
	crypto := e2ee.NewManager(e2ee.Config{Enabled: true, NodeID: "new-project", PairingSecret: "new-secret"})
	key := []byte("0123456789abcdef0123456789abcdef")
	if _, err = crypto.OpenSessionForClient("browser", e2ee.DerivedKey{Transport: key}); err != nil {
		t.Fatal(err)
	}
	app := &api.AppContext{E2EE: crypto, ProjectLocked: true, Relay: manager}
	c := &remoteHostControl{legacy: &remoteAccessControl{app: app, manager: manager}, token: "private-project-token", projectID: "P"}
	c.route.Store(remoteProjectRoute{ID: "P", Active: true})
	handler := c.middleware((&api.HTTPHandler{AppContext: app}).Routes())
	send := func(path, proofPath, token string) int {
		r := httptest.NewRequest("GET", path, nil)
		if token != "" {
			r.Header.Set(remotehost.ProjectTokenHeader, token)
		}
		r.Header.Set("X-MindFS-Local-CLI-Token", "native-token")
		r.Header.Set("X-IDE-Local", "true")
		if proofPath != "" {
			ts := time.Now().UTC().Format(time.RFC3339)
			r.Header.Set("X-MindFS-E2EE", "1")
			r.Header.Set("X-MindFS-Client-ID", "browser")
			r.Header.Set("X-MindFS-TS", ts)
			r.Header.Set("X-MindFS-Proof", e2ee.BuildRequestProof(key, "GET", proofPath, ts, "browser"))
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Code
	}
	for _, tc := range []struct {
		path, proof, token string
		want               int
	}{
		{"/p/P/api/dirs", "/p/P/api/dirs", c.token, 200},
		{"/p/P/api/dirs", "/api/dirs", c.token, 401},
		{"/p/P/api/dirs", "/p/Q/api/dirs", c.token, 401},
		{"/p/P/api/dirs", "", c.token, 401},
		{"/p/P/api/dirs", "/p/P/api/dirs", "", 401},
		{"/p/Q/api/dirs", "/p/Q/api/dirs", c.token, 404},
		{"/p/P/api/idea/remote", "/p/P/api/idea/remote", c.token, 404},
		{"/p/P/api/dirs?name=%E4%B8%AD%20x", "/p/P/api/dirs?name=%E4%B8%AD%20x", c.token, 200},
	} {
		if got := send(tc.path, tc.proof, tc.token); got != tc.want {
			t.Errorf("%s proof=%s got=%d want=%d", tc.path, tc.proof, got, tc.want)
		}
	}
	c.setRoute(false)
	if got := send("/p/P/api/dirs", "/p/P/api/dirs", c.token); got != 503 {
		t.Fatalf("revoked project: %d", got)
	}
}
