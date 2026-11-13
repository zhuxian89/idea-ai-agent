package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"mindfs/server/internal/backend"
	"mindfs/server/internal/remotehost"
)

func TestInstallerTakesOverIDEHostOnlyAfterProjectsExit(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
	t.Setenv("IDE_AGENT_DATA_DIR", dir)
	t.Setenv("IDE_AGENT_REMOTE_HOST_DIR", dir)
	t.Setenv("MINDFS_RELAY_BASE_URL", "http://127.0.0.1:1")
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready, done := make(chan struct{}), make(chan error, 1)
	go func() {
		done <- remotehost.Run(ctx, remotehost.Options{Dir: dir, StaticDir: dir, RuntimeVersion: "test-plugin",
			RelayBaseURL: "http://127.0.0.1:1", OnReady: func(remotehost.Descriptor) error { close(ready); return nil }})
	}()
	select {
	case <-ready:
	case err := <-done:
		t.Fatal(err)
	case <-time.After(10 * time.Second):
		t.Fatal("host startup timed out")
	}
	project, err := backend.Acquire(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	defer project.Close()
	if err := runCLI([]string{"-stop"}); err == nil {
		t.Fatal("installation must require closing IDEA while project data is in use")
	}
	if _, err := remotehost.NewClient(dir).Status(ctx); err != nil {
		t.Fatal("the running project's remote host was stopped", err)
	}
	project.Close()
	// No 30-second idle timeout: the normal installer stop command takes over now.
	if err := runCLI([]string{"-stop"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "host.json")); !os.IsNotExist(err) {
		t.Fatal("host descriptor remains after handoff", err)
	}
	select {
	case err := <-done:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("host did not exit")
	}
	// An already-exited host may also leave a stale descriptor.
	if err := os.WriteFile(filepath.Join(dir, "host.json"), []byte(`{"protocol":1,"url":"http://127.0.0.1:1","token":"stale"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runCLI([]string{"-stop"}); err != nil {
		t.Fatal(err)
	}
}
