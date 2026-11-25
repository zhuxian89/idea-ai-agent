package api

import (
	"context"
	"github.com/gorilla/websocket"
	"log"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/session"
	"strconv"
	"strings"
	"sync"
	"time"
)

func (h *WSHandler) broadcastAnsweredQuestion(ctx context.Context, rootID, sessionKey, toolUseID string) {
	if h == nil || h.AppContext == nil {
		return
	}
	manager, err := h.AppContext.GetSessionManager(rootID)
	if err != nil {
		log.Printf("[session] ask_user.answered.broadcast.manager_error root=%s session=%s call=%s err=%v", rootID, sessionKey, toolUseID, err)
		return
	}
	toolCall, err := manager.GetFullToolCall(ctx, sessionKey, toolUseID)
	if err != nil {
		log.Printf("[session] ask_user.answered.broadcast.load_error root=%s session=%s call=%s err=%v", rootID, sessionKey, toolUseID, err)
		return
	}
	// This synchronizes an existing question; it is not evidence of a new or
	// still-running turn. The agent may already have finished after admission.
	h.AppContext.GetSessionStreamHub().BroadcastSessionStream(rootID, sessionKey, &StreamEvent{
		Type: "question_answered",
		Data: *toolCall,
	})
}

func (h *WSHandler) handleWSPing(conn *websocket.Conn, clientID string, req WSRequest) {
	resp := WSResponse{
		ID:      req.ID,
		Type:    "pong",
		Payload: map[string]any{"ts": time.Now().UTC().Format(time.RFC3339Nano)},
	}
	_ = h.writeWSJSON(clientID, conn, resp)
}

