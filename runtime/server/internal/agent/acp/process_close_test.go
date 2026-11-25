package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	acpsdk "github.com/coder/acp-go-sdk"
)

func TestProcessInitializeAdvertisesTerminalFalse(t *testing.T) {
	serverR, clientW := io.Pipe()
	clientR, serverW := io.Pipe()
	defer serverR.Close()
	defer clientW.Close()
	defer clientR.Close()
	defer serverW.Close()

	proc := &Process{agentName: "init-test"}
	proc.client = &mindfsClient{proc: proc}
	proc.conn = acpsdk.NewClientSideConnection(proc.client, clientW, clientR)

	reqCh := make(chan map[string]any, 1)
	errCh := make(chan error, 1)
	go func() {
		line, err := bufio.NewReader(serverR).ReadBytes('\n')
		if err != nil {
			errCh <- err
			return
		}
		var req map[string]any
		if err := json.Unmarshal(line, &req); err != nil {
			errCh <- err
			return
		}
		reqCh <- req
		resp := map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"result": map[string]any{
				"protocolVersion":   acpsdk.ProtocolVersionNumber,
				"agentCapabilities": map[string]any{},
			},
		}
		payload, _ := json.Marshal(resp)
		_, err = serverW.Write(append(payload, '\n'))
		if err != nil {
			errCh <- err
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := proc.Initialize(ctx); err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	select {
	case err := <-errCh:
		t.Fatalf("fake ACP server: %v", err)
	case req := <-reqCh:
		params, _ := req["params"].(map[string]any)
		caps, _ := params["clientCapabilities"].(map[string]any)
		if terminal, ok := caps["terminal"].(bool); ok && terminal {
			t.Fatalf("clientCapabilities.terminal = true, want false: %#v", caps)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for initialize request")
	}
}

func TestProcessCloseReceivesChildExit(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ready := filepath.Join(t.TempDir(), "ready")
	process, err := Start(context.Background(), "close-test", executable,
		[]string{"-test.run=^TestProcessCloseHelper$"}, "", map[string]string{
			"ACP_CLOSE_TEST_READY": ready,
		})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = process.Close() })
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		} else if !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if time.Now().After(deadline) {
			t.Fatal("child did not become ready")
		}
		time.Sleep(10 * time.Millisecond)
	}
	started := time.Now()
	if err := process.Close(); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("closing a killed child took %s; its exit notification was not received", elapsed)
	}
}

func TestProcessCloseHelper(t *testing.T) {
	ready := os.Getenv("ACP_CLOSE_TEST_READY")
	if ready == "" {
		return
	}
	if err := os.WriteFile(ready, nil, 0600); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Minute)
}
