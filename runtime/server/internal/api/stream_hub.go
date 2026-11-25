package api

import (
	"fmt"
	"github.com/gorilla/websocket"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/notify"
	"mindfs/server/internal/session"
	"strconv"
	"strings"
	"sync"
	"time"
)

type StreamHub struct {
	mu                sync.RWMutex
	queuePublishLocks sync.Map // session key -> *sync.Mutex; serializes queue snapshots on the wire
	e2eeManager       *e2ee.Manager
	clients           map[string]*websocket.Conn
	connLocks         map[*websocket.Conn]*sync.Mutex
	localIDEClients   map[*websocket.Conn]bool
	sessionClients    map[string]map[string]struct{}
	pendingSessions   map[string]*SessionPendingState
	replayStates      map[string]*ClientReplayState
	completed         map[string]*CompletedSessionState
}

type PendingUserMessage struct {
	Agent       string    `json:"agent,omitempty"`
	Model       string    `json:"model,omitempty"`
	Mode        string    `json:"mode,omitempty"`
	Effort      string    `json:"effort,omitempty"`
	FastService string    `json:"fast_service,omitempty"`
	PlanMode    bool      `json:"plan_mode,omitempty"`
	Content     string    `json:"content"`
	Timestamp   time.Time `json:"timestamp"`
}

type QueuedUserMessage struct {
	ID string `json:"id"`
	PendingUserMessage
	ClientCtx usecase.ClientContext `json:"-"`
}

type SessionPendingState struct {
	RootID          string
	SessionTitle    string
	Active          bool
	QueueFrozen     bool
	User            *PendingUserMessage
	Queue           []QueuedUserMessage
	ReplyingList    []StreamEvent
	BaseExchangeSeq int
	NextEventSeq    uint64
	Summary         string
	UpdatedAt       time.Time
}

type ClientStreamStatus string

const (
	ClientStreamStatusReplay ClientStreamStatus = "replay"
	ClientStreamStatusLive   ClientStreamStatus = "live"
)

type ClientReplayState struct {
	Status       ClientStreamStatus
	LastEventSeq uint64
}

type CompletedSessionState struct {
	RequestID string
	Completed time.Time
}