func (h *WSHandler) handleSessionMessage(ctx context.Context, conn *websocket.Conn, clientID string, req WSRequest) {
	rootID := getString(req.Payload, "root_id")
	key := getString(req.Payload, "session_key")
	requestID := strings.TrimSpace(req.ID)
	content := getString(req.Payload, "content")
	planRequested, strippedContent := parsePlanMessage(content)
	if planRequested {
		content = strippedContent
	}
	planMode := planRequested
	sessionType := getString(req.Payload, "type")
	agentName := getString(req.Payload, "agent")
	model := getString(req.Payload, "model")
	agentMode := getString(req.Payload, "agent_mode")
	effort := getString(req.Payload, "effort")
	fastService := normalizeFastServiceValue(getString(req.Payload, "fast_service"))
	shell := getString(req.Payload, "shell")
	terminalCols := getInt(req.Payload, "terminal_cols")
	createWorktree := getBool(req.Payload, "create_worktree")
	worktreeBranchMode := getString(req.Payload, "worktree_branch_mode")
	worktreeBranch := getString(req.Payload, "worktree_branch")
	if content == "" || sessionType == "" || (agentName == "" && sessionType != session.TypeCommand) {
		h.sendWSError(conn, clientID, req.ID, "invalid_request", "content, type and agent required")
		return
	}

	uc := &usecase.Service{Registry: h.AppContext}
	streamHub := h.AppContext.GetSessionStreamHub()
	userTimestamp := time.Now().UTC()
	if requestID != "" {
		reservedAt, reserved := h.reserveClientRequest(requestID)
		userTimestamp = reservedAt
		if !reserved {
			h.sendWSAcceptedAt(conn, clientID, requestID, rootID, key, userTimestamp)
			return
		}
	}
	sessionName := ""
	runtimeRootPath := ""
	if key == "" {
		sessionName = usecase.BuildFallbackSessionName(content)
		sessionSource := ""
		if createWorktree && sessionType != session.TypeCommand {
			sessionSource = "worktree"
		}
		created, err := uc.CreateSession(ctx, usecase.CreateSessionInput{
			RootID: rootID,
			Input: session.CreateInput{
				Type:     sessionType,
				Source:   sessionSource,
				Agent:    agentName,
				Model:    model,
				Shell:    shell,
				PlanMode: planRequested,
				Name:     sessionName,
			},
		})
		if err != nil {
			h.sendWSError(conn, clientID, req.ID, "session.create_failed", err.Error())
			return
		}
		key = created.Key
		if createWorktree && sessionType != session.TypeCommand {
			wt, worktreeErr := h.AppContext.CreateSessionWorktree(ctx, rootID, worktreeBranchMode, worktreeBranch)
			if worktreeErr != nil {
				if manager, managerErr := h.AppContext.GetSessionManager(rootID); managerErr == nil {
					_ = manager.Delete(ctx, created.Key)
				}
				h.sendWSError(conn, clientID, req.ID, "session.create_failed", worktreeErr.Error())
				return
			}
			runtimeRootPath = wt.Path
			if manager, managerErr := h.AppContext.GetSessionManager(rootID); managerErr == nil {
				branch := worktreeBranch
				head := ""
				if root, rootErr := h.AppContext.GetRoot(rootID); rootErr == nil {
					if match, ok := resolveRelatedWorktree(ctx, root, wt.Path); ok {
						branch = match.Branch
						head = match.Head
					}
				}
				if _, recordErr := manager.RecordRelatedWorktree(ctx, created.Key, rootID, wt.Path, branch, head); recordErr != nil {
					h.sendWSError(conn, clientID, req.ID, "session.create_failed", recordErr.Error())
					return
				}
				if updated, getErr := manager.Get(ctx, created.Key, 0); getErr == nil && updated != nil {
					created = updated
				}
			}
		}
		h.broadcastSessionMetaUpdated(rootID, created)
		if sessionType != session.TypeCommand {
			go func(rootID, sessionKey, agentName, firstMessage string) {
				updated, err := uc.SuggestSessionName(context.Background(), usecase.SuggestSessionNameInput{
					RootID:       rootID,
					SessionKey:   sessionKey,
					Agent:        agentName,
					FirstMessage: firstMessage,
				})
				if err != nil {
					log.Printf("[session-name] async.error root=%s session=%s agent=%s err=%v", rootID, sessionKey, agentName, err)
					return
				}
				if updated == nil {
					return
				}
				if h.AppContext == nil {
					return
				}
				log.Printf("[session-name] async.broadcast root=%s session=%s name=%q", rootID, sessionKey, updated.Name)
				h.broadcastSessionMetaUpdated(rootID, updated)
			}(rootID, key, agentName, content)
		}
	} else if current, err := uc.GetSession(ctx, usecase.GetSessionInput{RootID: rootID, Key: key}); err == nil && current != nil {
		sessionName = current.Name
		planMode = current.PlanMode
		runtimeRootPath = sessionRuntimeRootPath(current)
		if planRequested && !current.PlanMode {
			if manager, managerErr := h.AppContext.GetSessionManager(rootID); managerErr == nil {
				if updateErr := manager.UpdatePlanMode(ctx, current, true); updateErr != nil {
					h.sendWSError(conn, clientID, req.ID, "session.plan_mode_failed", updateErr.Error())
					return
				}
				h.switchSessionRuntimePlanMode(ctx, key, current, true)
				updated, getErr := manager.Get(ctx, key, 0)
				if getErr == nil && updated != nil {
					current = updated
					planMode = updated.PlanMode
					h.broadcastSessionMetaUpdated(rootID, updated)
				}
			} else {
				h.sendWSError(conn, clientID, req.ID, "session.plan_mode_failed", managerErr.Error())
				return
			}
		}
	}
	if requestID != "" {
		h.sendWSAcceptedAt(conn, clientID, requestID, rootID, key, userTimestamp)
	}
	if h.AppContext != nil {
		streamHub.BindSessionClient(key, clientID)
	}
	clientCtx := parseClientContext(req.Payload, rootID)
	userMessage := PendingUserMessage{
		Agent:       agentName,
		Model:       model,
		Mode:        agentMode,
		Effort:      effort,
		FastService: fastService,
		PlanMode:    planMode,
		Content:     content,
		Timestamp:   userTimestamp,
	}
	job := sessionMessageJob{
		RootID:          rootID,
		RuntimeRootPath: runtimeRootPath,
		Key:             key,
		RequestID:       requestID,
		SessionType:     sessionType,
		SessionName:     sessionName,
		Shell:           shell,
		TerminalCols:    terminalCols,
		User:            userMessage,
		ClientCtx:       clientCtx,
		ExcludeClientID: clientID,
	}
	if sessionType != session.TypeCommand {
		queue, queued := streamHub.reserveOrQueueSessionMessage(rootID, key, sessionName, QueuedUserMessage{
			ID:                 requestID,
			PendingUserMessage: userMessage,
			ClientCtx:          clientCtx,
		})
		if queued {
			streamHub.BroadcastSessionQueueUpdated(rootID, key, queue)
			h.startNextQueuedSessionMessage(rootID, key)
			return
		}
	}
	if queue, changed := streamHub.UnfreezeQueuedSessionMessages(key); changed {
		streamHub.BroadcastSessionQueueUpdated(rootID, key, queue)
	}
	h.runSessionMessage(job)
}

