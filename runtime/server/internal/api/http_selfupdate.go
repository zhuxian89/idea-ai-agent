package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"

	"mindfs/server/internal/remotehost"
	"mindfs/server/internal/selfupdate"
)

// selfUpdater is created on first use. Only an installed standalone backend can replace itself:
// the embedded backend belongs to the IDE plugin, which updates it.
func (h *HTTPHandler) selfUpdater() (*selfupdate.Updater, error) {
	if !h.Standalone {
		return nil, errors.New("self-update is only available for the standalone backend")
	}
	h.selfUpdateOnce.Do(func() {
		executable, err := os.Executable()
		if err != nil {
			h.selfUpdateErr = err
			return
		}
		dir := os.Getenv("IDE_AGENT_REMOTE_HOST_DIR")
		if dir == "" {
			if dir, err = remotehost.DefaultDir(); err != nil {
				h.selfUpdateErr = err
				return
			}
		}
		h.selfUpdate = selfupdate.New(filepath.Clean(dir), executable, h.Version)
	})
	return h.selfUpdate, h.selfUpdateErr
}

func (h *HTTPHandler) handleStandaloneUpdateStatus(w http.ResponseWriter, r *http.Request) {
	updater, err := h.selfUpdater()
	if err != nil {
		respondError(w, http.StatusNotFound, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respondJSON(w, http.StatusOK, updater.Status())
}

// handleStandaloneLatest answers "what is the newest standalone version" on behalf of the page.
// Older backends have no such route (404), and the page then checks for itself as it always did.
func (h *HTTPHandler) handleStandaloneLatest(w http.ResponseWriter, r *http.Request) {
	updater, err := h.selfUpdater()
	if err != nil {
		respondError(w, http.StatusNotFound, err)
		return
	}
	version, err := updater.Latest(r.Context())
	if err != nil {
		respondError(w, http.StatusBadGateway, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respondJSON(w, http.StatusOK, map[string]string{"version": version})
}

func (h *HTTPHandler) handleStandaloneUpdateStart(w http.ResponseWriter, r *http.Request) {
	updater, err := h.selfUpdater()
	if err != nil {
		respondError(w, http.StatusNotFound, err)
		return
	}
	var req struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json"))
		return
	}
	status, err := updater.Start(req.Version)
	if err != nil {
		code := http.StatusBadRequest
		if errors.Is(err, selfupdate.ErrBusy) {
			code = http.StatusConflict
		}
		respondError(w, code, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respondJSON(w, http.StatusAccepted, status)
}
