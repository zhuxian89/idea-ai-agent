package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"mindfs/server/internal/agent"
	"mindfs/server/internal/commandexec"
)

var activeAgentInstalls sync.Map

// Desktop actions run on the local companion, never on a remotely selected node.
func requireDesktopRequest(w http.ResponseWriter, r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		respondError(w, http.StatusForbidden, errors.New("local desktop request required"))
		return false
	}
	return true
}

func (h *HTTPHandler) handleAgentInstall(w http.ResponseWriter, r *http.Request) {
	if !requireDesktopRequest(w, r) {
		return
	}
	var req agentRestartRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errors.New("invalid install request"))
		return
	}
	if h.AppContext == nil || h.AppContext.GetAgentPool() == nil || h.AppContext.GetProber() == nil {
		respondError(w, http.StatusServiceUnavailable, errors.New("agent runtime not configured"))
		return
	}
	def, ok := h.AppContext.GetAgentPool().Config().GetAgent(strings.TrimSpace(req.Agent))
	if !ok || len(def.InstallCommands) == 0 {
		respondError(w, http.StatusBadRequest, errors.New("agent has no configured installation command"))
		return
	}
	if _, busy := activeAgentInstalls.LoadOrStore(def.Name, true); busy {
		respondError(w, http.StatusConflict, errors.New("installation is already running"))
		return
	}
	defer activeAgentInstalls.Delete(def.Name)
	prober := h.AppContext.GetProber()
	prober.RefreshInstallations()
	if status, ok := prober.GetStatus(def.Name); ok && status.Installed {
		respondError(w, http.StatusConflict, errors.New("agent is already installed; detect it again"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	flusher, streaming := w.(http.Flusher)
	var events []agentConnectionEvent
	emit := func(event agentConnectionEvent) {
		if streaming {
			if err := json.NewEncoder(w).Encode(event); err != nil {
				cancel()
				return
			}
			flusher.Flush()
		} else {
			events = append(events, event)
		}
	}
	if streaming {
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Cache-Control", "no-store")
	}
	emit(agentConnectionEvent{Type: "starting"})
	err := runAgentInstall(ctx, def, h.configuredShells(), emit)
	if err == nil {
		emit(agentConnectionEvent{Type: "checking"})
		// Executable presence and native connectivity are different facts.
		prober.RefreshInstallations()
		status, found := prober.GetStatus(def.Name)
		if !found || !status.Installed {
			err = errors.New("installer finished, but the Agent executable was not detected; check installation output and PATH")
		} else {
			err = probeAgent(def.Name, h.AppContext)
		}
	}
	if err != nil {
		emit(agentConnectionEvent{Type: "error", Text: err.Error()})
	} else {
		emit(agentConnectionEvent{Type: "done"})
	}
	if !streaming {
		respondJSON(w, http.StatusOK, events)
	}
}

// Reuse the same configured commands, shells and process-tree lifecycle as command
// sessions, but do not create a chat/session or accept shell text from the browser.
func runAgentInstall(ctx context.Context, def agent.Definition, shells []commandexec.ShellSpec, emit func(agentConnectionEvent)) error {
	cwd, err := os.MkdirTemp("", "idea-agent-install-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(cwd)
	for _, command := range def.InstallCommands {
		proc, err := commandexec.Start(ctx, commandexec.Options{Command: command, Cwd: cwd, Shells: shells})
		if err != nil {
			return err
		}
		limiter := commandexec.NewOutputLimiter()
		ticker := time.NewTicker(commandexec.DefaultFlushEvery)
		flush := func() {
			if chunk, ok := limiter.Flush(); ok {
				emit(agentConnectionEvent{Type: "chunk", Text: chunk.Text})
			}
		}
		reading := true
		for reading {
			select {
			case chunk, ok := <-proc.Output():
				if !ok {
					reading = false
				} else {
					limiter.Write(chunk)
				}
			case <-ticker.C:
				flush()
			case <-ctx.Done():
				_ = proc.KillTree()
				for range proc.Output() {
				}
				proc.Wait()
				ticker.Stop()
				flush()
				return ctx.Err()
			}
		}
		ticker.Stop()
		flush()
		result := proc.Wait()
		if result.Err != nil || result.ExitCode != 0 {
			return fmt.Errorf("installation command failed (exit %d): %v", result.ExitCode, result.Err)
		}
	}
	return nil
}
