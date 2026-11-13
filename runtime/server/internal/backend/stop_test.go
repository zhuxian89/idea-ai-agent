package backend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"mindfs/server/internal/remotehost"
)

func stoppingCore(t *testing.T) (string, *os.File, <-chan struct{}) {
	t.Helper()
	dir := t.TempDir()
	lease, err := Acquire(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lease.Close() })
	stopped := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/control/status":
			_ = json.NewEncoder(w).Encode(remotehost.Status{Protocol: remotehost.Protocol})
		case "/control/stop":
			close(stopped)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	address := strings.TrimPrefix(server.URL, "http://")
	if err := PublishCore(dir, address, address, "test-token"); err != nil {
		t.Fatal(err)
	}
	return dir, lease, stopped
}

func TestStopCoreWaitsPastTenSecondsForDataLock(t *testing.T) {
	dir, lease, stopped := stoppingCore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- StopCore(ctx, dir) }()
	<-stopped
	select {
	case err := <-done:
		t.Fatalf("stop returned while the data writer was still active: %v", err)
	case <-time.After(10*time.Second + 250*time.Millisecond):
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stop did not finish after the data lock was released")
	}
}

func TestStopCoreWaitCanBeCancelled(t *testing.T) {
	dir, _, stopped := stoppingCore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- StopCore(ctx, dir) }()
	<-stopped
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("got %v, want context.Canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("stop did not observe cancellation")
	}
	if lease, err := Acquire(dir, false); err == nil {
		lease.Close()
		t.Fatal("cancellation released the active data writer's lock")
	}
}
