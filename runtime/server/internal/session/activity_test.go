package session

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	agenttypes "mindfs/server/internal/agent/types"
	rootfs "mindfs/server/internal/fs"
)

func TestActivityFactsSurvivePendingMergeDiskAndCompactReads(t *testing.T) {
	for _, agent := range []string{"codex", "claude"} {
		t.Run(agent, func(t *testing.T) {
			ctx := context.Background()
			root := rootfs.NewRootInfo("root", "Root", t.TempDir())
			manager := NewManager(root)
			created, err := manager.Create(ctx, CreateInput{Type: TypeChat, Agent: agent, Name: "Activity"})
			if err != nil {
				t.Fatal(err)
			}
			actions := []agenttypes.ActivityAction{{Type: "search", Query: "activity", Path: "src"}}
			call := agenttypes.ToolCall{CallID: "call", Kind: agenttypes.ToolKindSearch, Status: "running", Title: "activity",
				Activity: &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: agent, Origin: "live", Operation: "search", Source: "agent", Actions: &actions}}
			if err := manager.UpsertPendingExchangeAux(ctx, created.Key, ExchangeAux{ToolCall: &call}); err != nil {
				t.Fatal(err)
			}
			zero := 0.0
			output := strings.Repeat("original output\n", 10000)
			update := agenttypes.ToolCall{CallID: "call", Status: "failed", Content: []agenttypes.ToolCallContentItem{{Type: "text", Text: output}}, Meta: map[string]any{"output": output}, Activity: &agenttypes.ActivityFactsV1{Outcome: "failed"}}
			if agent == "codex" {
				update.Activity.DurationMs = &zero
			}
			if err := manager.UpsertPendingExchangeAux(ctx, created.Key, ExchangeAux{ToolCall: &update}); err != nil {
				t.Fatal(err)
			}
			replay := agenttypes.ToolCall{CallID: "call", Status: "running"}
			if err := manager.UpsertPendingExchangeAux(ctx, created.Key, ExchangeAux{ToolCall: &replay}); err != nil {
				t.Fatal(err)
			}
			full, err := manager.GetFullToolCall(ctx, created.Key, "call")
			if err != nil {
				t.Fatal(err)
			}
			if full.Status != "failed" || full.Activity.Outcome != "failed" || (*full.Activity.Actions)[0].Query != "activity" {
				t.Fatal("pending facts/status lost")
			}
			(*full.Activity.Actions)[0].Path = "mutated"
			full, err = manager.GetFullToolCall(ctx, created.Key, "call")
			if err != nil || (*full.Activity.Actions)[0].Path != "src" {
				t.Fatal("read mutated pending state")
			}
			if err := manager.AddExchangeAux(ctx, created.Key, ExchangeAux{Seq: 2, Line: 1, ToolCall: full}); err != nil {
				t.Fatal(err)
			}
			// A fresh manager proves the following reads come from persistence.
			reopened := NewManager(root)
			details, err := reopened.GetFullToolCall(ctx, created.Key, "call")
			if err != nil {
				t.Fatal(err)
			}
			list, err := reopened.GetExchangeAux(ctx, created.Key, 0)
			if err != nil {
				t.Fatal(err)
			}
			compact := list[2][0].ToolCall
			if !reflect.DeepEqual(full.Activity, details.Activity) || !reflect.DeepEqual(details.Activity, compact.Activity) {
				t.Fatal("full/compact facts differ")
			}
			if details.Content[0].Text != output || len(compact.Content) != 0 || compact.Meta["output"] != nil {
				t.Fatal("original detail or compact boundary lost")
			}
			wire, err := json.Marshal(map[string]any{"toolcall": details})
			if err != nil || !strings.Contains(string(wire), `"schemaVersion":1`) {
				t.Fatal("detail wire lost activity")
			}
			if (agent == "codex") != (details.Activity.DurationMs != nil) {
				t.Fatal("missing/zero duration lost")
			}
		})
	}
}
