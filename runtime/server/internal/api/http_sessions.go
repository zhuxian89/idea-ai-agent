package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/commandexec"
	"mindfs/server/internal/session"

	"github.com/go-chi/chi/v5"
)

func (h *HTTPHandler) handleSessions(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	if truthyQuery(r, "multi_root") {
		h.handleMultiRootSessions(w, r)
		return
	}
	beforeTime, err := parseOptionalTimeQuery(r, "before_time")
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	afterTime, err := parseOptionalTimeQuery(r, "after_time")
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	if !beforeTime.IsZero() && !afterTime.IsZero() {
		respondError(w, http.StatusBadRequest, errInvalidRequest("before_time and after_time are mutually exclusive"))
		return
	}
	limit, err := parsePositiveIntQuery(r, "limit")
	if err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("limit must be a positive integer"))
		return
	}
	if limit <= 0 {
		limit = sessionListPageSize
	}
	uc := h.service()
	out, err := uc.ListSessions(r.Context(), usecase.ListSessionsInput{
		RootID:          rootID,
		BeforeTime:      beforeTime,
		AfterTime:       afterTime,
		Limit:           limit,
		TopLevelOnly:    truthyQuery(r, "top_level"),
		IncludeChildren: truthyQuery(r, "include_children"),
	})
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	payload := make([]map[string]any, 0, len(out.Sessions))
	for _, s := range out.Sessions {
		payload = append(payload, h.sessionListResponse(s))
	}
	pinnedPayload := make([]map[string]any, 0, len(out.PinnedSessions))
	for _, s := range out.PinnedSessions {
		pinnedPayload = append(pinnedPayload, h.sessionListResponse(s))
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"items":        payload,
		"pinned_items": pinnedPayload,
		"pinned_keys":  out.PinnedKeys,
		"total_count":  out.TotalCount,
	})
}

func (h *HTTPHandler) handleMultiRootSessions(w http.ResponseWriter, r *http.Request) {
	limit, err := parsePositiveIntQuery(r, "limit_per_root")
	if err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("limit_per_root must be a positive integer"))
		return
	}
	if limit <= 0 {
		limit = multiRootSessionLimit
	}
	out, err := h.service().ListMultiRootSessions(r.Context(), usecase.ListMultiRootSessionsInput{
		LimitPerRoot: limit,
	})
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	groups := make([]map[string]any, 0, len(out.Groups))
	for _, group := range out.Groups {
		items := make([]map[string]any, 0, len(group.Sessions))
		for _, s := range group.Sessions {
			item := h.sessionListResponse(s)
			item["root_id"] = group.RootID
			items = append(items, item)
		}
		pinnedItems := make([]map[string]any, 0, len(group.PinnedSessions))
		for _, s := range group.PinnedSessions {
			item := h.sessionListResponse(s)
			item["root_id"] = group.RootID
			pinnedItems = append(pinnedItems, item)
		}
		groups = append(groups, map[string]any{
			"root_id":             group.RootID,
			"root_name":           group.RootName,
			"latest_session_time": group.LatestSessionTime,
			"items":               items,
			"pinned_items":        pinnedItems,
			"pinned_keys":         group.PinnedKeys,
			"total_count":         group.TotalCount,
		})
	}
	respondJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

func (h *HTTPHandler) handleSessionChildren(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	parentSessionKey := strings.TrimSpace(r.URL.Query().Get("parent_session_key"))
	if parentSessionKey == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("parent_session_key required"))
		return
	}
	beforeTime, err := parseOptionalTimeQuery(r, "before_time")
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	limit, err := parsePositiveIntQuery(r, "limit")
	if err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("limit must be a positive integer"))
		return
	}
	if limit <= 0 {
		limit = childSessionPageSize
	} else if limit > childSessionMaxLimit {
		limit = childSessionMaxLimit
	}
	out, err := h.service().ListChildSessions(r.Context(), usecase.ListChildSessionsInput{
		RootID:           rootID,
		ParentSessionKey: parentSessionKey,
		BeforeTime:       beforeTime,
		Limit:            limit,
	})
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	payload := make([]map[string]any, 0, len(out.Sessions))
	for _, s := range out.Sessions {
		payload = append(payload, h.sessionListResponse(s))
	}
	respondJSON(w, http.StatusOK, payload)
}

