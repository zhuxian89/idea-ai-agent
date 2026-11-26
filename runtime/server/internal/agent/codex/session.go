package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
	codextypes "github.com/fanwenlin/codex-go-sdk/types"
	"log"
	"mindfs/server/internal/agent/logs"
	types "mindfs/server/internal/agent/types"
	"strings"
	"sync"
	"time"
)

type OpenOptions struct {
	AgentName             string
	SessionKey            string
	Model                 string
	Mode                  string
	Effort                string
	FastService           string
	PlanMode              bool
	ReadOnly              bool
	Probe                 bool
	RootPath              string
	Command               string
	Args                  []string
	Env                   map[string]string
	DeveloperInstructions string
	ResumeSessionID       string
	ForkSessionID         string
	CodexUserOrdinal      *int
}

type Runtime struct {
	mu      sync.Mutex
	clients map[string]*codexsdk.Codex
}

func NewRuntime() *Runtime {
	return &Runtime{clients: make(map[string]*codexsdk.Codex)}
}

func (r *Runtime) OpenSession(_ context.Context, opts OpenOptions) (types.Session, error) {
	if opts.SessionKey == "" {
		return nil, errors.New("session key required")
	}
	client := r.getOrCreateClient(opts)
	var sess *session
	threadOptions := codexsdk.ThreadOptions{
		Model:                 strings.TrimSpace(opts.Model),
		ModelReasoningEffort:  codexsdk.ModelReasoningEffort(strings.TrimSpace(opts.Effort)),
		FastService:           strings.TrimSpace(opts.FastService),
		WorkingDirectory:      opts.RootPath,
		DeveloperInstructions: strings.TrimSpace(opts.DeveloperInstructions),
		ApprovalHandler: func(req codexsdk.ApprovalRequest) (codexsdk.ApprovalDecision, error) {
			if sess == nil {
				return codexsdk.ApprovalDecisionRejected, errors.New("codex session not initialized")
			}
			return sess.handleApprovalRequest(req)
		},
		ServerRequestHandler: func(req codexsdk.ServerRequest) (any, error) {
			if sess == nil {
				return nil, errors.New("codex session not initialized")
			}
			return sess.handleNativeRequest(req)
		},
		AskUserHandler: func(req codexsdk.AskUserRequest) (codexsdk.AskUserResponse, error) {
			if sess == nil {
				return codexsdk.AskUserResponse{}, errors.New("codex session not initialized")
			}
			return sess.handleAskUserRequest(req)
		},
	}
	if opts.PlanMode && !opts.ReadOnly {
		threadOptions.CollaborationMode = codexCollaborationMode(true)
	}
	if opts.ReadOnly {
		threadOptions.SandboxMode, threadOptions.ApprovalPolicy = "read-only", "never"
	} else if err := applyPermissionMode(&threadOptions, opts.Mode); err != nil {
		return nil, err
	}

	var thread *codexsdk.Thread
	if strings.TrimSpace(opts.ForkSessionID) != "" {
		threadID, err := forkCodexThread(context.Background(), client, threadOptions, strings.TrimSpace(opts.ForkSessionID), opts.CodexUserOrdinal)
		if err != nil {
			return nil, err
		}
		opts.ResumeSessionID = threadID
		thread = client.ResumeThread(threadID, threadOptions)
	} else if strings.TrimSpace(opts.ResumeSessionID) != "" {
		thread = client.ResumeThread(strings.TrimSpace(opts.ResumeSessionID), threadOptions)
	} else {
		thread = client.StartThread(threadOptions)
	}

	threadID := ""
	if strings.TrimSpace(opts.ResumeSessionID) != "" {
		threadID = strings.TrimSpace(opts.ResumeSessionID)
	} else if id := thread.ID(); id != nil && strings.TrimSpace(*id) != "" {
		threadID = strings.TrimSpace(*id)
	}
	sess = &session{
		client:        client,
		thread:        thread,
		threadOpts:    threadOptions,
		threadID:      threadID,
		sessionKey:    opts.SessionKey,
		planMode:      opts.PlanMode && !opts.ReadOnly,
		readOnly:      opts.ReadOnly,
		questionWaits: make(map[string]*types.PendingQuestion[map[string]string]),
		agentDebugLog: logs.NewAgentLogger(opts.RootPath, opts.SessionKey, opts.AgentName),
	}
	return sess, nil
}

