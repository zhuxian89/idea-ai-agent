package claude

import (
	"context"
	"fmt"

	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"mindfs/server/internal/agent/types"
)

func (s *session) handleElicitation(ctx context.Context, req claudeagent.ElicitationRequest) (claudeagent.ElicitationResult, error) {
	native, err := types.NewElicitation(req.ServerName, req.Message, req.Mode, req.URL, req.RequestedSchema)
	if err != nil {
		return claudeagent.ElicitationResult{Action: "cancel"}, err
	}
	result, err := s.awaitNativeInteraction(ctx, req.RequestID, native)
	if err != nil {
		return claudeagent.ElicitationResult{Action: "cancel"}, err
	}
	action, _ := result["action"].(string)
	content, _ := result["content"].(map[string]any)
	return claudeagent.ElicitationResult{Action: action, Content: content}, nil
}

func (s *session) handleUserDialog(ctx context.Context, req claudeagent.UserDialogRequest) (claudeagent.UserDialogResult, error) {
	if req.DialogKind != "refusal_fallback_prompt" {
		return claudeagent.UserDialogResult{Behavior: "cancelled"}, nil
	}
	message, _ := req.Payload["guidanceText"].(string)
	native := &types.NativeInteraction{Kind: req.DialogKind, Title: "Claude Code · Model fallback", Message: message, Details: req.Payload, Actions: []string{"retry_fallback", "edit_prompt", "cancelled"}}
	result, err := s.awaitNativeInteraction(ctx, req.RequestID, native)
	if err != nil {
		return claudeagent.UserDialogResult{Behavior: "cancelled"}, err
	}
	behavior, _ := result["behavior"].(string)
	return claudeagent.UserDialogResult{Behavior: behavior, Result: result["result"]}, nil
}

func (s *session) awaitNativeInteraction(ctx context.Context, requestID string, native *types.NativeInteraction) (map[string]any, error) {
	if requestID == "" {
		return nil, fmt.Errorf("native interaction missing request id")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	id := "claude-native-" + requestID
	waiter := types.NewPendingQuestion[claudeagent.Answers](ctx)
	s.questionMu.Lock()
	if s.questionWaits == nil {
		s.questionWaits = make(map[string]*types.PendingQuestion[claudeagent.Answers])
	}
	if s.nativeInteractions == nil {
		s.nativeInteractions = make(map[string]*types.NativeInteraction)
	}
	if _, exists := s.questionWaits[id]; exists {
		s.questionMu.Unlock()
		return nil, fmt.Errorf("native request already pending: %s", id)
	}
	s.questionWaits[id], s.nativeInteractions[id] = waiter, native
	s.questionMu.Unlock()
	defer func() {
		s.questionMu.Lock()
		delete(s.questionWaits, id)
		delete(s.nativeInteractions, id)
		s.questionMu.Unlock()
	}()
	call := native.ToolCall(id)
	s.trackPendingToolCall(call)
	s.emit(types.Event{Type: types.EventTypeToolCall, SessionID: s.SessionID(), Data: call})
	answers, err := waiter.Wait()
	s.resolveApprovalQuestion(claudeagent.QuestionSet{ToolUseID: id}, answers, err)
	if err != nil {
		return nil, err
	}
	return native.Result(answers)
}
