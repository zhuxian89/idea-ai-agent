package api

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"mindfs/server/internal/e2ee"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

func (h *StreamHub) SendToClient(clientID string, resp WSResponse) {
	if blank(clientID) {
		return
	}
	h.mu.RLock()
	conn := h.clients[clientID]
	h.mu.RUnlock()
	if conn == nil {
		return
	}
	if err := h.WriteJSON(clientID, conn, resp); err != nil {
		// A broken UI connection must not hold up other clients or queue replay.
		h.UnregisterClient(clientID, conn)
		_ = conn.Close()
	}
}

func (h *StreamHub) BroadcastAll(resp WSResponse) {
	for _, clientID := range h.getAllClientIDs() {
		h.SendToClient(clientID, resp)
	}
}

func (h *StreamHub) BroadcastSessionStream(rootID, sessionKey string, event *StreamEvent) {
	if event == nil {
		return
	}
	stored := h.AppendReplyEvent(sessionKey, *event)
	for _, clientID := range h.GetSessionClientIDs(sessionKey, true) {
		resp := buildSessionStreamResponse(rootID, sessionKey, &stored)
		h.SendToClient(clientID, resp)
	}
}

func (h *StreamHub) BroadcastSessionDone(rootID, sessionKey, requestID string) {
	h.mu.Lock()
	h.completed[sessionKey] = &CompletedSessionState{
		RequestID: requestID,
		Completed: time.Now().UTC(),
	}
	h.mu.Unlock()
	resp := buildSessionDoneResponse(rootID, sessionKey, requestID, false)
	for _, clientID := range h.GetSessionClientIDs(sessionKey, false) {
		h.SendToClient(clientID, resp)
	}
}

func (h *StreamHub) BroadcastSessionUserMessage(
	rootID string,
	sessionKey string,
	sessionType string,
	sessionName string,
	agentName string,
	model string,
	mode string,
	effort string,
	fastService string,
	planMode bool,
	content string,
	excludeClientID string,
	queued bool,
) {
	h.BroadcastSessionUserMessageAt(rootID, sessionKey, sessionType, sessionName, agentName, model, mode, effort, fastService, planMode, content, time.Now().UTC(), excludeClientID, queued)
}

func (h *StreamHub) BroadcastSessionUserMessageAt(
	rootID string,
	sessionKey string,
	sessionType string,
	sessionName string,
	agentName string,
	model string,
	mode string,
	effort string,
	fastService string,
	planMode bool,
	content string,
	timestamp time.Time,
	excludeClientID string,
	queued bool,
	baseExchangeSeq ...int,
) {
	pendingUser := h.SetPendingUserAt(rootID, sessionKey, sessionName, agentName, model, mode, effort, fastService, planMode, content, timestamp, baseExchangeSeq...)
	resp := buildSessionUserMessageResponse(rootID, sessionKey, sessionType, sessionName, agentName, model, mode, effort, fastService, planMode, content, pendingUser.Timestamp, queued)
	// The sender's optimistic state can disagree with the server about whether
	// this turn was queued. Every client needs the authoritative started message.
	for _, clientID := range h.GetSessionClientIDs(sessionKey, false) {
		h.SendToClient(clientID, resp)
	}
}

func (h *StreamHub) queuePublishLock(sessionKey string) *sync.Mutex {
	lock, _ := h.queuePublishLocks.LoadOrStore(sessionKey, &sync.Mutex{})
	return lock.(*sync.Mutex)
}

func (h *StreamHub) BroadcastSessionQueueUpdated(rootID, sessionKey string, _ []QueuedUserMessage) {
	lock := h.queuePublishLock(sessionKey)
	lock.Lock()
	defer lock.Unlock()
	// A handler's earlier snapshot may already have been drained by another turn.
	// Read the current state inside the publication lock, also used by replay.
	_, queue, frozen := h.queueSnapshot(sessionKey)
	resp := buildSessionQueueUpdatedResponse(rootID, sessionKey, queue, frozen)
	for _, clientID := range h.GetSessionClientIDs(sessionKey, false) {
		h.SendToClient(clientID, resp)
	}
}

func lastRunes(value string, max int) string {
	if max <= 0 || value == "" {
		return ""
	}
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return "..." + string(runes[len(runes)-max:])
}

