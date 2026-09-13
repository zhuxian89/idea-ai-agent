package claude

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"mindfs/server/internal/agent/types"
)

func approvalTestSession() (*session, chan types.Event) {
	s := &session{}
	events := make(chan types.Event, 32)
	s.OnUpdate(func(event types.Event) { events <- event })
	return s, events
}

func approvalTestRequest(id string) claudeagent.ToolPermissionRequest {
	return claudeagent.ToolPermissionRequest{
		ToolName: "Bash", Arguments: json.RawMessage(`{"command":"claude --version"}`),
		Context: claudeagent.PermissionContext{ToolUseID: id},
	}
}

func TestPlanBypassAutomaticallyAllowsReadOnlyToolsWithoutApproval(t *testing.T) {
	s, events := approvalTestSession()
	s.planMode = true
	s.permissionMode = claudeagent.PermissionModePlan
	s.previousPermissionMode = claudeagent.PermissionModeBypassAll

	requests := []claudeagent.ToolPermissionRequest{
		{ToolName: "Skill", Arguments: json.RawMessage(`{"skill":"claude-api"}`), Context: claudeagent.PermissionContext{ToolUseID: "skill-1", AgentID: "agent-1"}},
		{ToolName: "Skill", Arguments: json.RawMessage(`{"skill":"claude-api"}`), Context: claudeagent.PermissionContext{ToolUseID: "skill-2", AgentID: "agent-2"}},
		{ToolName: "Read", Arguments: json.RawMessage(`{"file_path":"README.md"}`), Context: claudeagent.PermissionContext{ToolUseID: "read-1"}},
		{ToolName: "Agent", Arguments: json.RawMessage(`{"subagent_type":"Explore","prompt":"trace code"}`), Context: claudeagent.PermissionContext{ToolUseID: "explore-1"}},
	}
	start := make(chan struct{})
	results := make(chan claudeagent.PermissionResult, len(requests))
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	for _, req := range requests {
		go func(req claudeagent.ToolPermissionRequest) {
			<-start
			results <- s.handleCanUseTool(ctx, req)
		}(req)
	}
	close(start)
	for range requests {
		if _, allowed := (<-results).(claudeagent.PermissionAllow); !allowed {
			t.Fatal("read-only requests should be automatically allowed concurrently")
		}
	}
	if len(s.questionWaits) != 0 || len(s.pendingToolCalls) != 0 {
		t.Fatal("automatic callbacks left pending state")
	}
	select {
	case event := <-events:
		t.Fatalf("automatic permissions must not emit approval events: %#v", event)
	default:
	}
	for _, req := range requests {
		if s.hasPendingToolCall("approval-" + req.Context.ToolUseID) {
			t.Fatalf("automatic permission remained pending: %s", req.Context.ToolUseID)
		}
	}
}

func TestPlanBypassAutomaticallyDeniesWriteAndExecuteTools(t *testing.T) {
	s, events := approvalTestSession()
	s.planMode = true
	s.permissionMode = claudeagent.PermissionModePlan
	s.previousPermissionMode = claudeagent.PermissionModeBypassAll

	for _, req := range []claudeagent.ToolPermissionRequest{
		{ToolName: "Bash", Arguments: json.RawMessage(`{"command":"touch changed"}`), Context: claudeagent.PermissionContext{ToolUseID: "bash-1"}},
		{ToolName: "Edit", Arguments: json.RawMessage(`{"file_path":"README.md"}`), Context: claudeagent.PermissionContext{ToolUseID: "edit-1"}},
		{ToolName: "Write", Arguments: json.RawMessage(`{"file_path":"README.md"}`), Context: claudeagent.PermissionContext{ToolUseID: "write-1"}},
		{ToolName: "Agent", Arguments: json.RawMessage(`{"subagent_type":"general-purpose"}`), Context: claudeagent.PermissionContext{ToolUseID: "agent-1"}},
	} {
		if _, denied := s.handleCanUseTool(context.Background(), req).(claudeagent.PermissionDeny); !denied {
			t.Fatalf("%s must stay blocked by plan mode", req.ToolName)
		}
	}
	select {
	case event := <-events:
		t.Fatalf("automatic plan denials must not emit approval events: %#v", event)
	default:
	}
}

