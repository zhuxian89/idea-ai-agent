package relay

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestDisabledBindingCannotSaveLateCredentials(t *testing.T) {
	t.Setenv("IDE_AGENT_DATA_DIR", t.TempDir())
	t.Setenv("MINDFS_RELAY_BASE_URL", "")
	m, err := NewManager("127.0.0.1:1", false, "https://relay.test", false)
	if err != nil {
		t.Fatal(err)
	}
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	m.service.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		close(entered)
		<-release // Simulate a response already in flight when access is disabled.
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"status":"confirmed","device_token":"late","node_id":"old","endpoint":"wss://relay.test/connector"}`)), Header: make(http.Header)}, nil
	})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := m.Start(ctx); err != nil {
		t.Fatal(err)
	}
	bindCtx, cancelBinding := context.WithCancel(ctx)
	defer cancelBinding()
	m.pendingCode, m.polling, m.bindCancel = "pc_test", true, cancelBinding
	go func() { m.pollLoop(bindCtx, "pc_test"); close(finished) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("binding not started")
	}
	if err := m.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	close(release)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("poll did not stop")
	}
	// Reenabling must not resurrect a binding that completed after cancellation.
	if err := m.SetEnabled(true); err != nil {
		t.Fatal(err)
	}
	status := m.Status()
	if status.Bound || status.PendingCode != "" || status.Connected {
		t.Fatalf("canceled binding resurrected: %+v", status)
	}
}
