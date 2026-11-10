package usecase

import (
	"context"
	"errors"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
)

// stopperSession embeds the interface so only the methods under test need to exist.
type stopperSession struct {
	agenttypes.Session
	stopped []string
	err     error
}

func (s *stopperSession) StopTask(_ context.Context, ref string) error {
	s.stopped = append(s.stopped, ref)
	return s.err
}

type plainSession struct{ agenttypes.Session }

func registerTestTurn(t *testing.T, rootID, key string, sess agenttypes.Session) {
	t.Helper()
	registerActiveTurn(rootID, key, func() {})
	setActiveTurnSession(rootID, key, sess)
	t.Cleanup(func() { unregisterActiveTurn(rootID, key) })
}

func TestStopSessionTaskStopsOnlyTheTaskAndKeepsTheTurn(t *testing.T) {
	sess := &stopperSession{}
	registerTestTurn(t, "root", "parent", sess)

	err := (&Service{}).StopSessionTask(context.Background(), StopSessionTaskInput{RootID: "root", Key: "parent", TaskRef: " toolu-1 "})
	if err != nil {
		t.Fatalf("StopSessionTask() error = %v", err)
	}
	if len(sess.stopped) != 1 || sess.stopped[0] != "toolu-1" {
		t.Fatalf("stopped = %v, want [toolu-1]", sess.stopped)
	}
	if getActiveTurn("root", "parent") == nil {
		t.Fatal("stopping one task must not end the running turn")
	}
}

func TestStopSessionTaskReportsWhyItCannotStop(t *testing.T) {
	svc := &Service{}
	ctx := context.Background()

	if err := svc.StopSessionTask(ctx, StopSessionTaskInput{RootID: "root", Key: "idle", TaskRef: "t"}); !errors.Is(err, errNoRunningTurn) {
		t.Fatalf("no running turn: err = %v, want errNoRunningTurn", err)
	}

	registerTestTurn(t, "root", "plain", &plainSession{})
	if err := svc.StopSessionTask(ctx, StopSessionTaskInput{RootID: "root", Key: "plain", TaskRef: "t"}); err == nil {
		t.Fatal("an agent without task control must return an error")
	}

	if err := svc.StopSessionTask(ctx, StopSessionTaskInput{RootID: "root", Key: "", TaskRef: "t"}); err == nil {
		t.Fatal("missing session key must return an error")
	}
	if err := svc.StopSessionTask(ctx, StopSessionTaskInput{RootID: "root", Key: "k", TaskRef: " "}); err == nil {
		t.Fatal("missing task id must return an error")
	}

	failing := &stopperSession{err: errors.New("cli refused")}
	registerTestTurn(t, "root", "failing", failing)
	if err := svc.StopSessionTask(ctx, StopSessionTaskInput{RootID: "root", Key: "failing", TaskRef: "t"}); err == nil || err.Error() != "cli refused" {
		t.Fatalf("a CLI failure must reach the caller, got %v", err)
	}
}

// The CLI can take a long time to answer. The stop must give up when its context ends and say why.
func TestStopSessionTaskStopsWaitingWhenTheContextEnds(t *testing.T) {
	blocked := &blockingStopper{release: make(chan struct{})}
	registerTestTurn(t, "root", "slow", blocked)
	t.Cleanup(func() { close(blocked.release) })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- (&Service{}).StopSessionTask(ctx, StopSessionTaskInput{RootID: "root", Key: "slow", TaskRef: "t"})
	}()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("err = %v, want context.DeadlineExceeded", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("StopSessionTask kept waiting after its context ended")
	}
}

type blockingStopper struct {
	agenttypes.Session
	release chan struct{}
}

func (b *blockingStopper) StopTask(ctx context.Context, _ string) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-b.release:
		return nil
	}
}
