package usecase

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/session"
	"mindfs/server/internal/turndiff"
)

type StreamTextFilter interface {
	Push(chunk string) string
	Flush() string
}

type StreamCompletionSuffixer interface {
	CompletionSuffix() string
}

type StreamToolActivityObserver interface {
	MarkToolActivity()
}

type SendMessageInput struct {
	RootID                 string
	RuntimeRootPath        string
	Key                    string
	Agent                  string
	Model                  string
	Mode                   string
	Effort                 string
	FastService            string
	PlanMode               *bool
	ReadOnly               bool
	ReturnErrorOnCancel    bool
	StreamFilter           StreamTextFilter
	Shell                  string
	TerminalCols           int
	Content                string
	UserTimestamp          time.Time
	ClientCtx              ClientContext
	OnStart                func(MessageStart)
	OnUpdate               func(agenttypes.Event)
	OnSubSessionCreated    func(*session.Session)
	OnSubSessionUpdate     func(sessionKey string, update agenttypes.Event)
	OnAgentDefaultsChanged func(agentName string)
}

type MessageStart struct {
	Model           string
	Mode            string
	Effort          string
	FastService     string
	BaseExchangeSeq int
}

type RunTransientSlashCommandInput struct {
	RootID      string
	Key         string
	Agent       string
	Model       string
	Mode        string
	Effort      string
	FastService string
	Command     string
	OnUpdate    func(agenttypes.Event)
}

type codexDeviceCodeLoginSession interface {
	LoginChatGPTDeviceCode(context.Context) error
}

type AnswerQuestionInput struct {
	RootID     string
	SessionKey string
	Agent      string
	ToolUseID  string
	Answers    map[string]string
}

type CancelSessionTurnInput struct {
	RootID string
	Key    string
}

const (
	switchContextTailLines   = 20
	sessionNameTimeout       = 30 * time.Second
	sessionNameMinMessageLen = 12
	sessionRecoveryAttempts  = 3
	sessionRecoveryDelay     = 30 * time.Second
)

type SuggestSessionNameInput struct {
	RootID       string
	SessionKey   string
	Agent        string
	Model        string
	FirstMessage string
}

var (
	sessionSendLocksMu sync.Mutex
	sessionSendLocks   = make(map[string]*sync.Mutex)
	activeTurnsMu      sync.Mutex
	activeTurns        = make(map[string]*activeTurnState)
)

type activeTurnState struct {
	cancel  context.CancelFunc
	session agenttypes.Session
}

func getSessionSendLock(sessionKey string) *sync.Mutex {
	sessionSendLocksMu.Lock()
	defer sessionSendLocksMu.Unlock()
	lock := sessionSendLocks[sessionKey]
	if lock == nil {
		lock = &sync.Mutex{}
		sessionSendLocks[sessionKey] = lock
	}
	return lock
}

func activeTurnKey(rootID, sessionKey string) string {
	return rootID + "::" + sessionKey
}

func registerActiveTurn(rootID, sessionKey string, cancel context.CancelFunc) {
	if strings.TrimSpace(rootID) == "" || strings.TrimSpace(sessionKey) == "" || cancel == nil {
		return
	}
	activeTurnsMu.Lock()
	activeTurns[activeTurnKey(rootID, sessionKey)] = &activeTurnState{cancel: cancel}
	activeTurnsMu.Unlock()
}

func setActiveTurnSession(rootID, sessionKey string, sess agenttypes.Session) {
	if strings.TrimSpace(rootID) == "" || strings.TrimSpace(sessionKey) == "" || sess == nil {
		return
	}
	activeTurnsMu.Lock()
	state := activeTurns[activeTurnKey(rootID, sessionKey)]
	if state != nil {
		state.session = sess
	}
	activeTurnsMu.Unlock()
}

func unregisterActiveTurn(rootID, sessionKey string) {
	if strings.TrimSpace(rootID) == "" || strings.TrimSpace(sessionKey) == "" {
		return
	}
	activeTurnsMu.Lock()
	delete(activeTurns, activeTurnKey(rootID, sessionKey))
	activeTurnsMu.Unlock()
}

func getActiveTurn(rootID, sessionKey string) *activeTurnState {
	activeTurnsMu.Lock()
	defer activeTurnsMu.Unlock()
	return activeTurns[activeTurnKey(rootID, sessionKey)]
}

