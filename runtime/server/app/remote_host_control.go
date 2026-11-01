package app

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"mindfs/server/internal/api"
	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/relay"
	"mindfs/server/internal/remotehost"
)

type remoteProjectPreference struct {
	Enabled          bool   `json:"enabled"`
	Mode             string `json:"mode,omitempty"`
	MigrationPending bool   `json:"migration_pending,omitempty"`
}
type remoteProjectRoute struct {
	ID     string
	Active bool
}

// remoteHostControl only moves the remote entry. AppContext, Agent Pool and
// StreamHub remain owned by this project for local and browser clients alike.
type remoteHostControl struct {
	mu                                   sync.Mutex
	legacy                               *remoteAccessControl
	client                               *remotehost.Client
	saved                                remoteProjectPreference
	projectPath, address, ownerID, token string
	identity                             e2ee.Config
	host                                 remotehost.Status
	projectID                            string
	lastError                            string
	route                                atomic.Value
	done                                 chan struct{}
}

func newRemoteHostControl(legacy *remoteAccessControl, hostDir, projectPath, address string) (*remoteHostControl, error) {
	c := &remoteHostControl{legacy: legacy, client: remotehost.NewClient(hostDir), projectPath: projectPath, address: address, done: make(chan struct{})}
	c.route.Store(remoteProjectRoute{})
	data, err := os.ReadFile(legacy.path)
	if errors.Is(err, os.ErrNotExist) {
		c.saved.Mode = "host"
	} else if err != nil {
		return nil, err
	} else if err = json.Unmarshal(data, &c.saved); err != nil {
		return nil, err
	}
	if c.saved.Mode != "" && c.saved.Mode != "host" {
		return nil, errors.New("unsupported remote access mode")
	}
	c.ownerID, err = newRemoteSecret()
	if err != nil {
		return nil, err
	}
	c.token, err = newRemoteSecret()
	if err != nil {
		return nil, err
	}
	identity, err := e2ee.EnsureConfigAtPath(filepath.Join(filepath.Dir(legacy.path), "remote-host-e2ee.json"), true)
	if err != nil {
		return nil, err
	}
	c.identity = identity.Config
	if c.saved.Mode == "host" {
		if err = legacy.manager.SetEnabled(false); err != nil {
			return nil, err
		}
		legacy.app.E2EE.ReplaceConfig(c.identity)
	}
	return c, nil
}
func newRemoteSecret() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func (c *remoteHostControl) persist(next remoteProjectPreference) error {
	data, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err = os.WriteFile(c.legacy.path+".tmp", data, 0600); err != nil {
		return err
	}
	if err = os.Rename(c.legacy.path+".tmp", c.legacy.path); err != nil {
		return err
	}
	c.saved = next
	c.legacy.enabled = next.Enabled
	return nil
}
func (c *remoteHostControl) setRoute(active bool) {
	previous := c.route.Load().(remoteProjectRoute)
	c.route.Store(remoteProjectRoute{c.projectID, active})
	if previous.Active && !active {
		c.legacy.app.GetSessionStreamHub().CloseRemoteClients()
	}
}
func (c *remoteHostControl) allowed() bool { return c.route.Load().(remoteProjectRoute).Active }

