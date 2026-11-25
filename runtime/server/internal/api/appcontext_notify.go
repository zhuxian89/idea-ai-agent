package api

import (
	"context"
	"errors"
	"log"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/barknotify"
	"mindfs/server/internal/kanban"
	"mindfs/server/internal/notify"
	"strings"
	"time"
)

func (s *AppContext) notifySessionDone(rootID, sessionKey, requestID string, pending PendingSessionSnapshot) {
	if s == nil {
		return
	}
	failure, failed := s.takeSessionFailure(rootID, sessionKey)
	if strings.HasPrefix(strings.TrimSpace(requestID), "scheduled:") {
		return
	}
	rootTitle := s.rootTitle(rootID)
	sessionTitle := strings.TrimSpace(pending.SessionTitle)
	if sessionTitle == "" {
		sessionTitle = s.sessionTitle(rootID, sessionKey)
	}
	summary := strings.TrimSpace(pending.Summary)
	eventID := strings.TrimSpace(requestID)
	if eventID == "" {
		eventID = "session.done:" + rootID + ":" + sessionKey + ":" + pending.UpdatedAt.Format(time.RFC3339Nano)
	}
	payload := notify.BuildSessionPayload(notify.SessionNotification{
		Type:         "session.done",
		RootID:       rootID,
		RootTitle:    rootTitle,
		SessionKey:   sessionKey,
		SessionTitle: sessionTitle,
		Summary:      summary,
		EventID:      eventID,
	})
	s.notifyPayload(context.Background(), eventID, payload)
	// Bark only reports final outcomes: a turn that ended in an error is a
	// failure, never a completion, even though the web payload keeps its type.
	barkEvent := barknotify.Event{
		Kind:         barknotify.KindDone,
		EventID:      eventID,
		RootID:       rootID,
		RootTitle:    rootTitle,
		SessionKey:   sessionKey,
		SessionTitle: sessionTitle,
		Summary:      summary,
	}
	if failed {
		barkEvent.Kind = barknotify.KindFailed
		barkEvent.Summary = failure
	}
	s.notifyBark(barkEvent)
}

func (s *AppContext) notifyAskUserIfNeeded(rootID, sessionKey string, event *StreamEvent) {
	if s == nil || event == nil || event.Type != string(agenttypes.EventTypeToolCall) {
		return
	}
	toolCall, ok := event.Data.(agenttypes.ToolCall)
	if !ok || toolCall.Kind != agenttypes.ToolKindAskUser {
		return
	}
	payload := notify.BuildSessionPayload(notify.SessionNotification{
		Type:         "session.ask_user",
		RootID:       rootID,
		RootTitle:    s.rootTitle(rootID),
		SessionKey:   sessionKey,
		SessionTitle: s.sessionTitle(rootID, sessionKey),
		Summary:      askUserSummary(toolCall),
		EventID:      "session.ask_user:" + rootID + ":" + sessionKey + ":" + toolCall.CallID,
	})
	s.notifyPayload(context.Background(), notify.EventID(payload), payload)
	kind := barknotify.KindAskUser
	if isApprovalPrompt(toolCall) {
		kind = barknotify.KindApproval
	}
	s.notifyBark(barkEventForPrompt(kind, notify.EventID(payload), rootID, s.rootTitle(rootID), sessionKey, s.sessionTitle(rootID, sessionKey), askUserSummary(toolCall)))
}

func (s *AppContext) updateTaskAuxFlagsFromEvent(rootID, sessionKey string, event *StreamEvent) {
	if s == nil || event == nil {
		return
	}
	patch := kanban.TaskAuxFlagsPatch{}
	eventType := ""
	switch event.Type {
	case string(agenttypes.EventTypeToolCall):
		toolCall, ok := event.Data.(agenttypes.ToolCall)
		if !ok {
			return
		}
		switch toolCall.Kind {
		case agenttypes.ToolKindAskUser:
			value := true
			patch.AskUserWaiting = &value
			eventType = "aux_ask_user_waiting"
		case agenttypes.ToolKindTask:
			value := true
			patch.HasTask = &value
			eventType = "aux_task_seen"
		default:
			return
		}
	case string(agenttypes.EventTypeToolUpdate):
		toolCall, ok := event.Data.(agenttypes.ToolCall)
		if !ok || toolCall.Kind != agenttypes.ToolKindAskUser {
			return
		}
		switch strings.ToLower(strings.TrimSpace(toolCall.Status)) {
		case "complete", "completed", "failed", "canceled", "cancelled":
		default:
			return
		}
		manager, err := s.GetSessionManager(rootID)
		if err != nil {
			return
		}
		value := manager.HasPendingAskUserQuestions(context.Background(), sessionKey)
		patch.AskUserWaiting = &value
		eventType = "aux_ask_user_resolved"
	case string(agenttypes.EventTypePlanUpdate):
		value := true
		patch.HasPlan = &value
		eventType = "aux_plan_seen"
	case string(agenttypes.EventTypeTodoUpdate):
		value := true
		patch.HasTodos = &value
		eventType = "aux_todos_seen"
	default:
		return
	}
	s.updateTaskAuxFlagsForSession(rootID, sessionKey, patch, eventType)
}