func (h *WSHandler) handleSessionSlashCommandRun(ctx context.Context, conn *websocket.Conn, clientID string, req WSRequest) {
	rootID := getString(req.Payload, "root_id")
	key := getString(req.Payload, "session_key")
	requestID := strings.TrimSpace(req.ID)
	agentName := getString(req.Payload, "agent")
	model := getString(req.Payload, "model")
	agentMode := getString(req.Payload, "agent_mode")
	effort := getString(req.Payload, "effort")
	fastService := normalizeFastServiceValue(getString(req.Payload, "fast_service"))
	command := strings.TrimSpace(getString(req.Payload, "command"))
	normalizedCommand := strings.TrimPrefix(strings.ToLower(command), "/")
	if rootID == "" || agentName == "" || normalizedCommand == "" {
		h.sendWSError(conn, clientID, req.ID, "invalid_request", "root_id, agent and command required")
		return
	}
	if key == "" {
		if requestID != "" {
			key = "transient-" + requestID
		} else {
			key = "transient-" + normalizedCommand + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
		}
	}
	if agentName != "codex" || (normalizedCommand != "status" && normalizedCommand != "login") {
		h.sendWSError(conn, clientID, req.ID, "unsupported_slash_command", "only codex /status and /login are supported")
		return
	}
	if requestID != "" {
		_, reserved := h.reserveClientRequest(requestID)
		if !reserved {
			h.sendWSAccepted(conn, clientID, requestID, rootID, key)
			return
		}
		h.sendWSAccepted(conn, clientID, requestID, rootID, key)
	}
	if h.AppContext != nil {
		h.AppContext.GetSessionStreamHub().BindSessionClient(key, clientID)
	}

	uc := &usecase.Service{Registry: h.AppContext}
	msgCtx, cancel := h.sessionMessageContext()
	defer cancel()
	updateTracker := newTurnUpdateTracker()
	err := uc.RunTransientSlashCommand(msgCtx, usecase.RunTransientSlashCommandInput{
		RootID:      rootID,
		Key:         key,
		Agent:       agentName,
		Model:       model,
		Mode:        agentMode,
		Effort:      effort,
		FastService: fastService,
		Command:     normalizedCommand,
		OnUpdate: func(update agenttypes.Event) {
			updateTracker.Begin()
			defer updateTracker.End()
			event := updateToEvent(update)
			if event == nil {
				return
			}
			_ = h.writeWSJSON(clientID, conn, buildSlashCommandStreamResponse(rootID, key, normalizedCommand, requestID, event))
		},
	})
	if err != nil {
		log.Printf("[ws] session.slash_command.error root=%s session=%s command=%s request=%s err=%v", rootID, key, normalizedCommand, requestID, err)
		event := &StreamEvent{
			Type: "error",
			Data: map[string]string{"message": normalizeAgentErrorMessage(err)},
		}
		_ = h.writeWSJSON(clientID, conn, buildSlashCommandStreamResponse(rootID, key, normalizedCommand, requestID, event))
	}
	if ok := updateTracker.WaitIdle(msgCtx, sessionDoneSettleWindow, sessionDoneMaxWait); !ok {
		log.Printf("[ws] session.slash_command.done.wait_timeout root=%s session=%s command=%s request=%s", rootID, key, normalizedCommand, requestID)
	}
	_ = h.writeWSJSON(clientID, conn, buildSlashCommandDoneResponse(rootID, key, normalizedCommand, requestID))
}

func (h *WSHandler) handleSessionPlanModeSet(ctx context.Context, conn *websocket.Conn, clientID string, req WSRequest) {
	rootID := getString(req.Payload, "root_id")
	key := getString(req.Payload, "session_key")
	requestID := strings.TrimSpace(req.ID)
	enabled := getBool(req.Payload, "enabled")
	if rootID == "" || key == "" {
		h.sendWSError(conn, clientID, req.ID, "invalid_request", "root_id and session_key required")
		return
	}
	manager, err := h.AppContext.GetSessionManager(rootID)
	if err != nil {
		h.sendWSError(conn, clientID, req.ID, "session.plan_mode_failed", err.Error())
		return
	}
	current, err := manager.Get(ctx, key, 0)
	if err != nil {
		h.sendWSError(conn, clientID, req.ID, "session.plan_mode_failed", err.Error())
		return
	}
	previous := current.PlanMode
	if err := manager.UpdatePlanMode(ctx, current, enabled); err != nil {
		h.sendWSError(conn, clientID, req.ID, "session.plan_mode_failed", err.Error())
		return
	}
	if previous != enabled {
		h.switchSessionRuntimePlanMode(ctx, key, current, enabled)
	}
	updated, err := manager.Get(ctx, key, 0)
	if err != nil {
		h.sendWSError(conn, clientID, req.ID, "session.plan_mode_failed", err.Error())
		return
	}
	h.sendWSAccepted(conn, clientID, requestID, rootID, key)
	h.broadcastSessionMetaUpdated(rootID, updated)
	_ = h.writeWSJSON(clientID, conn, buildSessionDoneResponse(rootID, key, requestID, false))
}