func agentPoolSessionKey(sessionKey, agentName string) string {
	trimmedSessionKey := strings.TrimSpace(sessionKey)
	if trimmedSessionKey == "" {
		return ""
	}
	trimmedAgent := strings.TrimSpace(agentName)
	if trimmedAgent == "" {
		return trimmedSessionKey
	}
	return strings.ToLower(trimmedAgent) + "-" + trimmedSessionKey
}

func isCanceledTurnError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return true
	}
	value := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(value, "context canceled") ||
		strings.Contains(value, "context cancelled") ||
		strings.Contains(value, "turn canceled") ||
		strings.Contains(value, "turn cancelled") ||
		strings.Contains(value, "cancelled")
}

func isNonRecoverableAgentError(err error) bool {
	if err == nil {
		return false
	}
	value := strings.ToLower(strings.TrimSpace(err.Error()))
	if value == "" {
		return false
	}
	needles := []string{
		"429",
		"too many requests",
		"exceeded retry limit",
		"rate limit",
		"ratelimit",
		"usage limit",
		"usagelimitexceeded",
		"remote compaction failed",
		"compact_remote",
		"responsetoomanyfailedattempts",
	}
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func cancelRuntimeAfterNonRecoverableError(sess agenttypes.Session, pool *agent.Pool, agentName string, cause error) {
	agentName = strings.TrimSpace(agentName)
	if sess != nil {
		if err := sess.CancelCurrentTurn(); err != nil {
			log.Printf("[session] turn.cancel_after_non_recoverable.error agent=%s cause=%v err=%v", agentName, cause, err)
		}
	}
	if pool != nil && agentName != "" {
		if _, ok := pool.KillAgentProcess(agentName, 0); ok {
			log.Printf("[session] runtime.kill_after_non_recoverable.done agent=%s cause=%v", agentName, cause)
			return
		}
	}
	if sess != nil {
		if err := sess.Close(); err != nil {
			log.Printf("[session] runtime.close_after_non_recoverable.error agent=%s cause=%v err=%v", agentName, cause, err)
		}
	}
}

func (s *Service) SendMessage(ctx context.Context, in SendMessageInput) error {
	if err := s.ensureRegistry(); err != nil {
		return err
	}
	userTimestamp := sendMessageUserTimestamp(in, time.Now().UTC())
	sendLock := getSessionSendLock(in.Key)
	sendLock.Lock()
	defer sendLock.Unlock()
	turnCtx, turnCancel := context.WithCancel(ctx)
	registerActiveTurn(in.RootID, in.Key, turnCancel)
	defer unregisterActiveTurn(in.RootID, in.Key)
	s.applyMessageRuntimeDefaults(&in)
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return err
	}
	current, err := manager.Get(ctx, in.Key, 0)
	if err != nil {
		return err
	}
	readOnly := in.ReadOnly || session.IsReadOnlySession(current)
	if !readOnly && in.PlanMode != nil && current.PlanMode != *in.PlanMode {
		if err := manager.UpdatePlanMode(ctx, current, *in.PlanMode); err != nil {
			return err
		}
	}
	resolvedMode := resolveRuntimeMode(current, in.Mode)
	if readOnly {
		resolvedMode = ""
	}
	resolvedFastService := resolveRuntimeFastService(in.Agent, current, in.FastService)
	if in.OnStart != nil {
		in.OnStart(MessageStart{
			Model:           in.Model,
			Mode:            resolvedMode,
			Effort:          in.Effort,
			FastService:     resolvedFastService,
			BaseExchangeSeq: len(current.Exchanges),
		})
	}
	if current.Type == session.TypeCommand {
		return s.sendCommandMessage(turnCtx, in, manager, current)
	}
	if err := s.validateAgentModel(in.Agent, in.Model); err != nil {
		log.Printf("[session/model] validate.error root=%s session=%s agent=%s model=%q err=%v", in.RootID, in.Key, strings.TrimSpace(in.Agent), strings.TrimSpace(in.Model), err)
		return err
	}
	isInitial := len(current.Exchanges) == 0
	agentPool := s.Registry.GetAgentPool()
	if agentPool == nil {
		return nil
	}
	watcher, _ := s.Registry.GetFileWatcher(in.RootID, manager)
	if watcher != nil {
		watcher.RegisterSession(current.Key)
		watcher.MarkSessionActive(current.Key)
	}
	root := manager.Root()
	managedRootAbs, _ := root.RootDir()
	rootAbs := managedRootAbs
	if runtimeRootPath := strings.TrimSpace(in.RuntimeRootPath); runtimeRootPath != "" {
		rootAbs = filepath.Clean(runtimeRootPath)
	}
	planMode := current != nil && current.PlanMode && !readOnly

	developerInstructions := ""
	includeReplyTipsInUserMessage := isInitial && !session.IsCollabSource(current.Source)
	if isInitial && agentPool.SupportsDeveloperInstructions(in.Agent) {
		// Native configuration owns the developer/system prompt. Rendering hints
		// must not replace the user's configured developer instructions.
		includeReplyTipsInUserMessage = false
	}
	sess, agentCtxSeq, err := s.ensureAgentSession(turnCtx, agentPool, manager, current, in.Agent, in.Model, resolvedMode, in.Effort, in.FastService, readOnly, rootAbs, developerInstructions, func() {
		if in.OnUpdate != nil {
			in.OnUpdate(agenttypes.Event{
				Type: agenttypes.EventTypeRecovery,
				Data: agenttypes.RecoveryStatus{Message: resumeFallbackNotice(len(current.Exchanges))},
			})
		}
	})
	if err != nil {
		return err
	}
	setActiveTurnSession(in.RootID, current.Key, sess)

	prompt := s.BuildPrompt(BuildPromptInput{
		Session:                       current,
		Manager:                       manager,
		Agent:                         in.Agent,
		Message:                       in.Content,
		ClientContext:                 in.ClientCtx,
		AgentCtxSeq:                   agentCtxSeq,
		RuntimeRootAbs:                rootAbs,
		IsInitial:                     isInitial,
		IncludeReplyTipsInUserMessage: includeReplyTipsInUserMessage,
	})
	var responseText string
	sawAssistantChunk := false
	var lastContextWindow agenttypes.ContextWindow
	plannedAssistantSeq := len(current.Exchanges) + 2
	auxBuffer := make([]session.ExchangeAux, 0, 8)
	var latestTurnDiff *agenttypes.TurnDiffUpdate
	defer manager.ClearPendingExchangeAux(context.Background(), current.Key)
	var thoughtBuffer strings.Builder
	currentThoughtID := ""
	flushThought := func() {
		thought := thoughtBuffer.String()
		if strings.TrimSpace(thought) == "" {
			thoughtBuffer.Reset()
			currentThoughtID = ""
			return
		}
		thoughtID := currentThoughtID
		thoughtBuffer.Reset()
		currentThoughtID = ""
		auxBuffer = append(auxBuffer, session.ExchangeAux{
			Seq:       plannedAssistantSeq,
			Line:      currentAssistantLine(responseText),
			Thought:   thought,
			ThoughtID: thoughtID,
		})
	}
	lastResponseUpdateType := ""
	claudeSubagents := newClaudeSubagentRouter(subagentSessionInput{
		RootID:      in.RootID,
		Parent:      current,
		Agent:       in.Agent,
		Model:       in.Model,
		Mode:        in.Mode,
		Effort:      in.Effort,
		FastService: in.FastService,
		RootAbs:     rootAbs,
		Manager:     manager,
		OnCreated:   in.OnSubSessionCreated,
		OnUpdate:    in.OnSubSessionUpdate,
	})
	attachSessionUpdates := func(runtime agenttypes.Session) func() {
		return agenttypes.SubscribeTurnUpdates(runtime, func(update agenttypes.Event) {
			update = normalizeAgentUpdatePaths(root, update)
			if claudeSubagents.Handle(context.Background(), update) {
				return
			}
			switch update.Type {
			case agenttypes.EventTypeThoughtChunk:
				if chunk, ok := update.Data.(agenttypes.ThoughtChunk); ok && chunk.Content != "" {
					if currentThoughtID == "" {
						currentThoughtID = "thought-" + randomHex(8)
					}
					chunk.ID = currentThoughtID
					update.Data = chunk
					thoughtBuffer.WriteString(chunk.Content)
				}
			case agenttypes.EventTypeToolCall, agenttypes.EventTypeToolUpdate, agenttypes.EventTypeTodoUpdate, agenttypes.EventTypePlanUpdate, agenttypes.EventTypeCompact, agenttypes.EventTypeTurnDiff, agenttypes.EventTypeMessageChunk, agenttypes.EventTypeMessageDone:
				flushThought()
			}
			clientUpdate := compactAgentUpdate(update)
			if update.Type == agenttypes.EventTypeToolCall || update.Type == agenttypes.EventTypeToolUpdate {
				if toolCall, ok := update.Data.(agenttypes.ToolCall); ok && toolCall.IsWriteOperation() {
					for _, path := range toolCall.GetAffectedPaths() {
						if watcher == nil {
							continue
						}
						recordPath := relatedFileRecordPath(managedRootAbs, rootAbs, path)
						if update.Type == agenttypes.EventTypeToolCall && toolCall.Status == "running" {
							watcher.RecordPendingWrite(current.Key, recordPath)
						}
						if update.Type == agenttypes.EventTypeToolUpdate || toolCall.Status == "complete" {
							watcher.RecordSessionFile(current.Key, recordPath)
						}
					}
				}
				if toolCall, ok := update.Data.(agenttypes.ToolCall); ok {
					s.ensureSubagentSessions(context.Background(), subagentSessionInput{
						RootID:      in.RootID,
						Parent:      current,
						Agent:       in.Agent,
						Model:       in.Model,
						Mode:        in.Mode,
						Effort:      in.Effort,
						FastService: in.FastService,
						RootAbs:     rootAbs,
						Pool:        agentPool,
						Manager:     manager,
						ToolCall:    toolCall,
						OnCreated:   in.OnSubSessionCreated,
						OnUpdate:    in.OnSubSessionUpdate,
					})
					if shouldPersistToolCallAux(toolCall) {
						toolCallCopy := toolCall
						auxBuffer = append(auxBuffer, session.ExchangeAux{
							Seq:      plannedAssistantSeq,
							Line:     currentAssistantLine(responseText),
							ToolCall: &toolCallCopy,
						})
						_ = manager.UpsertPendingExchangeAux(context.Background(), current.Key, session.ExchangeAux{ToolCall: &toolCallCopy})
					}
				}
			}
			if update.Type == agenttypes.EventTypePlanUpdate {
				if plan, ok := update.Data.(agenttypes.PlanUpdate); ok && strings.TrimSpace(plan.Content) != "" {
					planCopy := plan
					auxBuffer = append(auxBuffer, session.ExchangeAux{
						Seq:  plannedAssistantSeq,
						Line: currentAssistantLine(responseText),
						Plan: &planCopy,
					})
				}
			}
			if update.Type == agenttypes.EventTypeTodoUpdate {
				if todo, ok := update.Data.(agenttypes.TodoUpdate); ok && len(todo.Items) > 0 {
					todoCopy := todo
					auxBuffer = append(auxBuffer, session.ExchangeAux{
						Seq:  plannedAssistantSeq,
						Line: currentAssistantLine(responseText),
						Todo: &todoCopy,
					})
				}
			}
			if update.Type == agenttypes.EventTypeCompact {
				if compact, ok := update.Data.(agenttypes.CompactNotice); ok {
					compactCopy := compact
					auxBuffer = append(auxBuffer, session.ExchangeAux{
						Seq:     plannedAssistantSeq,
						Line:    currentAssistantLine(responseText),
						Compact: &compactCopy,
					})
				}
			}
			if update.Type == agenttypes.EventTypeTurnDiff {
				if turnDiff, ok := update.Data.(agenttypes.TurnDiffUpdate); ok {
					turnDiffCopy := turnDiff
					latestTurnDiff = &turnDiffCopy
				}
			}
			if update.Type == agenttypes.EventTypeMessageChunk {
				if chunk, ok := update.Data.(agenttypes.MessageChunk); ok {
					sawAssistantChunk = true
					textDelta := chunk.Content
					if in.StreamFilter != nil && chunk.ParentToolUseID == "" && chunk.TaskID == "" {
						textDelta = in.StreamFilter.Push(chunk.Content)
						if textDelta == "" {
							if watcher != nil {
								watcher.MarkSessionActive(current.Key)
							}
							return
						}
						chunk.Content = textDelta
						update.Data = chunk
						clientUpdate = compactAgentUpdate(update)
					}
					responseText = appendResponseChunk(responseText, lastResponseUpdateType, textDelta)
					lastResponseUpdateType = string(update.Type)
				}
			} else if update.Type == agenttypes.EventTypeMessageDone {
				if done, ok := update.Data.(agenttypes.MessageDone); ok {
					lastContextWindow = done.ContextWindow
				}
			} else if update.Type == agenttypes.EventTypeThoughtChunk ||
				update.Type == agenttypes.EventTypeToolCall ||
				update.Type == agenttypes.EventTypeToolUpdate ||
				update.Type == agenttypes.EventTypeTodoUpdate ||
				update.Type == agenttypes.EventTypePlanUpdate ||
				update.Type == agenttypes.EventTypeCompact {
				if update.Type == agenttypes.EventTypeToolCall || update.Type == agenttypes.EventTypeToolUpdate {
					if obs, ok := in.StreamFilter.(StreamToolActivityObserver); ok {
						obs.MarkToolActivity()
					}
				}
				lastResponseUpdateType = string(update.Type)
			}
			if watcher != nil {
				watcher.MarkSessionActive(current.Key)
			}
			if in.OnUpdate != nil {
				in.OnUpdate(clientUpdate)
			}
		})
	}
	sendWithAttachedUpdates := func(runtime agenttypes.Session, content string) error {
		unsubscribe := attachSessionUpdates(runtime)
		defer unsubscribe()
		finishUse := agentPool.BeginSessionUse(agentPoolSessionKey(current.Key, in.Agent))
		defer finishUse()
		return runtime.SendMessage(turnCtx, content)
	}
	// Observe every agent in the shared turn flow, outside its native runtime.
	// A failed snapshot must never prevent the agent from running or change
	// its prompt, permissions or event stream.
	workspaceBefore, err := turndiff.Capture(turnCtx, rootAbs)
	if err != nil {
		log.Printf("[session/diff] capture.unavailable session=%s err=%v", current.Key, err)
	}
	sendErr := sendWithAttachedUpdates(sess, prompt)
	if sendErr != nil && !isCanceledTurnError(sendErr) {
		if isNonRecoverableAgentError(sendErr) {
			log.Printf("[session] turn.send.non_recoverable root=%s session=%s agent=%s action=fail_without_recovery err=%v", in.RootID, current.Key, in.Agent, sendErr)
			cancelRuntimeAfterNonRecoverableError(sess, agentPool, in.Agent, sendErr)
		} else if !sawAssistantChunk {
			log.Printf("[session] turn.send.no_response root=%s session=%s agent=%s action=fail_without_recovery", in.RootID, current.Key, in.Agent)
		} else {
			if in.OnUpdate != nil {
				in.OnUpdate(agenttypes.Event{
					Type: agenttypes.EventTypeRecovery,
					Data: agenttypes.RecoveryStatus{Message: "遇到错误，重试中..."},
				})
			}
			recoveredSess, recoveredErr := s.recoverAgentTurn(turnCtx, SendRecoveryInput{
				RootID:             in.RootID,
				SessionKey:         current.Key,
				Manager:            manager,
				Current:            current,
				AgentName:          in.Agent,
				Model:              in.Model,
				Mode:               in.Mode,
				Effort:             in.Effort,
				FastService:        in.FastService,
				PlanMode:           planMode,
				RootAbs:            rootAbs,
				CurrentSession:     sess,
				Prompt:             prompt,
				SawAssistantChunk:  sawAssistantChunk,
				SendWithAttachment: sendWithAttachedUpdates,
			})
			if recoveredErr != nil {
				sendErr = recoveredErr
			} else {
				sess = recoveredSess
				sendErr = nil
			}
		}
	}
	flushThought()
	if in.StreamFilter != nil {
		if tail := in.StreamFilter.Flush(); tail != "" {
			responseText = appendResponseChunk(responseText, lastResponseUpdateType, tail)
			lastResponseUpdateType = string(agenttypes.EventTypeMessageChunk)
			if in.OnUpdate != nil {
				in.OnUpdate(agenttypes.Event{
					Type:      agenttypes.EventTypeMessageChunk,
					SessionID: sess.SessionID(),
					Data:      agenttypes.MessageChunk{Content: tail},
				})
			}
		}
		if sendErr == nil && ctx.Err() == nil && turnCtx.Err() == nil {
			if suffixer, ok := in.StreamFilter.(StreamCompletionSuffixer); ok {
				if suffix := suffixer.CompletionSuffix(); suffix != "" {
					responseText = appendResponseChunk(responseText, lastResponseUpdateType, suffix)
					lastResponseUpdateType = string(agenttypes.EventTypeMessageChunk)
					if in.OnUpdate != nil {
						in.OnUpdate(agenttypes.Event{
							Type:      agenttypes.EventTypeMessageChunk,
							SessionID: sess.SessionID(),
							Data:      agenttypes.MessageChunk{Content: suffix},
						})
					}
				}
			}
		}
	}
	latestTurnDiff = finishWorkspaceTurnDiff(workspaceBefore, latestTurnDiff, root, current.Key, func(path string) string {
		return normalizeToolPath(root, filepath.Join(rootAbs, filepath.FromSlash(path)))
	})
	if session.IsCollabSource(current.Source) && latestTurnDiff == nil {
		latestTurnDiff = &agenttypes.TurnDiffUpdate{Partial: true}
	}
	if latestTurnDiff != nil && (strings.TrimSpace(latestTurnDiff.Diff) != "" || (session.IsCollabSource(current.Source) && latestTurnDiff.Partial)) {
		turnDiffCopy := *latestTurnDiff
		auxBuffer = append(auxBuffer, session.ExchangeAux{
			Seq:      plannedAssistantSeq,
			Line:     currentAssistantLine(responseText),
			TurnDiff: &turnDiffCopy,
		})
	}
	claudeSubagents.FinishAll()
	if sendErr != nil && !isCanceledTurnError(sendErr) {
		log.Printf("[session] turn.send.error root=%s session=%s agent=%s err=%v", in.RootID, current.Key, in.Agent, sendErr)
	}
	resolvedModel := resolveRuntimeModel(current, sess, in.Model)
	resolvedEffort := resolveRuntimeEffort(in.Agent, current, in.Effort)
	resolvedFastService = resolveRuntimeFastService(in.Agent, current, in.FastService)
	if prefs := s.Registry.GetPreferences(); prefs != nil && !session.IsCollabSource(current.Source) {
		if changed, err := prefs.UpdateAgentDefaultsIfChanged(in.Agent, resolvedModel, resolvedEffort, resolvedFastService); err != nil {
			log.Printf("[preferences] agent_defaults.update.error agent=%s err=%v", strings.TrimSpace(in.Agent), err)
		} else if changed {
			log.Printf("[preferences] agent_defaults.update.done agent=%s model=%q effort=%q fast_service=%q", strings.TrimSpace(in.Agent), resolvedModel, resolvedEffort, resolvedFastService)
			if in.OnAgentDefaultsChanged != nil {
				in.OnAgentDefaultsChanged(strings.TrimSpace(in.Agent))
			}
		}
	}
	modelDisplayName := s.resolveExchangeModelDisplayName(in.Agent, resolvedModel)
	exchangeCtx := session.WithExchangeModelDisplayName(ctx, modelDisplayName)
	if err := manager.UpdateModel(ctx, current, resolvedModel); err != nil {
		return err
	}
	if err := manager.AddExchangeForAgentAt(exchangeCtx, current, "user", in.Content, in.Agent, resolvedMode, resolvedEffort, resolvedFastService, userTimestamp); err != nil {
		log.Printf("[session] persist.user.error root=%s session=%s agent=%s err=%v", in.RootID, current.Key, in.Agent, err)
		return err
	}
	if err := manager.AddExchangeForAgent(session.WithExchangeContextWindow(exchangeCtx, &lastContextWindow), current, "agent", responseText, in.Agent, resolvedMode, resolvedEffort, resolvedFastService); err != nil {
		log.Printf("[session] persist.agent.error root=%s session=%s agent=%s err=%v", in.RootID, current.Key, in.Agent, err)
		return err
	}
	if err := manager.UpdateLastContextWindow(ctx, current, lastContextWindow); err != nil {
		return err
	}
	for _, aux := range dedupeExchangeAuxBuffer(auxBuffer) {
		aux = hydratePendingToolCallAux(ctx, manager, current.Key, aux)
		if err := manager.AddExchangeAux(ctx, current.Key, aux); err != nil {
			return err
		}
	}
	if err := manager.UpdateAgentState(ctx, current, in.Agent, contextLineCount(current.Exchanges), sess.SessionID()); err != nil {
		return err
	}

	prober := s.Registry.GetProber()
	if sendErr != nil && !isCanceledTurnError(sendErr) {
		if prober != nil {
			prober.ReportRuntimeFailure(in.Agent, sendErr)
		}
		return sendErr
	}
	if in.ReturnErrorOnCancel && (isCanceledTurnError(sendErr) || ctx.Err() != nil || turnCtx.Err() != nil) {
		return context.Canceled
	}
	if prober != nil {
		prober.ReportSuccess(in.Agent)
	}
	return nil
}

