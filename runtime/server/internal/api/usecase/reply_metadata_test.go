package usecase

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mindfs/server/internal/agent/codex"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/session"
)

// Uses the actual Codex JSONL importer, synchronization, disk store and fresh
// manager. An optional artifact lets the browser test consume this same result.
func TestNativeReplyMetadataRoundTrip(t *testing.T) {
	ctx := context.Background()
	root := fs.NewRootInfo("root", "Root", t.TempDir())
	home := t.TempDir()
	t.Setenv("CODEX_HOME", home)
	dir := filepath.Join(home, "sessions", "2026", "09", "14")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "rollout-reply.jsonl")
	meta, _ := json.Marshal(map[string]any{"type": "session_meta", "payload": map[string]any{"id": "reply-native", "cwd": root.RootPath}})
	native := string(meta) + "\n" + `{"timestamp":"2026-09-14T01:00:00Z","type":"turn_context","payload":{"turn_id":"first","model":"gpt-6-astra","effort":"high"}}
{"timestamp":"2026-09-14T01:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"first request"}]}}
{"timestamp":"2026-09-14T01:00:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"first answer"}]}}
{"timestamp":"2026-09-14T01:00:03Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":9000000},"last_token_usage":{"total_tokens":109000},"model_context_window":258000}}}
{"timestamp":"2026-09-14T01:01:00Z","type":"turn_context","payload":{"turn_id":"second","model":"gpt-6-astra","effort":"xhigh"}}
{"timestamp":"2026-09-14T01:01:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"second request"}]}}
{"timestamp":"2026-09-14T01:01:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"second answer"}]}}
{"timestamp":"2026-09-14T01:01:03Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":9500000},"last_token_usage":{"total_tokens":55000},"model_context_window":258000}}}
{"timestamp":"2026-09-14T01:02:00Z","type":"turn_context","payload":{"turn_id":"third","model":"gpt-6-astra"}}
{"timestamp":"2026-09-14T01:02:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"third request"}]}}
{"timestamp":"2026-09-14T01:02:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"third answer"}]}}
`
	// First import emulates records saved by the old importer without metadata.
	var old strings.Builder
	for _, line := range strings.Split(native, "\n") {
		if !strings.Contains(line, "turn_context") && !strings.Contains(line, "token_count") {
			old.WriteString(line + "\n")
		}
	}
	if err := os.WriteFile(path, []byte(old.String()), 0600); err != nil {
		t.Fatal(err)
	}
	manager := session.NewManager(root)
	service := &Service{Registry: &syncDeltaTestRegistry{root: root, manager: manager, importer: codex.NewImporter(codex.ImporterOptions{AgentName: "codex"})}}
	created, err := service.ImportExternalSession(ctx, ImportExternalSessionInput{RootID: root.ID, Agent: "codex", AgentSessionID: "reply-native"})
	if err != nil {
		t.Fatal(err)
	}
	before, err := manager.Get(ctx, created.SessionKey, 0)
	if err != nil || len(before.Exchanges) != 6 {
		t.Fatalf("old import: %#v %v", before, err)
	}
	if before.Exchanges[1].Effort != "" || before.Exchanges[1].ContextWindow != nil {
		t.Fatal("fixture must begin without metadata")
	}
	if err := os.WriteFile(path, []byte(native), 0600); err != nil {
		t.Fatal(err)
	}
	for pass := 0; pass < 2; pass++ {
		_, err := service.SyncExternalSessionDelta(ctx, SyncExternalSessionDeltaInput{RootID: root.ID, Key: created.SessionKey, Full: true})
		if err != nil {
			t.Fatal(err)
		}
		fresh := session.NewManager(root)
		saved, err := fresh.Get(ctx, created.SessionKey, 0)
		if err != nil || len(saved.Exchanges) != 6 {
			t.Fatalf("reopened: %#v %v", saved, err)
		}
		for i, want := range []struct {
			effort string
			tokens int
		}{{"high", 109000}, {"xhigh", 55000}} {
			ex := saved.Exchanges[i*2+1]
			if ex.Effort != want.effort || ex.ContextWindow == nil || ex.ContextWindow.TotalTokens != want.tokens || ex.ContextWindow.ModelContextWindow != 258000 {
				t.Fatalf("reply %d: %#v", i, ex)
			}
		}
		if saved.Exchanges[5].ContextWindow != nil || saved.Exchanges[5].Effort != "" {
			t.Fatal("previous turn leaked into unknown reply")
		}
		for i, ex := range saved.Exchanges {
			if ex.Seq != before.Exchanges[i].Seq || ex.Content != before.Exchanges[i].Content || !ex.Timestamp.Equal(before.Exchanges[i].Timestamp) {
				t.Fatal("backfill changed exchange identity")
			}
		}
		if out := os.Getenv("REPLY_METADATA_FIXTURE_DIR"); out != "" {
			if err := os.MkdirAll(out, 0700); err != nil {
				t.Fatal(err)
			}
			wire, _ := json.Marshal(saved)
			if err := os.WriteFile(filepath.Join(out, "native-replies.json"), wire, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestLiveReplyContextIsSavedOnEachExchangeForBothAgents(t *testing.T) {
	for _, agent := range []string{"codex", "claude"} {
		t.Run(agent, func(t *testing.T) {
			ctx := context.Background()
			root := fs.NewRootInfo("r", "r", t.TempDir())
			m := session.NewManager(root)
			current, err := m.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: agent})
			if err != nil {
				t.Fatal(err)
			}
			for _, used := range []int{0, 109000} {
				window := &agenttypes.ContextWindow{TotalTokens: used, ModelContextWindow: 258000}
				if err := m.AddExchangeForAgent(session.WithExchangeContextWindow(ctx, window), current, "agent", "answer", agent, "", "high", ""); err != nil {
					t.Fatal(err)
				}
				window.TotalTokens = 999999
			}
			fresh, err := session.NewManager(root).Get(ctx, current.Key, 0)
			if err != nil || len(fresh.Exchanges) != 2 {
				t.Fatal(err)
			}
			if fresh.Exchanges[0].ContextWindow.TotalTokens != 0 || fresh.Exchanges[1].ContextWindow.TotalTokens != 109000 {
				t.Fatal("reply snapshots changed")
			}
		})
	}
}
