package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fanwenlin/codex-go-sdk/types"
)

func TestNativeBacklogPreservesOrderAndCriticalEvents(t *testing.T) {
	a := NewAppServerExec("", nil, nil, types.ClientInfo{}, "", "")
	slow, fast := a.subscribe(), a.subscribe()
	defer a.unsubscribe(slow)
	defer a.unsubscribe(fast)
	const count = 2048
	fastDone := make(chan struct{})
	go func() {
		defer close(fastDone)
		for i := 0; i < count+2; i++ {
			<-fast
		}
	}()
	for i := 0; i < count; i++ {
		a.dispatchEvent(appEvent{Method: fmt.Sprint(i)})
	}
	id := int64(73)
	a.dispatchEvent(appEvent{ID: &id, Method: "mcpServer/elicitation/request", Params: json.RawMessage(`{"threadId":"thread"}`)})
	a.dispatchEvent(appEvent{Method: "turn/completed"})
	select {
	case <-fastDone:
	case <-time.After(time.Second):
		t.Fatal("slow subscriber blocked fast one")
	}
	for i := 0; i < count+2; i++ {
		select {
		case e := <-slow:
			want := fmt.Sprint(i)
			if i == count {
				want = "mcpServer/elicitation/request"
			}
			if i == count+1 {
				want = "turn/completed"
			}
			if e.Method != want {
				t.Fatalf("event %d: %s, want %s", i, e.Method, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("lost event %d", i)
		}
	}
	a.closeSubscribers()
}

func TestNativeUnsubscribeReleasesBlockedQueue(t *testing.T) {
	s := newAppEventSubscription()
	for i := 0; i < 4096; i++ {
		s.enqueue(appEvent{Method: "delta"})
	}
	s.stop()
	s.stop()
	s.enqueue(appEvent{Method: "ignored"})
	deadline := time.After(time.Second)
	for {
		select {
		case _, ok := <-s.out:
			if !ok {
				s.mu.Lock()
				defer s.mu.Unlock()
				if len(s.pending) != 0 {
					t.Fatal("retained queue")
				}
				return
			}
		case <-deadline:
			t.Fatal("worker leaked")
		}
	}
}

func TestNativeRequestsKeepIDRouteWithoutTurnAndCancel(t *testing.T) {
	a := NewAppServerExec("", nil, nil, types.ClientInfo{}, "", "")
	writer := &captureWriteCloser{}
	a.stdin = writer
	first, second := a.subscribe(), a.subscribe()
	defer a.unsubscribe(first)
	defer a.unsubscribe(second)
	id := int64(91)
	a.dispatchEvent(appEvent{ID: &id, Method: "mcpServer/elicitation/request", Params: json.RawMessage(`{"threadId":"thread","mode":"url"}`)})
	e1, e2 := <-first, <-second
	if !eventMatchesTurn(e1, "thread", "turn") || eventMatchesTurn(e1, "other", "turn") {
		t.Fatal("incorrect thread-only routing")
	}
	state := &turnState{}
	var calls atomic.Int32
	handler := func(req types.ServerRequest) (any, error) {
		calls.Add(1)
		if req.ID != id || req.Method != e1.Method {
			t.Error("lost request identity")
		}
		return map[string]any{"action": "accept", "content": nil}, nil
	}
	args := CodexExecArgs{ServerRequestHandler: handler}
	out := make(chan ExecResult, 8)
	a.handleTurnEvent(context.Background(), e1, "thread", "turn", args, state, out)
	a.handleTurnEvent(context.Background(), e2, "thread", "turn", args, state, out)
	state.requests.Wait()
	if calls.Load() != 1 {
		t.Fatalf("duplicate requests: %d", calls.Load())
	}
	var reply map[string]any
	if err := json.Unmarshal(writer.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	if reply["id"] != float64(id) || reply["result"].(map[string]any)["action"] != "accept" {
		t.Fatal(reply)
	}
	// Server retirement must cancel a pending callback, even without a turn id.
	id = 92
	a.dispatchEvent(appEvent{ID: &id, Method: "mcpServer/elicitation/request", Params: json.RawMessage(`{"threadId":"thread"}`)})
	event := <-first
	started, stopped := make(chan struct{}), make(chan struct{})
	args.ServerRequestHandler = func(req types.ServerRequest) (any, error) {
		close(started)
		<-req.Context.Done()
		close(stopped)
		return nil, req.Context.Err()
	}
	a.handleTurnEvent(context.Background(), event, "thread", "turn", args, state, out)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("handler not started")
	}
	a.dispatchEvent(appEvent{Method: "serverRequest/resolved", Params: json.RawMessage(`{"threadId":"thread","requestId":92}`)})
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("retired request still pending")
	}
	state.requests.Wait()
}

// Emit a full turn before replying to turn/start, as a fast local server can.
type earlyTurnWriter struct{ a *AppServerExec }

func (w *earlyTurnWriter) Close() error { return nil }
func (w *earlyTurnWriter) Write(data []byte) (int, error) {
	var req rpcEnvelope
	if err := json.Unmarshal(data, &req); err != nil {
		return 0, err
	}
	if req.Method == "turn/start" {
		w.a.handleLine(`{"method":"item/agentMessage/delta","params":{"threadId":"thread","turnId":"turn","itemId":"message","delta":"early"}}`)
		w.a.handleLine(`{"method":"turn/completed","params":{"threadId":"thread","turn":{"id":"turn","status":"completed"}}}`)
		w.a.handleLine(fmt.Sprintf(`{"id":%d,"result":{"turn":{"id":"turn"}}}`, *req.ID))
	}
	return len(data), nil
}

func TestNativeTurnSubscribesBeforeStartReply(t *testing.T) {
	a := NewAppServerExec("", nil, nil, types.ClientInfo{}, "", "")
	a.startOnce.Do(func() {})
	a.stdin = &earlyTurnWriter{a: a}
	a.knownThreads["thread"] = struct{}{}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	id := "thread"
	output := make(chan ExecResult, 8)
	if err := a.runTurn(CodexExecArgs{Context: ctx, ThreadId: &id}, output); err != nil {
		t.Fatal(err)
	}
	if len(output) != 2 {
		t.Fatalf("lost early events: %d", len(output))
	}
}

func TestNativeTurnCompletionCancelsOutstandingInteraction(t *testing.T) {
	a := NewAppServerExec("", nil, nil, types.ClientInfo{}, "", "")
	a.stdin = &captureWriteCloser{}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	started, stopped := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- a.streamTurn(ctx, "thread", "turn", CodexExecArgs{ServerRequestHandler: func(req types.ServerRequest) (any, error) {
			close(started)
			<-req.Context.Done()
			close(stopped)
			return nil, req.Context.Err()
		}}, make(chan ExecResult, 8))
	}()
	waitForSubscribers(t, a, 1)
	id := int64(93)
	a.dispatchEvent(appEvent{ID: &id, Method: "item/permissions/requestApproval", Params: json.RawMessage(`{"threadId":"thread","turnId":"turn"}`)})
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("not started")
	}
	a.dispatchEvent(appEvent{Method: "turn/completed", Params: json.RawMessage(`{"threadId":"thread","turnId":"turn"}`)})
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("turn stuck")
	}
	select {
	case <-stopped:
	default:
		t.Fatal("callback leaked")
	}
}

func TestNativeDuplicateSubscriberDoesNotWaitForRequestOwner(t *testing.T) {
	a := NewAppServerExec("", nil, nil, types.ClientInfo{}, "", "")
	a.stdin = &captureWriteCloser{}
	sub := a.subscribe()
	defer a.unsubscribe(sub)
	id := int64(101)
	a.dispatchEvent(appEvent{ID: &id, Method: "mcpServer/elicitation/request", Params: json.RawMessage(`{"threadId":"thread"}`)})
	event := <-sub
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started, ownerDone := make(chan struct{}), make(chan struct{})
	handler := func(req types.ServerRequest) (any, error) {
		close(started)
		<-req.Context.Done()
		return nil, req.Context.Err()
	}
	go func() { defer close(ownerDone); a.submitServerResponse(ctx, event, handler) }()
	<-started
	duplicateDone := make(chan struct{})
	go func() { defer close(duplicateDone); a.submitServerResponse(context.Background(), event, handler) }()
	select {
	case <-duplicateDone:
	case <-time.After(time.Second):
		t.Fatal("duplicate subscriber blocked on request owner")
	}
	cancel()
	select {
	case <-ownerDone:
	case <-time.After(time.Second):
		t.Fatal("owner leaked")
	}
}
