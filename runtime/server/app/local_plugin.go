package app

import (
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
)

func validateLocalOptions(addr string, opts StartOptions) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil || host != "127.0.0.1" {
		return fmt.Errorf("IDE runtime must bind to 127.0.0.1")
	}
	if len(opts.AccessToken) < 32 {
		return fmt.Errorf("IDE runtime requires a private access token")
	}
	info, err := os.Stat(opts.ProjectRoot)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("IDE runtime requires an existing project directory")
	}
	if os.Getenv("IDE_AGENT_DATA_DIR") == "" {
		return fmt.Errorf("IDE runtime requires a separate data directory")
	}
	return nil
}

// The browser receives a session cookie through a one-time host navigation.
// Tokens never appear in application logs or in the frontend's JavaScript.
func localAccessMiddleware(token, rootID string, next http.Handler) http.Handler {
	cookieName := localCookieName(token)
	valid := func(candidate string) bool {
		return subtle.ConstantTimeCompare([]byte(candidate), []byte(token)) == 1
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		local, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr)
		// Bind Host checks to the listener, preventing DNS rebinding.
		if !ok || r.Host != local.String() {
			http.Error(w, "invalid local host", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
			http.Error(w, "invalid origin", http.StatusForbidden)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/" && valid(r.URL.Query().Get("ide_token")) {
			http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			w.Header().Set("Cache-Control", "no-store")
			query := url.Values{"root": {rootID}, "ide": {"1"}}
			http.Redirect(w, r, "/?"+query.Encode(), http.StatusSeeOther)
			return
		}
		cookie, err := r.Cookie(cookieName)
		if err != nil || !valid(cookie.Value) {
			http.Error(w, "IDE session required", http.StatusUnauthorized)
			return
		}
		// These belong to the standalone remote distribution, not the IDE runtime.
		if strings.HasPrefix(r.URL.Path, "/api/relay/") && r.URL.Path != "/api/relay/status" ||
			strings.HasPrefix(r.URL.Path, "/api/token-station/") ||
			(r.URL.Path == "/api/app/update" && r.Method != http.MethodGet) {
			http.Error(w, "unavailable in IDEA", http.StatusNotFound)
			return
		}
		// Project opening, renaming and worktree selection belong to the IDE.
		// Preserve Git operations inside the selected project, but never register
		// or remove another managed root through the embedded standalone UI.
		readOnly := r.Method == http.MethodGet || r.Method == http.MethodHead
		if ((r.URL.Path == "/api/dirs" || strings.HasPrefix(r.URL.Path, "/api/dirs/")) && !readOnly) ||
			r.URL.Path == "/api/local_dirs" || strings.HasPrefix(r.URL.Path, "/api/imports/github") ||
			(r.URL.Path == "/api/git/worktrees" && !readOnly) {
			http.Error(w, "open or manage projects in IDEA", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func localCookieName(token string) string {
	// Cookies are shared across ports. Each project process needs its own name.
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("idea_agent_%x", sum[:8])
}
