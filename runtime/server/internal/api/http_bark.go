package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"mindfs/server/internal/barknotify"
)

const barkRequestLimit = 8 << 10

func (h *HTTPHandler) barkService() (*barknotify.Service, error) {
	if h == nil || h.AppContext == nil || h.AppContext.Bark == nil {
		return nil, errServiceUnavailable("bark service not configured")
	}
	return h.AppContext.Bark, nil
}

func (h *HTTPHandler) handleBarkStatus(w http.ResponseWriter, r *http.Request) {
	svc, err := h.barkService()
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	respondJSON(w, http.StatusOK, svc.Status())
}

// requireSameOriginWhenRelayed keeps a page on another site from changing where
// notifications go, or triggering one, through a visitor's browser. Requests the
// Relay forwards carry the host the browser addressed and the Origin it sent; a
// genuine page of that Relay has the same host in both. Requests that did not come
// through the Relay (local access) are already limited by the local access token.
func requireSameOriginWhenRelayed(r *http.Request) error {
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		return nil
	}
	origin, err := url.Parse(strings.TrimSpace(r.Header.Get("X-Forwarded-Origin")))
	if err != nil || origin.Host == "" || !strings.EqualFold(origin.Host, host) {
		return errors.New("notification settings can only be changed from the Relay page of this node")
	}
	return nil
}

func (h *HTTPHandler) handleBarkUpdate(w http.ResponseWriter, r *http.Request) {
	svc, err := h.barkService()
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	if err := requireSameOriginWhenRelayed(r); err != nil {
		respondError(w, http.StatusForbidden, err)
		return
	}
	var update barknotify.Update
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, barkRequestLimit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&update); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid bark settings payload"))
		return
	}
	status, err := svc.Apply(update)
	if err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest(err.Error()))
		return
	}
	respondJSON(w, http.StatusOK, status)
}

func (h *HTTPHandler) handleBarkTest(w http.ResponseWriter, r *http.Request) {
	svc, err := h.barkService()
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	if err := requireSameOriginWhenRelayed(r); err != nil {
		respondError(w, http.StatusForbidden, err)
		return
	}
	if err := svc.SendTest(r.Context()); err != nil {
		respondError(w, http.StatusBadGateway, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}