func forkCodexThread(ctx context.Context, client *codexsdk.Codex, opts codexsdk.ThreadOptions, sourceThreadID string, userOrdinal *int) (string, error) {
	sourceThreadID = strings.TrimSpace(sourceThreadID)
	if sourceThreadID == "" {
		return "", errors.New("codex source thread id required")
	}

	thread, err := client.ForkThread(ctx, sourceThreadID, codexsdk.ThreadForkOptions{
		ThreadOptions:                opts,
		TruncateBeforeNthUserMessage: userOrdinal,
	})
	if err != nil {
		return "", err
	}
	var threadID string
	if thread != nil && thread.ID() != nil {
		threadID = strings.TrimSpace(*thread.ID())
	}
	if threadID == "" {
		return "", errors.New("codex thread/fork did not return thread id")
	}
	return threadID, nil
}

func codexCollaborationMode(enabled bool) *codexsdk.CollaborationMode {
	if enabled {
		return codexsdk.NewCollaborationMode(codexsdk.CollaborationModePlan)
	}
	return codexsdk.NewCollaborationMode(codexsdk.CollaborationModeDefault)
}

func (r *Runtime) CloseAll() {
	r.mu.Lock()
	clients := r.clients
	r.clients = make(map[string]*codexsdk.Codex)
	r.mu.Unlock()

	for _, client := range clients {
		if client != nil {
			_ = client.Close()
		}
	}
}

func (r *Runtime) Close(agentName string) error {
	r.mu.Lock()
	client, ok := r.clients[agentName]
	if ok {
		delete(r.clients, agentName)
	}
	r.mu.Unlock()

	if !ok || client == nil {
		return nil
	}
	return client.Close()
}

func (r *Runtime) AppServerUserAgent(agentName string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	client := r.clients[agentName]
	if client == nil {
		return "", false
	}
	return client.AppServerUserAgent()
}

func (r *Runtime) getOrCreateClient(opts OpenOptions) *codexsdk.Codex {
	r.mu.Lock()
	defer r.mu.Unlock()
	if client, ok := r.clients[opts.AgentName]; ok {
		return client
	}
	client := newClient(opts)
	r.clients[opts.AgentName] = client
	return client
}

func newClient(opts OpenOptions) *codexsdk.Codex {
	codexOptions := codexsdk.CodexOptions{
		Transport:             codexsdk.TransportAppServer,
		AppServerPathOverride: opts.Command,
		Env:                   opts.Env,
		Verbose:               true,
	}
	// MindFS already owns the idle-release policy. Codex's additional retention
	// period would keep unsubscribed threads loaded in this app-server process.
	codexOptions.AppServerArgs = append(append([]string{}, opts.Args...), "-c", "thread_unload_delay_secs=0")
	return codexsdk.NewCodex(codexOptions)
}

type session struct {
	client     *codexsdk.Codex
	thread     *codexsdk.Thread
	threadOpts codexsdk.ThreadOptions
	threadID   string
	sessionKey string
	planMode   bool
	readOnly   bool

	mu            sync.RWMutex
	onUpdate      func(types.Event)
	turn          types.TurnCanceler
	contextWindow types.ContextWindow
	planTextByID  map[string]string

	agentDebugLog *logs.AgentLogger

	questionMu         sync.Mutex
	questionWaits      map[string]*types.PendingQuestion[map[string]string]
	nativeInteractions map[string]*types.NativeInteraction
	questionItems      map[string][]codexsdk.AskUserQuestion
}

func (s *session) SendMessage(ctx context.Context, content string) error {
	if s == nil || s.thread == nil {
		return errors.New("codex session not initialized")
	}
	turnCtx, turnID := s.turn.Begin(ctx)
	defer s.turn.End(turnID)
	log.Printf("[agent/codex] input session=%s bytes=%d", s.sessionKey, len(content))
	streamed, err := s.thread.RunStreamed(content, codexsdk.TurnOptions{Context: turnCtx})
	if err != nil {
		log.Printf("[agent/codex] send.error session=%s err=%v", s.sessionKey, err)
		return err
	}

	if err := s.handleInteractiveStream(turnCtx, streamed); err != nil {
		return err
	}
	s.updateThreadIDFromThread()
	return nil
}

