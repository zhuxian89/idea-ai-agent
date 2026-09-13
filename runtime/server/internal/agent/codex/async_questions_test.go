package codex

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
	"mindfs/server/internal/agent/types"
)

// This is the native agentMessage shape emitted by request_user_input_async.
const asyncQuestionEvent = `{"type":"item.completed","threadId":"thread-1","turnId":"turn-1","item":{"type":"agentMessage","id":"choice-1","delivery":"async","text":"Choose a layout","questions":[{"title":"Choose a layout","options":["List","Tabs"]},{"title":"Extra details","options":null}]}}`

type asyncQuestionExec struct {
	mu           sync.Mutex
	runs         []codexsdk.CodexExecArgs
	interrupted  chan struct{}
	once         sync.Once
	interruptErr error
}

func (e *asyncQuestionExec) Run(args codexsdk.CodexExecArgs) <-chan codexsdk.ExecResult {
	e.mu.Lock()
	e.runs = append(e.runs, args)
	first := len(e.runs) == 1
	e.mu.Unlock()
	out := make(chan codexsdk.ExecResult, 5)
	go func() {
		defer close(out)
		out <- codexsdk.ExecResult{Line: `{"type":"thread.started","threadId":"thread-1"}`}
		if first {
			out <- codexsdk.ExecResult{Line: asyncQuestionEvent}
			select {
			case <-e.interrupted:
				// A repeated completion must not create another question.
				out <- codexsdk.ExecResult{Line: asyncQuestionEvent}
			case <-args.Context.Done():
			}
		} else {
			out <- codexsdk.ExecResult{Line: `{"type":"item.completed","item":{"type":"agentMessage","id":"answer","text":"Using the selected layout"}}`}
		}
		out <- codexsdk.ExecResult{Line: `{"type":"turn.completed"}`}
	}()
	return out
}

func (e *asyncQuestionExec) RPCCall(_ context.Context, method string, params interface{}) (json.RawMessage, error) {
	if method != "turn/interrupt" {
		return nil, errors.New("unexpected RPC: " + method)
	}
	p, _ := params.(map[string]any)
	if p["threadId"] != "thread-1" || p["turnId"] != "turn-1" {
		return nil, errors.New("interrupted the wrong native turn")
	}
	if e.interruptErr != nil {
		return nil, e.interruptErr
	}
	e.once.Do(func() { close(e.interrupted) })
	return json.RawMessage(`{}`), nil
}

func (e *asyncQuestionExec) requests() []codexsdk.CodexExecArgs {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]codexsdk.CodexExecArgs(nil), e.runs...)
}

func TestAsyncQuestionPausesUntilExplicitAnswer(t *testing.T) {
	exec := &asyncQuestionExec{interrupted: make(chan struct{})}
	client := codexsdk.NewCodexWithExec(exec, codexsdk.CodexOptions{})
	s := &session{client: client, thread: client.ResumeThread("thread-1", codexsdk.ThreadOptions{}), threadID: "thread-1"}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	updates := make(chan types.Event, 20)
	s.OnUpdate(func(event types.Event) { updates <- event })
	done := make(chan error, 1)
	go func() { done <- s.SendMessage(ctx, "Help me choose") }()
	select {
	case event := <-updates:
		if call, ok := event.Data.(types.ToolCall); !ok || call.Kind != types.ToolKindAskUser || call.Status != "running" {
			t.Fatalf("expected an actionable pending question, got %#v", event)
		}
	case <-ctx.Done():
		t.Fatal("async question was never surfaced")
	}
	select {
	case err := <-done:
		t.Fatalf("continued before the user answered: %v", err)
	case event := <-updates:
		t.Fatalf("unexpected activity while waiting: %#v", event)
	case <-time.After(50 * time.Millisecond):
	}
	if len(exec.requests()) != 1 {
		t.Fatal("started a new native turn without an answer")
	}
	if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: "choice-1", Answers: map[string]string{"q_0": "Tabs"}}); err == nil {
		t.Fatal("accepted a partial answer and skipped a required question")
	}
	if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: "choice-1", Answers: map[string]string{"q_0": "Tabs", "q_1": "保留运行状态😀"}}); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("did not resume after the answer")
	}
	requests := exec.requests()
	if len(requests) != 2 {
		t.Fatalf("native turns = %d", len(requests))
	}
	var response struct {
		Answers []struct {
			Question string `json:"question"`
			Answer   string `json:"answer"`
		} `json:"answers"`
	}
	if err := json.Unmarshal([]byte(requests[1].Input), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Answers) != 2 || response.Answers[0].Answer != "Tabs" || response.Answers[1].Answer != "保留运行状态😀" {
		t.Fatalf("lost explicit answers: %s", requests[1].Input)
	}
	if requests[1].ThreadId == nil || *requests[1].ThreadId != "thread-1" {
		t.Fatal("resumed another native thread")
	}
}

func TestAsyncQuestionCancellationNeverResumesWithDefault(t *testing.T) {
	exec := &asyncQuestionExec{interrupted: make(chan struct{})}
	client := codexsdk.NewCodexWithExec(exec, codexsdk.CodexOptions{})
	s := &session{client: client, thread: client.ResumeThread("thread-1", codexsdk.ThreadOptions{}), threadID: "thread-1"}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	question := make(chan struct{}, 1)
	s.OnUpdate(func(event types.Event) {
		if call, ok := event.Data.(types.ToolCall); ok && call.Kind == types.ToolKindAskUser {
			question <- struct{}{}
		}
	})
	done := make(chan error, 1)
	go func() { done <- s.SendMessage(ctx, "Choose") }()
	select {
	case <-question:
	case <-ctx.Done():
		t.Fatal("no pending question")
	}
	if err := s.CancelCurrentTurn(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancel must not count as an answer")
		}
	case <-ctx.Done():
		t.Fatal("canceled question leaked")
	}
	if len(exec.requests()) != 1 {
		t.Fatal("resumed after cancellation")
	}
	if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: "choice-1", Answers: map[string]string{"q_0": "List"}}); err == nil {
		t.Fatal("accepted an expired question")
	}
}

func TestAsyncQuestionInterruptFailureDoesNotResume(t *testing.T) {
	exec := &asyncQuestionExec{interrupted: make(chan struct{}), interruptErr: errors.New("native pause refused")}
	client := codexsdk.NewCodexWithExec(exec, codexsdk.CodexOptions{})
	s := &session{client: client, thread: client.ResumeThread("thread-1", codexsdk.ThreadOptions{}), threadID: "thread-1"}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := s.SendMessage(ctx, "Choose"); !errors.Is(err, exec.interruptErr) {
		t.Fatalf("lost interruption failure: %v", err)
	}
	if len(exec.requests()) != 1 {
		t.Fatal("resumed despite failed pause")
	}
}