func (h *HTTPHandler) handleReplyingSessions(w http.ResponseWriter, r *http.Request) {
	if h.AppContext == nil || h.AppContext.GetSessionStreamHub() == nil {
		respondJSON(w, http.StatusOK, map[string]any{"sessions": []map[string]any{}})
		return
	}
	items := h.AppContext.GetSessionStreamHub().ListReplyingSessions()
	payload := make([]map[string]any, 0, len(items))
	for _, item := range items {
		rootTitle := item.RootID
		sessionTitle := strings.TrimSpace(item.SessionTitle)
		if root, err := h.AppContext.GetRoot(item.RootID); err == nil {
			if strings.TrimSpace(root.Name) != "" {
				rootTitle = root.Name
			}
			if sessionTitle == "" {
				if manager, err := h.AppContext.GetSessionManager(item.RootID); err == nil {
					if sess, err := manager.Get(r.Context(), item.SessionKey, 0); err == nil && sess != nil {
						sessionTitle = sess.Name
					}
				}
			}
		}
		payload = append(payload, map[string]any{
			"rootId":       item.RootID,
			"rootTitle":    rootTitle,
			"sessionKey":   item.SessionKey,
			"sessionTitle": sessionTitle,
			"status":       item.Status,
			"summary":      item.Summary,
			"updatedAt":    item.UpdatedAt,
		})
	}
	respondJSON(w, http.StatusOK, map[string]any{"sessions": payload})
}

func (h *HTTPHandler) handleSessionSearch(w http.ResponseWriter, r *http.Request) {
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	query := r.URL.Query().Get("q")
	limit, err := parsePositiveIntQuery(r, "limit")
	if err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("limit must be a positive integer"))
		return
	}
	out, err := h.service().SearchSessions(r.Context(), usecase.SearchSessionsInput{
		RootID:    rootID,
		Query:     query,
		Limit:     limit,
		MultiRoot: truthyQuery(r, "multi_root"),
	})
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"items": out.Items,
	})
}

func (h *HTTPHandler) handleCandidates(w http.ResponseWriter, r *http.Request) {
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	candidateType := usecase.CandidateType(strings.TrimSpace(r.URL.Query().Get("type")))
	agent := strings.TrimSpace(r.URL.Query().Get("agent"))
	uc := h.service()
	out, err := uc.SearchCandidates(r.Context(), usecase.SearchCandidatesInput{
		RootID: rootID,
		Type:   candidateType,
		Query:  r.URL.Query().Get("q"),
		Agent:  agent,
	})
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "root not found") {
			status = http.StatusNotFound
		}
		respondError(w, status, err)
		return
	}
	respondJSON(w, http.StatusOK, out.Items)
}

