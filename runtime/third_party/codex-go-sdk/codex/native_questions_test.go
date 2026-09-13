package codex

import (
	"context"
	"encoding/json"
	"github.com/fanwenlin/codex-go-sdk/types"
	"testing"
	"time"
)

func TestPendingQuestionDoesNotBlockTurnCompletion(t *testing.T) {
	a := NewAppServerExec("", nil, nil, types.ClientInfo{}, "", "")
	a.stdin = &captureWriteCloser{}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	questionStarted := make(chan struct{})
	questionStopped := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		finished <- a.streamTurn(ctx, "thread", "turn", CodexExecArgs{AskUserHandler: func(req types.AskUserRequest) (types.AskUserResponse, error) {
			close(questionStarted)
			<-req.Context.Done()
			close(questionStopped)
			return types.AskUserResponse{}, req.Context.Err()
		}}, make(chan ExecResult, 8))
	}()
	waitForSubscribers(t, a, 1)
	requestID := int64(17)
	a.dispatchEvent(appEvent{ID: &requestID, Method: "item/tool/requestUserInput", Params: json.RawMessage(`{"threadId":"thread","turnId":"turn","itemId":"question","questions":[{"id":"q","question":"Choose"}]}`)})
	select {
	case <-questionStarted:
	case <-ctx.Done():
		t.Fatal("question did not start")
	}
	a.dispatchEvent(appEvent{Method: "turn/completed", Params: json.RawMessage(`{"threadId":"thread","turnId":"turn"}`)})
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("question blocked event dispatch")
	}
	select {
	case <-questionStopped:
	default:
		t.Fatal("question callback outlived turn")
	}
}
