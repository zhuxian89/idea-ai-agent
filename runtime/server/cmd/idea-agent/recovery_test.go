package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mindfs/server/internal/backend"
)

func TestRecoveryRequiresAnUnreachableExclusiveCore(t *testing.T) {
	dir := t.TempDir()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	addr := strings.TrimPrefix(server.URL, "http://")
	if err := backend.PublishCore(dir, addr, addr, "test"); err != nil {
		t.Fatal(err)
	}
	exclusive, err := backend.Acquire(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if unresponsiveWriter(context.Background(), dir) {
		t.Fatal("an authentication error offered to stop a reachable service")
	}
	server.Close()
	if !unresponsiveWriter(context.Background(), dir) {
		t.Fatal("a disconnected Core still holding the writer lease went undetected")
	}
	exclusive.Close()
	shared, err := backend.Acquire(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	defer shared.Close()
	if unresponsiveWriter(context.Background(), dir) {
		t.Fatal("a stale descriptor and embedded reader offered standalone recovery")
	}
}

func TestRecoveryKeepsUnavailableWritersDataAndInstallation(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("IDE_AGENT_REMOTE_HOST_DIR", dir)
	server := httptest.NewServer(http.NotFoundHandler())
	addr := strings.TrimPrefix(server.URL, "http://")
	server.Close()
	if err := backend.PublishCore(dir, addr, addr, "test"); err != nil {
		t.Fatal(err)
	}
	if err := backend.RecordInstallation(dir, filepath.Join(dir, "installed")); err != nil {
		t.Fatal(err)
	}
	owner, err := backend.Acquire(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := recoverEmbeddedCore(ctx, dir); err == nil {
		t.Fatal("switch succeeded while another process still held the lock")
	}
	if _, err := os.Stat(filepath.Join(dir, "core.json")); err != nil {
		t.Fatal("active writer lost its discovery record", err)
	}
	owner.Close()
	if err := recoverEmbeddedCore(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "installation.json")); err != nil {
		t.Fatal("switch removed the standalone installation", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "core.json")); !os.IsNotExist(err) {
		t.Fatal("stale descriptor remained after successful switch", err)
	}
}
