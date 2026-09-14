package types

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestActivityFactsMergeAndClone(t *testing.T) {
	actions := []ActivityAction{{Type: "read", Path: "README.md"}}
	zero := 0.0
	base := &ActivityFactsV1{SchemaVersion: 1, Agent: "codex", Origin: "live", Operation: "execute", Source: "agent", Actions: &actions,
		Tool: &ActivityTool{Name: "read", Server: "files"}, DisplayLabel: &ActivityDisplayLabel{Text: "Inspect", Source: "native"}}
	completed := MergeActivityFacts(base, &ActivityFactsV1{Outcome: "failed", DurationMs: &zero})
	replayed := MergeActivityFacts(completed, &ActivityFactsV1{Tool: &ActivityTool{DisplayName: "Files"}})
	if replayed.Outcome != "failed" || replayed.DurationMs == nil || *replayed.DurationMs != 0 || replayed.Tool.Server != "files" || replayed.Tool.DisplayName != "Files" {
		t.Fatalf("merged facts = %#v", replayed)
	}
	(*replayed.Actions)[0].Path = "changed"
	replayed.Tool.Name = "changed"
	replayed.DisplayLabel.Text = "changed"
	if (*base.Actions)[0].Path != "README.md" || base.Tool.Name != "read" || base.DisplayLabel.Text != "Inspect" {
		t.Fatal("cloned facts share mutable nested fields")
	}
	empty := []ActivityAction{}
	cleared := MergeActivityFacts(completed, &ActivityFactsV1{Actions: &empty, Outcome: "cancelled"})
	payload, err := json.Marshal(cleared)
	if err != nil || !strings.Contains(string(payload), `"actions":[]`) || cleared.Outcome != "cancelled" {
		t.Fatalf("explicit replacement lost: %s, %v", payload, err)
	}
	if MergeToolStatus("cancelled", "running") != "cancelled" || MergeToolStatus("failed", "complete") != "complete" {
		t.Fatal("ordered terminal correction or replay guard failed")
	}
}

func TestActivityDurationAndOptionalWireField(t *testing.T) {
	for _, invalid := range []float64{-1, math.NaN(), math.Inf(1)} {
		if NativeToolDuration(&invalid) != nil {
			t.Fatalf("accepted invalid duration %v", invalid)
		}
	}
	payload, err := json.Marshal(ToolCall{CallID: "old", Status: "running", Kind: ToolKindExecute})
	if err != nil || strings.Contains(string(payload), "activity") {
		t.Fatalf("legacy wire changed: %s, %v", payload, err)
	}
}

func TestMalformedOptionalActivityDoesNotDiscardTheToolCall(t *testing.T) {
	for _, facts := range []string{`true`, `{"schemaVersion":1,"durationMs":"bad"}`, `{"schemaVersion":2,"actions":"new-format"}`} {
		var call ToolCall
		payload := `{"callId":"old","kind":"read","title":"README.md","status":"complete","activity":` + facts + `}`
		if err := json.Unmarshal([]byte(payload), &call); err != nil || call.Title != "README.md" || call.Status != "complete" || call.Activity.SchemaVersion != 0 {
			t.Fatalf("optional corrupt facts discarded legacy record: %#v, %v", call, err)
		}
	}
}
