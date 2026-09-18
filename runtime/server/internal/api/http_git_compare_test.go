package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"mindfs/server/internal/fs"
)

func TestGitFileCompareRequiresLocalToken(t *testing.T) {
	handler := &HTTPHandler{
		AppContext:    &AppContext{Dirs: fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json"))},
		LocalCLIToken: "token",
	}
	w := httptest.NewRecorder()
	handler.handleGitFileCompare(w, httptest.NewRequest(http.MethodGet, "/api/git/related-file/compare", nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("HTTP = %d, body = %s", w.Code, w.Body)
	}
}

func TestGitFileCompareAcceptsIDEAccessToken(t *testing.T) {
	handler := &HTTPHandler{
		AppContext:       &AppContext{Dirs: fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json"))},
		LocalCLIToken:    "local-cli-token",
		LocalAccessToken: "ide-access-token",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/git/related-file/compare", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	req.Header.Set(localCLIHeaderName, "ide-access-token")
	if !handler.isLocalCLIRequest(req) {
		t.Fatal("IDE access token rejected")
	}
}
