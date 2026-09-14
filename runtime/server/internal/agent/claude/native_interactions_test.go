package claude

import (
	"context"
	"testing"
	"time"

	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"mindfs/server/internal/agent/types"
)

func TestNativeElicitationAndDialogRoundTrip(t *testing.T) {
	for _, dialog := range []bool{false, true} {
		s := &session{}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		events := make(chan types.Event, 4)
		s.OnUpdate(func(e types.Event) { events <- e })
		finished := make(chan any, 1)
		go func() {
			if dialog {
				r, err := s.handleUserDialog(ctx, claudeagent.UserDialogRequest{RequestID: "42", DialogKind: "refusal_fallback_prompt", Payload: map[string]any{"originalModel": "one", "fallbackModel": "two"}})
				if err != nil {
					finished <- err
				} else {
					finished <- r
				}
			} else {
				r, err := s.handleElicitation(ctx, claudeagent.ElicitationRequest{RequestID: "42", ServerName: "test", RequestedSchema: map[string]any{"type": "object", "required": []any{"flag"}, "properties": map[string]any{"flag": map[string]any{"type": "boolean"}}}})
				if err != nil {
					finished <- err
				} else {
					finished <- r
				}
			}
		}()
		select {
		case <-events:
		case <-ctx.Done():
			t.Fatal("no prompt")
		}
		answer := types.AskUserAnswer{ToolUseID: "claude-native-42", Answers: map[string]string{"q_0": "accept", "q_1": `{"flag":"wrong"}`}}
		if s.AnswerQuestion(ctx, answer) == nil {
			t.Fatal("invalid answer accepted")
		}
		if dialog {
			answer.Answers = map[string]string{"q_0": "retry_fallback"}
		} else {
			answer.Answers["q_1"] = `{"flag":false}`
		}
		if err := s.AnswerQuestion(ctx, answer); err != nil {
			t.Fatal(err)
		}
		select {
		case value := <-finished:
			if dialog {
				r, ok := value.(claudeagent.UserDialogResult)
				if !ok || r.Behavior != "completed" || r.Result != "retry_fallback" {
					t.Fatal(value)
				}
			} else {
				r, ok := value.(claudeagent.ElicitationResult)
				if !ok || r.Action != "accept" || r.Content["flag"] != false {
					t.Fatal(value)
				}
			}
		case <-ctx.Done():
			t.Fatal("no result")
		}
		update := <-events
		if update.Type != types.EventTypeToolUpdate || update.Data.(types.ToolCall).Status != "complete" {
			t.Fatal("prompt lifecycle incomplete")
		}
		cancel()
	}
	s := &session{}
	r, err := s.handleUserDialog(context.Background(), claudeagent.UserDialogRequest{DialogKind: "future-kind"})
	if err != nil || r.Behavior != "cancelled" {
		t.Fatal("unknown dialog must cancel")
	}
}

func TestNativeElicitationCancellationClosesPrompt(t *testing.T) {
	s := &session{}
	ctx, cancel := context.WithCancel(context.Background())
	events := make(chan types.Event, 4)
	s.OnUpdate(func(e types.Event) { events <- e })
	done := make(chan error, 1)
	go func() {
		_, err := s.handleElicitation(ctx, claudeagent.ElicitationRequest{RequestID: "cancel", Mode: "url", URL: "https://example.com"})
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
	if s.AnswerQuestion(context.Background(), types.AskUserAnswer{ToolUseID: "claude-native-cancel", Answers: map[string]string{"q_0": "accept"}}) == nil {
		t.Fatal("stale prompt accepted")
	}
	update := <-events
	if update.Data.(types.ToolCall).Status == "running" {
		t.Fatal("prompt still running")
	}
}
