package app

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIDEAccessBoundary(t *testing.T) {
	const token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	address := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 19731}
	handler := localAccessMiddleware(token, "demo project", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	for _, test := range []struct {
		name, path, method, host, origin, credential string
		status                                       int
	}{
		{"anonymous API", "/api/sessions", "GET", address.String(), "", "", 401},
		{"anonymous websocket", "/ws", "GET", address.String(), "", "", 401},
		{"wrong cookie", "/api/sessions", "GET", address.String(), "", "wrong", 401},
		{"authenticated API", "/api/sessions", "GET", address.String(), "", token, 204},
		{"authenticated websocket", "/ws", "GET", address.String(), "http://" + address.String(), token, 204},
		{"foreign origin", "/api/sessions", "POST", address.String(), "https://example.com", token, 403},
		{"null origin", "/api/sessions", "POST", address.String(), "null", token, 403},
		{"DNS rebinding", "/api/sessions", "GET", "attacker.example:19731", "", token, 403},
		{"relay disabled", "/api/relay/bind/start", "POST", address.String(), "", token, 404},
		{"updater disabled", "/api/app/update", "POST", address.String(), "", token, 404},
		{"relay status retained", "/api/relay/status", "GET", address.String(), "", token, 204},
		{"project listing retained", "/api/dirs", "GET", address.String(), "", token, 204},
		{"cannot add another project", "/api/dirs", "POST", address.String(), "", token, 403},
		{"cannot remove IDE project", "/api/dirs", "DELETE", address.String(), "", token, 403},
		{"cannot rename IDE project", "/api/dirs/demo/rename", "POST", address.String(), "", token, 403},
		{"no unrelated directory browsing", "/api/local_dirs", "GET", address.String(), "", token, 403},
		{"cannot import another project", "/api/imports/github", "POST", address.String(), "", token, 403},
		{"cannot register a worktree", "/api/git/worktrees", "POST", address.String(), "", token, 403},
		{"cannot delete IDE worktree", "/api/git/worktrees", "DELETE", address.String(), "", token, 403},
		{"worktree inspection retained", "/api/git/worktrees", "GET", address.String(), "", token, 204},
		{"bootstrap", "/?ide_token=" + token, "GET", address.String(), "", "", 303},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest(test.method, "http://"+test.host+test.path, nil)
			r = r.WithContext(context.WithValue(r.Context(), http.LocalAddrContextKey, address))
			if test.origin != "" {
				r.Header.Set("Origin", test.origin)
			}
			if test.credential != "" {
				r.AddCookie(&http.Cookie{Name: localCookieName(token), Value: test.credential})
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != test.status {
				t.Fatalf("got %d, want %d", w.Code, test.status)
			}
			if test.status == 303 {
				cookies := w.Result().Cookies()
				if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
					t.Fatal("missing private same-site cookie")
				}
				if strings.Contains(w.Header().Get("Location"), token) {
					t.Fatal("redirect exposes token")
				}
				if !strings.Contains(w.Header().Get("Location"), "root=demo+project") {
					t.Fatal("project not selected")
				}
			}
		})
	}
}

func TestIDERuntimeRejectsPublicListener(t *testing.T) {
	opts := StartOptions{ProjectRoot: t.TempDir(), AccessToken: strings.Repeat("a", 64)}
	t.Setenv("IDE_AGENT_DATA_DIR", t.TempDir())
	for _, addr := range []string{"0.0.0.0:0", ":0", "localhost:0", "192.168.1.2:0"} {
		if validateLocalOptions(addr, opts) == nil {
			t.Fatalf("accepted %s", addr)
		}
	}
	if err := validateLocalOptions("127.0.0.1:0", opts); err != nil {
		t.Fatal(err)
	}
}

func TestIDEProjectsHaveIndependentCookies(t *testing.T) {
	if localCookieName(strings.Repeat("a", 64)) == localCookieName(strings.Repeat("b", 64)) {
		t.Fatal("different project processes must not overwrite each other's browser session")
	}
}