func (h *HTTPHandler) handlePromptSave(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid prompt payload"))
		return
	}
	out, err := h.service().SavePrompt(r.Context(), usecase.SavePromptInput{
		Text: input.Text,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *HTTPHandler) handlePromptDelete(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid prompt payload"))
		return
	}
	out, err := h.service().DeletePrompt(r.Context(), usecase.DeletePromptInput{
		Text: input.Text,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *HTTPHandler) handleExternalSessionsList(w http.ResponseWriter, r *http.Request) {
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	agentName := strings.TrimSpace(r.URL.Query().Get("agent"))
	if rootID == "" || agentName == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root and agent are required"))
		return
	}
	beforeTime, err := parseOptionalTimeQuery(r, "before_time")
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	afterTime, err := parseOptionalTimeQuery(r, "after_time")
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	if !beforeTime.IsZero() && !afterTime.IsZero() {
		respondError(w, http.StatusBadRequest, errInvalidRequest("before_time and after_time are mutually exclusive"))
		return
	}
	limit, err := parsePositiveIntQuery(r, "limit")
	if err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("limit must be a positive integer"))
		return
	}
	filterBound := false
	switch strings.TrimSpace(r.URL.Query().Get("filter_bound")) {
	case "1", "true", "TRUE", "True":
		filterBound = true
	}
	uc := h.service()
	out, err := uc.ListExternalSessions(r.Context(), usecase.ListExternalSessionsInput{
		RootID:      rootID,
		Agent:       agentName,
		BeforeTime:  beforeTime,
		AfterTime:   afterTime,
		Limit:       limit,
		FilterBound: filterBound,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	payload := make([]map[string]any, 0, len(out.Items))
	for _, item := range out.Items {
		payload = append(payload, externalSessionListResponse(item))
	}
	respondJSON(w, http.StatusOK, payload)
}

func (h *HTTPHandler) handleExternalSessionImport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RootID         string `json:"root_id"`
		Agent          string `json:"agent"`
		AgentSessionID string `json:"agent_session_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
		return
	}
	req.RootID = strings.TrimSpace(req.RootID)
	req.Agent = strings.TrimSpace(req.Agent)
	req.AgentSessionID = strings.TrimSpace(req.AgentSessionID)
	if req.RootID == "" || req.Agent == "" || req.AgentSessionID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root_id, agent, agent_session_id are required"))
		return
	}
	uc := h.service()
	out, err := uc.ImportExternalSession(r.Context(), usecase.ImportExternalSessionInput{
		RootID:         req.RootID,
		Agent:          req.Agent,
		AgentSessionID: req.AgentSessionID,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	if h.AppContext != nil {
		h.AppContext.GetSessionStreamHub().BroadcastAll(WSResponse{
			Type: "session.imported",
			Payload: map[string]any{
				"root_id":          req.RootID,
				"session_key":      out.SessionKey,
				"agent":            out.Agent,
				"agent_session_id": out.AgentSessionID,
				"imported_count":   out.ImportedCount,
			},
		})
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *HTTPHandler) handleExternalSessionImportBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RootID          string   `json:"root_id"`
		Agent           string   `json:"agent"`
		AgentSessionIDs []string `json:"agent_session_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
		return
	}
	req.RootID = strings.TrimSpace(req.RootID)
	req.Agent = strings.TrimSpace(req.Agent)
	if req.RootID == "" || req.Agent == "" || len(req.AgentSessionIDs) == 0 {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root_id, agent, agent_session_ids are required"))
		return
	}
	uc := h.service()
	out, err := uc.ImportExternalSessionsBatch(r.Context(), usecase.ImportExternalSessionsBatchInput{
		RootID:          req.RootID,
		Agent:           req.Agent,
		AgentSessionIDs: req.AgentSessionIDs,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	if h.AppContext != nil {
		for _, item := range out.Items {
			if !item.Success || strings.TrimSpace(item.SessionKey) == "" {
				continue
			}
			h.AppContext.GetSessionStreamHub().BroadcastAll(WSResponse{
				Type: "session.imported",
				Payload: map[string]any{
					"root_id":          req.RootID,
					"session_key":      item.SessionKey,
					"agent":            req.Agent,
					"agent_session_id": item.AgentSessionID,
					"imported_count":   item.ImportedCount,
				},
			})
		}
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *HTTPHandler) handleSessionGet(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session key required"))
		return
	}
	afterSeq, err := parsePositiveIntQuery(r, "seq")
	if err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("seq must be a positive integer"))
		return
	}
	uc := h.service()
	auxAfterSeq := afterSeq
	var pendingUser *session.Exchange
	if h.AppContext != nil {
		pendingUser = h.AppContext.GetSessionStreamHub().GetPendingUserExchange(key)
	}
	if pendingUser == nil {
		if synced, err := uc.SyncExternalSessionDelta(r.Context(), usecase.SyncExternalSessionDeltaInput{
			RootID: rootID,
			Key:    key,
		}); err != nil {
			log.Printf("[session/sync] external delta best-effort failed root=%s session=%s err=%v", strings.TrimSpace(rootID), strings.TrimSpace(key), err)
		} else if synced.RefreshAux {
			auxAfterSeq = 0
		}
	}
	out, err := uc.GetSession(r.Context(), usecase.GetSessionInput{
		RootID: rootID,
		Key:    key,
		Seq:    afterSeq,
	})
	if err != nil {
		respondError(w, http.StatusNotFound, err)
		return
	}
	contextWindow, _ := uc.GetSessionContextWindow(r.Context(), usecase.GetSessionContextWindowInput{
		RootID: rootID,
		Key:    key,
	})
	exchangeAux, _ := uc.GetSessionExchangeAux(r.Context(), usecase.GetSessionExchangeAuxInput{
		RootID: rootID,
		Key:    key,
		Seq:    auxAfterSeq,
	})
	respondJSON(w, http.StatusOK, h.sessionResponse(r.Context(), rootID, out, pendingUser, contextWindow, exchangeAux))
}

