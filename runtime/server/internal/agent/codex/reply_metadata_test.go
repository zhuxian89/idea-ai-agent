package codex

import (
	"context"
	"encoding/json"
	"testing"

	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
	agenttypes "mindfs/server/internal/agent/types"
)

func TestStreamedContextDoesNotLeakIntoNextTurn(t *testing.T) {
	s := &session{}
	var replies []agenttypes.ContextWindow
	s.OnUpdate(func(event agenttypes.Event) {
		if event.Type == agenttypes.EventTypeMessageDone {
			replies = append(replies, event.Data.(agenttypes.MessageDone).ContextWindow)
		}
	})
	events := make(chan codexsdk.ThreadEvent, 5)
	events <- &codexsdk.TurnStartedEvent{}
	events <- &codexsdk.RawEvent{Type: "thread.tokenUsage.updated", Raw: json.RawMessage(`{"tokenUsage":{"last":{"totalTokens":109000},"modelContextWindow":258000}}`)}
	events <- &codexsdk.TurnCompletedEvent{}
	events <- &codexsdk.TurnStartedEvent{}
	events <- &codexsdk.TurnCompletedEvent{}
	close(events)
	if err := s.handleStreamedEvents(context.Background(), events, &asyncQuestionPause{}); err != nil {
		t.Fatal(err)
	}
	if len(replies) != 2 || replies[0].TotalTokens != 109000 || replies[0].ModelContextWindow != 258000 || replies[1] != (agenttypes.ContextWindow{}) {
		t.Fatalf("unexpected per-turn Context: %#v", replies)
	}
}

func TestContextWindowUsesLastRequestNotCumulativeUsage(t *testing.T) {
	for _, sample := range []struct {
		raw   string
		valid bool
		used  int
	}{
		{`{"tokenUsage":{"last":{"totalTokens":109000},"total":{"totalTokens":9000000},"modelContextWindow":258000}}`, true, 109000},
		{`{"raw":{"tokenUsage":{"last":{"totalTokens":55000},"modelContextWindow":258000}}}`, true, 55000},
		{`{"tokenUsage":{"last":{"totalTokens":0},"total":{"totalTokens":9000000},"modelContextWindow":258000}}`, true, 0},
		{`{"tokenUsage":{"total":{"totalTokens":9000000},"modelContextWindow":258000}}`, false, 0},
		{`{"tokenUsage":{"last":{"totalTokens":-1},"modelContextWindow":258000}}`, false, 0},
	} {
		got, ok := parseContextWindow(json.RawMessage(sample.raw))
		if ok != sample.valid || (ok && got.TotalTokens != sample.used) {
			t.Fatalf("parse %s: %#v %v", sample.raw, got, ok)
		}
	}
}
