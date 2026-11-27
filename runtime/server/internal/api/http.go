package api

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/relay"
	"mindfs/server/internal/selfupdate"

	"github.com/go-chi/chi/v5"
)

// HTTPHandler provides REST endpoints for health, tree, file, and action.
type HTTPHandler struct {
	AppContext       *AppContext
	StaticDir        string
	Version          string
	LocalCLIToken    string
	LocalAccessToken string
	Standalone       bool
	selfUpdateOnce   sync.Once
	selfUpdate       *selfupdate.Updater
	selfUpdateErr    error
	RelayStatus      func(context.Context) (relay.Status, error)
}

type protectedResponseWriter struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

const (
	maxUploadRequestBytes = 64 << 20
	maxUploadFileCount    = 20
	sessionListPageSize   = 50
	multiRootSessionLimit = 6
	childSessionPageSize  = 20
	childSessionMaxLimit  = 50
	e2eeHeaderName        = "X-MindFS-E2EE"
	clientIDHeaderName    = "X-MindFS-Client-ID"
	e2eeProofHeaderName   = "X-MindFS-Proof"
	e2eeTSHeaderName      = "X-MindFS-TS"
	localCLIHeaderName    = "X-MindFS-Local-CLI-Token"
	requestProofMaxSkew   = 5 * time.Minute
)

func (h *HTTPHandler) service() *usecase.Service {
	return &usecase.Service{Registry: h.AppContext}
}

func (h *HTTPHandler) requireProtectedHTTPSession(r *http.Request) (*e2ee.Session, bool, error) {
	if isLocalIDEAccess(r) {
		return nil, false, nil
	}
	manager := h.AppContext.GetE2EEManager()
	if manager == nil || !manager.Enabled() {
		return nil, false, nil
	}
	if strings.TrimSpace(r.Header.Get(e2eeHeaderName)) == "" {
		return nil, true, errInvalidRequest("e2ee_required")
	}
	clientID := strings.TrimSpace(r.Header.Get(clientIDHeaderName))
	if clientID == "" {
		return nil, true, errInvalidRequest("client_id required")
	}
	sess, err := manager.SessionForClient(clientID)
	if err != nil {
		return nil, true, errInvalidRequest(err.Error())
	}
	return sess, true, nil
}

func (h *HTTPHandler) requireRequestProof(r *http.Request) (*e2ee.Session, error) {
	if isLocalIDEAccess(r) {
		return nil, nil
	}
	manager := h.AppContext.GetE2EEManager()
	if manager == nil || !manager.Enabled() {
		return nil, nil
	}
	clientID := strings.TrimSpace(r.Header.Get(clientIDHeaderName))
	ts := strings.TrimSpace(r.Header.Get(e2eeTSHeaderName))
	proof := strings.TrimSpace(r.Header.Get(e2eeProofHeaderName))
	if clientID == "" || ts == "" || proof == "" {
		return nil, errInvalidRequest("e2ee_proof_required")
	}
	sess, err := manager.SessionForClient(clientID)
	if err != nil {
		return nil, errInvalidRequest(err.Error())
	}
	timestamp, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return nil, errInvalidRequest("invalid_e2ee_ts")
	}
	now := time.Now().UTC()
	if timestamp.Before(now.Add(-requestProofMaxSkew)) || timestamp.After(now.Add(requestProofMaxSkew)) {
		return nil, errInvalidRequest("e2ee_proof_expired")
	}
	expected := e2ee.BuildRequestProof(sess.Key, r.Method, requestProofPath(r), ts, clientID)
	if !e2ee.VerifyProof(expected, proof) {
		return nil, errInvalidRequest("e2ee_proof_invalid")
	}
	return sess, nil
}

func requestProofPath(r *http.Request) string {
	if r == nil || r.URL == nil {
		return ""
	}
	if r.URL.RawQuery == "" {
		return remoteProofPath(r)
	}
	return remoteProofPath(r) + "?" + r.URL.RawQuery
}

func writeProtectedJSON(w http.ResponseWriter, status int, key []byte, value any) error {
	envelope, err := e2ee.EncryptJSON(key, value)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set(e2eeHeaderName, "1")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(envelope)
}

