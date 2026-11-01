package remotehost

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestHostProcess(t *testing.T) {
	if os.Getenv("REMOTE_HOST_TEST_PROCESS") != "1" {
		return
	}
	err := Run(context.Background(), Options{Dir: os.Getenv("REMOTE_HOST_TEST_DIR"), StaticDir: os.Getenv("REMOTE_HOST_TEST_STATIC"), RelayBaseURL: "http://127.0.0.1:1", OnReady: func(d Descriptor) error {
		payload, err := json.Marshal(d)
		if err != nil {
			return err
		}
		_, err = fmt.Println(string(payload))
		return err
	}})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	os.Exit(0)
}
func startHostProcess(t *testing.T, dir, static string) (*exec.Cmd, Descriptor) {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestHostProcess$")
	cmd.Env = append(os.Environ(), "REMOTE_HOST_TEST_PROCESS=1", "REMOTE_HOST_TEST_DIR="+dir, "REMOTE_HOST_TEST_STATIC="+static)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	done := make(chan struct {
		d   Descriptor
		err error
	}, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		var d Descriptor
		if !scanner.Scan() {
			done <- struct {
				d   Descriptor
				err error
			}{d, fmt.Errorf("no host readiness: %v", scanner.Err())}
			return
		}
		err := json.Unmarshal(scanner.Bytes(), &d)
		done <- struct {
			d   Descriptor
			err error
		}{d, err}
	}()
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatal(result.err)
		}
		return cmd, result.d
	case <-time.After(15 * time.Second):
		t.Fatal("host readiness timeout")
		return nil, Descriptor{}
	}
}
func TestSeparateProcessesShareOneHostAndRecoverAfterCrash(t *testing.T) {
	dir, static := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(static, "index.html"), []byte("host shell"), 0600); err != nil {
		t.Fatal(err)
	}
	first, a := startHostProcess(t, dir, static)
	// stdin is /dev/null. The shared process must outlive the project launcher.
	second, b := startHostProcess(t, dir, static)
	if a != b {
		t.Fatal("separate launchers created separate host identities")
	}
	exited := make(chan error, 1)
	go func() { exited <- second.Wait() }()
	select {
	case err := <-exited:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("duplicate launcher did not exit")
	}
	if _, err := NewClient(dir).Status(context.Background()); err != nil {
		t.Fatal("duplicate launcher exit stopped shared host", err)
	}
	identityBefore, err := os.ReadFile(filepath.Join(dir, "e2ee.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = first.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = first.Wait()
	_, c := startHostProcess(t, dir, static)
	if c.Token == a.Token {
		t.Fatal("crash reused process control credential")
	}
	identityAfter, err := os.ReadFile(filepath.Join(dir, "e2ee.json"))
	if err != nil || string(identityBefore) != string(identityAfter) {
		t.Fatal("crash changed persisted node identity", err)
	}
	if _, err = NewClient(dir).Status(context.Background()); err != nil {
		t.Fatal(err)
	}
}
