package remotehost

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/relay"
)

const LeaseTTL = 20 * time.Second
const IdleTTL = 30 * time.Second

type Options struct {
	Dir            string
	StaticDir      string
	RelayBaseURL   string
	OnReady        func(Descriptor) error
	RuntimeVersion string
}
type projectRecord struct {
	ID            string `json:"project_id"`
	Path          string `json:"path"`
	Name          string `json:"name"`
	Enabled       bool   `json:"enabled"`
	SharingPaused bool   `json:"sharing_paused,omitempty"`
}
type diskState struct {
	Enabled  bool            `json:"enabled"`
	Projects []projectRecord `json:"projects"`
}
type activeProject struct {
	Registration
	lastSeen time.Time
	route    *projectRoute
}
type host struct {
	mu         sync.Mutex
	dir        string
	staticDir  string
	token      string
	state      diskState
	active     map[string]*activeProject
	emptySince time.Time
	relay      *relay.Manager
	e2ee       *e2ee.Manager
	probeHTTP  *http.Client
	version    string
	stop       context.CancelFunc
}

// Run must execute in the dedicated --remote-host process: Relay's existing
// stores use IDE_AGENT_DATA_DIR, so it is set only here, never in project hosts.
func Run(ctx context.Context, opts Options) error {
	if opts.StaticDir == "" {
		return fmt.Errorf("remote_host_static_directory_required")
	}
	if info, err := os.Stat(filepath.Join(opts.StaticDir, "index.html")); err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("remote_host_static_assets_missing")
	}
	if opts.Dir == "" {
		var err error
		opts.Dir, err = DefaultDir()
		if err != nil {
			return err
		}
	}
	if err := privateDir(opts.Dir); err != nil {
		return err
	}
	lock, err := os.OpenFile(filepath.Join(opts.Dir, "host.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	acquired, err := tryLock(lock)
	if err != nil {
		return err
	}
	if !acquired {
		// The winner may still be publishing its listener. Wait only for startup,
		// never replace a live descriptor or create another identity.
		deadline := time.NewTimer(10 * time.Second)
		defer deadline.Stop()
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			d, e := ReadDescriptor(opts.Dir)
			if e == nil {
				if _, e = NewClient(opts.Dir).Status(ctx); e == nil {
					if opts.OnReady != nil {
						return opts.OnReady(d)
					}
					return nil
				}
			}
			if e != nil && e.Error() == "remote_protocol_incompatible" {
				return e
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-deadline.C:
				return fmt.Errorf("remote_host_start_timeout")
			case <-ticker.C:
			}
		}
	}
	if err := os.Setenv("IDE_AGENT_DATA_DIR", opts.Dir); err != nil {
		return err
	}
	ensured, err := e2ee.EnsureConfigAtPath(filepath.Join(opts.Dir, "e2ee.json"), true)
	if err != nil {
		return err
	}
	h, err := newHost(opts.Dir, opts.StaticDir, e2ee.NewManager(ensured.Config))
	if err != nil {
		return err
	}
	publicListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer publicListener.Close()
	controlListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer controlListener.Close()
	h.relay, err = relay.NewManager(publicListener.Addr().String(), !h.state.Enabled, opts.RelayBaseURL, false)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	h.version = opts.RuntimeVersion
	h.stop = cancel
	if err = h.relay.Start(ctx); err != nil {
		return err
	}
	defer h.relay.SetEnabled(false)
	publicServer := &http.Server{Handler: h.publicHandler(), ReadHeaderTimeout: 5 * time.Second}
	controlServer := &http.Server{Handler: h.controlHandler(), ReadHeaderTimeout: 5 * time.Second}
	defer publicServer.Close()
	defer controlServer.Close()
	defer h.closeRoutes()
	errorsCh := make(chan error, 2)
	go func() { errorsCh <- publicServer.Serve(publicListener) }()
	go func() { errorsCh <- controlServer.Serve(controlListener) }()
	d := Descriptor{Protocol: Protocol, URL: "http://" + controlListener.Addr().String(), Token: h.token}
	if err = writeJSON(filepath.Join(opts.Dir, "host.json"), d); err != nil {
		return err
	}
	defer os.Remove(filepath.Join(opts.Dir, "host.json")) // still holds the process lock
	if opts.OnReady != nil {
		if err = opts.OnReady(d); err != nil {
			return err
		}
	}
	h.e2ee.StartCleanup(ctx.Done())
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-errorsCh:
			if errors.Is(err, http.ErrServerClosed) {
				return nil
			}
			return err
		case now := <-tick.C:
			if h.expire(now) {
				return nil
			}
		}
	}
}
func newHost(dir, staticDir string, manager *e2ee.Manager) (*host, error) {
	h := &host{dir: dir, staticDir: staticDir, e2ee: manager, active: map[string]*activeProject{}, emptySince: time.Now(), probeHTTP: &http.Client{Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Timeout: 2 * time.Second}}
	token, err := randomID(32)
	if err != nil {
		return nil, err
	}
	h.token = token
	data, err := os.ReadFile(filepath.Join(dir, "projects.json"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if err = json.Unmarshal(data, &h.state); err != nil {
			return nil, err
		}
	}
	return h, nil
}
func writeJSON(path string, value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err = os.WriteFile(path+".tmp", b, 0600); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}
func randomID(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
func canonicalProject(path string) (string, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("project_directory_required")
	}
	path = filepath.Clean(path)
	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	return path, nil
}
func (h *host) status() Status {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := Status{Status: h.relay.Status(), Protocol: Protocol, Enabled: h.state.Enabled, RemoteHost: true, PairingSecret: h.e2ee.PairingSecret()}
	s.E2EERequired = true
	s.E2EENodeID = h.e2ee.NodeID()
	s.Projects = h.managedProjectsLocked()
	s.RuntimeVersion = h.version
	return s
}
func (h *host) saveLocked(state diskState) error {
	if err := writeJSON(filepath.Join(h.dir, "projects.json"), state); err != nil {
		return err
	}
	h.state = state
	return nil
}
func (h *host) setEnabled(enabled bool) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.state
	state.Enabled = enabled
	if err := h.saveLocked(state); err != nil {
		return err
	}
	if !enabled {
		for _, p := range h.active {
			if p.route != nil {
				p.route.close()
				p.route = nil
			}
		}
	}
	if err := h.relay.SetEnabled(enabled); err != nil {
		return err
	}
	return nil
}
func (h *host) register(ctx context.Context, in Registration) (string, error) {
	if in.Protocol != Protocol {
		return "", &APIError{409, "remote_protocol_incompatible"}
	}
	if in.OwnerID == "" || in.Token == "" || in.E2EENodeID == "" || in.PairingSecret == "" || strings.TrimSpace(in.Name) == "" {
		return "", &APIError{400, "invalid_project_registration"}
	}
	path, err := canonicalProject(in.ProjectPath)
	if err != nil {
		return "", &APIError{400, "invalid_project_path"}
	}
	if _, err := loopbackURL(in.Address); err != nil {
		return "", &APIError{400, err.Error()}
	}
	// Readiness is proved before publishing the project as available.
	probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(probeCtx, http.MethodGet, strings.TrimSuffix(in.Address, "/")+"/health", nil)
	req.Header.Set(ProjectTokenHeader, in.Token)
	resp, err := h.probeHTTP.Do(req)
	if err != nil {
		return "", &APIError{503, "project_not_ready"}
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", &APIError{503, "project_not_ready"}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.state
	state.Projects = append([]projectRecord(nil), state.Projects...)
	index := -1
	for i, p := range state.Projects {
		if p.Path == path {
			index = i
			break
		}
	}
	changed := index < 0
	if index < 0 {
		id, e := randomID(16)
		if e != nil {
			return "", e
		}
		state.Projects = append(state.Projects, projectRecord{ID: id, Path: path})
		index = len(state.Projects) - 1
	}
	record := &state.Projects[index]
	current := h.active[record.ID]
	if current != nil && time.Since(current.lastSeen) <= LeaseTTL && current.OwnerID != in.OwnerID {
		return "", &APIError{409, "project_owner_conflict"}
	}
	changed = changed || record.Name != in.Name || record.Enabled != in.Enabled
	record.Name = in.Name
	record.Enabled = in.Enabled
	if changed {
		if err = h.saveLocked(state); err != nil {
			return "", err
		}
	}
	if current != nil && current.OwnerID == in.OwnerID && current.Address == in.Address && current.Token == in.Token && current.E2EENodeID == in.E2EENodeID && current.PairingSecret == in.PairingSecret {
		current.lastSeen = time.Now()
		current.Enabled = in.Enabled
		if !in.Enabled && current.route != nil {
			current.route.close()
			current.route = nil
		}
		return record.ID, nil
	}
	if current != nil && current.route != nil {
		current.route.close()
	}
	in.ProjectPath = path
	h.active[record.ID] = &activeProject{Registration: in, lastSeen: time.Now()}
	h.emptySince = time.Time{}
	return record.ID, nil
}
func (h *host) ownedLocked(o Ownership) (*activeProject, error) {
	p := h.active[o.ProjectID]
	if p == nil || time.Since(p.lastSeen) > LeaseTTL {
		return nil, &APIError{404, "project_not_registered"}
	}
	if p.OwnerID != o.OwnerID {
		return nil, &APIError{409, "project_owner_conflict"}
	}
	return p, nil
}
func (h *host) heartbeat(o Ownership) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	p, e := h.ownedLocked(o)
	if e != nil {
		return e
	}
	p.lastSeen = time.Now()
	return nil
}
func (h *host) unregister(o Ownership) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	p := h.active[o.ProjectID]
	if p == nil {
		return nil
	}
	if p.OwnerID != o.OwnerID {
		return &APIError{409, "project_owner_conflict"}
	}
	if p.route != nil {
		p.route.close()
	}
	delete(h.active, o.ProjectID)
	if len(h.active) == 0 {
		h.emptySince = time.Now()
	}
	return nil
}
func (h *host) enableProject(o Ownership, enabled bool) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	p, e := h.ownedLocked(o)
	if e != nil {
		return e
	}
	state := h.state
	state.Projects = append([]projectRecord(nil), state.Projects...)
	for i := range state.Projects {
		if state.Projects[i].ID == o.ProjectID {
			state.Projects[i].Enabled = enabled
		}
	}
	if e = h.saveLocked(state); e != nil {
		return e
	}
	p.Enabled = enabled
	if !enabled && p.route != nil {
		p.route.close()
		p.route = nil
	}
	return nil
}
func (h *host) expire(now time.Time) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, p := range h.active {
		if now.Sub(p.lastSeen) > LeaseTTL {
			if p.route != nil {
				p.route.close()
			}
			delete(h.active, id)
		}
	}
	if len(h.active) > 0 {
		h.emptySince = time.Time{}
		return false
	}
	if h.emptySince.IsZero() {
		h.emptySince = now
	}
	return now.Sub(h.emptySince) >= IdleTTL
}
func (h *host) closeRoutes() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, p := range h.active {
		if p.route != nil {
			p.route.close()
			p.route = nil
		}
	}
}
func (h *host) projects() []Project {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]Project, 0)
	for _, p := range h.managedProjectsLocked() {
		if p.Enabled {
			out = append(out, p.Project)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ProjectID < out[j].ProjectID
	})
	return out
}

// Project opt-in is owned by its runtime. A user pausing it in the computer's
// management panel must not have that choice overwritten by registration.
func (h *host) managedProjectsLocked() []ManagedProject {
	out := make([]ManagedProject, 0)
	for _, p := range h.state.Projects {
		if !p.Enabled {
			continue
		}
		availability := "closed"
		if active := h.active[p.ID]; active != nil && active.Enabled && time.Since(active.lastSeen) <= LeaseTTL {
			availability = "online"
		}
		out = append(out, ManagedProject{Project{p.ID, p.Name, filepath.Base(filepath.Dir(p.Path)), availability}, !p.SharingPaused})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ProjectID < out[j].ProjectID
	})
	return out
}

func (h *host) setSharing(id string, enabled bool) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.state
	state.Projects = append([]projectRecord(nil), state.Projects...)
	for i := range state.Projects {
		p := &state.Projects[i]
		if p.ID != id || !p.Enabled {
			continue
		}
		p.SharingPaused = !enabled
		if err := h.saveLocked(state); err != nil {
			return err
		}
		if active := h.active[id]; !enabled && active != nil && active.route != nil {
			active.route.close()
			active.route = nil
		}
		return nil
	}
	return &APIError{404, "project_not_found"}
}