func (s *AppContext) updateTaskAuxFlagsForSession(rootID, sessionKey string, patch kanban.TaskAuxFlagsPatch, eventType string) {
	if s == nil {
		return
	}
	manager, err := s.GetSessionManager(rootID)
	if err != nil {
		return
	}
	sess, err := manager.Get(context.Background(), sessionKey, 0)
	if err != nil || sess == nil || strings.TrimSpace(sess.TaskID) == "" {
		return
	}
	svc, err := s.GetKanbanService()
	if err != nil {
		return
	}
	if _, err := svc.UpdateTaskAuxFlags(context.Background(), rootID, sess.TaskID, patch, eventType); err != nil {
		log.Printf("[kanban] task.aux_flags.update.error root=%s task=%s session=%s err=%v", rootID, sess.TaskID, sessionKey, err)
	}
}

func (s *AppContext) notifyScheduled(rootID, taskID, taskName, sessionKey, summary, message string, success bool) {
	if s == nil {
		return
	}
	if strings.TrimSpace(summary) == "" && success {
		summary = s.sessionSummary(rootID, sessionKey)
	}
	eventID := "scheduled:" + rootID + ":" + taskID + ":" + time.Now().UTC().Format(time.RFC3339Nano)
	payload := notify.BuildScheduledPayload(notify.ScheduledNotification{
		RootID:     rootID,
		RootTitle:  s.rootTitle(rootID),
		TaskID:     taskID,
		TaskName:   taskName,
		SessionKey: sessionKey,
		Summary:    summary,
		Error:      message,
		Success:    success,
		EventID:    eventID,
	})
	s.notifyPayload(context.Background(), eventID, payload)
	barkEvent := barknotify.Event{
		Kind:         barknotify.KindDone,
		EventID:      eventID,
		RootID:       rootID,
		RootTitle:    s.rootTitle(rootID),
		SessionKey:   sessionKey,
		SessionTitle: strings.TrimSpace(taskName),
		Summary:      summary,
	}
	if !success {
		barkEvent.Kind = barknotify.KindFailed
		barkEvent.Summary = message
	}
	s.notifyBark(barkEvent)
}

func (s *AppContext) notifyPayload(ctx context.Context, eventID string, payload notify.Payload) {
	if s == nil {
		return
	}
	if s.WebPush != nil && s.WebPush.Enabled() {
		s.WebPush.NotifyPayload(ctx, eventID, payload)
	}
	if s.Notify != nil && s.Notify.Enabled() {
		s.Notify.NotifyPayload(ctx, payload)
	}
}

func (s *AppContext) rootTitle(rootID string) string {
	if s == nil || s.Dirs == nil {
		return strings.TrimSpace(rootID)
	}
	root, ok := s.Dirs.Get(rootID)
	if !ok {
		return strings.TrimSpace(rootID)
	}
	return firstNonBlank(root.Name, root.ID)
}

func (s *AppContext) sessionTitle(rootID, sessionKey string) string {
	if strings.TrimSpace(rootID) == "" || strings.TrimSpace(sessionKey) == "" {
		return ""
	}
	manager, err := s.GetSessionManager(rootID)
	if err != nil {
		return ""
	}
	sess, err := manager.Get(context.Background(), sessionKey, 0)
	if err != nil || sess == nil {
		return ""
	}
	return strings.TrimSpace(sess.Name)
}

