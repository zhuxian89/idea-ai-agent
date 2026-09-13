package session

import (
	"context"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
)

func TestPendingQuestionSummaryKeepsOtherQuestions(t *testing.T) {
	ctx := context.Background()
	m := &Manager{}
	for _, id := range []string{"approval-one", "approval-two"} {
		call := agenttypes.ToolCall{CallID: id, Kind: agenttypes.ToolKindAskUser, Status: "running"}
		if err := m.UpsertPendingExchangeAux(ctx, "session", ExchangeAux{ToolCall: &call}); err != nil {
			t.Fatal(err)
		}
	}
	if !m.HasPendingAskUserQuestions(ctx, "session") {
		t.Fatal("pending questions were not detected")
	}
	if err := m.MarkPendingAskUserAnswered(ctx, "session", "approval-one", map[string]string{"q_0": "允许本次执行"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if !m.HasPendingAskUserQuestions(ctx, "session") {
		t.Fatal("answering one question cleared another question's waiting state")
	}
	if err := m.MarkPendingAskUserAnswered(ctx, "session", "approval-two", map[string]string{"q_0": "拒绝执行"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if m.HasPendingAskUserQuestions(ctx, "session") {
		t.Fatal("answered questions remain waiting")
	}
}

func TestPendingQuestionSummaryIgnoresTerminalQuestionsAndRealTools(t *testing.T) {
	for _, status := range []string{"complete", "completed", "failed", "canceled", "cancelled"} {
		t.Run(status, func(t *testing.T) {
			m := &Manager{pendingToolCalls: map[string]map[string]agenttypes.ToolCall{"session": {
				"approval": {CallID: "approval", Kind: agenttypes.ToolKindAskUser, Status: status},
				"bash":     {CallID: "bash", Kind: agenttypes.ToolKindExecute, Status: "running"},
			}}}
			if m.HasPendingAskUserQuestions(context.Background(), "session") {
				t.Fatal("terminal question or executing tool was treated as waiting for an answer")
			}
		})
	}
}

func TestPendingQuestionSummaryRecognizesRunningStates(t *testing.T) {
	for _, status := range []string{"", "running", "pending", "in_progress"} {
		m := &Manager{pendingToolCalls: map[string]map[string]agenttypes.ToolCall{"session": {
			"ask": {CallID: "ask", Kind: agenttypes.ToolKindAskUser, Status: status},
		}}}
		if !m.HasPendingAskUserQuestions(context.Background(), "session") {
			t.Fatalf("missed pending question status %q", status)
		}
		if m.HasPendingAskUserQuestions(context.Background(), "other") {
			t.Fatal("questions leaked into a different session")
		}
	}
}
