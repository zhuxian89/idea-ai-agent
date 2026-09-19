package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
)

type agentConnectionRequest struct {
	Agent   string `json:"agent"`
	Model   string `json:"model"`
	Message string `json:"message"`
}

type agentConnectionEvent struct {
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	ElapsedMS int64  `json:"elapsed_ms,omitempty"`
}

// Use a fresh native runtime so external CLI configuration changes are picked up
// without restarting any of the user's active conversations.
func (h *HTTPHandler) openConnectionSession(ctx context.Context, req agentConnectionRequest) (agenttypes.Session, func(), error) {
	if h.AppContext == nil || h.AppContext.GetAgentPool() == nil {
		return nil, nil, errors.New("agent runtime not configured")
	}
	cfg := h.AppContext.GetAgentPool().Config()
	def, ok := cfg.GetAgent(strings.TrimSpace(req.Agent))
	if !ok {
		return nil, nil, errors.New("agent not configured")
	}
	root, err := os.MkdirTemp("", "idea-agent-connection-")
	if err != nil {
		return nil, nil, err
	}
	pool := agent.NewPool(agent.Config{Agents: []agent.Definition{def}})
	cleanup := func() { pool.CloseAll(); _ = os.RemoveAll(root) }
	mode := ""
	protocol := def.Protocol
	if protocol == "" {
		protocol = agent.DefaultProtocol(def.Name)
	}
	if protocol == agent.ProtocolCodexSDK {
		mode = "read-only"
	}
	if protocol == agent.ProtocolClaudeSDK {
		mode = "dontAsk"
	}
	sess, err := pool.GetOrCreate(ctx, agenttypes.OpenSessionInput{
		SessionKey: "connection-test", AgentName: def.Name, RootPath: root,
		Model: strings.TrimSpace(req.Model), Mode: mode, Probe: true,
	})
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	return sess, cleanup, nil
}

func (h *HTTPHandler) handleAgentConnectionModels(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	sess, cleanup, err := h.openConnectionSession(ctx, agentConnectionRequest{Agent: r.URL.Query().Get("agent")})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	defer cleanup()
	models, err := sess.ListModels(ctx)
	if err != nil {
		respondError(w, http.StatusBadGateway, err)
		return
	}
	respondJSON(w, http.StatusOK, models)
}

func (h *HTTPHandler) handleAgentConnectionTest(w http.ResponseWriter, r *http.Request) {
	var req agentConnectionRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errors.New("invalid test request"))
		return
	}
	if strings.TrimSpace(req.Message) == "" {
		req.Message = "Hi"
	}
	if len(req.Message) > 8000 {
		respondError(w, http.StatusBadRequest, errors.New("test message is too long"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	started := time.Now()
	flusher, streaming := w.(http.Flusher)
	var events []agentConnectionEvent
	var mu sync.Mutex
	emit := func(event agentConnectionEvent) {
		mu.Lock()
		defer mu.Unlock()
		event.ElapsedMS = time.Since(started).Milliseconds()
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
	sess, cleanup, err := h.openConnectionSession(ctx, req)
	if err == nil {
		defer cleanup()
		err = runAgentConnectionTest(ctx, sess, req.Message, emit)
	}
	if err != nil {
		emit(agentConnectionEvent{Type: "error", Text: err.Error()})
	} else {
		emit(agentConnectionEvent{Type: "done"})
	}
	// Protected remote responses are buffered and encrypted by the shared wrapper.
	if !streaming {
		respondJSON(w, http.StatusOK, events)
	}
}

func runAgentConnectionTest(ctx context.Context, sess agenttypes.Session, message string, emit func(agentConnectionEvent)) error {
	var mu sync.Mutex
	var output strings.Builder
	done := make(chan struct{}, 1)
	sess.OnUpdate(func(ev agenttypes.Event) {
		if ev.Type == agenttypes.EventTypeMessageChunk {
			if chunk, ok := ev.Data.(agenttypes.MessageChunk); ok && chunk.ParentToolUseID == "" {
				mu.Lock()
				output.WriteString(chunk.Content)
				mu.Unlock()
				emit(agentConnectionEvent{Type: "chunk", Text: chunk.Content})
			}
		}
		if ev.Type == agenttypes.EventTypeMessageDone {
			if result, ok := ev.Data.(agenttypes.MessageDone); ok && result.ParentToolUseID != "" {
				return
			}
			select {
			case done <- struct{}{}:
			default:
			}
		}
	})
	defer sess.OnUpdate(nil)
	if err := sess.SendMessage(ctx, message); err != nil {
		return err
	}
	select {
	case <-done:
	case <-ctx.Done():
		return ctx.Err()
	}
	mu.Lock()
	defer mu.Unlock()
	if strings.TrimSpace(output.String()) == "" {
		return errors.New("agent completed without a text response")
	}
	return nil
}
