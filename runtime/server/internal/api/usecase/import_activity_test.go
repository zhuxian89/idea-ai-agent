package usecase

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/session"
)

func TestFullImportBackfillsExistingToolsWithoutDuplicates(t *testing.T) {
	for _, agent := range []string{"codex", "claude"} {
		t.Run(agent, func(t *testing.T) {
			ctx := context.Background()
			root := fs.NewRootInfo("root", "Root", t.TempDir())
			manager := session.NewManager(root)
			old := agenttypes.ToolCall{CallID: "command", Kind: agenttypes.ToolKindExecute, Status: "complete", Title: "pwd", Content: []agenttypes.ToolCallContentItem{{Type: "text", Text: "original detail"}}}
			ts := time.Date(2026, 9, 14, 1, 0, 0, 0, time.UTC)
			importer := &syncDeltaTestImporter{exchanges: []agenttypes.ImportedExchange{{Role: "user", Content: "inspect", Timestamp: ts}, {Role: "agent", Content: "done", Timestamp: ts.Add(time.Second), Aux: []agenttypes.ImportedExchangeAux{{ToolCall: &old}}}}}
			svc := &Service{Registry: &syncDeltaTestRegistry{root: root, manager: manager, importer: importer}}
			input := ImportExternalSessionInput{RootID: root.ID, Agent: agent, AgentSessionID: "external"}
			created, err := svc.ImportExternalSession(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			// Simulate an old persisted replay entry for the same native call.
			if err := manager.AddExchangeAux(ctx, created.SessionKey, session.ExchangeAux{Seq: 2, ToolCall: &old}); err != nil {
				t.Fatal(err)
			}
			updated := old
			updated.Content = nil
			updated.Activity = &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: agent, Origin: "imported", Operation: "execute", Source: "agent", Outcome: "completed"}
			read := agenttypes.ToolCall{CallID: "read", Kind: agenttypes.ToolKindRead, Status: "complete", Title: "README.md", Activity: &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: agent, Origin: "imported", Operation: "read", Source: "agent", Outcome: "completed"}}
			importer.exchanges[1].Aux = []agenttypes.ImportedExchangeAux{{ToolCall: &read}, {ToolCall: &updated}}
			var snapshot []byte
			for pass := 0; pass < 3; pass++ {
				out, err := svc.ImportExternalSession(ctx, input)
				if err != nil || out.SessionKey != created.SessionKey || out.ImportedCount != 0 {
					t.Fatalf("reimport: %#v %v", out, err)
				}
				if !importer.input.AfterTimestamp.IsZero() || importer.input.Cursor.SourcePath != "" {
					t.Fatal("full backfill used timestamp/cursor gate")
				}
				fresh := session.NewManager(root)
				saved, err := fresh.Get(ctx, created.SessionKey, 0)
				if err != nil || len(saved.Exchanges) != 2 {
					t.Fatal("exchanges duplicated", err)
				}
				aux, err := fresh.GetExchangeAux(ctx, created.SessionKey, 0)
				if err != nil || len(aux[2]) != 2 || aux[2][0].ToolCall.CallID != "read" || aux[2][1].ToolCall.CallID != "command" {
					t.Fatalf("order/count: %#v %v", aux, err)
				}
				full, err := fresh.GetFullToolCall(ctx, created.SessionKey, "command")
				if err != nil || len(full.Content) != 1 || full.Content[0].Text != "original detail" || !reflect.DeepEqual(full.Activity, aux[2][1].ToolCall.Activity) {
					t.Fatal("full/compact facts or details lost", err)
				}
				wire, _ := json.Marshal(aux)
				if pass > 0 && string(wire) != string(snapshot) {
					t.Fatal("reimport changed compact projection")
				}
				snapshot = wire
			}
		})
	}
}

func TestBackfillToolsOnlyTurnKeepsStoredSequenceAndMixedAgentHistory(t *testing.T) {
	ctx := context.Background()
	root := fs.NewRootInfo("root", "Root", t.TempDir())
	manager := session.NewManager(root)
	current, err := manager.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: "claude"})
	if err != nil {
		t.Fatal(err)
	}
	ts := time.Date(2026, 9, 14, 1, 0, 0, 0, time.UTC)
	for _, ex := range []struct{ role, content, agent string }{{"user", "first", "claude"}, {"user", "second", "claude"}, {"agent", "done", "claude"}, {"user", "third", "codex"}, {"agent", "done", "codex"}} {
		if err := manager.AddExchangeForAgentAt(ctx, current, ex.role, ex.content, ex.agent, "", "", "", ts); err != nil {
			t.Fatal(err)
		}
	}
	call := agenttypes.ToolCall{CallID: "read", Kind: agenttypes.ToolKindRead, Status: "complete", Activity: &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: "claude", Origin: "imported", Operation: "read", Source: "agent"}}
	imported := []agenttypes.ImportedExchange{{Role: "user", Content: "first"}, {Role: "agent", Aux: []agenttypes.ImportedExchangeAux{{ToolCall: &call}}}, {Role: "user", Content: "second"}, {Role: "agent", Content: "done"}}
	for pass := 0; pass < 2; pass++ {
		delta, err := reconcileImportedActivity(ctx, manager, current, "claude", imported, 3, true)
		if err != nil || len(delta) != 0 {
			t.Fatalf("unexpected tail: %#v %v", delta, err)
		}
	}
	aux, err := manager.GetExchangeAux(ctx, current.Key, 0)
	if err != nil || len(aux[1]) != 1 || len(aux[5]) != 0 {
		t.Fatalf("wrong owning exchange: %#v %v", aux, err)
	}
	latest, err := manager.Get(ctx, current.Key, 0)
	if err != nil || !reflect.DeepEqual(current.Exchanges, latest.Exchanges) {
		t.Fatal("stored text/sequence changed", err)
	}
}