func (w *protectedResponseWriter) Header() http.Header {
	return w.ResponseWriter.Header()
}

func (w *protectedResponseWriter) WriteHeader(status int) {
	w.status = status
}

func (w *protectedResponseWriter) Write(payload []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(payload)
}

func (h *HTTPHandler) protectedEndpoint(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.isLocalCLIRequest(r) {
			next(w, r)
			return
		}
		sess, protected, err := h.requireProtectedHTTPSession(r)
		if !protected {
			next(w, r)
			return
		}
		if err != nil {
			respondError(w, http.StatusUnauthorized, err)
			return
		}
		sess, err = h.requireRequestProof(r)
		if err != nil {
			respondError(w, http.StatusUnauthorized, err)
			return
		}
		if r.Body != nil && r.ContentLength != 0 && r.Method != http.MethodGet && r.Method != http.MethodHead {
			var envelope e2ee.CipherEnvelope
			if err := json.NewDecoder(io.LimitReader(r.Body, maxUploadRequestBytes)).Decode(&envelope); err != nil {
				respondError(w, http.StatusBadRequest, errInvalidRequest("invalid protected payload"))
				return
			}
			plaintext, err := e2ee.DecryptBytes(sess.Key, &envelope)
			if err != nil {
				respondError(w, http.StatusBadRequest, errInvalidRequest("e2ee_proof_invalid"))
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(plaintext))
			r.ContentLength = int64(len(plaintext))
		}
		recorder := &protectedResponseWriter{ResponseWriter: w}
		next(recorder, r)
		if recorder.status == 0 {
			recorder.status = http.StatusOK
		}
		if recorder.status == http.StatusNoContent || recorder.status == http.StatusNotModified || recorder.body.Len() == 0 {
			w.WriteHeader(recorder.status)
			return
		}
		var payload any
		if err := json.Unmarshal(recorder.body.Bytes(), &payload); err != nil {
			respondError(w, http.StatusServiceUnavailable, err)
			return
		}
		if err := writeProtectedJSON(w, recorder.status, sess.Key, payload); err != nil {
			respondError(w, http.StatusServiceUnavailable, err)
			return
		}
	}
}

