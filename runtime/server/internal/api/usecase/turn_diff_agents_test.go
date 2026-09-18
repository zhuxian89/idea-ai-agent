package usecase

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	rootfs "mindfs/server/internal/fs"
	"mindfs/server/internal/session"
)

// Exercise the real Claude and ACP transports with a local process that edits
// files but emits no file-change or turn-diff events. No model API is called.
func init() {
	protocol := os.Getenv("IDE_AGENT_SHARED_DIFF_TEST_HELPER")
	if protocol == "" {
		return
	}
	enc := json.NewEncoder(os.Stdout)
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 4096), 1<<20)
	for input.Scan() {
		var req struct {
			ID        any    `json:"id"`
			Method    string `json:"method"`
			Type      string `json:"type"`
			RequestID string `json:"request_id"`
		}
		if err := json.Unmarshal(input.Bytes(), &req); err != nil {
			os.Exit(2)
		}
		if protocol == string(agent.ProtocolClaudeSDK) && req.Type == "control_request" {
			_ = enc.Encode(map[string]any{"type": "control_response", "response": map[string]any{
				"subtype": "success", "request_id": req.RequestID, "response": map[string]any{},
			}})
			continue
		}
		isTurn := req.Type == "user" || req.Method == "session/prompt"
		if isTurn {
			if err := os.WriteFile(os.Getenv("IDE_AGENT_SHARED_DIFF_FILE"), []byte("after turn\n"), 0600); err != nil {
				os.Exit(3)
			}
		}
		if protocol == string(agent.ProtocolClaudeSDK) {
			if isTurn {
				_ = enc.Encode(map[string]any{"type": "assistant", "session_id": "shared-diff", "message": map[string]any{
					"id": "answer", "role": "assistant", "content": []any{map[string]any{"type": "text", "text": "Done."}},
				}})
				_ = enc.Encode(map[string]any{"type": "result", "subtype": "success", "session_id": "shared-diff", "result": "Done.", "is_error": false})
			}
			continue
		}
		if req.ID == nil {
			continue
		}
		result := map[string]any{}
		switch req.Method {
		case "initialize":
			result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{}}
		case "session/new":
			result = map[string]any{"sessionId": "shared-diff"}
		case "session/prompt":
			_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
				"sessionId": "shared-diff", "update": map[string]any{
					"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "Done."},
				},
			}})
			result = map[string]any{"stopReason": "end_turn"}
		}
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}
	os.Exit(0)
}

func TestWorkspaceTurnDiffSharedAcrossAgents(t *testing.T) {
	for _, tc := range []struct {
		name     string
		protocol agent.Protocol
	}{
		{"claude", agent.ProtocolClaudeSDK},
		{"custom-agent", agent.ProtocolACP},
	} {
		for _, gitWorkspace := range []bool{true, false} {
			workspaceKind := "git"
			if !gitWorkspace {
				workspaceKind = "no-git"
			}
			t.Run(tc.name+"/"+workspaceKind, func(t *testing.T) {
				rootDir := t.TempDir()
				if gitWorkspace {
					runUsecaseGit(t, rootDir, "init", "-q")
				}
				path := filepath.Join(rootDir, "example.txt")
				mustWriteFile(t, path, "before turn\n")
				root := rootfs.NewRootInfo("root", "Root", rootDir)
				manager := session.NewManager(root)
				t.Cleanup(func() { _ = manager.Shutdown() })
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				defer cancel()
				current, err := manager.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: tc.name})
				if err != nil {
					t.Fatal(err)
				}
				bin, err := os.Executable()
				if err != nil {
					t.Fatal(err)
				}
				pool := agent.NewPool(agent.Config{Agents: []agent.Definition{{Name: tc.name, Command: bin, Protocol: tc.protocol, Env: map[string]string{
					"IDE_AGENT_SHARED_DIFF_TEST_HELPER": string(tc.protocol), "IDE_AGENT_SHARED_DIFF_FILE": path,
				}}}})
				t.Cleanup(pool.CloseAll)
				service := &Service{Registry: &turnDiffRegistry{commandTestRegistry: &commandTestRegistry{root: root, manager: manager}, pool: pool}}
				input := SendMessageInput{RootID: root.ID, Key: current.Key, Agent: tc.name, Content: "Edit example.txt.", OnUpdate: func(event agenttypes.Event) {
					if event.Type == agenttypes.EventTypeTurnDiff {
						t.Error("workspace observer fabricated a native diff event")
					}
				}}
				fresh := session.NewManager(root)
				t.Cleanup(func() { _ = fresh.Shutdown() })
				for turn := 1; turn <= 2; turn++ {
					if err := service.SendMessage(ctx, input); err != nil {
						t.Fatal(err)
					}
					aux, err := fresh.GetExchangeAux(ctx, current.Key, 0)
					if err != nil {
						t.Fatal(err)
					}
					var diffs []*agenttypes.TurnDiffUpdate
					for _, entry := range aux[turn*2] {
						if entry.TurnDiff != nil {
							diffs = append(diffs, entry.TurnDiff)
						}
					}
					if gitWorkspace && turn == 1 {
						if len(diffs) != 1 || !diffs[0].Workspace || !strings.Contains(diffs[0].Diff, "-before turn") || !strings.Contains(diffs[0].Diff, "+after turn") {
							t.Fatalf("missing persisted workspace diff: %+v", diffs)
						}
					} else if len(diffs) != 0 {
						t.Fatalf("unexpected diff in turn %d: %+v", turn, diffs)
					}
					stored, err := fresh.Get(ctx, current.Key, 0)
					if err != nil {
						t.Fatal(err)
					}
					if got := stored.Exchanges[len(stored.Exchanges)-1]; got.Agent != tc.name || got.Content != "Done." {
						t.Fatalf("native reply changed: %+v", got)
					}
				}
			})
		}
	}
}
