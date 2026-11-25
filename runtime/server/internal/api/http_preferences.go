package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"

	"mindfs/server/internal/agent"
	"mindfs/server/internal/preferences"
)

func (h *HTTPHandler) handleAgentsList(w http.ResponseWriter, r *http.Request) {
	if h.AppContext == nil || h.AppContext.GetProber() == nil {
		log.Printf("[http] agents.list.short_circuit returning_empty_response")
		respondJSON(w, http.StatusOK, map[string]any{
			"agents": []map[string]any{},
			"shells": []map[string]any{},
		})
		return
	}
	statuses := h.AppContext.GetProber().GetInstalledStatuses()
	if r.URL.Query().Get("all") == "1" {
		h.AppContext.GetProber().RefreshInstallations()
		statuses = h.AppContext.GetProber().GetConfiguredStatuses()
	}
	if prefs := h.AppContext.GetPreferences(); prefs != nil {
		statuses = prefs.ApplyAgentDefaults(statuses)
	}
	statuses = applyAgentAPIProviderCapabilities(statuses)
	shells := []agent.ShellStatus{}
	if pool := h.AppContext.GetAgentPool(); pool != nil {
		shells = pool.AvailableShells()
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"agents": statuses,
		"shells": shells,
	})
}

type sessionNamingPreferenceRequest struct {
	Agent string `json:"agent"`
	Model string `json:"model"`
}

type idleSessionResourceReleasePreferenceRequest struct {
	Hours int `json:"hours"`
}

type newProjectMetaLocationPreferenceRequest struct {
	Location string `json:"location"`
}

func (h *HTTPHandler) handleNewProjectMetaLocationPreferenceGet(w http.ResponseWriter, _ *http.Request) {
	if h.AppContext == nil || h.AppContext.GetPreferences() == nil {
		respondError(w, http.StatusServiceUnavailable, errInvalidRequest("preferences not configured"))
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"location": h.AppContext.GetPreferences().NewProjectMetaLocation()})
}

func (h *HTTPHandler) handleNewProjectMetaLocationPreferencePut(w http.ResponseWriter, r *http.Request) {
	if h.AppContext == nil || h.AppContext.GetPreferences() == nil {
		respondError(w, http.StatusServiceUnavailable, errInvalidRequest("preferences not configured"))
		return
	}
	var req newProjectMetaLocationPreferenceRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest(err.Error()))
		return
	}
	if err := h.AppContext.GetPreferences().UpdateNewProjectMetaLocation(req.Location); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest(err.Error()))
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"location": h.AppContext.GetPreferences().NewProjectMetaLocation()})
}

func (h *HTTPHandler) handleIdleSessionResourceReleasePreferenceGet(w http.ResponseWriter, _ *http.Request) {
	if h.AppContext == nil || h.AppContext.GetPreferences() == nil {
		respondError(w, http.StatusServiceUnavailable, errInvalidRequest("preferences not configured"))
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"hours": h.AppContext.GetPreferences().IdleSessionResourceReleaseHours(),
	})
}

func (h *HTTPHandler) handleIdleSessionResourceReleasePreferencePut(w http.ResponseWriter, r *http.Request) {
	if h.AppContext == nil || h.AppContext.GetPreferences() == nil {
		respondError(w, http.StatusServiceUnavailable, errInvalidRequest("preferences not configured"))
		return
	}
	var req idleSessionResourceReleasePreferenceRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest(err.Error()))
		return
	}
	if req.Hours <= 0 || req.Hours > preferences.MaxIdleSessionResourceReleaseHours {
		respondError(w, http.StatusBadRequest, errInvalidRequest("hours are out of range"))
		return
	}
	if err := h.AppContext.GetPreferences().UpdateIdleSessionResourceReleaseHours(req.Hours); err != nil {
		respondError(w, http.StatusInternalServerError, errInvalidRequest(err.Error()))
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"hours": req.Hours})
}

func (h *HTTPHandler) handleSessionNamingPreferenceGet(w http.ResponseWriter, _ *http.Request) {
	if h.AppContext == nil || h.AppContext.GetPreferences() == nil {
		respondError(w, http.StatusServiceUnavailable, errInvalidRequest("preferences not configured"))
		return
	}
	pref := h.AppContext.GetPreferences().SessionNamingDefaults()
	respondJSON(w, http.StatusOK, map[string]any{
		"agent": pref.Agent,
		"model": pref.Model,
	})
}

func (h *HTTPHandler) handleSessionNamingPreferencePut(w http.ResponseWriter, r *http.Request) {
	if h.AppContext == nil || h.AppContext.GetPreferences() == nil || h.AppContext.GetProber() == nil {
		respondError(w, http.StatusServiceUnavailable, errInvalidRequest("preferences not configured"))
		return
	}
	var req sessionNamingPreferenceRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest(err.Error()))
		return
	}
	req.Agent = strings.TrimSpace(req.Agent)
	req.Model = strings.TrimSpace(req.Model)
	if req.Agent == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session naming agent is required"))
		return
	}
	validAgent := false
	validModel := req.Model == ""
	for _, status := range h.AppContext.GetProber().GetInstalledStatuses() {
		if strings.TrimSpace(status.Name) != req.Agent {
			continue
		}
		validAgent = true
		if req.Model != "" {
			for _, model := range status.Models {
				if strings.TrimSpace(model.ID) == req.Model {
					validModel = true
					break
				}
			}
		}
		break
	}
	if !validAgent {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session naming agent is not installed"))
		return
	}
	if !validModel {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session naming model is not supported by the selected agent"))
		return
	}
	if err := h.AppContext.GetPreferences().UpdateSessionNamingDefaults(req.Agent, req.Model); err != nil {
		respondError(w, http.StatusInternalServerError, errInvalidRequest(err.Error()))
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"agent": req.Agent,
		"model": req.Model,
	})
}

func (h *HTTPHandler) handleAppUpdateGet(w http.ResponseWriter, r *http.Request) {
	if h.AppContext == nil || h.AppContext.GetUpdateService() == nil {
		respondJSON(w, http.StatusOK, map[string]any{
			"status": "idle",
		})
		return
	}
	respondJSON(w, http.StatusOK, h.AppContext.GetUpdateService().GetStatus())
}

func (h *HTTPHandler) handleAppUpdatePost(w http.ResponseWriter, r *http.Request) {
	if h.AppContext == nil || h.AppContext.GetUpdateService() == nil {
		respondError(w, http.StatusServiceUnavailable, errInvalidRequest("update service not configured"))
		return
	}
	if err := h.AppContext.GetUpdateService().TriggerUpdate(r.Context()); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest(err.Error()))
		return
	}
	respondJSON(w, http.StatusOK, h.AppContext.GetUpdateService().GetStatus())
}