type ReplyingSessionState struct {
	RootID       string    `json:"rootId"`
	SessionKey   string    `json:"sessionKey"`
	SessionTitle string    `json:"sessionTitle"`
	Status       string    `json:"status"`
	Summary      string    `json:"summary"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type PendingSessionSnapshot struct {
	RootID       string
	SessionTitle string
	Summary      string
	UpdatedAt    time.Time
}

type replayStep struct {
	events []StreamEvent
	live   bool
}

func blank(value string) bool {
	return strings.TrimSpace(value) == ""
}

func NewStreamHub(e2eeManager *e2ee.Manager) *StreamHub {
	return &StreamHub{
		e2eeManager:     e2eeManager,
		clients:         make(map[string]*websocket.Conn),
		connLocks:       make(map[*websocket.Conn]*sync.Mutex),
		localIDEClients: make(map[*websocket.Conn]bool),
		sessionClients:  make(map[string]map[string]struct{}),
		pendingSessions: make(map[string]*SessionPendingState),
		replayStates:    make(map[string]*ClientReplayState),
		completed:       make(map[string]*CompletedSessionState),
	}
}

func pendingClientKey(clientID, sessionKey string) string {
	return clientID + "::" + sessionKey
}

func cloneEvent(ev StreamEvent) StreamEvent {
	return StreamEvent{Type: ev.Type, Data: ev.Data, EventCursor: ev.EventCursor}
}

func cloneUserExchange(msg *PendingUserMessage) *session.Exchange {
	if msg == nil {
		return nil
	}
	return &session.Exchange{
		Role:        "user",
		Agent:       msg.Agent,
		Model:       msg.Model,
		Mode:        msg.Mode,
		Effort:      msg.Effort,
		FastService: msg.FastService,
		Content:     msg.Content,
		Timestamp:   msg.Timestamp,
	}
}

func (h *StreamHub) clearReplayStatesForSessionLocked(sessionKey string) {
	for _, replayKey := range h.getReplayKeyListLocked(sessionKey, "") {
		delete(h.replayStates, replayKey)
	}
}

func (h *StreamHub) RegisterClient(clientID string, conn *websocket.Conn) {
	h.registerClient(clientID, conn, false)
}

func (h *StreamHub) CloseRemoteClients() {
	h.mu.RLock()
	var connections []*websocket.Conn
	for _, conn := range h.clients {
		if !h.localIDEClients[conn] {
			connections = append(connections, conn)
		}
	}
	h.mu.RUnlock()
	for _, conn := range connections {
		_ = conn.Close()
	}
}

// CloseClients also disconnects local browsers when the backend shuts down.
// HTTP Server.Shutdown does not close upgraded WebSocket connections.
func (h *StreamHub) CloseClients() {
	h.mu.RLock()
	connections := make([]*websocket.Conn, 0, len(h.clients))
	for _, conn := range h.clients {
		connections = append(connections, conn)
	}
	h.mu.RUnlock()
	for _, conn := range connections {
		_ = conn.Close()
	}
}

func (h *StreamHub) registerClient(clientID string, conn *websocket.Conn, localIDE bool) {
	if blank(clientID) || conn == nil {
		return
	}
	h.mu.Lock()
	previous := h.clients[clientID]
	h.clients[clientID] = conn
	h.localIDEClients[conn] = localIDE
	if _, ok := h.connLocks[conn]; !ok {
		h.connLocks[conn] = &sync.Mutex{}
	}
	h.mu.Unlock()
	if previous != nil && previous != conn {
		_ = previous.Close()
	}
}

func (h *StreamHub) UnregisterClient(clientID string, conn *websocket.Conn) {
	if blank(clientID) {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	existing := h.clients[clientID]
	delete(h.connLocks, conn)
	delete(h.localIDEClients, conn)
	if existing != conn {
		return
	}
	delete(h.clients, clientID)
	for sessionKey, clientSet := range h.sessionClients {
		delete(clientSet, clientID)
		if len(clientSet) == 0 {
			delete(h.sessionClients, sessionKey)
		}
	}
	for _, replayKey := range h.getReplayKeyListLocked("", clientID) {
		delete(h.replayStates, replayKey)
	}
}

func (h *StreamHub) BindSessionClient(sessionKey, clientID string) {
	if blank(sessionKey) || blank(clientID) {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[clientID]; !ok {
		return
	}
	clientSet := h.sessionClients[sessionKey]
	if clientSet == nil {
		clientSet = make(map[string]struct{})
		h.sessionClients[sessionKey] = clientSet
	}
	clientSet[clientID] = struct{}{}
}

func (h *StreamHub) GetSessionClientIDs(sessionKey string, liveOnly bool) []string {
	if blank(sessionKey) {
		return nil
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	clientSet := h.sessionClients[sessionKey]
	if len(clientSet) == 0 {
		return nil
	}
	out := make([]string, 0, len(clientSet))
	for clientID := range clientSet {
		if h.clients[clientID] == nil {
			continue
		}
		if liveOnly && h.isReplayClientLocked(clientID, sessionKey) {
			continue
		}
		out = append(out, clientID)
	}
	return out
}

func (h *StreamHub) getAllClientIDs() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if len(h.clients) == 0 {
		return nil
	}
	clientIDs := make([]string, 0, len(h.clients))
	for clientID, conn := range h.clients {
		if conn != nil {
			clientIDs = append(clientIDs, clientID)
		}
	}
	return clientIDs
}

func (h *StreamHub) SetPendingUser(rootID, sessionKey, sessionTitle, agent, model, mode, effort, fastService string, planMode bool, content string) *PendingUserMessage {
	return h.SetPendingUserAt(rootID, sessionKey, sessionTitle, agent, model, mode, effort, fastService, planMode, content, time.Now().UTC())
}

func (h *StreamHub) SetPendingUserAt(rootID, sessionKey, sessionTitle, agent, model, mode, effort, fastService string, planMode bool, content string, timestamp time.Time, baseExchangeSeq ...int) *PendingUserMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	} else {
		timestamp = timestamp.UTC()
	}
	state := h.ensurePendingSessionLocked(sessionKey)
	delete(h.completed, sessionKey)
	state.RootID = rootID
	state.SessionTitle = strings.TrimSpace(sessionTitle)
	state.Active = true
	state.User = &PendingUserMessage{
		Agent:       agent,
		Model:       model,
		Mode:        mode,
		Effort:      effort,
		FastService: fastService,
		PlanMode:    planMode,
		Content:     content,
		Timestamp:   timestamp,
	}
	state.ReplyingList = nil
	state.BaseExchangeSeq = 0
	if len(baseExchangeSeq) > 0 && baseExchangeSeq[0] > 0 {
		state.BaseExchangeSeq = baseExchangeSeq[0]
	}
	state.NextEventSeq = 0
	state.Summary = ""
	state.UpdatedAt = state.User.Timestamp
	h.clearReplayStatesForSessionLocked(sessionKey)
	return &PendingUserMessage{
		Agent:       state.User.Agent,
		Model:       state.User.Model,
		Mode:        state.User.Mode,
		Effort:      state.User.Effort,
		FastService: state.User.FastService,
		PlanMode:    state.User.PlanMode,
		Content:     state.User.Content,
		Timestamp:   state.User.Timestamp,
	}
}

func (h *StreamHub) IsSessionReplying(sessionKey string) bool {
	if blank(sessionKey) {
		return false
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	state := h.pendingSessions[sessionKey]
	return state != nil && state.Active
}

func cloneQueue(queue []QueuedUserMessage) []QueuedUserMessage {
	if len(queue) == 0 {
		return nil
	}
	out := make([]QueuedUserMessage, len(queue))
	copy(out, queue)
	return out
}

func (h *StreamHub) GetPendingUserExchange(sessionKey string) *session.Exchange {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.pendingSessions[sessionKey]
	if state == nil {
		return nil
	}
	return cloneUserExchange(state.User)
}

func (h *StreamHub) PendingSessionSnapshot(sessionKey string) PendingSessionSnapshot {
	h.mu.RLock()
	defer h.mu.RUnlock()
	state := h.pendingSessions[sessionKey]
	if state == nil {
		return PendingSessionSnapshot{}
	}
	return PendingSessionSnapshot{
		RootID:       state.RootID,
		SessionTitle: state.SessionTitle,
		Summary:      state.Summary,
		UpdatedAt:    state.UpdatedAt,
	}
}

func (h *StreamHub) AppendReplyEvent(sessionKey string, event StreamEvent) StreamEvent {
	h.mu.Lock()
	defer h.mu.Unlock()
	if event.Type == "question_answered" {
		// Retain the correction for replay only when this pending turn contains
		// the question. A late correction must not create a pending turn or
		// attach an old question to the next turn.
		state := h.pendingSessions[sessionKey]
		call, ok := event.Data.(agenttypes.ToolCall)
		if state == nil || !ok {
			return event
		}
		for _, previous := range state.ReplyingList {
			question, ok := previous.Data.(agenttypes.ToolCall)
			if ok && question.CallID == call.CallID && question.Kind == agenttypes.ToolKindAskUser {
				state.NextEventSeq++
				event.EventCursor = formatEventCursor(state.BaseExchangeSeq, state.NextEventSeq)
				state.ReplyingList = append(state.ReplyingList, cloneEvent(event))
				return event
			}
		}
		return event
	}
	state := h.ensurePendingSessionLocked(sessionKey)
	state.NextEventSeq++
	event.EventCursor = formatEventCursor(state.BaseExchangeSeq, state.NextEventSeq)
	if coalesceUserShellStreamEvent(state, event) {
		state.UpdatedAt = time.Now().UTC()
		return event
	}
	state.ReplyingList = append(state.ReplyingList, cloneEvent(event))
	state.UpdatedAt = time.Now().UTC()
	if event.Type == "message_chunk" {
		if chunk, ok := event.Data.(agenttypes.MessageChunk); ok {
			state.Summary = lastRunes(state.Summary+chunk.Content, notify.BodyMaxRunes)
		}
	} else if isAuxiliarySummaryBoundary(event.Type) {
		state.Summary = ""
	}
	return event
}

func formatEventCursor(baseExchangeSeq int, eventSeq uint64) string {
	return fmt.Sprintf("%d:%d", baseExchangeSeq, eventSeq)
}

func parseEventCursor(value string) (int, uint64, bool) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 0, 0, false
	}
	baseExchangeSeq, err := strconv.Atoi(parts[0])
	if err != nil || baseExchangeSeq < 0 {
		return 0, 0, false
	}
	eventSeq, err := strconv.ParseUint(parts[1], 10, 64)
	if err != nil {
		return 0, 0, false
	}
	return baseExchangeSeq, eventSeq, true
}

func isAuxiliarySummaryBoundary(eventType string) bool {
	switch agenttypes.EventType(eventType) {
	case agenttypes.EventTypeThoughtChunk,
		agenttypes.EventTypeToolCall,
		agenttypes.EventTypeToolUpdate,
		agenttypes.EventTypeTodoUpdate,
		agenttypes.EventTypePlanUpdate,
		agenttypes.EventTypeCompact:
		return true
	default:
		return false
	}
}

const maxReplayUserShellStreamBytes = 256 * 1024

func coalesceUserShellStreamEvent(state *SessionPendingState, event StreamEvent) bool {
	if state == nil || event.Type != string(agenttypes.EventTypeToolUpdate) {
		return false
	}
	next, ok := event.Data.(agenttypes.ToolCall)
	if !ok || next.Meta == nil || next.Meta["source"] != "userShell" || next.Meta["phase"] != "stream" || next.CallID == "" {
		return false
	}
	for i := len(state.ReplyingList) - 1; i >= 0; i-- {
		prevEvent := state.ReplyingList[i]
		if prevEvent.Type != event.Type {
			continue
		}
		prev, ok := prevEvent.Data.(agenttypes.ToolCall)
		if !ok || prev.CallID != next.CallID || prev.Meta == nil || prev.Meta["source"] != "userShell" || prev.Meta["phase"] != "stream" {
			continue
		}
		merged := prev
		merged.Status = next.Status
		merged.Meta = map[string]any{}
		for key, value := range prev.Meta {
			merged.Meta[key] = value
		}
		for key, value := range next.Meta {
			merged.Meta[key] = value
		}
		merged.Meta["replaySnapshot"] = true
		text := toolCallText(prev.Content) + toolCallText(next.Content)
		if len(text) > maxReplayUserShellStreamBytes {
			text = text[len(text)-maxReplayUserShellStreamBytes:]
			merged.Meta["replayTruncated"] = true
			merged.Meta["replayTruncation"] = "tail"
		}
		merged.Content = []agenttypes.ToolCallContentItem{{Type: "text", Text: text}}
		state.ReplyingList[i] = StreamEvent{Type: event.Type, Data: merged, EventCursor: event.EventCursor}
		return true
	}
	return false
}

func toolCallText(items []agenttypes.ToolCallContentItem) string {
	if len(items) == 0 {
		return ""
	}
	var b strings.Builder
	for _, item := range items {
		b.WriteString(item.Text)
	}
	return b.String()
}

func (h *StreamHub) ListReplyingSessions() []ReplyingSessionState {
	h.mu.RLock()
	defer h.mu.RUnlock()
	items := make([]ReplyingSessionState, 0, len(h.pendingSessions))
	for sessionKey, state := range h.pendingSessions {
		if state == nil || !state.Active || blank(sessionKey) || blank(state.RootID) {
			continue
		}
		items = append(items, ReplyingSessionState{
			RootID:       state.RootID,
			SessionKey:   sessionKey,
			SessionTitle: state.SessionTitle,
			Status:       "replying",
			Summary:      state.Summary,
			UpdatedAt:    state.UpdatedAt,
		})
	}
	return items
}

func (h *StreamHub) ReplayPending(rootID, clientID, sessionKey, eventCursor string) {
	h.mu.Lock()
	lastEventSeq := uint64(0)
	if state := h.pendingSessions[sessionKey]; state != nil {
		if baseExchangeSeq, parsedEventSeq, ok := parseEventCursor(eventCursor); ok &&
			baseExchangeSeq == state.BaseExchangeSeq && parsedEventSeq <= state.NextEventSeq {
			lastEventSeq = parsedEventSeq
		}
	}
	h.replayStates[pendingClientKey(clientID, sessionKey)] = &ClientReplayState{
		Status:       ClientStreamStatusReplay,
		LastEventSeq: lastEventSeq,
	}
	h.mu.Unlock()

	h.replayQueueToClient(rootID, clientID, sessionKey)
	for {
		step := h.collectReplayStep(clientID, sessionKey)
		h.replayStepToClient(rootID, clientID, sessionKey, step.events)
		if step.live {
			h.replayCompletionToClient(rootID, clientID, sessionKey)
			return
		}
	}
}

func (h *StreamHub) HasReplayClients(rootID, sessionKey string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, replayKey := range h.getReplayKeyListLocked(sessionKey, "") {
		replay := h.replayStates[replayKey]
		if replay != nil && replay.Status == ClientStreamStatusReplay {
			return true
		}
	}
	return false
}

func (h *StreamHub) waitForReplayClients(sessionKey string) {
	for h.HasReplayClients("", sessionKey) {
		time.Sleep(10 * time.Millisecond)
	}
}

func (h *StreamHub) ClearSessionPending(sessionKey string) {
	if blank(sessionKey) {
		return
	}
	h.waitForReplayClients(sessionKey)
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.pendingSessions[sessionKey]
	if state != nil && len(state.Queue) > 0 {
		state.Active = false
		state.User = nil
		state.ReplyingList = nil
		state.Summary = ""
		state.UpdatedAt = time.Now().UTC()
	} else {
		delete(h.pendingSessions, sessionKey)
	}
	h.clearReplayStatesForSessionLocked(sessionKey)
}