func (h *StreamHub) WriteJSON(clientID string, conn *websocket.Conn, value any) error {
	if conn == nil {
		return nil
	}
	lock := h.getConnLock(conn)
	lock.Lock()
	defer lock.Unlock()
	if err := conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	h.mu.RLock()
	localIDE := h.localIDEClients[conn]
	h.mu.RUnlock()
	if !localIDE && h.e2eeManager != nil && h.e2eeManager.Enabled() {
		if resp, ok := value.(WSResponse); ok && resp.Type == "e2ee.error" {
			return conn.WriteJSON(resp)
		}
		sess, err := h.e2eeManager.SessionForClient(clientID)
		if err != nil {
			return nil
		}
		payload, err := json.Marshal(value)
		if err != nil {
			return err
		}
		envelope, err := e2ee.EncryptBytes(sess.Key, payload)
		if err != nil {
			return err
		}
		return conn.WriteJSON(envelope)
	}
	return conn.WriteJSON(value)
}

func (h *StreamHub) getConnLock(conn *websocket.Conn) *sync.Mutex {
	h.mu.RLock()
	lock := h.connLocks[conn]
	h.mu.RUnlock()
	if lock != nil {
		return lock
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if existing := h.connLocks[conn]; existing != nil {
		return existing
	}
	created := &sync.Mutex{}
	h.connLocks[conn] = created
	return created
}

func (h *StreamHub) collectReplayStep(clientID, sessionKey string) replayStep {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.nextReplayStepLocked(clientID, sessionKey)
}

func (h *StreamHub) nextReplayStepLocked(clientID, sessionKey string) replayStep {
	clientKey := pendingClientKey(clientID, sessionKey)
	replay := h.replayStates[clientKey]
	if replay == nil {
		return replayStep{live: true}
	}
	state := h.pendingSessions[sessionKey]
	if state == nil {
		replay.Status = ClientStreamStatusLive
		return replayStep{live: true}
	}
	events := make([]StreamEvent, 0, len(state.ReplyingList))
	maxEventSeq := replay.LastEventSeq
	for _, event := range state.ReplyingList {
		baseExchangeSeq, eventSeq, ok := parseEventCursor(event.EventCursor)
		if !ok || baseExchangeSeq != state.BaseExchangeSeq || eventSeq <= replay.LastEventSeq {
			continue
		}
		events = append(events, cloneEvent(event))
		if eventSeq > maxEventSeq {
			maxEventSeq = eventSeq
		}
	}
	if len(events) == 0 {
		replay.Status = ClientStreamStatusLive
		return replayStep{live: true}
	}
	sort.SliceStable(events, func(i, j int) bool {
		_, left, _ := parseEventCursor(events[i].EventCursor)
		_, right, _ := parseEventCursor(events[j].EventCursor)
		return left < right
	})
	replay.LastEventSeq = maxEventSeq
	return replayStep{events: events}
}

func (h *StreamHub) replayStepToClient(rootID, clientID, sessionKey string, events []StreamEvent) {
	for i := range events {
		h.SendToClient(clientID, buildSessionStreamResponse(rootID, sessionKey, &events[i]))
	}
}

func (h *StreamHub) replayQueueToClient(rootID, clientID, sessionKey string) {
	lock := h.queuePublishLock(sessionKey)
	lock.Lock()
	defer lock.Unlock()
	stateRoot, queue, frozen := h.queueSnapshot(sessionKey)
	if rootID == "" {
		rootID = stateRoot
	}
	if rootID == "" {
		return
	}
	h.SendToClient(clientID, buildSessionQueueUpdatedResponse(rootID, sessionKey, queue, frozen))
}

func (h *StreamHub) replayCompletionToClient(rootID, clientID, sessionKey string) {
	if blank(rootID) || blank(clientID) || blank(sessionKey) {
		return
	}
	h.mu.Lock()
	completed := h.completed[sessionKey]
	if completed == nil {
		h.mu.Unlock()
		return
	}
	requestID := completed.RequestID
	h.mu.Unlock()
	h.SendToClient(clientID, buildSessionDoneResponse(rootID, sessionKey, requestID, true))
}

func (h *StreamHub) isReplayClientLocked(clientID, sessionKey string) bool {
	for _, replayKey := range h.getReplayKeyListLocked(sessionKey, clientID) {
		state := h.replayStates[replayKey]
		return state != nil && state.Status != ClientStreamStatusLive
	}
	return false
}

func (h *StreamHub) getReplayKeyListLocked(sessionKey, clientID string) []string {
	if len(h.replayStates) == 0 {
		return nil
	}
	keys := make([]string, 0, len(h.replayStates))
	for replayKey := range h.replayStates {
		if sessionKey != "" && !strings.HasSuffix(replayKey, "::"+sessionKey) {
			continue
		}
		if clientID != "" && !strings.HasPrefix(replayKey, clientID+"::") {
			continue
		}
		keys = append(keys, replayKey)
	}
	return keys
}
