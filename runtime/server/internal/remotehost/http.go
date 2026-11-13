package remotehost

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func apiError(w http.ResponseWriter, err error) {
	var typed *APIError
	if errors.As(err, &typed) {
		jsonResponse(w, typed.Status, map[string]string{"error": typed.Code})
		return
	}
	jsonResponse(w, 503, map[string]string{"error": "remote_host_operation_failed"})
}
func decode(r *http.Request, out any) error {
	d := json.NewDecoder(io.LimitReader(r.Body, 64<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return &APIError{400, "invalid_request"}
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return &APIError{400, "invalid_request"}
	}
	return nil
}
func (h *host) controlHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+h.token)) != 1 {
			jsonResponse(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		var err error
		switch r.Method + " " + r.URL.Path {
		case "GET /control/status":
			jsonResponse(w, 200, h.status())
			return
		case "POST /control/upgrade-stop":
			var in struct {
				RuntimeVersion string `json:"runtime_version"`
			}
			err = decode(r, &in)
			if err == nil {
				if in.RuntimeVersion != h.version || h.stop == nil {
					err = &APIError{409, "remote_host_version_changed"}
				} else {
					// Flush an acknowledgment before shutdown closes the control server.
					w.Header().Set("Content-Type", "application/json")
					w.Header().Set("Content-Length", "2")
					_, _ = w.Write([]byte("{}"))
					if f, ok := w.(http.Flusher); ok {
						f.Flush()
					}
					h.stop()
					return
				}
			}
		case "POST /control/bind":
			err = h.setEnabled(true)
			if err == nil {
				_, err = h.relay.StartBinding()
			}
			if err == nil {
				jsonResponse(w, 200, h.status())
				return
			}
		case "POST /control/enable":
			var in struct {
				Enabled *bool `json:"enabled"`
			}
			err = decode(r, &in)
			if err == nil {
				if in.Enabled == nil {
					err = &APIError{400, "enabled_required"}
				} else {
					err = h.setEnabled(*in.Enabled)
				}
			}
		case "POST /control/projects/sharing":
			var in struct {
				ProjectID string `json:"project_id"`
				Enabled   *bool  `json:"enabled"`
			}
			err = decode(r, &in)
			if err == nil {
				if in.ProjectID == "" || in.Enabled == nil {
					err = &APIError{400, "project_and_enabled_required"}
				} else {
					err = h.setSharing(in.ProjectID, *in.Enabled)
				}
			}
		case "POST /control/register":
			var in Registration
			err = decode(r, &in)
			if err == nil {
				var id string
				id, err = h.register(r.Context(), in)
				if err == nil {
					jsonResponse(w, 200, map[string]string{"project_id": id})
					return
				}
			}
		case "POST /control/heartbeat", "POST /control/unregister":
			var in Ownership
			err = decode(r, &in)
			if err == nil {
				if strings.HasSuffix(r.URL.Path, "heartbeat") {
					err = h.heartbeat(in)
				} else {
					err = h.unregister(in)
				}
			}
		case "POST /control/project/enable":
			var in struct {
				Ownership
				Enabled *bool `json:"enabled"`
			}
			err = decode(r, &in)
			if err == nil {
				if in.Enabled == nil {
					err = &APIError{400, "enabled_required"}
				} else {
					err = h.enableProject(in.Ownership, *in.Enabled)
				}
			}
		default:
			jsonResponse(w, 404, map[string]string{"error": "not_found"})
			return
		}
		if err != nil {
			apiError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]bool{"ok": true})
	})
}
func (h *host) publicHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodGet && r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/api/relay/status" {
			status := h.status()
			status.Projects = nil
			jsonResponse(w, 200, status)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/control/") || strings.HasPrefix(r.URL.Path, "/api/idea/") {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.mu.Lock()
			enabled := h.state.Enabled
			h.mu.Unlock()
			if !enabled {
				jsonResponse(w, 503, map[string]string{"error": "remote_access_disabled"})
				return
			}
		}
		switch {
		case r.URL.Path == "/api/remote/projects" && r.Method == http.MethodGet:
			jsonResponse(w, 200, map[string]any{"projects": h.projects()})
		case strings.HasPrefix(r.URL.Path, "/p/"):
			h.proxyProject(w, r)
		case strings.HasPrefix(r.URL.Path, "/api/"):
			http.NotFound(w, r)
		case r.Method == http.MethodGet || r.Method == http.MethodHead:
			if r.URL.Path == "/" {
				http.ServeFile(w, r, filepath.Join(h.staticDir, "index.html"))
				return
			}
			http.FileServer(http.Dir(h.staticDir)).ServeHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}
func (h *host) availableLocked(id string) (*activeProject, error) {
	exists := false
	for _, p := range h.state.Projects {
		if p.ID == id && p.Enabled && !p.SharingPaused {
			exists = true
			break
		}
	}
	if !exists {
		return nil, &APIError{404, "project_not_found"}
	}
	p := h.active[id]
	if p == nil || time.Since(p.lastSeen) > LeaseTTL {
		return nil, &APIError{503, "project_offline"}
	}
	if !p.Enabled {
		return nil, &APIError{404, "project_not_found"}
	}
	return p, nil
}