func TestFastSyncMergesLateResultAndKeepsNewRepeatedUserMessage(t *testing.T) {
	ctx := context.Background()
	root := fs.NewRootInfo("root", "Root", t.TempDir())
	manager := session.NewManager(root)
	current, err := manager.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	ts := time.Date(2026, 9, 14, 1, 0, 0, 0, time.UTC)
	for _, ex := range []struct{ role, text string }{{"user", "repeat"}, {"agent", "working"}} {
		if err := manager.AddExchangeForAgentAt(ctx, current, ex.role, ex.text, "codex", "", "", "", ts); err != nil {
			t.Fatal(err)
		}
	}
	call := agenttypes.ToolCall{CallID: "command", Kind: agenttypes.ToolKindExecute, Status: "running"}
	if err := manager.AddExchangeAux(ctx, current.Key, session.ExchangeAux{Seq: 2, ToolCall: &call}); err != nil {
		t.Fatal(err)
	}
	if err := manager.UpdateAgentState(ctx, current, "codex", 2, "external"); err != nil {
		t.Fatal(err)
	}
	call.Status = "failed"
	call.Activity = &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: "codex", Origin: "imported", Operation: "execute", Source: "agent", Outcome: "failed"}
	importer := &syncDeltaTestImporter{exchanges: []agenttypes.ImportedExchange{{Role: "agent", Content: "working", Aux: []agenttypes.ImportedExchangeAux{{ToolCall: &call}}}, {Role: "user", Content: "repeat", Timestamp: ts.Add(time.Minute)}}}
	svc := &Service{Registry: &syncDeltaTestRegistry{root: root, manager: manager, importer: importer}}
	out, err := svc.SyncExternalSessionDelta(ctx, SyncExternalSessionDeltaInput{RootID: root.ID, Key: current.Key})
	if err != nil || out.ImportedCount != 1 || !out.RefreshAux {
		t.Fatalf("sync: %#v %v", out, err)
	}
	latest, _ := manager.Get(ctx, current.Key, 0)
	aux, _ := manager.GetExchangeAux(ctx, current.Key, 0)
	if len(latest.Exchanges) != 3 || latest.Exchanges[2].Content != "repeat" || len(aux[2]) != 1 || aux[2][0].ToolCall.Activity.Outcome != "failed" {
		t.Fatal("late result duplicated or new repeated prompt lost")
	}
}

func TestCodexLiveTurnDoesNotImportOuterExecWrapperAsAnotherCommand(t *testing.T) {
	ctx := context.Background()
	root := fs.NewRootInfo("root", "Root", t.TempDir())
	manager := session.NewManager(root)
	current, err := manager.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	for _, ex := range []struct{ role, text string }{{"user", "inspect"}, {"agent", "done"}} {
		if err := manager.AddExchangeForAgentAt(ctx, current, ex.role, ex.text, "codex", "", "", "", time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	live := agenttypes.ToolCall{CallID: "exec-native", Kind: agenttypes.ToolKindExecute, Status: "failed", Meta: map[string]any{"rawType": "commandExecution"}, Activity: &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: "codex", Origin: "live", NativeTurnID: "turn", Outcome: "failed", Operation: "execute", Source: "agent"}}
	if err := manager.AddExchangeAux(ctx, current.Key, session.ExchangeAux{Seq: 2, ToolCall: &live}); err != nil {
		t.Fatal(err)
	}
	wrapper := live
	wrapper.CallID = "call-wrapper"
	wrapper.Meta = map[string]any{"wrapperTool": "exec", "rawType": "custom_tool_call"}
	wrapper.Activity = &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: "codex", Origin: "imported", NativeTurnID: "turn", Outcome: "failed", Operation: "execute", Source: "agent"}
	standalone := wrapper
	standalone.CallID = "standalone"
	standalone.Activity = &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: "codex", Origin: "imported", NativeTurnID: "other-turn", Outcome: "failed", Operation: "execute", Source: "agent"}
	mcp := wrapper
	mcp.CallID = "mcp"
	mcp.Kind = agenttypes.ToolKindOther
	mcp.Meta = map[string]any{"tool": "mcp__server__read"}
	incoming := []agenttypes.ImportedExchange{{Role: "user", Content: "inspect"}, {Role: "agent", Content: "done", Aux: []agenttypes.ImportedExchangeAux{{ToolCall: &wrapper}, {ToolCall: &standalone}, {ToolCall: &mcp}}}}
	for pass := 0; pass < 2; pass++ {
		if _, err := reconcileImportedActivity(ctx, manager, current, "codex", incoming, 0, true); err != nil {
			t.Fatal(err)
		}
	}
	aux, err := manager.GetExchangeAux(ctx, current.Key, 0)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	for _, entry := range aux[2] {
		if entry.ToolCall != nil {
			ids[entry.ToolCall.CallID] = entry.ToolCall.Status
		}
	}
	if !reflect.DeepEqual(ids, map[string]string{"exec-native": "failed", "standalone": "failed", "mcp": "failed"}) {
		t.Fatalf("wrong identity/scope: %#v", ids)
	}
	if len(incoming[1].Aux) != 3 {
		t.Fatal("caller input mutated")
	}
}
