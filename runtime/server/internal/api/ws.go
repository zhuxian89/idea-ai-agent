package api

import (
	"context"
	"encoding/json"
	"github.com/gorilla/websocket"
	"log"
	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/kanban"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	wsPingInterval = 30 * time.Second
	wsPongWait     = 2 * time.Minute
	wsProofQuery   = "e2ee_proof"
	wsTSQuery      = "e2ee_ts"

	sessionDoneSettleWindow = 50 * time.Millisecond
	sessionDoneMaxWait      = 2 * time.Second
)

var upgrader = websocket.Upgrader{}

// WSHandler manages JSON-RPC over WebSocket.
type WSHandler struct {
	AppContext      *AppContext
	fileOnce        sync.Once
	relatedFileOnce sync.Once
	proberOnce      sync.Once
	updateOnce      sync.Once
	githubOnce      sync.Once
	requestMu       sync.Mutex
	requests        map[string]time.Time
}

type StreamEvent struct {
	Type        string `json:"type"`
	Data        any    `json:"data,omitempty"`
	EventCursor string `json:"event_cursor,omitempty"`
}

type sessionMessageJob struct {
	RootID          string
	RuntimeRootPath string
	Key             string
	RequestID       string
	SessionType     string
	SessionName     string
	Shell           string
	TerminalCols    int
	User            PendingUserMessage
	ClientCtx       usecase.ClientContext
	ExcludeClientID string
	Queued          bool
}

type turnUpdateTracker struct {
	mu           sync.Mutex
	inFlight     int
	lastActivity time.Time
}

func newTurnUpdateTracker() *turnUpdateTracker {
	return &turnUpdateTracker{lastActivity: time.Now()}
}

func (t *turnUpdateTracker) Begin() {
	if t == nil {
		return
	}
	t.mu.Lock()
	t.inFlight++
	t.lastActivity = time.Now()
	t.mu.Unlock()
}

func (t *turnUpdateTracker) End() {
	if t == nil {
		return
	}
	t.mu.Lock()
	if t.inFlight > 0 {
		t.inFlight--
	}
	t.lastActivity = time.Now()
	t.mu.Unlock()
}

func (t *turnUpdateTracker) WaitIdle(ctx context.Context, settleWindow, maxWait time.Duration) bool {
	if t == nil {
		return true
	}
	if settleWindow <= 0 {
		settleWindow = 50 * time.Millisecond
	}
	if maxWait <= 0 {
		maxWait = 2 * time.Second
	}
	deadline := time.Now().Add(maxWait)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	for {
		t.mu.Lock()
		inFlight := t.inFlight
		idleFor := time.Since(t.lastActivity)
		t.mu.Unlock()
		if inFlight == 0 && idleFor >= settleWindow {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-ticker.C:
		}
	}
}