func wsAgentPoolSessionKey(sessionKey, agentName string) string {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return ""
	}
	agentName = strings.TrimSpace(agentName)
	if agentName == "" {
		return sessionKey
	}
	return strings.ToLower(agentName) + "-" + sessionKey
}

func (h *WSHandler) switchSessionRuntimePlanMode(ctx context.Context, key string, current *session.Session, enabled bool) {
	if h == nil || h.AppContext == nil || current == nil {
		return
	}
	pool := h.AppContext.GetAgentPool()
	if pool == nil {
		return
	}
	agentName := session.InferAgentFromSession(current)
	if runtime, ok := pool.Get(wsAgentPoolSessionKey(key, agentName)); ok {
		if err := runtime.SetPlanMode(ctx, enabled); err != nil {
			log.Printf("[session/plan] runtime.switch.error session=%s agent=%s plan_mode=%t err=%v", key, agentName, enabled, err)
		}
	}
}

func (h *WSHandler) runSessionMessage(job sessionMessageJob) {
	rootID := job.RootID
	key := job.Key
	requestID := strings.TrimSpace(job.RequestID)
	uc := &usecase.Service{Registry: h.AppContext}
	streamHub := h.AppContext.GetSessionStreamHub()
	msgCtx, cancel := h.sessionMessageContext()
	defer cancel()
	updateTracker := newTurnUpdateTracker()
	subTrackers := map[string]*turnUpdateTracker{}
	var subTrackersMu sync.Mutex
	subTrackerFor := func(sessionKey string) *turnUpdateTracker {
		subTrackersMu.Lock()
		defer subTrackersMu.Unlock()
		tracker := subTrackers[sessionKey]
		if tracker == nil {
			tracker = newTurnUpdateTracker()
			subTrackers[sessionKey] = tracker
		}
		return tracker
	}

	err := uc.SendMessage(msgCtx, usecase.SendMessageInput{
		RootID:          rootID,
		RuntimeRootPath: job.RuntimeRootPath,
		Key:             key,
		Agent:           job.User.Agent,
		Model:           job.User.Model,
		Mode:            job.User.Mode,
		Effort:          job.User.Effort,
		FastService:     job.User.FastService,
		PlanMode:        &job.User.PlanMode,
		Shell:           job.Shell,
		TerminalCols:    job.TerminalCols,
		Content:         job.User.Content,
		UserTimestamp:   job.User.Timestamp,
		ClientCtx:       job.ClientCtx,
		OnStart: func(start usecase.MessageStart) {
			h.AppContext.ClearTaskAuxFlagsForSession(rootID, key)
			streamHub.BroadcastSessionUserMessageAt(rootID, key, job.SessionType, job.SessionName, job.User.Agent, start.Model, start.Mode, start.Effort, start.FastService, job.User.PlanMode, job.User.Content, job.User.Timestamp, job.ExcludeClientID, job.Queued, start.BaseExchangeSeq)
		},
		OnUpdate: func(update agenttypes.Event) {
			updateTracker.Begin()
			defer updateTracker.End()
			if updateToEvent(update) == nil {
				return
			}
			h.AppContext.BroadcastSessionUpdate(rootID, key, update)
		},
		OnAgentDefaultsChanged: func(agentName string) {
			h.AppContext.BroadcastAgentStatusChanged(agentName)
		},
		OnSubSessionCreated: func(created *session.Session) {
			h.broadcastSessionMetaUpdated(rootID, created)
			if created != nil {
				streamHub.SetPendingReply(rootID, created.Key, created.Name)
			}
		},
		OnSubSessionUpdate: func(sessionKey string, update agenttypes.Event) {
			tracker := subTrackerFor(sessionKey)
			tracker.Begin()
			if updateToEvent(update) == nil {
				tracker.End()
				return
			}
			h.AppContext.BroadcastSessionUpdate(rootID, sessionKey, update)
			if update.Type == agenttypes.EventTypeMessageDone {
				tracker.End()
				if ok := tracker.WaitIdle(msgCtx, sessionDoneSettleWindow, sessionDoneMaxWait); !ok {
					log.Printf("[ws] sub-session.done.wait_timeout root=%s session=%s", rootID, sessionKey)
				}
				h.AppContext.BroadcastSessionDone(rootID, sessionKey, "")
				return
			}
			tracker.End()
		},
	})
	if err != nil {
		log.Printf("[ws] session.message.error root=%s session=%s request=%s err=%v", rootID, key, requestID, err)
		h.AppContext.BroadcastSessionError(rootID, key, err.Error())
	}
	if ok := updateTracker.WaitIdle(msgCtx, sessionDoneSettleWindow, sessionDoneMaxWait); !ok {
		log.Printf("[ws] session.done.wait_timeout root=%s session=%s request=%s", rootID, key, requestID)
	}
	log.Printf("[ws] session.done root=%s session=%s request=%s", rootID, key, requestID)
	h.AppContext.BroadcastSessionDone(rootID, key, requestID)
	h.startNextQueuedSessionMessage(rootID, key)
}

