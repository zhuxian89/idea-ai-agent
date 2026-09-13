package session

import (
	"context"
	"errors"
	agenttypes "mindfs/server/internal/agent/types"
	"testing"
	"time"
)

func TestAnswerAdmissionFailurePreservesPendingQuestion(t *testing.T) {
	m := &Manager{pendingToolCalls: map[string]map[string]agenttypes.ToolCall{"session": {"ask": {CallID: "ask", Kind: agenttypes.ToolKindAskUser, Status: "running"}}}}
	expired := errors.New("runtime waiter expired")
	if err := m.AcceptPendingAskUserAnswer(context.Background(), "session", "ask", map[string]string{"q_0": "A"}, time.Now(), func() error { return expired }); !errors.Is(err, expired) {
		t.Fatal(err)
	}
	call := m.pendingToolCalls["session"]["ask"]
	if call.Status != "running" || call.Meta["answers"] != nil {
		t.Fatalf("rejected answer persisted: %#v", call)
	}
	accepted := 0
	admit := func() error { accepted++; return nil }
	if err := m.AcceptPendingAskUserAnswer(context.Background(), "session", "ask", map[string]string{"q_0": "B"}, time.Now(), admit); err != nil {
		t.Fatal(err)
	}
	if err := m.AcceptPendingAskUserAnswer(context.Background(), "session", "ask", map[string]string{"q_0": "C"}, time.Now(), admit); err == nil {
		t.Fatal("duplicate accepted")
	}
	if accepted != 1 || m.pendingToolCalls["session"]["ask"].Status != "complete" {
		t.Fatal("answer not committed exactly once")
	}
}