// ServeHTTP upgrades the connection and processes JSON-RPC messages.
func (h *WSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.fileOnce.Do(func() {
		if h.AppContext != nil {
			h.AppContext.AddFileChangeListener(h.broadcastFileChange)
			h.AppContext.AddFileChangeBatchListener(h.broadcastFileChangeBatch)
		}
	})
	h.relatedFileOnce.Do(func() {
		if h.AppContext != nil {
			h.AppContext.AddRelatedFileListener(h.broadcastRelatedFileChange)
		}
	})
	h.proberOnce.Do(func() {
		if h.AppContext != nil && h.AppContext.GetProber() != nil {
			h.AppContext.GetProber().AddListener(h.broadcastAgentStatusChange)
		}
	})
	h.updateOnce.Do(func() {
		if h.AppContext != nil && h.AppContext.GetUpdateService() != nil {
			h.AppContext.GetUpdateService().AddListener(h.broadcastAppUpdate)
		}
	})
	h.githubOnce.Do(func() {
		if h.AppContext != nil && h.AppContext.GetGitHubImportService() != nil {
			h.AppContext.GetGitHubImportService().AddListener(h.broadcastGitHubImport)
		}
	})
	clientID := strings.TrimSpace(r.URL.Query().Get("client_id"))
	if clientID == "" {
		http.Error(w, "client_id required", http.StatusBadRequest)
		return
	}
	if err := h.requireWSProof(r, clientID); err != nil {
		respondError(w, http.StatusUnauthorized, err)
		return
	}
	localIDE := isLocalIDEAccess(r)
	if localIDE {
		clientID = "idea:" + clientID
	} else if strings.HasPrefix(clientID, "idea:") {
		http.Error(w, "reserved client id", http.StatusBadRequest)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	log.Printf("[ws] connected client=%s remote=%s path=%s", clientID, r.RemoteAddr, r.URL.Path)
	if h.AppContext != nil {
		h.AppContext.GetSessionStreamHub().registerClient(clientID, conn, localIDE)
		if !localIDE && ((isRemoteProjectAccess(r) && !remoteProjectAllowed(r)) || (!isRemoteProjectAccess(r) && h.AppContext.ProjectLocked && h.AppContext.Relay != nil && h.AppContext.Relay.NoRelayer())) {
			h.AppContext.GetSessionStreamHub().UnregisterClient(clientID, conn)
			_ = conn.Close()
			return
		}
		h.pushInitialAppUpdate(clientID)
		h.pushInitialGitHubImports(clientID)
	}
	defer func() {
		if h.AppContext != nil {
			h.AppContext.GetSessionStreamHub().UnregisterClient(clientID, conn)
		}
		log.Printf("[ws] disconnected client=%s remote=%s path=%s", clientID, r.RemoteAddr, r.URL.Path)
		conn.Close()
	}()

	conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(wsPongWait))
		return nil
	})

	done := make(chan struct{})
	defer close(done)

	go func() {
		ticker := time.NewTicker(wsPingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
					_ = conn.Close()
					return
				}
			case <-done:
				return
			}
		}
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if closeErr, ok := err.(*websocket.CloseError); ok {
				log.Printf("[ws] read.closed client=%s remote=%s path=%s code=%d text=%q", clientID, r.RemoteAddr, r.URL.Path, closeErr.Code, closeErr.Text)
			} else {
				log.Printf("[ws] read.error client=%s remote=%s path=%s err=%v", clientID, r.RemoteAddr, r.URL.Path, err)
			}
			return
		}
		if e2eeManager := h.AppContext.GetE2EEManager(); !localIDE && e2eeManager != nil && e2eeManager.Enabled() {
			sess, err := e2eeManager.SessionForClient(clientID)
			if err != nil {
				h.sendE2EEError(conn, "", err.Error())
				continue
			}
			var envelope e2ee.CipherEnvelope
			if err := json.Unmarshal(message, &envelope); err != nil {
				h.sendE2EEError(conn, "", "e2ee_session_missing")
				continue
			}
			message, err = e2ee.DecryptBytes(sess.Key, &envelope)
			if err != nil {
				h.sendE2EEError(conn, "", "e2ee_proof_invalid")
				continue
			}
		}
		var req WSRequest
		if err := json.Unmarshal(message, &req); err != nil {
			h.sendWSError(conn, clientID, "", "invalid_request", "invalid request")
			continue
		}
		h.handleWSRequest(r.Context(), conn, clientID, req)
	}
}

func (h *WSHandler) requireWSProof(r *http.Request, clientID string) error {
	if isLocalIDEAccess(r) {
		return nil
	}
	if h == nil || h.AppContext == nil {
		return nil
	}
	manager := h.AppContext.GetE2EEManager()
	if manager == nil || !manager.Enabled() {
		return nil
	}
	ts := strings.TrimSpace(r.URL.Query().Get(wsTSQuery))
	proof := strings.TrimSpace(r.URL.Query().Get(wsProofQuery))
	if clientID == "" || ts == "" || proof == "" {
		return errInvalidRequest("e2ee_proof_required")
	}
	sess, err := manager.SessionForClient(clientID)
	if err != nil {
		return errInvalidRequest(err.Error())
	}
	timestamp, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return errInvalidRequest("invalid_e2ee_ts")
	}
	now := time.Now().UTC()
	if timestamp.Before(now.Add(-requestProofMaxSkew)) || timestamp.After(now.Add(requestProofMaxSkew)) {
		return errInvalidRequest("e2ee_proof_expired")
	}
	expected := e2ee.BuildRequestProof(sess.Key, r.Method, wsProofPath(r), ts, clientID)
	if !e2ee.VerifyProof(expected, proof) {
		return errInvalidRequest("e2ee_proof_invalid")
	}
	return nil
}

func wsProofPath(r *http.Request) string {
	if r == nil || r.URL == nil {
		return ""
	}
	next := *r.URL
	query := cloneQuery(next.Query())
	query.Del(wsTSQuery)
	query.Del(wsProofQuery)
	next.RawQuery = query.Encode()
	if next.RawQuery == "" {
		return remoteProofPath(r)
	}
	return remoteProofPath(r) + "?" + next.RawQuery
}

func cloneQuery(values url.Values) url.Values {
	next := make(url.Values, len(values))
	for key, value := range values {
		next[key] = append([]string(nil), value...)
	}
	return next
}