func (c *remoteHostControl) registration(enabled bool) remotehost.Registration {
	return remotehost.Registration{
		Protocol: remotehost.Protocol, ProjectPath: c.projectPath, Name: filepath.Base(c.projectPath), OwnerID: c.ownerID,
		Address: c.address, Token: c.token, E2EENodeID: c.identity.NodeID, PairingSecret: c.identity.PairingSecret, Enabled: enabled,
	}
}
func (c *remoteHostControl) syncLocked(ctx context.Context) (err error) {
	defer func() {
		if err != nil {
			c.setRoute(false)
			c.lastError = err.Error()
		}
	}()
	status, err := c.client.Status(ctx)
	if err != nil {
		c.host.Connected = false
		return err
	}
	c.host = status
	if c.saved.MigrationPending && status.Bound {
		if c.saved.Mode != "host" {
			// Prepare ownership/readiness without exposing the new entry. Failures here
			// leave the old connector and old pairing completely usable.
			id, prepareErr := c.client.Register(ctx, c.registration(false))
			if prepareErr != nil {
				return prepareErr
			}
			c.projectID = id
			if err = c.legacy.manager.SetEnabled(false); err != nil {
				return err
			}
			c.legacy.app.GetSessionStreamHub().CloseRemoteClients()
			if err = c.persist(remoteProjectPreference{Enabled: true, Mode: "host", MigrationPending: true}); err != nil {
				restoreErr := c.legacy.manager.SetEnabled(c.saved.Enabled)
				return errors.Join(err, restoreErr)
			}
			c.legacy.app.E2EE.ReplaceConfig(c.identity)
		} else if !c.saved.Enabled {
			next := c.saved
			next.Enabled = true
			if err = c.persist(next); err != nil {
				return err
			}
		}
	}
	enabled := c.saved.Mode == "host" && c.saved.Enabled
	id, err := c.client.Register(ctx, c.registration(enabled))
	if err != nil {
		return err
	}
	c.projectID = id
	if c.saved.Mode == "host" && c.saved.MigrationPending && status.Bound {
		next := c.saved
		next.MigrationPending = false
		if err = c.persist(next); err != nil {
			return err
		}
	}
	c.lastError = ""
	c.setRoute(enabled && status.Enabled && status.Bound)
	return nil
}

