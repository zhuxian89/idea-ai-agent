package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/session"
)

func TestSessionLogPathRouteAndAccess(t *testing.T) {
	registry := fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json"))
	root, err := registry.Upsert(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &AppContext{Dirs: registry}
	manager, err := app.GetSessionManager(root.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Shutdown() })
	sess, err := manager.Create(context.Background(), session.CreateInput{Type: session.TypeChat, Agent: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	route := (&HTTPHandler{AppContext: app}).Routes()
	path := "/api/sessions/" + sess.Key + "/log-path?root=" + url.QueryEscape(root.ID)
	w := httptest.NewRecorder()
	route.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var payload map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["path"] != manager.ExchangeLogAbsolutePath(sess.Key) {
		t.Fatalf("payload = %v", payload)
	}
	app.E2EE = e2ee.NewManager(e2ee.Config{Enabled: true, NodeID: "node", PairingSecret: "secret"})
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("X-MindFS-Relayed", "1")
	w = httptest.NewRecorder()
	route.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unprotected log path: %d %s", w.Code, w.Body)
	}
}
