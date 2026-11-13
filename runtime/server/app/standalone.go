package app

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"mindfs/server/internal/api"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/remotehost"
)

type standaloneControl struct {
	services *api.AppContext
	token    string
	address  string
	version  string
	stop     context.CancelFunc
}

func (c *standaloneControl) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+c.token)) != 1 {
		http.Error(w, "local service authorization required", http.StatusUnauthorized)
		return
	}
	switch r.Method + " " + r.URL.Path {
	case "GET /control/status":
		json.NewEncoder(w).Encode(map[string]any{"protocol": remotehost.Protocol, "mode": "standalone", "runtime_version": c.version, "pid": os.Getpid()})
	case "POST /control/open-project":
		var input struct {
			Path          string `json:"path"`
			LegacyDataDir string `json:"legacy_data_dir"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&input); err != nil {
			http.Error(w, "invalid project request", 400)
			return
		}
		path, err := filepath.Abs(input.Path)
		if input.Path == "" || err != nil {
			http.Error(w, "project path required", 400)
			return
		}
		path, err = filepath.EvalSymlinks(path)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		info, err := os.Stat(path)
		if err != nil || !info.IsDir() {
			http.Error(w, "project directory required", 400)
			return
		}
		if root, found := fs.FindRootByPath(c.services.Dirs.List(), path); found {
			json.NewEncoder(w).Encode(map[string]string{"root_id": root.ID, "url": c.address, "token": c.token})
			return
		}
		preferred := fs.MetaLocationProject
		if input.LegacyDataDir != "" {
			legacy := fs.NewRegistry(filepath.Join(input.LegacyDataDir, "registry.json"))
			if err = legacy.Load(); err != nil {
				http.Error(w, fmt.Sprintf("read legacy project registry: %v", err), 400)
				return
			}
			if root, found := fs.FindRootByPath(legacy.List(), path); found {
				preferred = root.MetaLocation
			}
		}
		location, err := fs.MetaLocationForNewRoot(path, preferred)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		root, err := c.services.UpsertRootWithMetaLocation(path, location)
		if err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		c.services.GetSessionStreamHub().BroadcastAll(api.WSResponse{Type: "root.changed", Payload: map[string]any{"action": "added", "root_id": root.ID}})
		json.NewEncoder(w).Encode(map[string]string{"root_id": root.ID, "url": c.address, "token": c.token})
	case "POST /control/stop":
		w.Write([]byte("{}"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		c.stop()
	default:
		http.NotFound(w, r)
	}
}

func standaloneAccess(token string, services *api.AppContext, next http.Handler) http.Handler {
	cookieName := localCookieName(token)
	valid := func(value string) bool { return subtle.ConstantTimeCompare([]byte(value), []byte(token)) == 1 }
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		local, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr)
		if !ok || r.Host != local.String() {
			http.Error(w, "invalid local host", 403)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
			http.Error(w, "invalid origin", 403)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/control/") {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method == "GET" && r.URL.Path == "/" && valid(r.URL.Query().Get("ide_token")) {
			query := r.URL.Query()
			query.Del("ide_token")
			if id := query.Get("root"); id != "" {
				if _, ok := services.Dirs.Get(id); !ok {
					http.Error(w, "project not found", 404)
					return
				}
			}
			http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			w.Header().Set("Cache-Control", "no-store")
			http.Redirect(w, r, "/?"+query.Encode(), http.StatusSeeOther)
			return
		}
		if isNativeDialogRequest(r) && valid(r.Header.Get("X-MindFS-Local-CLI-Token")) {
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie(cookieName)
		if err != nil || !valid(cookie.Value) {
			http.Error(w, "Local AI Agent session required", 401)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Remote browsers use the project APIs directly through the existing Relay.
// Local control endpoints are unavailable through Relay.
func standaloneRemote(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/control/") || strings.HasPrefix(r.URL.Path, "/api/idea/") || strings.HasPrefix(r.URL.Path, "/api/token-station/") ||
			(strings.HasPrefix(r.URL.Path, "/api/relay/") && r.URL.Path != "/api/relay/status") || r.URL.Path == "/api/app/update" {
			http.NotFound(w, r)
			return
		}
		r.Header.Del("X-MindFS-Local-CLI-Token")
		next.ServeHTTP(w, r)
	})
}

func publishStandalone(dir, address, token string) error {
	d := remotehost.Descriptor{Protocol: remotehost.Protocol, URL: "http://" + address, Token: token, Mode: "standalone"}
	data, err := json.Marshal(d)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "host.json")
	if err := os.WriteFile(path+".tmp", append(data, '\n'), 0600); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}