func TestAutomaticPermissionPreservesOtherModesAndPlanApproval(t *testing.T) {
	for _, mode := range []claudeagent.PermissionMode{claudeagent.PermissionModeDefault, claudeagent.PermissionModeBypassAll} {
		s := &session{permissionMode: mode, previousPermissionMode: mode}
		if _, handled := s.automaticToolPermission(approvalTestRequest("bash")); handled {
			t.Fatal("non-plan callbacks must retain native approval behavior")
		}
	}
	s := &session{planMode: true, permissionMode: claudeagent.PermissionModePlan, previousPermissionMode: claudeagent.PermissionModeDefault}
	if _, handled := s.automaticToolPermission(claudeagent.ToolPermissionRequest{ToolName: "Skill"}); handled {
		t.Fatal("ordinary plan permissions were changed")
	}
	s.previousPermissionMode = claudeagent.PermissionModeBypassAll
	if _, handled := s.automaticToolPermission(claudeagent.ToolPermissionRequest{ToolName: "ExitPlanMode"}); handled {
		t.Fatal("plan approval must still require a decision")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, denied := s.handleCanUseTool(ctx, claudeagent.ToolPermissionRequest{ToolName: "Read"}).(claudeagent.PermissionDeny); !denied {
		t.Fatal("canceled callback allowed a tool")
	}
}

func nextApprovalEvent(t *testing.T, events <-chan types.Event, eventType types.EventType, id, status string) types.ToolCall {
	t.Helper()
	select {
	case event := <-events:
		call, ok := event.Data.(types.ToolCall)
		if !ok || event.Type != eventType || call.CallID != id || call.Status != status {
			t.Fatalf("unexpected event: %#v", event)
		}
		return call
	case <-time.After(2 * time.Second):
		t.Fatalf("missing %s for %s", eventType, id)
		return types.ToolCall{}
	}
}

func TestApprovalAnswerCompletesOnlySyntheticQuestion(t *testing.T) {
	for _, answer := range []string{"允许本次执行", "拒绝执行", "请先检查路径"} {
		t.Run(answer, func(t *testing.T) {
			s, events := approvalTestSession()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			s.trackPendingToolCall(newRunningToolCall("bash", "Bash", "tool_use", json.RawMessage(`{"command":"claude --version"}`)))
			finished := make(chan claudeagent.PermissionResult, 1)
			go func() { finished <- s.awaitToolPermission(ctx, approvalTestRequest("bash")) }()
			nextApprovalEvent(t, events, types.EventTypeToolCall, "approval-bash", "running")
			if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: "approval-bash", Answers: map[string]string{"q_0": answer}}); err != nil {
				t.Fatal(err)
			}
			update := nextApprovalEvent(t, events, types.EventTypeToolUpdate, "approval-bash", "complete")
			if update.Meta["answers"].(map[string]string)["q_0"] != answer || update.Meta["answeredAt"] == nil {
				t.Fatalf("answer missing from resolved question: %#v", update)
			}
			select {
			case result := <-finished:
				_, allowed := result.(claudeagent.PermissionAllow)
				if allowed != (answer == "允许本次执行") {
					t.Fatalf("wrong permission result: %#v", result)
				}
			case <-ctx.Done():
				t.Fatal("permission callback did not finish")
			}
			if s.hasPendingToolCall("approval-bash") || !s.hasPendingToolCall("bash") {
				t.Fatal("approval must close independently of the actual Bash tool")
			}
			if answer == "允许本次执行" {
				id := "bash"
				result, ok := s.toolResultUpdate(claudeagent.UserMessage{ParentToolUseID: &id, ToolUseResult: map[string]any{"stdout": "2.1.270"}})
				if !ok || result.CallID != "bash" || result.Status != "complete" {
					t.Fatalf("real tool result was lost: %#v", result)
				}
			}
			if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: "approval-bash", Answers: map[string]string{"q_0": answer}}); err == nil {
				t.Fatal("duplicate answer was accepted")
			}
			select {
			case event := <-events:
				t.Fatalf("approval emitted more than one terminal update: %#v", event)
			default:
			}
		})
	}
}

func TestApprovalCancellationAndTimeoutResolveWaitingItem(t *testing.T) {
	for _, deadline := range []bool{false, true} {
		name := "canceled"
		if deadline {
			name = "timeout"
		}
		t.Run(name, func(t *testing.T) {
			s, events := approvalTestSession()
			var ctx context.Context
			var cancel context.CancelFunc
			if deadline {
				ctx, cancel = context.WithTimeout(context.Background(), 100*time.Millisecond)
			} else {
				ctx, cancel = context.WithCancel(context.Background())
			}
			defer cancel()
			finished := make(chan claudeagent.PermissionResult, 1)
			go func() { finished <- s.awaitToolPermission(ctx, approvalTestRequest("bash")) }()
			nextApprovalEvent(t, events, types.EventTypeToolCall, "approval-bash", "running")
			if !deadline {
				cancel()
			}
			update := nextApprovalEvent(t, events, types.EventTypeToolUpdate, "approval-bash", "failed")
			reason, hasReason := update.Meta["error"].(string)
			if update.Meta["canceled"] != true || !hasReason || reason == "" {
				t.Fatalf("missing cancellation diagnostic: %#v", update)
			}
			select {
			case result := <-finished:
				if _, denied := result.(claudeagent.PermissionDeny); !denied {
					t.Fatalf("cancellation allowed execution: %#v", result)
				}
			case <-time.After(time.Second):
				t.Fatal("canceled callback did not finish")
			}
			if s.hasPendingToolCall("approval-bash") {
				t.Fatal("canceled approval remains pending")
			}
			if err := s.AnswerQuestion(context.Background(), types.AskUserAnswer{ToolUseID: "approval-bash", Answers: map[string]string{"q_0": "允许本次执行"}}); err == nil {
				t.Fatal("expired approval admitted a late answer")
			}
		})
	}
}

