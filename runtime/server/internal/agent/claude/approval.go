package claude

import (
	"context"
	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"mindfs/server/internal/agent/types"
	"strings"
	"time"
)

func (s *session) awaitToolPermission(ctx context.Context, req claudeagent.ToolPermissionRequest) claudeagent.PermissionResult {
	if strings.TrimSpace(req.Context.ToolUseID) == "" {
		return claudeagent.PermissionDeny{Reason: "permission request missing tool use id"}
	}
	question := "Claude Code 请求执行 " + req.ToolName + "：\n" + string(req.Arguments)
	// Synthetic approval prompts have no native tool_result to finish their lifecycle.
	answers, err := s.awaitQuestion(ctx, claudeagent.QuestionSet{
		ToolUseID: "approval-" + req.Context.ToolUseID,
		SessionID: req.Context.SessionID,
		Questions: []claudeagent.QuestionItem{{Question: question, Header: "执行授权", Options: []claudeagent.QuestionOption{
			{Label: "允许本次执行", Description: "允许此操作，后续权限仍由本机 Claude Code 配置决定"},
			{Label: "拒绝执行", Description: "拒绝此操作；也可以填写原因或修改意见"},
		}}},
	}, true)
	if err != nil {
		return claudeagent.PermissionDeny{Reason: err.Error()}
	}
	answer := answers["q_0"]
	if answer == "" {
		answer = answers[question]
	}
	if answer == "允许本次执行" {
		return claudeagent.PermissionAllow{Classification: claudeagent.PermissionClassificationUserTemporary}
	}
	return claudeagent.PermissionDeny{Reason: "用户拒绝执行：" + answer}
}

func (s *session) resolveApprovalQuestion(qs claudeagent.QuestionSet, answers claudeagent.Answers, err error) {
	callID := strings.TrimSpace(qs.ToolUseID)
	var update types.ToolCall
	var ok bool
	if err != nil {
		update, ok = s.cancelPendingToolCall(callID, err.Error())
	} else {
		update, ok = s.popPendingToolCall(callID)
		if ok {
			update.Status = "complete"
			update.Meta = mergeToolCallMeta(update.Meta, map[string]any{
				"answers":    map[string]string(answers),
				"answeredAt": time.Now().UTC().Format(time.RFC3339Nano),
			})
		}
	}
	if ok {
		s.emit(types.Event{Type: types.EventTypeToolUpdate, SessionID: s.SessionID(), Data: update})
	}
}