func (s *session) LoginChatGPTDeviceCode(ctx context.Context) error {
	if s == nil || s.client == nil {
		return errors.New("codex session not initialized")
	}
	turnCtx, turnID := s.turn.Begin(ctx)
	defer s.turn.End(turnID)
	events, err := s.client.LoginChatGPTDeviceCode(turnCtx)
	if err != nil {
		return err
	}
	for event := range events {
		notice := types.LoginNotice{
			Status:          strings.TrimSpace(event.Status),
			LoginID:         strings.TrimSpace(event.LoginID),
			VerificationURL: strings.TrimSpace(event.VerificationURL),
			UserCode:        strings.TrimSpace(event.UserCode),
			Error:           strings.TrimSpace(event.Error),
		}
		if event.AccountUpdated != nil {
			if event.AccountUpdated.AuthMode != nil {
				notice.AuthMode = strings.TrimSpace(*event.AccountUpdated.AuthMode)
			}
			if event.AccountUpdated.PlanType != nil {
				notice.PlanType = strings.TrimSpace(string(*event.AccountUpdated.PlanType))
			}
		}
		if notice.Status == "" {
			notice.Status = "running"
		}
		if notice.Status == "error" && notice.Error == "" {
			notice.Error = "login failed"
		}
		s.emit(types.Event{Type: types.EventTypeLogin, SessionID: s.SessionID(), Data: notice})
		if notice.Status == "error" {
			return errors.New(notice.Error)
		}
	}
	return nil
}

func (s *session) SubscribeThreadEvents(ctx context.Context) error {
	if s == nil || s.client == nil {
		return errors.New("codex session not initialized")
	}
	turnCtx, turnID := s.turn.Begin(ctx)
	defer s.turn.End(turnID)
	threadID := strings.TrimSpace(s.SessionID())
	if threadID == "" {
		s.updateThreadIDFromThread()
		threadID = strings.TrimSpace(s.SessionID())
	}
	if threadID == "" {
		return errors.New("codex thread id required")
	}
	streamed, err := s.client.SubscribeThreadEvents(turnCtx, threadID, s.threadOpts)
	if err != nil {
		return err
	}
	return s.handleInteractiveStream(turnCtx, streamed)
}

func (s *session) handleStreamedEvents(ctx context.Context, events <-chan codexsdk.ThreadEvent, questions *asyncQuestionPause) error {
	textByID := map[string]string{}
	for {
		var event codexsdk.ThreadEvent
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-questions.stopDeadline:
			s.turn.Cancel()
			return errors.New("timed out pausing Codex for user choice")
		case next, ok := <-events:
			if !ok {
				return nil
			}
			event = next
		}
		raw, _ := json.Marshal(event)
		switch e := event.(type) {
		case *codexsdk.ThreadStartedEvent:
			s.setThreadID(e.ThreadId)
		case *codexsdk.TurnStartedEvent:
			s.mu.Lock()
			s.contextWindow = types.ContextWindow{}
			s.mu.Unlock()
			continue
		case *codexsdk.ThreadGoalUpdatedEvent:
			s.setThreadID(e.ThreadID)
			continue
		case *codexsdk.ThreadGoalClearedEvent:
			s.setThreadID(e.ThreadID)
			continue
		case *codexsdk.TurnDiffUpdatedEvent:
			s.emit(types.Event{
				Type:      types.EventTypeTurnDiff,
				SessionID: s.SessionID(),
				Data: types.TurnDiffUpdate{
					TurnID: e.TurnId,
					Diff:   e.Diff,
				},
			})
			continue
		case *codexsdk.ItemStartedEvent:
			s.logRawToolItem(e.Item)
			if _, ok := e.Item.(*codexsdk.AgentMessageItem); ok {
				continue
			}
			if s.handleNonToolItem(e.Item, true) {
				continue
			}
			if toolCall, ok := mapLiveToolItem(e.Item, "started", ""); ok {
				s.emit(types.Event{Type: types.EventTypeToolCall, SessionID: s.SessionID(), Data: toolCall})
				continue
			}
			logUnhandledEvent(s.sessionKey, "item.started", raw)
		case *codexsdk.ItemUpdatedEvent:
			s.logRawToolItem(e.Item)
			if toolCall, ok := mapLiveToolItem(e.Item, "updated", ""); ok {
				s.emit(types.Event{Type: types.EventTypeToolUpdate, SessionID: s.SessionID(), Data: toolCall})
				continue
			}
			if s.handleNonToolItem(e.Item, false) {
				continue
			}
			msg, ok := e.Item.(*codexsdk.AgentMessageItem)
			if !ok {
				logUnhandledEvent(s.sessionKey, "item.updated", raw)
				continue
			}
			if len(questions.requests) > 0 || (msg.Delivery == "async" && len(msg.Questions) > 0) {
				continue
			}
			s.emitMessageDelta(msg, textByID)
		case *codexsdk.ItemCompletedEvent:
			if msg, ok := e.Item.(*codexsdk.AgentMessageItem); ok && msg.Delivery == "async" && len(msg.Questions) > 0 {
				if err := s.pauseForAsyncQuestion(ctx, e, msg, questions); err != nil {
					return err
				}
				continue
			}
			s.logRawToolItem(e.Item)
			if toolCall, ok := mapLiveToolItem(e.Item, "completed", e.TurnID); ok {
				s.emit(types.Event{Type: types.EventTypeToolUpdate, SessionID: s.SessionID(), Data: toolCall})
				continue
			}
			if s.handleNonToolItem(e.Item, false) {
				continue
			}
			msg, ok := e.Item.(*codexsdk.AgentMessageItem)
			if ok {
				if len(questions.requests) > 0 {
					continue
				}
				s.emitMessageDelta(msg, textByID)
				continue
			}
			if thought, ok := e.Item.(*codexsdk.ReasoningItem); ok {
				summary := strings.TrimSpace(strings.Join(thought.Summary, "\n"))
				if summary != "" {
					s.emit(types.Event{Type: types.EventTypeThoughtChunk, SessionID: s.SessionID(), Data: types.ThoughtChunk{Content: summary}})
				}
				continue
			}
			logUnhandledEvent(s.sessionKey, "item.completed", raw)
		case *codexsdk.TurnCompletedEvent:
			if len(questions.requests) > 0 {
				continue
			}
			s.updateThreadIDFromThread()
			log.Printf("[agent/codex] output.done session=%s", s.sessionKey)
			contextWindow, _ := s.ContextWindow(context.Background())
			s.emit(types.Event{
				Type:      types.EventTypeMessageDone,
				SessionID: s.SessionID(),
				Data:      types.MessageDone{ContextWindow: contextWindow},
			})
		case *codexsdk.TurnFailedEvent:
			log.Printf("[agent/codex] send.error session=%s err=%s", s.sessionKey, e.Error.Message)
			return errors.New("codex turn failed: " + e.Error.Message)
		case *codexsdk.ThreadErrorEvent:
			log.Printf("[agent/codex] send.error session=%s err=%s", s.sessionKey, e.Message)
			return errors.New("codex thread error: " + e.Message)
		case *codexsdk.RawEvent:
			if s.handleRawEvent(e) {
				continue
			}
			logUnhandledEvent(s.sessionKey, "raw_event", raw)
		default:
			logUnhandledEvent(s.sessionKey, "event", raw)
		}
	}
}

