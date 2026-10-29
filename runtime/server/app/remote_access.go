package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"mindfs/server/internal/api"
	configpkg "mindfs/server/internal/config"
	"mindfs/server/internal/relay"
)

type remoteAccessControl struct {
	mu      sync.Mutex
	manager *relay.Manager
	app     *api.AppContext
	path    string
	enabled bool
}

func newRemoteAccessControl(manager *relay.Manager, app *api.AppContext) (*remoteAccessControl, error) {
	dir, err := configpkg.MindFSConfigDir()
	if err != nil {
		return nil, err
	}
	c := &remoteAccessControl{manager: manager, app: app, path: filepath.Join(dir, "remote-access.json")}
	data, err := os.ReadFile(c.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		var saved struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.Unmarshal(data, &saved); err != nil {
			return nil, err
		}
		c.enabled = saved.Enabled
	}
	if err := manager.SetEnabled(c.enabled); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *remoteAccessControl) setEnabled(enabled bool) error {
	data, err := json.Marshal(struct {
		Enabled bool `json:"enabled"`
	}{enabled})
	if err != nil {
		return err
	}
	if err := os.WriteFile(c.path+".tmp", data, 0600); err != nil {
		return err
	}
	if err := os.Rename(c.path+".tmp", c.path); err != nil {
		return err
	}
	c.enabled = enabled
	if err := c.manager.SetEnabled(enabled); err != nil {
		return err
	}
	if !enabled {
		c.app.GetSessionStreamHub().CloseRemoteClients()
	}
	return nil
}

func (c *remoteAccessControl) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	defer c.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	var err error
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/idea/remote":
	case r.Method == http.MethodPost && r.URL.Path == "/api/idea/remote/bind":
		err = c.setEnabled(true)
		if err == nil {
			_, err = c.manager.StartBinding()
		}
	case r.Method == http.MethodPost && r.URL.Path == "/api/idea/remote/enable":
		var input struct {
			Enabled *bool `json:"enabled"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || input.Enabled == nil {
			http.Error(w, "enabled required", 400)
			return
		}
		err = c.setEnabled(*input.Enabled)
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		w.WriteHeader(503)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	status := c.manager.Status()
	_ = json.NewEncoder(w).Encode(struct {
		relay.Status
		Enabled       bool   `json:"enabled"`
		PairingSecret string `json:"pairing_secret"`
	}{status, c.enabled, c.app.E2EE.PairingSecret()})
}

// The connector forwards to a dedicated loopback listener. No IDEA credential
// is accepted here; protected API and WS handlers require browser E2EE proofs.
func remoteAccessMiddleware(manager *relay.Manager, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" && r.Method == http.MethodGet {
			w.WriteHeader(http.StatusOK)
			return
		}
		if manager.NoRelayer() {
			http.Error(w, "remote access disabled", http.StatusServiceUnavailable)
			return
		}
		path := r.URL.Path
		if strings.HasPrefix(path, "/api/idea/") ||
			(strings.HasPrefix(path, "/api/relay/") && path != "/api/relay/status") ||
			strings.HasPrefix(path, "/api/token-station/") || path == "/api/app/update" {
			http.NotFound(w, r)
			return
		}
		if isIDEProjectMutation(r) {
			http.Error(w, "open or manage projects in IDEA", http.StatusForbidden)
			return
		}
		r.Header.Del("X-MindFS-Local-CLI-Token")
		next.ServeHTTP(w, r)
	})
}

func isIDEProjectMutation(r *http.Request) bool {
	readOnly := r.Method == http.MethodGet || r.Method == http.MethodHead
	return ((r.URL.Path == "/api/dirs" || strings.HasPrefix(r.URL.Path, "/api/dirs/")) && !readOnly) ||
		r.URL.Path == "/api/local_dirs" || strings.HasPrefix(r.URL.Path, "/api/imports/github") ||
		(r.URL.Path == "/api/git/worktrees" && !readOnly)
}
