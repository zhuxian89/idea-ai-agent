package remotehost

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"mindfs/server/internal/e2ee"
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
			status.PairingSecret = ""
			status.Projects = nil // Management inventory is local-only, never a public directory.
			if r.Header.Get("X-MindFS-E2EE") == "" {
				jsonResponse(w, 200, map[string]any{"remote_host": true, "e2ee_required": true, "e2ee_node_id": status.E2EENodeID, "no_relayer": !status.Enabled})
				return
			}
			sess, err := h.requireProof(r)
			if err != nil {
				apiError(w, err)
				return
			}
			h.encrypted(w, 200, sess.Key, status)
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
		case r.URL.Path == "/api/e2ee/open" && r.Method == http.MethodPost:
			h.open(w, r)
		case r.URL.Path == "/api/remote/projects" && r.Method == http.MethodGet:
			sess, err := h.requireProof(r)
			if err != nil {
				apiError(w, err)
				return
			}
			h.encrypted(w, 200, sess.Key, map[string]any{"projects": h.projects()})
		case strings.HasPrefix(r.URL.Path, "/api/remote/projects/") && strings.HasSuffix(r.URL.Path, "/access") && r.Method == http.MethodPost:
			sess, err := h.requireProof(r)
			if err != nil {
				apiError(w, err)
				return
			}
			id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/remote/projects/"), "/access")
			h.mu.Lock()
			p, err := h.availableLocked(id)
			var payload any
			if err == nil {
				payload = map[string]string{"project_id": id, "e2ee_node_id": p.E2EENodeID, "pairing_secret": p.PairingSecret}
			}
			h.mu.Unlock()
			if err != nil {
				apiError(w, err)
				return
			}
			h.encrypted(w, 200, sess.Key, payload)
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
func (h *host) requireProof(r *http.Request) (*e2ee.Session, error) {
	if r.Header.Get("X-MindFS-E2EE") == "" {
		return nil, &APIError{401, "e2ee_required"}
	}
	id, ts, proof := r.Header.Get("X-MindFS-Client-ID"), r.Header.Get("X-MindFS-TS"), r.Header.Get("X-MindFS-Proof")
	if id == "" || ts == "" || proof == "" {
		return nil, &APIError{401, "e2ee_proof_required"}
	}
	sess, err := h.e2ee.SessionForClient(id)
	if err != nil {
		return nil, &APIError{401, err.Error()}
	}
	timestamp, err := time.Parse(time.RFC3339, ts)
	if err != nil || time.Since(timestamp) > 5*time.Minute || time.Until(timestamp) > 5*time.Minute {
		return nil, &APIError{401, "e2ee_proof_expired"}
	}
	path := r.URL.EscapedPath()
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	if !e2ee.VerifyProof(e2ee.BuildRequestProof(sess.Key, r.Method, path, ts, id), proof) {
		return nil, &APIError{401, "e2ee_proof_invalid"}
	}
	return sess, nil
}
func (h *host) encrypted(w http.ResponseWriter, status int, key []byte, payload any) {
	envelope, err := e2ee.EncryptJSON(key, payload)
	if err != nil {
		apiError(w, err)
		return
	}
	w.Header().Set("X-MindFS-E2EE", "1")
	jsonResponse(w, status, envelope)
}
func (h *host) open(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ClientID     string `json:"client_id"`
		NodeID       string `json:"node_id"`
		ClientEphPK  string `json:"client_eph_pk"`
		ClientNonce  string `json:"client_nonce"`
		Proof        string `json:"proof"`
		ProtoVersion int    `json:"proto_version"`
	}
	if err := decode(r, &in); err != nil {
		apiError(w, err)
		return
	}
	if in.ClientID == "" || in.ClientNonce == "" || in.ClientEphPK == "" || in.NodeID != h.e2ee.NodeID() || !e2ee.VerifyProof(e2ee.BuildOpenProof(h.e2ee.PairingSecret(), in.NodeID, in.ClientEphPK, in.ClientNonce), in.Proof) {
		apiError(w, &APIError{403, "e2ee_proof_invalid"})
		return
	}
	clientPub, err := e2ee.DecodePublicKey(in.ClientEphPK)
	if err != nil {
		apiError(w, &APIError{400, "invalid_client_eph_pk"})
		return
	}
	private, public, err := e2ee.GenerateECDHKeypair()
	if err != nil {
		apiError(w, err)
		return
	}
	nonceBytes := make([]byte, 16)
	if _, err = rand.Read(nonceBytes); err != nil {
		apiError(w, err)
		return
	}
	nonce := base64.StdEncoding.EncodeToString(nonceBytes)
	key, err := e2ee.DeriveKey(h.e2ee.PairingSecret(), in.NodeID, in.ClientEphPK, public, in.ClientNonce, nonce, private, clientPub)
	if err != nil {
		apiError(w, err)
		return
	}
	if _, err = h.e2ee.OpenSessionForClient(in.ClientID, key); err != nil {
		apiError(w, err)
		return
	}
	jsonResponse(w, 200, map[string]any{"ok": true, "node_eph_pk": public, "server_nonce": nonce, "server_proof": e2ee.BuildAcceptProof(h.e2ee.PairingSecret(), in.NodeID, in.ClientEphPK, public, in.ClientNonce, nonce)})
}
