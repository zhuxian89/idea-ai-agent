package acp

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

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