func (h *WSHandler) startNextQueuedSessionMessage(rootID, key string) {
	if h == nil || h.AppContext == nil || rootID == "" || key == "" {
		return
	}
	streamHub := h.AppContext.GetSessionStreamHub()
	item, queue, ok := streamHub.reserveNextQueuedSessionMessage(key)
	if !ok {
		return
	}
	streamHub.BroadcastSessionQueueUpdated(rootID, key, queue)
	sessionType := session.TypeChat
	sessionName := ""
	shell := ""
	runtimeRootPath := ""
	uc := &usecase.Service{Registry: h.AppContext}
	if current, err := uc.GetSession(context.Background(), usecase.GetSessionInput{RootID: rootID, Key: key}); err == nil && current != nil {
		sessionType = current.Type
		sessionName = current.Name
		shell = current.Shell
		runtimeRootPath = sessionRuntimeRootPath(current)
	}
	go h.runSessionMessage(sessionMessageJob{
		RootID:          rootID,
		RequestID:       item.ID,
		RuntimeRootPath: runtimeRootPath,
		Key:             key,
		SessionType:     sessionType,
		SessionName:     sessionName,
		Shell:           shell,
		User:            item.PendingUserMessage,
		ClientCtx:       item.ClientCtx,
		Queued:          true,
	})
}

func sessionRuntimeRootPath(current *session.Session) string {
	if current == nil || current.RelatedWorktree == nil {
		return ""
	}
	if strings.TrimSpace(current.TaskID) == "" && strings.TrimSpace(current.Source) != "worktree" {
		return ""
	}
	return strings.TrimSpace(current.RelatedWorktree.Path)
}

func (h *WSHandler) handleSessionReady(clientID string, req WSRequest) {
	if h.AppContext == nil {
		return
	}
	rootID := getString(req.Payload, "root_id")
	key := getString(req.Payload, "session_key")
	eventCursor := getString(req.Payload, "event_cursor")
	if rootID == "" || key == "" {
		return
	}
	streamHub := h.AppContext.GetSessionStreamHub()
	streamHub.BindSessionClient(key, clientID)
	streamHub.ReplayPending(rootID, clientID, key, eventCursor)
}

func (h *WSHandler) sessionMessageContext() (context.Context, context.CancelFunc) {
	parentCtx := context.Background()
	if h != nil && h.AppContext != nil {
		if agentPool := h.AppContext.GetAgentPool(); agentPool != nil {
			parentCtx = agentPool.Context()
		}
	}
	return context.WithCancel(parentCtx)
}