func (h *WSHandler) broadcastFileChange(change fs.FileChangeEvent) {
	resp := WSResponse{
		Type: "file.changed",
		Payload: map[string]any{
			"root_id": change.RootID,
			"path":    change.Path,
			"op":      change.Op,
			"is_dir":  change.IsDir,
		},
	}
	h.broadcastWS(resp)
}

func (h *WSHandler) handleSessionAnswerQuestion(ctx context.Context, conn *websocket.Conn, clientID string, req WSRequest) {
	rootID := getString(req.Payload, "root_id")
	key := getString(req.Payload, "session_key")
	agentName := getString(req.Payload, "agent")
	toolUseID := getString(req.Payload, "tool_use_id")
	if key == "" || toolUseID == "" {
		h.sendWSError(conn, clientID, req.ID, "invalid_request", "session_key and tool_use_id required")
		return
	}
	answers := parseStringMap(req.Payload["answers"])
	if len(answers) == 0 {
		h.sendWSError(conn, clientID, req.ID, "invalid_request", "answers required")
		return
	}
	uc := &usecase.Service{Registry: h.AppContext}
	if err := uc.AnswerQuestion(ctx, usecase.AnswerQuestionInput{
		RootID:     rootID,
		SessionKey: key,
		Agent:      agentName,
		ToolUseID:  toolUseID,
		Answers:    answers,
	}); err != nil {
		h.sendWSError(conn, clientID, req.ID, "session.answer_question_failed", err.Error())
		return
	}
	h.broadcastAnsweredQuestion(ctx, rootID, key, toolUseID)
	if manager, err := h.AppContext.GetSessionManager(rootID); err == nil {
		if sess, getErr := manager.Get(ctx, key, 0); getErr == nil && sess != nil && strings.TrimSpace(sess.TaskID) != "" {
			if svc, svcErr := h.AppContext.GetKanbanService(); svcErr == nil {
				value := manager.HasPendingAskUserQuestions(ctx, key)
				if _, clearErr := svc.UpdateTaskAuxFlags(ctx, rootID, sess.TaskID, kanban.TaskAuxFlagsPatch{AskUserWaiting: &value}, "aux_ask_user_answered"); clearErr != nil {
					log.Printf("[kanban] ask_user.answered.flag_clear.error root=%s task=%s session=%s err=%v", rootID, sess.TaskID, key, clearErr)
				}
			}
		}
	}
	_ = h.writeWSJSON(clientID, conn, WSResponse{
		ID:      req.ID,
		Type:    "session.answer_question.accepted",
		Payload: map[string]any{"root_id": rootID, "session_key": key, "tool_use_id": toolUseID},
	})
}

func (h *WSHandler) sendE2EEError(conn *websocket.Conn, id, code string) {
	resp := WSResponse{
		ID:   id,
		Type: "e2ee.error",
		Payload: map[string]any{
			"code": code,
		},
	}
	_ = h.writeWSJSON("", conn, resp)
}

func (h *WSHandler) sendWSAccepted(conn *websocket.Conn, clientID, requestID, rootID, sessionKey string) {
	h.sendWSAcceptedAt(conn, clientID, requestID, rootID, sessionKey, time.Time{})
}

func (h *WSHandler) sendWSAcceptedAt(conn *websocket.Conn, clientID, requestID, rootID, sessionKey string, timestamp time.Time) {
	payload := map[string]any{
		"request_id":  requestID,
		"root_id":     rootID,
		"session_key": sessionKey,
	}
	if !timestamp.IsZero() {
		payload["timestamp"] = timestamp.UTC()
	}
	resp := WSResponse{
		ID:      requestID,
		Type:    "session.accepted",
		Payload: payload,
	}
	_ = h.writeWSJSON(clientID, conn, resp)
}

func (h *WSHandler) reserveClientRequest(requestID string) (time.Time, bool) {
	requestID = strings.TrimSpace(requestID)
	now := time.Now().UTC()
	if requestID == "" {
		return now, true
	}
	h.requestMu.Lock()
	defer h.requestMu.Unlock()
	if h.requests == nil {
		h.requests = make(map[string]time.Time)
	}
	cutoff := time.Now().Add(-24 * time.Hour)
	for id, seenAt := range h.requests {
		if seenAt.Before(cutoff) {
			delete(h.requests, id)
		}
	}
	if seenAt, exists := h.requests[requestID]; exists {
		return seenAt, false
	}
	h.requests[requestID] = now
	return now, true
}

func (h *WSHandler) writeWSJSON(clientID string, conn *websocket.Conn, resp WSResponse) error {
	if h.AppContext != nil {
		return h.AppContext.GetSessionStreamHub().WriteJSON(clientID, conn, resp)
	}
	return conn.WriteJSON(resp)
}