func (s *session) handleNonToolItem(item codexsdk.ThreadItem, started bool) bool {
	switch v := item.(type) {
	case *codexsdk.ReasoningItem:
		if started {
			return true
		}
		summary := strings.TrimSpace(strings.Join(v.Summary, "\n"))
		if summary != "" {
			s.emit(types.Event{Type: types.EventTypeThoughtChunk, SessionID: s.SessionID(), Data: types.ThoughtChunk{ID: v.ID, Content: summary}})
		}
		return true
	case *codexsdk.TodoListItem:
		items := make([]types.TodoItem, 0, len(v.Items))
		for _, item := range v.Items {
			content := strings.TrimSpace(item.Text)
			if content == "" {
				continue
			}
			status := "pending"
			if item.Completed {
				status = "completed"
			}
			items = append(items, types.TodoItem{Content: content, Status: status})
		}
		s.emit(types.Event{Type: types.EventTypeTodoUpdate, SessionID: s.SessionID(), Data: types.TodoUpdate{Items: items}})
		return true
	case *codexsdk.CompactedItem:
		status := "complete"
		if started {
			status = "running"
		}
		s.emit(types.Event{Type: types.EventTypeCompact, SessionID: s.SessionID(), Data: types.CompactNotice{ID: v.ID, Status: status, Summary: v.Summary}})
		return true
	case *codextypes.UnknownItem:
		switch v.GetType() {
		case "plan":
			plan, ok := parseUnknownPlan(v.Raw)
			if ok {
				s.emit(types.Event{Type: types.EventTypePlanUpdate, SessionID: s.SessionID(), Data: plan})
			}
			return true
		case "contextCompaction":
			compact := parseUnknownContextCompaction(v.Raw)
			s.emit(types.Event{Type: types.EventTypeCompact, SessionID: s.SessionID(), Data: compact})
			return true
		}
		return false
	default:
		switch item.GetType() {
		case "plan":
			return true
		case "contextCompaction":
			s.emit(types.Event{Type: types.EventTypeCompact, SessionID: s.SessionID(), Data: types.CompactNotice{Status: "complete"}})
			return true
		}
		return false
	}
}