func (s *Service) RunTransientSlashCommand(ctx context.Context, in RunTransientSlashCommandInput) error {
	if err := s.ensureRegistry(); err != nil {
		return err
	}
	command := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(in.Command)), "/")
	agentName := strings.TrimSpace(in.Agent)
	if agentName != "codex" || (command != "status" && command != "login") {
		return errors.New("unsupported transient slash command")
	}
	key := strings.TrimSpace(in.Key)
	if key == "" {
		key = fmt.Sprintf("transient-%s-%d", command, time.Now().UnixNano())
	}
	sendLock := getSessionSendLock(key)
	sendLock.Lock()
	defer sendLock.Unlock()

	turnCtx, turnCancel := context.WithCancel(ctx)
	registerActiveTurn(in.RootID, key, turnCancel)
	defer unregisterActiveTurn(in.RootID, key)

	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return err
	}
	current, err := manager.Get(ctx, key, 0)
	if err != nil {
		if !errors.Is(err, session.ErrSessionNotFound) {
			return err
		}
		current = &session.Session{
			Key:         key,
			Type:        session.TypeChat,
			Model:       strings.TrimSpace(in.Model),
			AgentCtxSeq: map[string]int{},
			Name:        "Transient slash command",
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
	} else {
		if current.Type == session.TypeCommand {
			return errors.New("slash commands are not supported for command sessions")
		}
		if currentAgent := strings.TrimSpace(session.InferAgentFromSession(current)); currentAgent != "" && currentAgent != agentName {
			return errors.New("slash command agent does not match session agent")
		}
	}
	if err := s.validateAgentModel(agentName, in.Model); err != nil {
		return err
	}
	agentPool := s.Registry.GetAgentPool()
	if agentPool == nil {
		return errors.New("agent pool not configured")
	}
	root := manager.Root()
	rootAbs, _ := root.RootDir()
	readOnly := session.IsReadOnlySession(current)
	sess, _, err := s.ensureAgentSession(turnCtx, agentPool, manager, current, agentName, in.Model, in.Mode, in.Effort, in.FastService, readOnly, rootAbs, "", nil)
	if err != nil {
		return err
	}
	setActiveTurnSession(in.RootID, current.Key, sess)

	sess.OnUpdate(func(update agenttypes.Event) {
		update = normalizeAgentUpdatePaths(root, update)
		clientUpdate := compactAgentUpdate(update)
		if in.OnUpdate != nil {
			in.OnUpdate(clientUpdate)
		}
	})

	if command == "login" {
		loginSess, ok := sess.(codexDeviceCodeLoginSession)
		if !ok {
			return errors.New("codex login is not supported by this runtime")
		}
		err = loginSess.LoginChatGPTDeviceCode(turnCtx)
	} else {
		finishUse := agentPool.BeginSessionUse(agentPoolSessionKey(current.Key, agentName))
		defer finishUse()
		err = sess.SendMessage(turnCtx, "/"+command)
	}
	if err != nil && !isCanceledTurnError(err) {
		if prober := s.Registry.GetProber(); prober != nil {
			prober.ReportRuntimeFailure(agentName, err)
		}
		return err
	}
	return err
}

