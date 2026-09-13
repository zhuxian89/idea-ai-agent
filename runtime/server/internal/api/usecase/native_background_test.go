package usecase

import (
	"context"
	agenttypes "mindfs/server/internal/agent/types"
	rootfs "mindfs/server/internal/fs"
	"mindfs/server/internal/session"
	"testing"
	"time"
)

type backgroundCallbackSession struct {
	agenttypes.Session
	callback func(agenttypes.Event)
}

func (s *backgroundCallbackSession) OnUpdate(callback func(agenttypes.Event)) { s.callback = callback }
func (*backgroundCallbackSession) SessionID() string                          { return "native-child" }

func TestNativeBackgroundCompletionWaitsForCallbacksAndIgnoresLateEvents(t *testing.T) {
	ctx := context.Background()
	manager := session.NewManager(rootfs.NewRootInfo("root", "root", t.TempDir()))
	t.Cleanup(func() { _ = manager.Shutdown() })
	child, err := manager.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: "codex", Name: "child"})
	if err != nil {
		t.Fatal(err)
	}
	runtime := &backgroundCallbackSession{}
	started, release := make(chan struct{}), make(chan struct{})
	finish := attachBackgroundSessionUpdates(ctx, subagentSessionInput{RootID: "root", Agent: "codex", Manager: manager, OnUpdate: func(_ string, event agenttypes.Event) {
		if call, ok := event.Data.(agenttypes.ToolCall); ok && call.CallID == "active" {
			close(started)
			<-release
		}
	}}, child, runtime)
	callbackDone := make(chan struct{})
	go func() {
		runtime.callback(agenttypes.Event{Type: agenttypes.EventTypeToolCall, Data: agenttypes.ToolCall{CallID: "active", Kind: agenttypes.ToolKindAskUser, Status: "running"}})
		close(callbackDone)
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("callback did not start")
	}
	finished := make(chan struct{})
	go func() { finish(); close(finished) }()
	finishedEarly := false
	select {
	case <-finished:
		finishedEarly = true
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	select {
	case <-callbackDone:
	case <-time.After(time.Second):
		t.Fatal("callback deadlocked")
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("completion deadlocked")
	}
	if finishedEarly {
		t.Error("background turn persisted while its callback was active")
	}
	runtime.callback(agenttypes.Event{Type: agenttypes.EventTypeToolCall, Data: agenttypes.ToolCall{CallID: "late", Kind: agenttypes.ToolKindAskUser, Status: "running"}})
	if _, err := manager.GetFullToolCall(ctx, child.Key, "late"); err == nil {
		t.Error("late callback recreated pending state after completion")
	}
}