func (h *HTTPHandler) isLocalCLIRequest(r *http.Request) bool {
	candidate := strings.TrimSpace(r.Header.Get(localCLIHeaderName))
	if !constantTimeTokenEqual(candidate, h.LocalCLIToken) && !constantTimeTokenEqual(candidate, h.LocalAccessToken) {
		return false
	}
	if !isLocalCLIPath(r) {
		return false
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func constantTimeTokenEqual(candidate, expected string) bool {
	expected = strings.TrimSpace(expected)
	return expected != "" && subtle.ConstantTimeCompare([]byte(candidate), []byte(expected)) == 1
}

func isLocalCLIPath(r *http.Request) bool {
	if r == nil || r.URL == nil {
		return false
	}
	switch r.Method {
	case http.MethodPost:
		return r.URL.Path == "/api/dirs" || r.URL.Path == "/api/relay/bind/start" || isLocalCLITaskPath(r.URL.Path)
	case http.MethodDelete:
		return r.URL.Path == "/api/dirs"
	case http.MethodGet:
		return isLocalCLITaskPath(r.URL.Path) || isLocalTurnDiffPath(r.URL.Path) ||
			r.URL.Path == "/api/git/related-file/compare"
	default:
		return false
	}
}

func isLocalTurnDiffPath(path string) bool {
	const prefix = "/api/sessions/"
	const suffix = "/turn-diffs/"
	start := strings.Index(path, suffix)
	if !strings.HasPrefix(path, prefix) || start <= len(prefix) || start+len(suffix) >= len(path) {
		return false
	}
	return !strings.Contains(path[start+len(suffix):], "/")
}

func isLocalCLITaskPath(path string) bool {
	if !strings.HasPrefix(path, "/api/tasks/") {
		return false
	}
	if strings.TrimPrefix(path, "/api/tasks/") == "" {
		return false
	}
	return true
}

func (h *HTTPHandler) broadcastRootChanged(action, rootID string, extra ...map[string]any) {
	if h.AppContext == nil {
		return
	}
	payload := map[string]any{
		"action":  action,
		"root_id": rootID,
	}
	for _, fields := range extra {
		for key, value := range fields {
			payload[key] = value
		}
	}
	h.AppContext.GetSessionStreamHub().BroadcastAll(WSResponse{
		Type:    "root.changed",
		Payload: payload,
	})
}

// Routes constructs the chi router with all endpoints.
func (h *HTTPHandler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/", h.handleFrontend)
	r.Get("/health", h.handleHealth)
	r.Get("/api/tree", h.protectedEndpoint(h.handleTree))
	r.Get("/api/file", h.handleFile)
	r.Put("/api/file", h.protectedEndpoint(h.handleFileSave))
	r.Get("/api/git/status", h.protectedEndpoint(h.handleGitStatus))
	r.Get("/api/git/diff", h.protectedEndpoint(h.handleGitDiff))
	r.Get("/api/git/history", h.protectedEndpoint(h.handleGitHistory))
	r.Get("/api/git/commit/files", h.protectedEndpoint(h.handleGitCommitFiles))
	r.Get("/api/git/commit/diff", h.protectedEndpoint(h.handleGitCommitDiff))
	r.Get("/api/git/related-file/diff", h.protectedEndpoint(h.handleGitRelatedFileDiff))
	r.Get("/api/git/related-file/compare", h.handleGitFileCompare)
	r.Get("/api/git/branches", h.protectedEndpoint(h.handleGitBranches))
	r.Get("/api/git/worktrees", h.protectedEndpoint(h.handleGitWorktreeList))
	r.Post("/api/git/checkout", h.protectedEndpoint(h.handleGitCheckout))
	r.Post("/api/git/pull", h.protectedEndpoint(h.handleGitPull))
	r.Post("/api/git/push", h.protectedEndpoint(h.handleGitPush))
	r.Post("/api/git/commit", h.protectedEndpoint(h.handleGitCommit))
	r.Post("/api/git/stage", h.protectedEndpoint(h.handleGitStage))
	r.Post("/api/git/unstage", h.protectedEndpoint(h.handleGitUnstage))
	r.Post("/api/git/discard", h.protectedEndpoint(h.handleGitDiscard))
	r.Post("/api/git/worktrees", h.protectedEndpoint(h.handleGitWorktreeCreate))
	r.Delete("/api/git/worktrees", h.protectedEndpoint(h.handleGitWorktreeRemove))
	r.Post("/api/upload", h.handleUpload)
	r.Get("/api/candidates", h.protectedEndpoint(h.handleCandidates))
	r.Post("/api/prompts", h.protectedEndpoint(h.handlePromptSave))
	r.Delete("/api/prompts", h.protectedEndpoint(h.handlePromptDelete))
	r.Get("/api/sessions", h.protectedEndpoint(h.handleSessions))
	r.Get("/api/preferences/session-naming", h.protectedEndpoint(h.handleSessionNamingPreferenceGet))
	r.Put("/api/preferences/session-naming", h.protectedEndpoint(h.handleSessionNamingPreferencePut))
	r.Get("/api/preferences/idle-session-resource-release", h.protectedEndpoint(h.handleIdleSessionResourceReleasePreferenceGet))
	r.Put("/api/preferences/idle-session-resource-release", h.protectedEndpoint(h.handleIdleSessionResourceReleasePreferencePut))
	r.Get("/api/preferences/new-project-meta-location", h.protectedEndpoint(h.handleNewProjectMetaLocationPreferenceGet))
	r.Put("/api/preferences/new-project-meta-location", h.protectedEndpoint(h.handleNewProjectMetaLocationPreferencePut))
	r.Get("/api/replying-sessions", h.protectedEndpoint(h.handleReplyingSessions))
	r.Get("/api/sessions/search", h.protectedEndpoint(h.handleSessionSearch))
	r.Get("/api/sessions/children", h.protectedEndpoint(h.handleSessionChildren))
	r.Get("/api/sessions/external", h.protectedEndpoint(h.handleExternalSessionsList))
	r.Post("/api/sessions/import", h.protectedEndpoint(h.handleExternalSessionImport))
	r.Post("/api/sessions/import/batch", h.protectedEndpoint(h.handleExternalSessionImportBatch))
	r.Post("/api/sessions/fork", h.protectedEndpoint(h.handleSessionFork))
	r.Get("/api/sessions/{key}/toolcalls/{callID}", h.protectedEndpoint(h.handleSessionToolCallGet))
	r.Get("/api/sessions/{key}/turn-diffs/{snapshotID}", h.handleTurnDiffArtifact)
	r.Post("/api/sessions/{key}/sync", h.protectedEndpoint(h.handleSessionSync))
	r.Get("/api/sessions/{key}", h.protectedEndpoint(h.handleSessionGet))
	r.Get("/api/sessions/{key}/log-path", h.protectedEndpoint(h.handleSessionLogPathGet))
	r.Get("/api/sessions/{key}/related-files", h.protectedEndpoint(h.handleSessionRelatedFilesGet))
	r.Post("/api/sessions/{key}/pin", h.protectedEndpoint(h.handleSessionPin))
	r.Post("/api/sessions/{key}/rename", h.protectedEndpoint(h.handleSessionRename))
	r.Delete("/api/sessions/{key}/related-files", h.protectedEndpoint(h.handleSessionRelatedFilesDelete))
	r.Delete("/api/sessions/{key}", h.protectedEndpoint(h.handleSessionDelete))
	r.Get("/api/scheduled-agent-tasks", h.protectedEndpoint(h.handleScheduledAgentTasksList))
	r.Post("/api/scheduled-agent-tasks", h.protectedEndpoint(h.handleScheduledAgentTaskCreate))
	r.Put("/api/scheduled-agent-tasks/{id}", h.protectedEndpoint(h.handleScheduledAgentTaskUpdate))
	r.Delete("/api/scheduled-agent-tasks/{id}", h.protectedEndpoint(h.handleScheduledAgentTaskDelete))
	r.Post("/api/scheduled-agent-tasks/{id}/run", h.protectedEndpoint(h.handleScheduledAgentTaskRun))
	r.Get("/api/task-stage-templates", h.protectedEndpoint(h.handleTaskStageTemplatesList))
	r.Post("/api/task-stage-templates", h.protectedEndpoint(h.handleTaskStageTemplateSave))
	r.Delete("/api/task-stage-templates/{id}", h.protectedEndpoint(h.handleTaskStageTemplateDelete))
	r.Get("/api/task-templates", h.protectedEndpoint(h.handleTaskTemplatesList))
	r.Post("/api/task-templates", h.protectedEndpoint(h.handleTaskTemplateSave))
	r.Put("/api/task-templates/{id}", h.protectedEndpoint(h.handleTaskTemplateSave))
	r.Delete("/api/task-templates/{id}", h.protectedEndpoint(h.handleTaskTemplateDelete))
	r.Get("/api/tasks", h.protectedEndpoint(h.handleKanbanTasksList))
	r.Post("/api/tasks", h.protectedEndpoint(h.handleKanbanTaskCreate))
	r.Post("/api/tasks/{id}/input", h.protectedEndpoint(h.handleKanbanTaskInputUpdate))
	r.Post("/api/tasks/{id}/next", h.protectedEndpoint(h.handleKanbanTaskNext))
	r.Post("/api/tasks/{id}/run-now", h.protectedEndpoint(h.handleKanbanTaskRunNow))
	r.Post("/api/tasks/{id}/prev", h.protectedEndpoint(h.handleKanbanTaskPrev))
	r.Post("/api/tasks/{id}/jump", h.protectedEndpoint(h.handleKanbanTaskJump))
	r.Post("/api/tasks/{id}/pause", h.protectedEndpoint(h.handleKanbanTaskPause))
	r.Post("/api/tasks/{id}/resume", h.protectedEndpoint(h.handleKanbanTaskResume))
	r.Post("/api/tasks/{id}/complete", h.protectedEndpoint(h.handleKanbanTaskComplete))
	r.Post("/api/tasks/{id}/cancel", h.protectedEndpoint(h.handleKanbanTaskCancel))
	r.Post("/api/tasks/{id}/fail", h.protectedEndpoint(h.handleKanbanTaskFail))
	r.Get("/api/collab/templates", h.protectedEndpoint(h.handleCollabTemplatesList))
	r.Post("/api/collab/templates", h.protectedEndpoint(h.handleCollabTemplateSave))
	r.Put("/api/collab/templates/{id}", h.protectedEndpoint(h.handleCollabTemplateSave))
	r.Delete("/api/collab/templates/{id}", h.protectedEndpoint(h.handleCollabTemplateDelete))
	r.Get("/api/collab/runs", h.protectedEndpoint(h.handleCollabRunsList))
	r.Post("/api/collab/runs", h.protectedEndpoint(h.handleCollabRunCreate))
	r.Get("/api/collab/runs/{id}", h.protectedEndpoint(h.handleCollabRunGet))
	r.Put("/api/collab/runs/{id}/members", h.protectedEndpoint(h.handleCollabRunMembersUpdate))
	r.Get("/api/collab/runs/{id}/docs/*", h.protectedEndpoint(h.handleCollabRunDocGet))
	r.Post("/api/collab/runs/{id}/meeting", h.protectedEndpoint(h.handleCollabMeetingAction))
	r.Get("/api/collab/runs/{id}/changes", h.protectedEndpoint(h.handleCollabChanges))
	r.Post("/api/collab/runs/{id}/review-again", h.protectedEndpoint(h.handleCollabNextReview))
	r.Post("/api/collab/runs/{id}/decisions", h.protectedEndpoint(h.handleCollabRunDecisions))
	r.Post("/api/collab/runs/{id}/pause", h.protectedEndpoint(h.handleCollabRunPause))
	r.Post("/api/collab/runs/{id}/continue", h.protectedEndpoint(h.handleCollabRunContinue))
	r.Post("/api/collab/runs/{id}/cleanup-docs", h.protectedEndpoint(h.handleCollabRunCleanupDocs))
	r.Delete("/api/collab/runs/{id}", h.protectedEndpoint(h.handleCollabRunDelete))
	r.Get("/api/dirs", h.protectedEndpoint(h.handleDirs))
	r.Post("/api/dirs", h.protectedEndpoint(h.handleAddDir))
	r.Post("/api/dirs/{id}/rename", h.protectedEndpoint(h.handleRenameDir))
	r.Delete("/api/dirs", h.protectedEndpoint(h.handleRemoveDir))
	r.Get("/api/local_dirs", h.protectedEndpoint(h.handleLocalDirs))
	r.Get("/api/relay/status", h.handleRelayStatus)
	r.Get("/api/system/stats", h.protectedEndpoint(h.handleSystemStats))
	r.Get("/api/standalone/update", h.protectedEndpoint(h.handleStandaloneUpdateStatus))
	r.Get("/api/standalone/latest", h.protectedEndpoint(h.handleStandaloneLatest))
	r.Post("/api/standalone/update", h.protectedEndpoint(h.handleStandaloneUpdateStart))
	r.Post("/api/relay/bind/start", h.protectedEndpoint(h.handleRelayBindStart))
	r.Get("/api/token-station/userinfo", h.protectedEndpoint(h.handleTokenStationUserInfo))
	r.Post("/api/token-station/bind/start", h.protectedEndpoint(h.handleTokenStationBindStart))
	r.Get("/api/relay/tips", h.protectedEndpoint(h.handleRelayTips))
	r.Get("/api/relay/services", h.protectedEndpoint(h.handleRelayServicesList))
	r.Post("/api/relay/services", h.protectedEndpoint(h.handleRelayServiceSave))
	r.Delete("/api/relay/services/{slug}", h.protectedEndpoint(h.handleRelayServiceDelete))
	r.Post("/api/e2ee/open", h.handleE2EEOpen)
	r.Get("/api/app/update", h.protectedEndpoint(h.handleAppUpdateGet))
	r.Post("/api/app/update", h.protectedEndpoint(h.handleAppUpdatePost))
	r.Post("/api/imports/github", h.protectedEndpoint(h.handleGitHubImportStart))
	r.Get("/api/imports/github/{id}", h.protectedEndpoint(h.handleGitHubImportStatus))
	r.Get("/api/web-push/status", h.protectedEndpoint(h.handleWebPushStatus))
	r.Post("/api/web-push/subscriptions", h.protectedEndpoint(h.handleWebPushSubscriptionSave))
	r.Delete("/api/web-push/subscriptions", h.protectedEndpoint(h.handleWebPushSubscriptionDelete))
	r.Post("/api/web-push/test", h.protectedEndpoint(h.handleWebPushTest))
	r.Get("/api/bark", h.protectedEndpoint(h.handleBarkStatus))
	r.Put("/api/bark", h.protectedEndpoint(h.handleBarkUpdate))
	r.Post("/api/bark/test", h.protectedEndpoint(h.handleBarkTest))

	// Agent status API
	r.Get("/api/agents", h.protectedEndpoint(h.handleAgentsList))
	r.Post("/api/agents/check-update", h.protectedEndpoint(h.handleAgentUpdateCheck))
	r.Get("/api/agents/test-models", h.protectedEndpoint(h.handleAgentConnectionModels))
	r.Post("/api/agents/test-connection", h.protectedEndpoint(h.handleAgentConnectionTest))
	r.Post("/api/agents/probe", h.protectedEndpoint(h.handleAgentProbe))
	r.Post("/api/agents/install", h.protectedEndpoint(h.handleAgentInstall))
	r.Get("/api/desktop/cc-switch", h.protectedEndpoint(h.handleCCSwitchStatus))
	r.Post("/api/desktop/cc-switch/open", h.protectedEndpoint(h.handleCCSwitchOpen))
	r.Post("/api/agents/restart", h.protectedEndpoint(h.handleAgentRestart))
	r.Get("/api/agents/codex/rate-limits", h.protectedEndpoint(h.handleCodexRateLimitsGet))
	r.Post("/api/agents/codex/rate-limit-reset", h.protectedEndpoint(h.handleCodexRateLimitReset))
	r.Post("/api/config/export", h.protectedEndpoint(h.handleConfigExport))
	r.Post("/api/config/import", h.protectedEndpoint(h.handleConfigImport))
	r.Get("/api/agent-config/defaults", h.protectedEndpoint(h.handleAgentConfigDefaults))
	r.Get("/api/agent-config/backups", h.protectedEndpoint(h.handleAgentConfigBackupsList))
	r.Post("/api/agent-config/backups", h.protectedEndpoint(h.handleAgentConfigBackupCreate))
	r.Delete("/api/agent-config/backups", h.protectedEndpoint(h.handleAgentConfigBackupDelete))
	r.Post("/api/agent-config/switch", h.protectedEndpoint(h.handleAgentConfigSwitch))
	r.Get("/api/agent-api-providers", h.protectedEndpoint(h.handleAgentAPIProvidersList))
	r.Post("/api/agent-api-providers", h.protectedEndpoint(h.handleAgentAPIProviderCreate))
	r.Post("/api/agent-api-providers/sync", h.protectedEndpoint(h.handleAgentAPIProvidersSync))
	r.Delete("/api/agent-api-providers", h.protectedEndpoint(h.handleAgentAPIProviderDelete))
	r.Post("/api/agent-api-providers/switch", h.protectedEndpoint(h.handleAgentAPIProviderSwitch))
	r.NotFound(h.handleNotFound)

	return r
}

func (h *HTTPHandler) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func (h *HTTPHandler) handleNotFound(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" || r.URL.Path == "/ws" || r.URL.Path == "/health" {
		http.NotFound(w, r)
		return
	}
	h.handleFrontend(w, r)
}

func parseNonNegativeInt64Query(r *http.Request, key string) (int64, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, errInvalidRequest(key + " must be non-negative")
	}
	return value, nil
}

func parseOptionalTimeQuery(r *http.Request, key string) (time.Time, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return time.Time{}, nil
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		value, err = time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return time.Time{}, errInvalidRequest(key + " must be RFC3339")
		}
	}
	return value.UTC(), nil
}

func parsePositiveIntQuery(r *http.Request, key string) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0, errInvalidRequest(key + " must be positive")
	}
	return value, nil
}

func truthyQuery(r *http.Request, key string) bool {
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get(key))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