func (s *AppContext) sessionSummary(rootID, sessionKey string) string {
	if strings.TrimSpace(rootID) == "" || strings.TrimSpace(sessionKey) == "" {
		return ""
	}
	manager, err := s.GetSessionManager(rootID)
	if err != nil {
		return ""
	}
	sess, err := manager.Get(context.Background(), sessionKey, 0)
	if err != nil || sess == nil || len(sess.Exchanges) == 0 {
		return ""
	}
	for i := len(sess.Exchanges) - 1; i >= 0; i-- {
		if strings.TrimSpace(sess.Exchanges[i].Role) == "assistant" {
			return lastRunes(strings.TrimSpace(sess.Exchanges[i].Content), notify.BodyMaxRunes)
		}
	}
	return ""
}

func askUserSummary(toolCall agenttypes.ToolCall) string {
	if len(toolCall.Content) > 0 {
		for _, item := range toolCall.Content {
			if strings.TrimSpace(item.Text) != "" {
				return strings.TrimSpace(item.Text)
			}
		}
	}
	if toolCall.Meta != nil {
		if questions, ok := toolCall.Meta["questions"].([]agenttypes.AskUserQuestionItem); ok && len(questions) > 0 {
			return strings.TrimSpace(questions[0].Question)
		}
		if input := strings.TrimSpace(stringMetaValue(toolCall.Meta, "input")); input != "" {
			return "需要确认：" + lastRunes(input, notify.BodyMaxRunes)
		}
	}
	return "需要你继续输入"
}

func stringMetaValue(meta map[string]any, key string) string {
	if meta == nil {
		return ""
	}
	value, _ := meta[key].(string)
	return strings.TrimSpace(value)
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (s *AppContext) notifyBark(event barknotify.Event) {
	if s == nil || s.Bark == nil {
		return
	}
	s.Bark.Notify(context.Background(), event)
}

func barkEventForPrompt(kind barknotify.Kind, eventID, rootID, rootTitle, sessionKey, sessionTitle, summary string) barknotify.Event {
	return barknotify.Event{
		Kind:         kind,
		EventID:      eventID,
		RootID:       rootID,
		RootTitle:    rootTitle,
		SessionKey:   sessionKey,
		SessionTitle: sessionTitle,
		Summary:      summary,
	}
}

// approvalPromptHeader and approvalCallPrefix mark the synthetic ask-user
// prompts Codex and Claude Code use for tool approvals, which carry the full
// command in their body and deserve a different lock-screen label.
const (
	approvalPromptHeader = "执行授权"
	approvalCallPrefix   = "approval-"
)

func isApprovalPrompt(toolCall agenttypes.ToolCall) bool {
	if strings.HasPrefix(strings.TrimSpace(toolCall.CallID), approvalCallPrefix) {
		return true
	}
	if toolCall.Meta != nil {
		if questions, ok := toolCall.Meta["questions"].([]agenttypes.AskUserQuestionItem); ok {
			for _, question := range questions {
				if strings.TrimSpace(question.Header) == approvalPromptHeader {
					return true
				}
			}
		}
	}
	return false
}

type sessionFailure struct {
	message string
	at      time.Time
}

const sessionFailureMemory = 10 * time.Minute

func sessionFailureKey(rootID, sessionKey string) string {
	return rootID + "\x00" + sessionKey
}

// recordSessionFailure remembers that the running turn ended in an error so
// the done event that always follows can be reported as a failure.
func (s *AppContext) recordSessionFailure(rootID, sessionKey, message string) {
	if s == nil || strings.TrimSpace(sessionKey) == "" {
		return
	}
	now := time.Now()
	s.failureMu.Lock()
	defer s.failureMu.Unlock()
	if s.sessionFailures == nil {
		s.sessionFailures = make(map[string]sessionFailure)
	}
	for key, item := range s.sessionFailures {
		if now.Sub(item.at) > sessionFailureMemory {
			delete(s.sessionFailures, key)
		}
	}
	s.sessionFailures[sessionFailureKey(rootID, sessionKey)] = sessionFailure{message: normalizeAgentErrorMessage(errors.New(message)), at: now}
}

func (s *AppContext) takeSessionFailure(rootID, sessionKey string) (string, bool) {
	if s == nil {
		return "", false
	}
	s.failureMu.Lock()
	defer s.failureMu.Unlock()
	key := sessionFailureKey(rootID, sessionKey)
	item, ok := s.sessionFailures[key]
	if !ok {
		return "", false
	}
	delete(s.sessionFailures, key)
	if time.Since(item.at) > sessionFailureMemory {
		return "", false
	}
	return item.message, true
}