type SendRecoveryInput struct {
	RootID             string
	SessionKey         string
	Manager            *session.Manager
	Current            *session.Session
	AgentName          string
	Model              string
	Mode               string
	Effort             string
	FastService        string
	PlanMode           bool
	RootAbs            string
	CurrentSession     agenttypes.Session
	Prompt             string
	SawAssistantChunk  bool
	SendWithAttachment func(agenttypes.Session, string) error
}

func (s *Service) recoverAgentTurn(ctx context.Context, in SendRecoveryInput) (agenttypes.Session, error) {
	if s == nil {
		return nil, errors.New("services not configured")
	}
	if in.Current == nil {
		return nil, errors.New("session required")
	}
	if in.Manager == nil {
		return nil, errors.New("session manager required")
	}
	if in.SendWithAttachment == nil {
		return nil, errors.New("send function required")
	}
	if in.CurrentSession == nil {
		return nil, errors.New("current session required")
	}

	var lastErr error
	for attempt := 1; attempt <= sessionRecoveryAttempts; attempt++ {
		if attempt > 1 {
			log.Printf("[session/recovery] wait root=%s session=%s agent=%s attempt=%d/%d delay=%s", in.RootID, in.SessionKey, in.AgentName, attempt, sessionRecoveryAttempts, sessionRecoveryDelay)
			if err := waitForRecoveryDelay(ctx, sessionRecoveryDelay); err != nil {
				return nil, err
			}
		}

		sess := in.CurrentSession
		recoveryMessage := in.Prompt
		recoveryAction := "resend_prompt"
		if in.SawAssistantChunk {
			recoveryMessage = "continue"
			recoveryAction = "continue"
		}
		log.Printf("[session/recovery] send.start root=%s session=%s agent=%s attempt=%d/%d action=%s", in.RootID, in.SessionKey, in.AgentName, attempt, sessionRecoveryAttempts, recoveryAction)
		if err := in.SendWithAttachment(sess, recoveryMessage); err != nil {
			if isCanceledTurnError(err) || ctx.Err() != nil {
				return nil, err
			}
			if isNonRecoverableAgentError(err) {
				log.Printf("[session/recovery] send.non_recoverable root=%s session=%s agent=%s attempt=%d/%d action=%s err=%v", in.RootID, in.SessionKey, in.AgentName, attempt, sessionRecoveryAttempts, recoveryAction, err)
				return nil, err
			}
			lastErr = err
			log.Printf("[session/recovery] send.failed root=%s session=%s agent=%s attempt=%d/%d action=%s err=%v", in.RootID, in.SessionKey, in.AgentName, attempt, sessionRecoveryAttempts, recoveryAction, err)
			continue
		}
		log.Printf("[session/recovery] send.done root=%s session=%s agent=%s attempt=%d/%d action=%s", in.RootID, in.SessionKey, in.AgentName, attempt, sessionRecoveryAttempts, recoveryAction)
		return sess, nil
	}
	if lastErr == nil {
		lastErr = errors.New("agent recovery failed")
	}
	return nil, lastErr
}

