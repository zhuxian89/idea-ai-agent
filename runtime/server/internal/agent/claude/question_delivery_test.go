package claude

import (
	"context"
	"encoding/json"
	"errors"
	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"mindfs/server/internal/agent/types"
	"testing"
	"time"
)

func TestCanceledNativeQuestionRejectsAnswerBeforeCallbackReturns(t *testing.T) {
	s := &session{}
	requestCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	emitting := make(chan struct{})
	release := make(chan struct{})
	s.OnUpdate(func(types.Event) { close(emitting); <-release })
	finished := make(chan error, 1)
	go func() {
		_, err := s.awaitAskUserQuestion(requestCtx, claudeagent.QuestionSet{ToolUseID: "ask", Questions: []claudeagent.QuestionItem{{Question: "Choose"}}})
		finished <- err
	}()
	select {
	case <-emitting:
	case <-time.After(time.Second):
		t.Fatal("question not emitted")
	}
	cancel()
	answerErr := s.AnswerQuestion(context.Background(), types.AskUserAnswer{ToolUseID: "ask", Answers: map[string]string{"q_0": "A"}})
	close(release)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("question did not finish")
	}
	if !errors.Is(answerErr, context.Canceled) {
		t.Fatalf("canceled native request admitted answer: %v", answerErr)
	}
}

func TestAnswerQuestionConsumedOnlyOnce(t *testing.T) {
	s := &session{questionWaits: map[string]*types.PendingQuestion[claudeagent.Answers]{"question": types.NewPendingQuestion[claudeagent.Answers](context.Background())}}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	answer := types.AskUserAnswer{ToolUseID: "question", Answers: map[string]string{"q_0": "A"}}
	if err := s.AnswerQuestion(ctx, answer); err != nil {
		t.Fatal(err)
	}
	if err := s.AnswerQuestion(ctx, answer); err == nil || errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("duplicate should reject immediately: %v", err)
	}
}

func TestNativeMultipleQuestionsPreserveAnswers(t *testing.T) {
	s := &session{}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	prompt := make(chan types.ToolCall, 1)
	s.OnUpdate(func(event types.Event) {
		if call, ok := event.Data.(types.ToolCall); ok {
			prompt <- call
		}
	})
	finished := make(chan claudeagent.PermissionResult, 1)
	go func() {
		finished <- s.handleCanUseTool(ctx, claudeagent.ToolPermissionRequest{
			ToolName: "AskUserQuestion", Context: claudeagent.PermissionContext{ToolUseID: "ask"},
			Arguments: json.RawMessage(`{"questions":[{"question":"Select features","multiSelect":true,"options":[{"label":"A"},{"label":"B"}]},{"question":"Details"}]}`),
		})
	}()
	select {
	case call := <-prompt:
		if !call.Meta["questions"].([]types.AskUserQuestionItem)[0].MultiSelect {
			t.Fatal("multi-select lost")
		}
	case <-ctx.Done():
		t.Fatal("no question")
	}
	if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: "ask", Answers: map[string]string{"q_0": "A, B", "q_1": "自定义方案😀"}}); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-finished:
		allow, ok := result.(claudeagent.PermissionAllow)
		if !ok {
			t.Fatalf("answer rejected: %T", result)
		}
		answers := allow.UpdatedInput["answers"].(map[string]string)
		if answers["Select features"] != "A, B" || answers["Details"] != "自定义方案😀" {
			t.Fatalf("native answers changed: %v", answers)
		}
	case <-ctx.Done():
		t.Fatal("answer did not reach native permission response")
	}
}
