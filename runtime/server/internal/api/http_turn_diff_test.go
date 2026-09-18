package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"mindfs/server/internal/fs"
)

func TestTurnDiffArtifactRequiresLocalToken(t *testing.T) {
	handler := &HTTPHandler{
		AppContext:    &AppContext{Dirs: fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json"))},
		LocalCLIToken: "token",
	}
	w := httptest.NewRecorder()
	handler.handleTurnDiffArtifact(w, httptest.NewRequest(http.MethodGet, "/api/sessions/s/turn-diffs/id", nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("HTTP = %d, body = %s", w.Code, w.Body)
	}
}

func TestTurnDiffArtifactAcceptsIDEAccessToken(t *testing.T) {
	handler := &HTTPHandler{
		AppContext:       &AppContext{Dirs: fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json"))},
		LocalCLIToken:    "local-cli-token",
		LocalAccessToken: "ide-access-token",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/sessions/s/turn-diffs/id", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	req.Header.Set(localCLIHeaderName, "ide-access-token")
	w := httptest.NewRecorder()
	handler.handleTurnDiffArtifact(w, req)
	if w.Code == http.StatusForbidden {
		t.Fatalf("IDE access token rejected: %s", w.Body)
	}
}

func TestLocalTurnDiffPath(t *testing.T) {
	if !isLocalTurnDiffPath("/api/sessions/session/turn-diffs/snapshot") {
		t.Fatal("artifact path rejected")
	}
	for _, path := range []string{
		"/api/sessions/turn-diffs/snapshot",
		"/api/sessions/session/turn-diffs/snapshot/escape",
		"/api/sessions/session/toolcalls/call",
	} {
		if isLocalTurnDiffPath(path) {
			t.Fatalf("path accepted: %s", path)
		}
	}
}