func (h *HTTPHandler) handleSessionLogPathGet(w http.ResponseWriter, r *http.Request) {
	out, err := h.service().GetSessionLogPath(r.Context(), usecase.GetSessionInput{
		RootID: r.URL.Query().Get("root"),
		Key:    chi.URLParam(r, "key"),
	})
	if err != nil {
		respondError(w, http.StatusNotFound, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{
		"path":             out.Path,
		"agent_session_id": out.AgentSessionID,
	})
}

func (h *HTTPHandler) handleSessionSync(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session key required"))
		return
	}
	afterSeq, err := parsePositiveIntQuery(r, "seq")
	if err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("seq must be a positive integer"))
		return
	}
	uc := h.service()
	var pendingUser *session.Exchange
	if h.AppContext != nil {
		pendingUser = h.AppContext.GetSessionStreamHub().GetPendingUserExchange(key)
	}
	if pendingUser == nil {
		if _, err := uc.SyncExternalSessionDelta(r.Context(), usecase.SyncExternalSessionDeltaInput{
			RootID: rootID, Key: key, Full: true,
		}); err != nil {
			respondError(w, http.StatusBadRequest, err)
			return
		}
	}
	out, err := uc.GetSession(r.Context(), usecase.GetSessionInput{
		RootID: rootID,
		Key:    key,
		Seq:    afterSeq,
	})
	if err != nil {
		respondError(w, http.StatusNotFound, err)
		return
	}
	contextWindow, _ := uc.GetSessionContextWindow(r.Context(), usecase.GetSessionContextWindowInput{
		RootID: rootID,
		Key:    key,
	})
	exchangeAux, _ := uc.GetSessionExchangeAux(r.Context(), usecase.GetSessionExchangeAuxInput{
		RootID: rootID,
		Key:    key,
		Seq:    afterSeq,
	})
	response := h.sessionResponse(r.Context(), rootID, out, pendingUser, contextWindow, exchangeAux)
	if pendingUser == nil {
		response["activity_history_version"] = 1
		response["reply_metadata_version"] = 1
	}
	respondJSON(w, http.StatusOK, response)
}

func (h *HTTPHandler) handleSessionToolCallGet(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	key := chi.URLParam(r, "key")
	callID := chi.URLParam(r, "callID")
	if strings.TrimSpace(key) == "" || strings.TrimSpace(callID) == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session key and tool call id required"))
		return
	}
	toolCall, err := h.service().GetSessionToolCall(r.Context(), usecase.GetSessionToolCallInput{
		RootID: rootID,
		Key:    key,
		CallID: callID,
	})
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondError(w, http.StatusNotFound, err)
			return
		}
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"toolcall": toolCall})
}