func parseUnknownPlan(raw json.RawMessage) (types.PlanUpdate, bool) {
	var payload struct {
		ID   string `json:"id"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return types.PlanUpdate{}, false
	}
	content := strings.TrimSpace(payload.Text)
	if content == "" {
		return types.PlanUpdate{}, false
	}
	return types.PlanUpdate{ID: payload.ID, Content: content}, true
}

func parseUnknownContextCompaction(raw json.RawMessage) types.CompactNotice {
	var payload struct {
		ID      string `json:"id"`
		Summary string `json:"summary"`
	}
	_ = json.Unmarshal(raw, &payload)
	return types.CompactNotice{ID: payload.ID, Status: "complete", Summary: payload.Summary}
}

func (s *session) AnswerQuestion(ctx context.Context, answer types.AskUserAnswer) error {
	callID := strings.TrimSpace(answer.ToolUseID)
	if callID == "" {
		return errors.New("toolUseId required")
	}
	if len(answer.Answers) == 0 {
		return errors.New("answers required")
	}

	answers := make(map[string]string, len(answer.Answers))
	for key, value := range answer.Answers {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key != "" && value != "" {
			answers[key] = value
		}
	}
	if len(answers) == 0 {
		return errors.New("answers required")
	}

	s.questionMu.Lock()
	defer s.questionMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	waiter, ok := s.questionWaits[callID]
	if !ok {
		return errors.New("question is not pending: " + callID)
	}
	if questions := s.questionItems[callID]; len(questions) > 0 {
		if len(codexAskUserResponse(questions, answers).Answers) != len(questions) {
			return errors.New("all questions require an explicit answer")
		}
	}
	if native := s.nativeInteractions[callID]; native != nil {
		if err := native.Validate(answers); err != nil {
			return err
		}
	}
	if err := waiter.Answer(ctx, answers); err != nil {
		return err
	}
	delete(s.questionWaits, callID)
	return nil
}

func (s *session) emit(event types.Event) {
	s.mu.RLock()
	handler := s.onUpdate
	s.mu.RUnlock()
	if handler == nil {
		return
	}
	handler(event)
}

func (s *session) OnUpdate(onUpdate func(types.Event)) {
	s.mu.Lock()
	s.onUpdate = onUpdate
	s.mu.Unlock()
}

func (s *session) CancelCurrentTurn() error {
	s.cancelPendingQuestions(errors.New("turn canceled"))
	s.turn.Cancel()
	return nil
}

func (s *session) SessionID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.threadID
}

func (s *session) ContextWindow(_ context.Context) (types.ContextWindow, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.contextWindow, nil
}

func (s *session) Close() error {
	if s == nil || s.thread == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return s.closeThread(ctx)
}

func (s *session) closeThread(ctx context.Context) error {
	response, err := s.thread.Unsubscribe(ctx)
	if err != nil {
		return err
	}
	switch response.Status {
	case codextypes.ThreadUnsubscribeStatusNotLoaded:
		return nil
	case codextypes.ThreadUnsubscribeStatusUnsubscribed, codextypes.ThreadUnsubscribeStatusNotSubscribed:
	default:
		return fmt.Errorf("codex thread/unsubscribe returned unknown status %q", response.Status)
	}
	id := s.thread.ID()
	if id == nil || strings.TrimSpace(*id) == "" {
		return errors.New("codex thread id required to confirm unload")
	}
	// Unsubscribe acknowledges removal of the subscription, not completion of
	// shutdown. Loaded-list only drops the thread after shutdown has finished.
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		loaded, err := codexThreadLoaded(ctx, s.client, *id)
		if err != nil {
			return fmt.Errorf("confirm codex thread %s unloaded: %w", *id, err)
		}
		if !loaded {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for codex thread %s to unload: %w", *id, ctx.Err())
		case <-ticker.C:
		}
	}
}

func codexThreadLoaded(ctx context.Context, client *codexsdk.Codex, threadID string) (bool, error) {
	params := map[string]any{}
	for {
		var response struct {
			Data       *[]string `json:"data"`
			NextCursor *string   `json:"nextCursor"`
		}
		if err := client.AppServerRPCTyped(ctx, "thread/loaded/list", params, &response); err != nil {
			return false, err
		}
		if response.Data == nil {
			return false, errors.New("codex thread/loaded/list returned no data")
		}
		for _, id := range *response.Data {
			if id == threadID {
				return true, nil
			}
		}
		if response.NextCursor == nil || *response.NextCursor == "" {
			return false, nil
		}
		params["cursor"] = *response.NextCursor
	}
}

func (s *session) updateThreadIDFromThread() {
	if s == nil || s.thread == nil {
		return
	}
	id := s.thread.ID()
	if id == nil {
		return
	}
	s.setThreadID(*id)
}

func (s *session) setThreadID(id string) {
	if strings.TrimSpace(id) == "" {
		return
	}
	s.mu.Lock()
	s.threadID = id
	s.mu.Unlock()
}
