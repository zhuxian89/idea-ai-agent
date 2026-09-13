package codex

import (
	"context"
	"errors"
	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
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
		_, err := s.handleAskUserRequest(codexsdk.AskUserRequest{Context: requestCtx, ItemID: "ask", Questions: []codexsdk.AskUserQuestion{{ID: "q", Question: "Choose"}}})
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
	s := &session{questionWaits: map[string]*types.PendingQuestion[map[string]string]{"question": types.NewPendingQuestion[map[string]string](context.Background())}}
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

func TestNativeQuestionsRoundTripAndCancel(t *testing.T) {
	for _, cancelTurn := range []bool{false, true} {
		s := &session{}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		prompt := make(chan types.Event, 1)
		s.OnUpdate(func(event types.Event) { prompt <- event })
		finished := make(chan error, 1)
		go func() {
			response, err := s.handleAskUserRequest(codexsdk.AskUserRequest{Context: ctx, ItemID: "ask", Questions: []codexsdk.AskUserQuestion{{ID: "strategy", Question: "Choose a strategy"}, {ID: "details", Question: "Details"}}})
			if !cancelTurn && err == nil && (response.Answers["strategy"].Answers[0] != "B" || response.Answers["details"].Answers[0] != "自定义方案😀") {
				err = errors.New("answers lost their native question IDs or content")
			}
			finished <- err
		}()
		select {
		case <-prompt:
		case <-ctx.Done():
			t.Fatal("no question")
		}
		if cancelTurn {
			s.cancelPendingQuestions(errors.New("turn canceled"))
		} else {
			if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: "ask", Answers: map[string]string{"q_0": "B", "q_1": "自定义方案😀"}}); err != nil {
				t.Fatal(err)
			}
		}
		select {
		case err := <-finished:
			if (err != nil) != cancelTurn {
				t.Fatalf("cancel=%v: %v", cancelTurn, err)
			}
		case <-ctx.Done():
			t.Fatal("question waiter leaked")
		}
		cancel()
	}
}