func (h *HTTPHandler) handleSessionRelatedFilesGet(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session key required"))
		return
	}
	uc := h.service()
	out, err := uc.GetSessionRelatedFiles(r.Context(), usecase.GetSessionRelatedFilesInput{
		RootID: rootID,
		Key:    key,
	})
	if err != nil {
		respondError(w, http.StatusNotFound, err)
		return
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *HTTPHandler) handleSessionRelatedFilesDelete(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	key := chi.URLParam(r, "key")
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	head := strings.TrimSpace(r.URL.Query().Get("head"))
	repoPath := strings.TrimSpace(r.URL.Query().Get("repo_path"))
	repoKind := strings.TrimSpace(r.URL.Query().Get("repo_kind"))
	if strings.TrimSpace(key) == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session key required"))
		return
	}
	if path == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("path required"))
		return
	}
	uc := h.service()
	if err := uc.RemoveSessionRelatedFile(r.Context(), usecase.RemoveSessionRelatedFileInput{
		RootID:   rootID,
		Key:      key,
		Path:     path,
		Head:     head,
		RepoPath: repoPath,
		RepoKind: repoKind,
	}); err != nil {
		respondError(w, http.StatusNotFound, err)
		return
	}
	if h.AppContext != nil {
		h.AppContext.GetSessionStreamHub().BroadcastAll(WSResponse{
			Type: "session.related_files.updated",
			Payload: map[string]any{
				"root_id":     rootID,
				"session_key": key,
			},
		})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *HTTPHandler) handleSessionFork(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RootID     string `json:"root_id"`
		SessionKey string `json:"session_key"`
		Seq        int    `json:"seq"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
		return
	}
	if strings.TrimSpace(req.RootID) == "" || strings.TrimSpace(req.SessionKey) == "" || req.Seq <= 0 {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root_id, session_key and seq are required"))
		return
	}
	out, err := h.service().ForkSession(r.Context(), usecase.ForkSessionInput{
		RootID: req.RootID,
		Key:    req.SessionKey,
		Seq:    req.Seq,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	if h.AppContext != nil && out.Session != nil {
		h.AppContext.GetSessionStreamHub().BroadcastAll(WSResponse{
			Type: "session.created",
			Payload: map[string]any{
				"root_id": req.RootID,
				"session": h.sessionListResponse(out.Session),
			},
		})
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"session_key": out.Session.Key,
		"session":     h.sessionResponse(r.Context(), req.RootID, out.Session, nil, agenttypes.ContextWindow{}, nil),
	})
}

func (h *HTTPHandler) handleSessionRename(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session key required"))
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
		return
	}
	uc := h.service()
	renamed, err := uc.RenameSession(r.Context(), usecase.RenameSessionInput{
		RootID: rootID,
		Key:    key,
		Name:   req.Name,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	if h.AppContext != nil {
		h.AppContext.GetSessionStreamHub().BroadcastAll(WSResponse{
			Type: "session.meta.updated",
			Payload: map[string]any{
				"root_id": rootID,
				"session": map[string]any{
					"key":          renamed.Key,
					"name":         renamed.Name,
					"model":        renamed.Model,
					"mode":         session.InferModeFromSession(renamed),
					"effort":       session.InferEffortFromSession(renamed),
					"fast_service": session.InferFastServiceFromSession(renamed),
					"plan_mode":    renamed.PlanMode,
					"pinned_at":    renamed.PinnedAt,
					"updated_at":   renamed.UpdatedAt,
				},
			},
		})
	}
	respondJSON(w, http.StatusOK, h.sessionListResponse(renamed))
}

func (h *HTTPHandler) handleSessionPin(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session key required"))
		return
	}
	var req struct {
		Pinned bool `json:"pinned"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid json body"))
		return
	}
	updated, err := h.service().PinSession(r.Context(), usecase.PinSessionInput{
		RootID: rootID,
		Key:    key,
		Pinned: req.Pinned,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	if h.AppContext != nil {
		h.AppContext.GetSessionStreamHub().BroadcastAll(WSResponse{
			Type: "session.meta.updated",
			Payload: map[string]any{
				"root_id": rootID,
				"session": h.sessionListResponse(updated),
			},
		})
	}
	respondJSON(w, http.StatusOK, h.sessionListResponse(updated))
}

func (h *HTTPHandler) handleSessionDelete(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("session key required"))
		return
	}
	uc := h.service()
	if err := uc.DeleteSession(r.Context(), usecase.DeleteSessionInput{
		RootID: rootID,
		Key:    key,
	}); err != nil {
		respondError(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// applyHistoryDisplayOverrides rewrites the display copy of persisted user
// exchanges that the native CLI generated as background task notifications.
// It operates on the response copy only and never touches the cached session
// pointer; exchange count, roles, seq, and timestamps are preserved so client
// caches still advance, and any projection failure falls back to the stored
// content instead of failing the history response.
func (h *HTTPHandler) applyHistoryDisplayOverrides(ctx context.Context, rootID string, s *session.Session, exchanges []session.Exchange) {
	if h == nil || h.AppContext == nil || s == nil || len(exchanges) == 0 {
		return
	}
	hasUserText := false
	for _, exchange := range exchanges {
		if exchange.Seq > 0 && strings.EqualFold(strings.TrimSpace(exchange.Role), "user") && strings.TrimSpace(exchange.Content) != "" {
			hasUserText = true
			break
		}
	}
	if !hasUserText {
		return
	}
	overrides, err := h.service().SessionHistoryDisplayOverrides(ctx, usecase.SessionHistoryDisplayInput{
		RootID: strings.TrimSpace(rootID),
		Key:    s.Key,
	})
	if err != nil {
		log.Printf("[session/display] projection incomplete root=%s session=%s err=%v", strings.TrimSpace(rootID), strings.TrimSpace(s.Key), err)
	}
	if len(overrides) == 0 {
		return
	}
	for index := range exchanges {
		if exchanges[index].Seq <= 0 || !strings.EqualFold(strings.TrimSpace(exchanges[index].Role), "user") {
			continue
		}
		if display, ok := overrides[exchanges[index].Seq]; ok {
			exchanges[index].Content = display
		}
	}
}

func (h *HTTPHandler) sessionResponse(
	ctx context.Context,
	rootID string,
	s *session.Session,
	pendingUser *session.Exchange,
	contextWindow agenttypes.ContextWindow,
	exchangeAux map[int][]session.ExchangeAux,
) map[string]any {
	if s == nil {
		return map[string]any{}
	}
	exchanges := append([]session.Exchange{}, s.Exchanges...)
	h.applyHistoryDisplayOverrides(ctx, rootID, s, exchanges)
	if pendingUser != nil {
		pendingUser.Seq = 0
		exchanges = append(exchanges, *pendingUser)
	}
	auxPayload := make(map[string][]session.ExchangeAux, len(exchangeAux))
	for seq, items := range exchangeAux {
		if seq <= 0 || len(items) == 0 {
			continue
		}
		auxPayload[strconv.Itoa(seq)] = append([]session.ExchangeAux(nil), items...)
	}
	return map[string]any{
		"key":                 s.Key,
		"type":                s.Type,
		"parent_session_key":  s.ParentSessionKey,
		"parent_tool_call_id": s.ParentToolCallID,
		"source":              s.Source,
		"task_id":             s.TaskID,
		"agent":               session.InferAgentFromSession(s),
		"model":               s.Model,
		"mode":                session.InferModeFromSession(s),
		"effort":              session.InferEffortFromSession(s),
		"fast_service":        session.InferFastServiceFromSession(s),
		"plan_mode":           s.PlanMode,
		"shell":               h.commandShellForResponse(s, exchangeAux),
		"name":                s.Name,
		"exchanges":           exchanges,
		"exchange_aux":        auxPayload,
		"related_files":       s.RelatedFiles,
		"related_worktree":    s.RelatedWorktree,
		"context_window":      contextWindow,
		"pinned_at":           s.PinnedAt,
		"created_at":          s.CreatedAt,
		"updated_at":          s.UpdatedAt,
		"closed_at":           s.ClosedAt,
	}
}

func (h *HTTPHandler) sessionListResponse(s *session.Session) map[string]any {
	if s == nil {
		return map[string]any{}
	}
	return map[string]any{
		"key":                 s.Key,
		"type":                s.Type,
		"parent_session_key":  s.ParentSessionKey,
		"parent_tool_call_id": s.ParentToolCallID,
		"source":              s.Source,
		"task_id":             s.TaskID,
		"agent":               session.InferAgentFromSession(s),
		"model":               s.Model,
		"mode":                session.InferModeFromSession(s),
		"effort":              session.InferEffortFromSession(s),
		"fast_service":        session.InferFastServiceFromSession(s),
		"plan_mode":           s.PlanMode,
		"shell":               h.commandShellForSession(s),
		"name":                s.Name,
		"related_worktree":    s.RelatedWorktree,
		"pinned_at":           s.PinnedAt,
		"created_at":          s.CreatedAt,
		"updated_at":          s.UpdatedAt,
		"closed_at":           s.ClosedAt,
	}
}

func (h *HTTPHandler) configuredShells() []commandexec.ShellSpec {
	if h == nil || h.AppContext == nil || h.AppContext.GetAgentPool() == nil {
		return nil
	}
	cfg := h.AppContext.GetAgentPool().Config()
	shells := make([]commandexec.ShellSpec, 0, len(cfg.Shells))
	for _, shell := range cfg.Shells {
		shells = append(shells, commandexec.ShellSpec{
			Command:       shell.Command,
			Args:          append([]string(nil), shell.Args...),
			LongShellArgs: append([]string(nil), shell.LongShellArgs...),
			CommandPrefix: shell.CommandPrefix,
		})
	}
	return shells
}

func (h *HTTPHandler) commandShellForSession(s *session.Session) string {
	if s == nil || s.Type != session.TypeCommand {
		return ""
	}
	if strings.TrimSpace(s.Shell) != "" {
		return strings.TrimSpace(s.Shell)
	}
	return commandexec.ResolveShell(h.configuredShells())
}

func (h *HTTPHandler) commandShellForResponse(s *session.Session, aux map[int][]session.ExchangeAux) string {
	if s == nil || s.Type != session.TypeCommand {
		return ""
	}
	if shell := session.InferCommandShellFromAux(aux); strings.TrimSpace(shell) != "" {
		return strings.TrimSpace(shell)
	}
	return h.commandShellForSession(s)
}

func externalSessionListResponse(s agenttypes.ExternalSessionSummary) map[string]any {
	name := strings.TrimSpace(s.Title)
	if name == "" {
		name = strings.TrimSpace(s.FirstUserText)
	}
	if name == "" {
		name = s.AgentSessionID
	}
	return map[string]any{
		"key":              s.AgentSessionID,
		"type":             session.TypeChat,
		"agent":            s.Agent,
		"model":            "",
		"name":             name,
		"title":            strings.TrimSpace(s.Title),
		"created_at":       s.UpdatedAt,
		"updated_at":       s.UpdatedAt,
		"closed_at":        nil,
		"agent_session_id": s.AgentSessionID,
	}
}
