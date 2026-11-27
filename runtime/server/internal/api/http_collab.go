package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"mindfs/server/internal/collab"

	"github.com/go-chi/chi/v5"
)

func (h *HTTPHandler) collabService(w http.ResponseWriter) (*collab.Service, bool) {
	if h == nil || h.AppContext == nil {
		respondError(w, http.StatusServiceUnavailable, errInvalidRequest("app context unavailable"))
		return nil, false
	}
	svc, err := h.AppContext.GetCollabService()
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return nil, false
	}
	return svc, true
}

func (h *HTTPHandler) handleCollabTemplatesList(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	mode := strings.TrimSpace(r.URL.Query().Get("mode"))
	items, skills, err := svc.ListTemplatesWithAvailability(mode)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"skills": skills,
	})
}

func (h *HTTPHandler) handleCollabTemplateSave(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	var req collab.Template
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
		return
	}
	if id := strings.TrimSpace(chi.URLParam(r, "id")); id != "" {
		req.ID = id
	}
	saved, err := svc.SaveTemplate(req)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, saved)
}

func (h *HTTPHandler) handleCollabTemplateDelete(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	if err := svc.DeleteTemplate(chi.URLParam(r, "id")); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *HTTPHandler) handleCollabRunsList(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	if rootID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	limit, err := parsePositiveIntQuery(r, "limit")
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	mode := strings.TrimSpace(r.URL.Query().Get("mode"))
	items, waitingCount, err := svc.ListRuns(r.Context(), rootID, mode, limit)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"items":         items,
		"waiting_count": waitingCount,
	})
}

func (h *HTTPHandler) handleCollabRunCreate(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	var req struct {
		collab.StartMeetingInput
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
		return
	}
	if strings.TrimSpace(req.RootID) == "" {
		req.RootID = strings.TrimSpace(r.URL.Query().Get("root"))
	}
	var detail collab.RunDetail
	var err error
	switch req.Mode {
	case collab.ModeGroup:
		detail, err = svc.StartMeeting(r.Context(), req.StartMeetingInput)
	case "", collab.ModeQuick:
		detail, err = svc.StartQuickRun(r.Context(), req.StartQuickRunInput)
	default:
		err = errInvalidRequest("invalid collaboration mode")
	}
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusCreated, detail)
}

func (h *HTTPHandler) handleCollabRunGet(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	if rootID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	detail, err := svc.GetRunDetail(r.Context(), rootID, chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, collab.ErrRunNotFound) {
			respondError(w, http.StatusNotFound, err)
			return
		}
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, detail)
}

func (h *HTTPHandler) handleCollabRunMembersUpdate(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	var req collab.UpdateRunMembersInput
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
		return
	}
	req.RunID = chi.URLParam(r, "id")
	if strings.TrimSpace(req.RootID) == "" {
		req.RootID = strings.TrimSpace(r.URL.Query().Get("root"))
	}
	if strings.TrimSpace(req.RootID) == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	detail, err := svc.UpdateRunMembers(r.Context(), req)
	if err != nil {
		if errors.Is(err, collab.ErrRunNotFound) {
			respondError(w, http.StatusNotFound, err)
			return
		}
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, detail)
}

func (h *HTTPHandler) handleCollabRunDocGet(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	if rootID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	docName := chi.URLParam(r, "*")
	content, err := svc.ReadDoc(rootID, chi.URLParam(r, "id"), docName)
	if err != nil {
		if os.IsNotExist(err) {
			respondError(w, http.StatusNotFound, errInvalidRequest("document not found"))
			return
		}
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"name":    docName,
		"content": content,
	})
}

func (h *HTTPHandler) handleCollabMeetingAction(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	if rootID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	var input collab.MeetingActionInput
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&input); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
		return
	}
	detail, err := svc.MeetingAction(r.Context(), rootID, chi.URLParam(r, "id"), input)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, detail)
}

func (h *HTTPHandler) handleCollabRunDecisions(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	var req collab.SubmitDecisionsInput
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
		return
	}
	req.RunID = chi.URLParam(r, "id")
	if strings.TrimSpace(req.RootID) == "" {
		req.RootID = strings.TrimSpace(r.URL.Query().Get("root"))
	}
	detail, err := svc.SubmitDecisions(r.Context(), req)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, detail)
}

func (h *HTTPHandler) handleCollabRunPause(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	rootID := collabActionRootID(r)
	if rootID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	detail, err := svc.PauseRun(r.Context(), rootID, chi.URLParam(r, "id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, detail)
}

func (h *HTTPHandler) handleCollabRunContinue(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	rootID := collabActionRootID(r)
	if rootID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	detail, err := svc.ContinueRun(r.Context(), rootID, chi.URLParam(r, "id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, detail)
}

func (h *HTTPHandler) handleCollabRunCleanupDocs(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	var req struct {
		RootID   string   `json:"root_id"`
		KeepDocs []string `json:"keep_docs"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req)
	}
	rootID := strings.TrimSpace(req.RootID)
	if rootID == "" {
		rootID = strings.TrimSpace(r.URL.Query().Get("root"))
	}
	if rootID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	detail, removed, err := svc.CleanupDocs(r.Context(), rootID, chi.URLParam(r, "id"), req.KeepDocs)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"detail":  detail,
		"removed": removed,
	})
}

func (h *HTTPHandler) handleCollabRunDelete(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	if rootID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	if err := svc.DeleteRun(r.Context(), rootID, chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, collab.ErrRunNotFound) {
			respondError(w, http.StatusNotFound, err)
			return
		}
		respondError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func collabActionRootID(r *http.Request) string {
	if q := strings.TrimSpace(r.URL.Query().Get("root")); q != "" {
		return q
	}
	if r.Body == nil || r.ContentLength == 0 {
		return ""
	}
	var body struct {
		RootID string `json:"root_id"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body)
	return strings.TrimSpace(body.RootID)
}

func (h *HTTPHandler) handleCollabNextReview(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.collabService(w)
	if !ok {
		return
	}
	round, err := strconv.Atoi(r.URL.Query().Get("round"))
	if err != nil || round < 0 {
		respondError(w, http.StatusBadRequest, errInvalidRequest("expected round required"))
		return
	}
	var body struct {
		RootID     string `json:"root_id"`
		AuthorNote string `json:"author_note"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
			respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
			return
		}
	}
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	if rootID == "" {
		rootID = strings.TrimSpace(body.RootID)
	}
	if rootID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	detail, err := svc.NextReview(r.Context(), rootID, chi.URLParam(r, "id"), round, body.AuthorNote)
	if err != nil {
		respondError(w, http.StatusConflict, err)
		return
	}
	respondJSON(w, http.StatusOK, detail)
}
