package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"mindfs/server/internal/remotehost"
)

func TestStandaloneBindCommand(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "local-ai-agent")
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	if output, err := exec.Command("go", "build", "-o", executable, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, output)
	}

	var approved atomic.Bool
	fakeRelay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/bind/poll":
			if !approved.Load() {
				_, _ = w.Write([]byte(`{"status":"pending","next_poll_after_ms":100}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{
				"status": "confirmed", "device_token": "relay-test-token", "node_id": "headless-test",
				"node_name": "Linux test server", "endpoint": "ws://" + r.Host + "/connector",
			})
		case "/connector":
			upgrader := websocket.Upgrader{}
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				t.Error(err)
				return
			}
			defer conn.Close()
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer fakeRelay.Close()

	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
	t.Setenv("IDE_AGENT_REMOTE_HOST_DIR", dir)
	t.Setenv("IDE_AGENT_DATA_DIR", dir)
	t.Setenv("MINDFS_RELAY_BASE_URL", fakeRelay.URL)
	t.Setenv("PATH", "")
	run := func(args ...string) (string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		output, err := exec.CommandContext(ctx, executable, args...).CombinedOutput()
		return string(output), err
	}
	command := func(args ...string) string {
		t.Helper()
		output, err := run(args...)
		if err != nil {
			t.Fatalf("%v: %v\n%s", args, err, output)
		}
		return output
	}
	if output, err := run("-bind"); err == nil || !strings.Contains(output, "-no-browser") {
		t.Fatalf("expected startup instructions when stopped, got %v %s", err, output)
	}
	defer func() {
		for _, args := range []string{"-stop", "-stop-core"} {
			if output, err := run(args); err != nil {
				t.Errorf("cleanup %s: %v\n%s", args, err, output)
			}
		}
	}()
	command("-no-browser", "-web-push=false")
	first := command("-bind")
	link := ""
	for _, line := range strings.Split(first, "\n") {
		if strings.HasPrefix(line, fakeRelay.URL+"/bind?") {
			link = line
		}
	}
	loginURL, err := url.Parse(link)
	if err != nil || loginURL.Query().Get("code") == "" {
		t.Fatalf("expected Relay login URL, got %s", first)
	}
	if again := command("-bind"); again != first {
		t.Fatalf("repeating the query changed the pending link: %s", again)
	}
	approved.Store(true)
	client := remotehost.NewClient(dir)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for {
		var status remotehost.Status
		if err := client.Call(ctx, http.MethodGet, "/control/remote", nil, &status); err != nil {
			t.Fatal(err)
		}
		if status.Connected {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("the gateway did not connect after approval")
		case <-time.After(50 * time.Millisecond):
		}
	}
	linked := command("-bind")
	if !strings.Contains(linked, "Relay: connected") || !strings.Contains(linked, "Node: Linux test server") ||
		!strings.Contains(linked, fakeRelay.URL+"/n/headless-test/") {
		t.Fatalf("expected node URL after approval, got %s", linked)
	}
	if err := client.Call(ctx, http.MethodPost, "/control/remote/enable", map[string]bool{"enabled": false}, nil); err != nil {
		t.Fatal(err)
	}
	if paused := command("-bind"); !strings.Contains(paused, "remote access paused") {
		t.Fatalf("expected querying an already bound node to preserve paused access, got %s", paused)
	}
}
