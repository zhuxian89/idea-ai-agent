package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"mindfs/server/internal/agent"
	"mindfs/server/internal/commandexec"
)

func TestInstallCommandsUseRealRunnerAndStopOnFailure(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fixture commands")
	}
	var output strings.Builder
	emit := func(e agentConnectionEvent) { output.WriteString(e.Text) }
	shells := []commandexec.ShellSpec{{Command: "sh", Args: []string{"-c"}}}
	err := runAgentInstall(context.Background(), agent.Definition{InstallCommands: []string{"echo installer-output; sleep 0.05", "exit 7", "echo must-not-run"}}, shells, emit)
	if err == nil || !strings.Contains(err.Error(), "exit 7") {
		t.Fatalf("error = %v", err)
	}
	if !strings.Contains(output.String(), "installer-output") || strings.Contains(output.String(), "must-not-run") {
		t.Fatalf("output = %q", output.String())
	}
}

func TestInstallCancellationKillsProcessTree(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fixture commands")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	started := time.Now()
	err := runAgentInstall(ctx, agent.Definition{InstallCommands: []string{"sleep 30"}}, []commandexec.ShellSpec{{Command: "sh", Args: []string{"-c"}}}, func(agentConnectionEvent) {})
	if err == nil || time.Since(started) > 3*time.Second {
		t.Fatalf("cancellation = %v, elapsed %v", err, time.Since(started))
	}
}

func TestInstallEndpointValidatesAndDetectsActualExecutable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fixture commands")
	}
	binary := filepath.Join(t.TempDir(), "fixture-agent")
	command := "printf '#!/bin/sh\nexit 0\n' > '" + binary + "' && chmod +x '" + binary + "'"
	cfg := agent.Config{Agents: []agent.Definition{{Name: "fixture-install", Command: binary, Protocol: "unsupported-fixture", InstallCommands: []string{command}}}, Shells: []agent.Shell{{Command: "sh", Args: []string{"-c"}}}}
	pool := agent.NewPool(cfg)
	defer pool.CloseAll()
	prober := agent.NewProber(&cfg, pool, 0)
	h := &HTTPHandler{AppContext: &AppContext{Agents: pool, Prober: prober}}
	request := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/agents/install", strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:1234"
		w := httptest.NewRecorder()
		h.handleAgentInstall(w, r)
		return w
	}
	for _, body := range []string{`{"agent":"unknown"}`, `{"agent":"fixture-install","command":"touch injected"}`} {
		if w := request(body); w.Code != http.StatusBadRequest {
			t.Fatalf("unsafe request %s = %d", body, w.Code)
		}
	}
	activeAgentInstalls.Store("fixture-install", true)
	if w := request(`{"agent":"fixture-install"}`); w.Code != http.StatusConflict {
		t.Fatalf("duplicate = %d", w.Code)
	}
	activeAgentInstalls.Delete("fixture-install")
	w := request(`{"agent":"fixture-install"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("install = %d %s", w.Code, w.Body.String())
	}
	var events []agentConnectionEvent
	decoder := json.NewDecoder(strings.NewReader(w.Body.String()))
	for decoder.More() {
		var e agentConnectionEvent
		if err := decoder.Decode(&e); err != nil {
			t.Fatal(err)
		}
		events = append(events, e)
	}
	if len(events) < 3 || events[len(events)-1].Type != "done" {
		t.Fatalf("events=%+v", events)
	}
	if _, err := os.Stat(binary); err != nil {
		t.Fatal(err)
	}
	status, _ := prober.GetStatus("fixture-install")
	if !status.Installed {
		t.Fatalf("not detected: %+v", status)
	}
	if w := request(`{"agent":"fixture-install"}`); w.Code != http.StatusConflict {
		t.Fatalf("already installed = %d", w.Code)
	}
}

func TestDesktopActionsRejectRemoteRequests(t *testing.T) {
	h := &HTTPHandler{}
	for _, handler := range []http.HandlerFunc{h.handleAgentInstall, h.handleCCSwitchStatus, h.handleCCSwitchOpen} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
		r.RemoteAddr = "203.0.113.1:4567"
		handler(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("remote request accepted: %d", w.Code)
		}
	}
}