func waitForRecoveryDelay(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) AnswerQuestion(ctx context.Context, in AnswerQuestionInput) error {
	if err := s.ensureRegistry(); err != nil {
		return err
	}
	sessionKey := strings.TrimSpace(in.SessionKey)
	if sessionKey == "" {
		return errors.New("session key required")
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return err
	}
	agentName := strings.TrimSpace(in.Agent)
	if agentName == "" {
		current, err := manager.Get(ctx, sessionKey, 0)
		if err != nil {
			return err
		}
		agentName = strings.TrimSpace(session.InferAgentFromSession(current))
	}
	if agentName == "" {
		return errors.New("agent required")
	}
	pool := s.Registry.GetAgentPool()
	if pool == nil {
		return errors.New("agent pool unavailable")
	}
	sess, ok := pool.Get(agentPoolSessionKey(sessionKey, agentName))
	if !ok {
		return errors.New("agent session not found")
	}
	answer := agenttypes.AskUserAnswer{
		ToolUseID: strings.TrimSpace(in.ToolUseID),
		Answers:   in.Answers,
	}
	return manager.AcceptPendingAskUserAnswer(ctx, sessionKey, answer.ToolUseID, answer.Answers, time.Now(), func() error {
		return sess.AnswerQuestion(ctx, answer)
	})
}