func (h *WSHandler) handleSessionCancel(ctx context.Context, conn *websocket.Conn, clientID string, req WSRequest) {
	rootID := getString(req.Payload, "root_id")
	key := getString(req.Payload, "session_key")
	if rootID == "" || key == "" {
		h.sendWSError(conn, clientID, req.ID, "invalid_request", "root_id and session_key required")
		return
	}
	log.Printf("[ws] session.cancel root=%s session=%s request=%s", rootID, key, req.ID)

	streamHub := h.AppContext.GetSessionStreamHub()
	if queue, ok := streamHub.FreezeQueuedSessionMessages(key); ok {
		log.Printf("[ws] session.queue.freeze root=%s session=%s request=%s", rootID, key, req.ID)
		streamHub.BroadcastSessionQueueUpdated(rootID, key, queue)
	}

	uc := &usecase.Service{Registry: h.AppContext}
	if err := uc.CancelSessionTurn(ctx, usecase.CancelSessionTurnInput{
		RootID: rootID,
		Key:    key,
	}); err != nil {
		if queue, changed := streamHub.UnfreezeQueuedSessionMessages(key); changed {
			streamHub.BroadcastSessionQueueUpdated(rootID, key, queue)
		}
		log.Printf("[ws] session.cancel.error root=%s session=%s request=%s err=%v", rootID, key, req.ID, err)
		h.sendWSError(conn, clientID, req.ID, "session.cancel_failed", err.Error())
		return
	}
}

func (h *WSHandler) handleSessionQueueRemove(_ context.Context, conn *websocket.Conn, clientID string, req WSRequest) {
	rootID := getString(req.Payload, "root_id")
	key := getString(req.Payload, "session_key")
	queueID := strings.TrimSpace(getString(req.Payload, "queue_id"))
	if rootID == "" || key == "" || queueID == "" {
		h.sendWSError(conn, clientID, req.ID, "invalid_request", "root_id, session_key and queue_id required")
		return
	}
	streamHub := h.AppContext.GetSessionStreamHub()
	queue := streamHub.RemoveQueuedSessionMessage(key, queueID)
	streamHub.BroadcastSessionQueueUpdated(rootID, key, queue)
	if req.ID != "" {
		h.sendWSAccepted(conn, clientID, req.ID, rootID, key)
	}
}

func (h *WSHandler) handleSessionQueueUpdate(_ context.Context, conn *websocket.Conn, clientID string, req WSRequest) {
	rootID := getString(req.Payload, "root_id")
	key := getString(req.Payload, "session_key")
	queueID := strings.TrimSpace(getString(req.Payload, "queue_id"))
	content := getString(req.Payload, "content")
	if rootID == "" || key == "" || queueID == "" || strings.TrimSpace(content) == "" {
		h.sendWSError(conn, clientID, req.ID, "invalid_request", "root_id, session_key, queue_id and content required")
		return
	}
	streamHub := h.AppContext.GetSessionStreamHub()
	queue := streamHub.UpdateQueuedSessionMessage(key, queueID, content)
	streamHub.BroadcastSessionQueueUpdated(rootID, key, queue)
	if req.ID != "" {
		h.sendWSAccepted(conn, clientID, req.ID, rootID, key)
	}
}

func (h *WSHandler) handleSessionQueueSendNow(ctx context.Context, conn *websocket.Conn, clientID string, req WSRequest) {
	rootID := getString(req.Payload, "root_id")
	key := getString(req.Payload, "session_key")
	queueID := strings.TrimSpace(getString(req.Payload, "queue_id"))
	if rootID == "" || key == "" || queueID == "" {
		h.sendWSError(conn, clientID, req.ID, "invalid_request", "root_id, session_key and queue_id required")
		return
	}
	streamHub := h.AppContext.GetSessionStreamHub()
	streamHub.BindSessionClient(key, clientID)
	queue, ok := streamHub.PromoteQueuedSessionMessage(key, queueID)
	if !ok {
		h.sendWSError(conn, clientID, req.ID, "not_found", "queued message not found")
		return
	}
	streamHub.BroadcastSessionQueueUpdated(rootID, key, queue)
	if req.ID != "" {
		h.sendWSAccepted(conn, clientID, req.ID, rootID, key)
	}
	if !streamHub.IsSessionReplying(key) {
		h.startNextQueuedSessionMessage(rootID, key)
		return
	}
	uc := &usecase.Service{Registry: h.AppContext}
	if err := uc.CancelSessionTurn(ctx, usecase.CancelSessionTurnInput{RootID: rootID, Key: key}); err != nil {
		log.Printf("[ws] session.queue.send_now.cancel.error root=%s session=%s request=%s err=%v", rootID, key, req.ID, err)
	}
}

func (h *WSHandler) sendWSError(conn *websocket.Conn, clientID, id, code, message string) {
	resp := WSResponse{
		ID:   id,
		Type: "session.error",
		Error: &WSResponseError{
			Code:    code,
			Message: message,
		},
		Payload: map[string]any{},
	}
	_ = h.writeWSJSON(clientID, conn, resp)
}
