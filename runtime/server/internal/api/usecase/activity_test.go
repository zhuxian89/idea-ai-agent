package usecase

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/session"
)

func TestActivitySurvivesBufferedDedupeStreamAndDetailService(t *testing.T) {
	zero := 0.0
	actions := []agenttypes.ActivityAction{{Type: "read", Path: "README.md"}}
	started := agenttypes.ToolCall{CallID: "call", Kind: agenttypes.ToolKindRead, Status: "running", Title: "README.md",
		Activity: &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: "codex", Origin: "live", Operation: "read", Source: "agent", Actions: &actions}}
	completed := agenttypes.ToolCall{CallID: "call", Status: "declined", Activity: &agenttypes.ActivityFactsV1{Outcome: "declined", DurationMs: &zero}, Content: []agenttypes.ToolCallContentItem{{Type: "text", Text: "original details"}}}
	buffer := []session.ExchangeAux{{Seq: 2, ToolCall: &started}, {Seq: 2, ToolCall: &completed}, {Seq: 2, ToolCall: &started}}
	items := dedupeExchangeAuxBuffer(buffer)
	if len(items) != 1 || items[0].ToolCall.Status != "declined" || items[0].ToolCall.Activity.Outcome != "declined" || items[0].ToolCall.Activity.Actions == nil {
		t.Fatal("buffer dedupe lost terminal facts")
	}
	full := items[0].ToolCall
	stream := compactAgentUpdate(agenttypes.Event{Type: agenttypes.EventTypeToolUpdate, Data: *full})
	compacted := stream.Data.(agenttypes.ToolCall)
	if !reflect.DeepEqual(full.Activity, compacted.Activity) || len(compacted.Content) != 0 {
		t.Fatal("stream compacting lost facts or leaked details")
	}
	(*compacted.Activity.Actions)[0].Path = "mutated"
	if (*full.Activity.Actions)[0].Path != "README.md" {
		t.Fatal("compact stream mutated full state")
	}
	ctx := context.Background()
	root := fs.NewRootInfo("root", "Root", t.TempDir())
	manager := session.NewManager(root)
	created, err := manager.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: "codex", Name: "Activity"})
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.AddExchangeAux(ctx, created.Key, items[0]); err != nil {
		t.Fatal(err)
	}
	svc := &Service{Registry: &syncDeltaTestRegistry{root: root, manager: manager}}
	detail, err := svc.GetSessionToolCall(ctx, GetSessionToolCallInput{RootID: root.ID, Key: created.Key, CallID: "call"})
	if err != nil || !reflect.DeepEqual(full.Activity, detail.Activity) {
		t.Fatalf("detail service facts: %#v, %v", detail, err)
	}
	wire, err := json.Marshal(map[string]any{"toolcall": detail})
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		ToolCall agenttypes.ToolCall `json:"toolcall"`
	}
	if err := json.Unmarshal(wire, &decoded); err != nil || !reflect.DeepEqual(decoded.ToolCall.Activity, full.Activity) {
		t.Fatal("detail JSON roundtrip lost facts")
	}
}

func TestDedupeExchangeAuxBufferKeepsOnlyLatestTurnDiff(t *testing.T) {
	first := agenttypes.TurnDiffUpdate{TurnID: "turn-1", Diff: "first"}
	latest := agenttypes.TurnDiffUpdate{TurnID: "turn-1", Diff: "latest"}
	items := dedupeExchangeAuxBuffer([]session.ExchangeAux{
		{Seq: 2, Line: 0, TurnDiff: &first},
		{Seq: 2, Line: 3, TurnDiff: &latest},
	})
	if len(items) != 1 || items[0].TurnDiff == nil || items[0].TurnDiff.Diff != "latest" || items[0].Line != 3 {
		t.Fatalf("deduped turn diff = %#v", items)
	}
}
