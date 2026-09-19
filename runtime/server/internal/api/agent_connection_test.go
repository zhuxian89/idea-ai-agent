package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
)

// Explicit opt-in: unlike the protocol-only SDK test, this sends one real Hi
// through the same HTTP handler and native runtime used by the settings dialog.
func TestInstalledCodexConnectionEndpoint(t *testing.T) {
	if os.Getenv("CODEX_CONNECTION_TEST") != "1" {
		t.Skip("set CODEX_CONNECTION_TEST=1 to send a real Hi using installed Codex")
	}
	pool := agent.NewPool(agent.Config{Agents: []agent.Definition{{Name: "codex", Command: "codex", Protocol: agent.ProtocolCodexSDK}}})
	defer pool.CloseAll()
	h := &HTTPHandler{AppContext: &AppContext{Agents: pool}}
	models := httptest.NewRecorder()
	h.handleAgentConnectionModels(models, httptest.NewRequest("GET", "/api/agents/test-models?agent=codex", nil))
	if models.Code != 200 {
		t.Fatalf("native model discovery failed: %s", models.Body.String())
	}
	var catalog agenttypes.ModelList
	if err := json.Unmarshal(models.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	t.Logf("native discovery returned %d models", len(catalog.Models))
	response := httptest.NewRecorder()
	h.handleAgentConnectionTest(response, httptest.NewRequest("POST", "/api/agents/test-connection", strings.NewReader(`{"agent":"codex","message":"Hi"}`)))
	var gotText, completed bool
	for _, line := range strings.Split(strings.TrimSpace(response.Body.String()), "\n") {
		var event agentConnectionEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatal(err)
		}
		if event.Type == "error" {
			t.Fatalf("native connection test failed: %s", event.Text)
		}
		if event.Type == "chunk" && strings.TrimSpace(event.Text) != "" {
			gotText = true
		}
		if event.Type == "done" {
			completed = true
			t.Logf("native Hi completed in %d ms", event.ElapsedMS)
		}
	}
	if !gotText || !completed {
		t.Fatalf("incomplete native response: text=%v completed=%v", gotText, completed)
	}
}

type connectionTestSession struct {
	agenttypes.Session
	handler func(agenttypes.Event)
	send    func(context.Context, string) error
}

func (s *connectionTestSession) OnUpdate(handler func(agenttypes.Event)) { s.handler = handler }
func (s *connectionTestSession) SendMessage(ctx context.Context, content string) error {
	return s.send(ctx, content)
}

func TestConnectionTestStreamsCustomMessageAndRequiresCompletion(t *testing.T) {
	sess := &connectionTestSession{}
	sess.send = func(ctx context.Context, message string) error {
		if message != "自定义测试" {
			t.Fatalf("unexpected message %q", message)
		}
		sess.handler(agenttypes.Event{Type: agenttypes.EventTypeMessageChunk, Data: agenttypes.MessageChunk{Content: "你好"}})
		sess.handler(agenttypes.Event{Type: agenttypes.EventTypeMessageChunk, Data: agenttypes.MessageChunk{Content: "！"}})
		sess.handler(agenttypes.Event{Type: agenttypes.EventTypeMessageDone, Data: agenttypes.MessageDone{}})
		return nil
	}
	var got string
	err := runAgentConnectionTest(context.Background(), sess, "自定义测试", func(event agentConnectionEvent) { got += event.Text })
	if err != nil || got != "你好！" {
		t.Fatalf("output=%q err=%v", got, err)
	}
	if sess.handler != nil {
		t.Fatal("test callback was not detached")
	}
}

func TestConnectionTestDoesNotTreatPartialReplyOrEmptyResponseAsSuccess(t *testing.T) {
	for _, name := range []string{"empty", "native-error", "cancelled"} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			sess := &connectionTestSession{}
			sess.send = func(context.Context, string) error {
				if name == "empty" {
					sess.handler(agenttypes.Event{Type: agenttypes.EventTypeMessageDone})
					return nil
				}
				sess.handler(agenttypes.Event{Type: agenttypes.EventTypeMessageChunk, Data: agenttypes.MessageChunk{Content: "partial"}})
				if name == "native-error" {
					return errors.New("authentication failed")
				}
				cancel()
				return nil
			}
			if err := runAgentConnectionTest(ctx, sess, "Hi", func(agentConnectionEvent) {}); err == nil {
				t.Fatal("expected a failed test")
			}
		})
	}
}