func (s *Service) CancelSessionTurn(ctx context.Context, in CancelSessionTurnInput) error {
	if err := s.ensureRegistry(); err != nil {
		return err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return err
	}
	key := strings.TrimSpace(in.Key)
	if key == "" {
		return errors.New("session key required")
	}
	if strings.HasPrefix(key, "transient-") {
		active := getActiveTurn(in.RootID, key)
		if active == nil {
			return nil
		}
		active.cancel()
		if active.session != nil {
			if err := active.session.CancelCurrentTurn(); err != nil {
				log.Printf("[session] turn.cancel.error root=%s session=%s err=%v", in.RootID, key, err)
			}
		}
		return nil
	}
	current, err := manager.Get(ctx, key, 0)
	if err != nil {
		return err
	}
	active := getActiveTurn(in.RootID, current.Key)
	if active == nil {
		return nil
	}
	if active.session != nil {
		// Let the runtime emit its own turn boundary after interrupt. Canceling
		// turnCtx first can dequeue the current waiter, so a late ResultMessage
		// may be delivered to the next queued turn.
		if err := active.session.CancelCurrentTurn(); err != nil {
			log.Printf("[session] turn.cancel.error root=%s session=%s err=%v", in.RootID, current.Key, err)
			active.cancel()
			return err
		}
		return nil
	}
	active.cancel()
	return nil
}
