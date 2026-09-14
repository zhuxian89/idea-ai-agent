package codex

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
	"mindfs/server/internal/agent/types"
)

func TestNativeElicitationInvalidAnswerCanRetry(t *testing.T) {
	s := &session{}
	events := make(chan types.Event, 4)
	s.OnUpdate(func(e types.Event) { events <- e })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result := make(chan any, 1)
	go func() {
		r, err := s.handleNativeRequest(codexsdk.ServerRequest{Context: ctx, ID: 41, Method: "mcpServer/elicitation/request", Params: json.RawMessage(`{"serverName":"test","mode":"form","requestedSchema":{"type":"object","required":["count"],"properties":{"count":{"type":"integer"}}}}`)})
		if err != nil {
			result <- err
		} else {
			result <- r
		}
	}()
	select {
	case <-events:
	case <-ctx.Done():
		t.Fatal("no prompt")
	}
	answer := types.AskUserAnswer{ToolUseID: "codex-native-41", Answers: map[string]string{"q_0": "accept", "q_1": `{"count":"wrong"}`}}
	if s.AnswerQuestion(ctx, answer) == nil {
		t.Fatal("invalid answer accepted")
	}
	answer.Answers["q_1"] = `{"count":3}`
	if err := s.AnswerQuestion(ctx, answer); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-result:
		m, ok := r.(map[string]any)
		if !ok || m["content"].(map[string]any)["count"] != float64(3) {
			t.Fatalf("result: %#v", r)
		}
	case <-ctx.Done():
		t.Fatal("no response")
	}
	update := <-events
	if update.Type != types.EventTypeToolUpdate || update.Data.(types.ToolCall).Status != "complete" {
		t.Fatal("synthetic prompt not completed")
	}
	if err := s.AnswerQuestion(ctx, answer); err == nil {
		t.Fatal("duplicate admitted")
	}
}

func TestNativePermissionCancellationClosesPrompt(t *testing.T) {
	s := &session{}
	ctx, cancel := context.WithCancel(context.Background())
	events := make(chan types.Event, 4)
	s.OnUpdate(func(e types.Event) { events <- e })
	done := make(chan error, 1)
	go func() {
		_, err := s.handleNativeRequest(codexsdk.ServerRequest{Context: ctx, ID: 42, Method: "item/permissions/requestApproval", Params: json.RawMessage(`{"permissions":{"network":{"enabled":true}}}`)})
		done <- err
	}()
	select {
	case <-events:
	case <-time.After(time.Second):
		t.Fatal("no prompt")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancellation ignored")
		}
	case <-time.After(time.Second):
		t.Fatal("waiter leaked")
	}
	if s.AnswerQuestion(context.Background(), types.AskUserAnswer{ToolUseID: "codex-native-42", Answers: map[string]string{"q_0": "allow_session"}}) == nil {
		t.Fatal("stale prompt accepted")
	}
	update := <-events
	if update.Data.(types.ToolCall).Status == "running" {
		t.Fatal("prompt still running")
	}
}