func TestDuplicateApprovalDoesNotResolveOriginalQuestion(t *testing.T) {
	s, events := approvalTestSession()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	finished := make(chan claudeagent.PermissionResult, 1)
	go func() { finished <- s.awaitToolPermission(ctx, approvalTestRequest("same")) }()
	nextApprovalEvent(t, events, types.EventTypeToolCall, "approval-same", "running")
	if _, denied := s.awaitToolPermission(ctx, approvalTestRequest("same")).(claudeagent.PermissionDeny); !denied {
		t.Fatal("duplicate request was not rejected")
	}
	canceled, stop := context.WithCancel(context.Background())
	stop()
	if _, denied := s.awaitToolPermission(canceled, approvalTestRequest("same")).(claudeagent.PermissionDeny); !denied {
		t.Fatal("already canceled request was not rejected")
	}
	if !s.hasPendingToolCall("approval-same") {
		t.Fatal("duplicate request removed the original pending item")
	}
	select {
	case event := <-events:
		t.Fatalf("duplicate request emitted a terminal event: %#v", event)
	default:
	}
	if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: "approval-same", Answers: map[string]string{"q_0": "允许本次执行"}}); err != nil {
		t.Fatal(err)
	}
	nextApprovalEvent(t, events, types.EventTypeToolUpdate, "approval-same", "complete")
	select {
	case <-finished:
	case <-ctx.Done():
		t.Fatal("original permission callback did not finish")
	}
}

func TestCompletedApprovalDoesNotPoisonNativeQuestionFallback(t *testing.T) {
	s, events := approvalTestSession()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	approved := make(chan claudeagent.PermissionResult, 1)
	go func() { approved <- s.awaitToolPermission(ctx, approvalTestRequest("bash")) }()
	nextApprovalEvent(t, events, types.EventTypeToolCall, "approval-bash", "running")
	if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: "approval-bash", Answers: map[string]string{"q_0": "允许本次执行"}}); err != nil {
		t.Fatal(err)
	}
	nextApprovalEvent(t, events, types.EventTypeToolUpdate, "approval-bash", "complete")
	select {
	case <-approved:
	case <-ctx.Done():
		t.Fatal("approval did not finish")
	}
	answered := make(chan error, 1)
	go func() {
		_, err := s.awaitAskUserQuestion(ctx, claudeagent.QuestionSet{ToolUseID: "native-ask", Questions: []claudeagent.QuestionItem{{Question: "Choose"}}})
		answered <- err
	}()
	nextApprovalEvent(t, events, types.EventTypeToolCall, "native-ask", "running")
	if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: "native-ask", Answers: map[string]string{"q_0": "A"}}); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-answered:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("native question did not finish")
	}
	result, ok := s.toolResultUpdate(claudeagent.UserMessage{ToolUseResult: map[string]any{"answers": map[string]string{"Choose": "A"}}})
	if !ok || result.CallID != "native-ask" || result.Status != "complete" {
		t.Fatalf("stale approval broke the native question fallback: %#v", result)
	}
}

func TestApprovalTurnCancelAndSessionCloseEmitOneTerminalUpdate(t *testing.T) {
	for name, stop := range map[string]func(*session) error{
		"cancel turn":   (*session).CancelCurrentTurn,
		"close session": (*session).Close,
	} {
		t.Run(name, func(t *testing.T) {
			s, events := approvalTestSession()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			finished := make(chan claudeagent.PermissionResult, 1)
			go func() { finished <- s.awaitToolPermission(ctx, approvalTestRequest("bash")) }()
			nextApprovalEvent(t, events, types.EventTypeToolCall, "approval-bash", "running")
			if err := stop(s); err != nil {
				t.Fatal(err)
			}
			nextApprovalEvent(t, events, types.EventTypeToolUpdate, "approval-bash", "failed")
			select {
			case result := <-finished:
				if _, denied := result.(claudeagent.PermissionDeny); !denied {
					t.Fatalf("closed session allowed execution: %#v", result)
				}
			case <-ctx.Done():
				t.Fatal("permission callback did not stop")
			}
			if s.hasPendingToolCall("approval-bash") {
				t.Fatal("closed approval remains pending")
			}
			select {
			case event := <-events:
				t.Fatalf("duplicate terminal update: %#v", event)
			default:
			}
		})
	}
}
