package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"mindfs/server/internal/relay"
)

func TestRemoteEntryRejectsManagementAndLocalCredentials(t *testing.T) {
	t.Setenv("IDE_AGENT_DATA_DIR", t.TempDir())
	manager, err := relay.NewManager("127.0.0.1:1234", false, "https://relay.example.com", false)
	if err != nil {
		t.Fatal(err)
	}
	h := remoteAccessMiddleware(manager, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-MindFS-Local-CLI-Token") != "" {
			t.Error("local credential reached remote business handler")
		}
		w.WriteHeader(204)
	}))
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/health", 200}, {"GET", "/api/sessions", 204},
		{"GET", "/api/idea/remote", 404}, {"POST", "/api/relay/bind/start", 404},
		{"POST", "/api/dirs", 403}, {"GET", "/api/local_dirs", 403},
		{"POST", "/api/git/worktrees", 403}, {"POST", "/api/app/update", 404},
	} {
		r := httptest.NewRequest(tc.method, tc.path, nil)
		r.Header.Set("X-MindFS-Local-CLI-Token", "private")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Errorf("%s %s: %d", tc.method, tc.path, w.Code)
		}
	}
}