func (c *remoteHostControl) start(ctx context.Context) {
	go func() {
		defer close(c.done)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			c.mu.Lock()
			_ = c.syncLocked(ctx)
			c.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
func (c *remoteHostControl) close() {
	<-c.done
	c.mu.Lock()
	defer c.mu.Unlock()
	c.setRoute(false)
	if c.projectID != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = c.client.Unregister(ctx, remotehost.Ownership{ProjectID: c.projectID, OwnerID: c.ownerID})
	}
}

func (c *remoteHostControl) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	defer c.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	var err error
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/idea/remote":
		// Status failures are represented alongside legacy status so the local panel
		// can explain/retry migration even while the shared entry is unavailable.
		err = c.syncLocked(r.Context())
		if err != nil {
			c.lastError = err.Error()
			err = nil
		}
	case r.Method == http.MethodPost && (r.URL.Path == "/api/idea/remote/bind" || r.URL.Path == "/api/idea/remote/migrate"):
		// Creating the computer binding is explicit; failure leaves legacy access on.
		var hostStatus remotehost.Status
		hostStatus, err = c.client.Status(r.Context())
		if err == nil && !hostStatus.Bound {
			_, err = c.client.Bind(r.Context())
		}
		// Joining an already bound computer must preserve its global off switch.
		if err == nil {
			next := c.saved
			next.MigrationPending = true
			err = c.persist(next)
		}
		if err == nil {
			err = c.syncLocked(r.Context())
		}
	case r.Method == http.MethodPost && r.URL.Path == "/api/idea/remote/cancel-migration":
		next := c.saved
		next.MigrationPending = false
		err = c.persist(next)
	case r.Method == http.MethodPost && r.URL.Path == "/api/idea/remote/enable":
		var enabled bool
		enabled, err = decodeRemoteEnabled(w, r)
		if err == nil {
			if c.saved.Mode == "" {
				err = c.legacy.setEnabled(enabled)
				if err == nil {
					c.saved = remoteProjectPreference{Enabled: enabled}
				}
			} else {
				next := c.saved
				next.Enabled = enabled
				if !enabled {
					next.MigrationPending = false
					c.setRoute(false)
				}
				err = c.persist(next)
				if err == nil {
					err = c.syncLocked(r.Context())
				}
			}
		}
	case r.Method == http.MethodPost && r.URL.Path == "/api/idea/remote/host-enable":
		var enabled bool
		enabled, err = decodeRemoteEnabled(w, r)
		if err == nil {
			err = c.client.SetEnabled(r.Context(), enabled)
		}
		if err == nil {
			err = c.syncLocked(r.Context())
		}
	case r.Method == http.MethodPost && r.URL.Path == "/api/idea/remote/project-sharing":
		var input struct {
			ProjectID string `json:"project_id"`
			Enabled   *bool  `json:"enabled"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		err = decoder.Decode(&input)
		if err == nil {
			if input.ProjectID == "" || input.Enabled == nil {
				err = errors.New("project and enabled required")
			} else {
				err = c.client.SetSharing(r.Context(), input.ProjectID, *input.Enabled)
			}
		}
		if err == nil {
			err = c.syncLocked(r.Context())
		}
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	status := c.host.Status
	pairing := c.host.PairingSecret
	legacyMode := c.saved.Mode == ""
	if legacyMode && !c.saved.MigrationPending {
		status = c.legacy.manager.Status()
		pairing = c.legacy.app.E2EE.PairingSecret()
	}
	if c.lastError != "" {
		status.LastError = c.lastError
	}
	projectURL := ""
	if c.projectID != "" && c.host.NodeURL != "" {
		projectURL = strings.TrimRight(c.host.NodeURL, "/") + "/p/" + c.projectID + "/"
	}
	if legacyMode && !c.saved.MigrationPending {
		projectURL = status.NodeURL
	}
	_ = json.NewEncoder(w).Encode(struct {
		relay.Status
		Enabled          bool                        `json:"enabled"`
		HostEnabled      bool                        `json:"host_enabled"`
		PairingSecret    string                      `json:"pairing_secret"`
		ProjectID        string                      `json:"project_id"`
		ProjectURL       string                      `json:"project_url"`
		LegacyMode       bool                        `json:"legacy_mode"`
		MigrationPending bool                        `json:"migration_pending"`
		HostBound        bool                        `json:"host_bound"`
		ProjectName      string                      `json:"project_name"`
		Projects         []remotehost.ManagedProject `json:"projects"`
	}{status, c.saved.Enabled, c.host.Enabled, pairing, c.projectID, projectURL, legacyMode, c.saved.MigrationPending, c.host.Bound, filepath.Base(c.projectPath), c.host.Projects})
}
func decodeRemoteEnabled(w http.ResponseWriter, r *http.Request) (bool, error) {
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return false, err
	}
	if input.Enabled == nil {
		return false, errors.New("enabled required")
	}
	return *input.Enabled, nil
}

// middleware separates the legacy entry from the host-only mounted entry.
// The host credential is not an IDEA credential and cannot bypass E2EE.
func (c *remoteHostControl) middleware(next http.Handler) http.Handler {
	legacy := remoteAccessMiddleware(c.legacy.manager, next)
	restricted := remoteBusinessMiddleware(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		supplied := r.Header.Get(remotehost.ProjectTokenHeader)
		if supplied != "" {
			if subtle.ConstantTimeCompare([]byte(supplied), []byte(c.token)) != 1 {
				http.Error(w, "unauthorized remote host", 401)
				return
			}
			if r.Method == http.MethodGet && r.URL.Path == "/health" {
				w.WriteHeader(200)
				return
			}
			route := c.route.Load().(remoteProjectRoute)
			if !route.Active {
				http.Error(w, "project unavailable", 503)
				return
			}
			prefix := "/p/" + route.ID
			escaped := r.URL.EscapedPath()
			if !strings.HasPrefix(escaped, prefix+"/") {
				http.NotFound(w, r)
				return
			}
			r = r.Clone(r.Context())
			u := *r.URL
			r.URL = &u
			r = api.RemoteProjectAccess(r, escaped, c.allowed)
			r.URL.Path = strings.TrimPrefix(r.URL.Path, prefix)
			r.URL.RawPath = strings.TrimPrefix(escaped, prefix)
			r.Header.Del(remotehost.ProjectTokenHeader)
			restricted.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/p/") {
			http.Error(w, "remote host authentication required", 401)
			return
		}
		legacy.ServeHTTP(w, r)
	})
}

func remoteConfigurationError(err error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "remote access configuration: " + err.Error()})
	})
}
