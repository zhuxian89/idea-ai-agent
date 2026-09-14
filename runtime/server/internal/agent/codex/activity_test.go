package codex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	codextypes "github.com/fanwenlin/codex-go-sdk/types"
	"mindfs/server/internal/agent/types"
)

func TestNativeActivityFixtures(t *testing.T) {
	cases := []struct {
		name, phase, item, outcome string
	}{
		{"start", "started", `{"type":"commandExecution","id":"command","command":"cat README.md","source":"agent","status":"inProgress","commandActions":[{"type":"read","name":"README.md","path":"README.md","command":"cat README.md"}]}`, ""},
		{"complete", "completed", `{"type":"commandExecution","id":"command","command":"cat README.md","source":"agent","status":"completed","exitCode":0,"durationMs":0,"aggregatedOutput":"project documentation","commandActions":[{"type":"read","name":"README.md","path":"README.md","command":"cat README.md"}]}`, "completed"},
		{"declined", "completed", `{"type":"commandExecution","id":"denied","command":"git push","status":"declined"}`, "declined"},
		{"failed", "completed", `{"type":"commandExecution","id":"failed","command":"false","status":"completed","exitCode":1,"durationMs":1250}`, "failed"},
		{"cancelled", "completed", `{"type":"commandExecution","id":"cancelled","command":"sleep 5","status":"cancelled"}`, "cancelled"},
		{"interrupted", "completed", `{"type":"commandExecution","id":"interrupted","command":"sleep 5","status":"interrupted"}`, "interrupted"},
		{"mcp", "completed", `{"type":"mcpToolCall","id":"mcp","server":"github","tool":"get_issue","status":"completed","durationMs":1250}`, "completed"},
		{"incremental", "updated", `{"type":"webSearch","id":"search","query":"codex"}`, ""},
		{"unknown", "completed", `{"type":"commandExecution","id":"unknown","command":"pwd","status":"future-status","durationMs":-1}`, ""},
		{"mixed", "updated", `{"type":"commandExecution","id":"mixed","command":"cat README.md && opaque","commandActions":[{"type":"read","path":"README.md"},{"type":"unknown","command":"opaque"}]}`, ""},
		{"user", "completed", `{"type":"commandExecution","id":"user","command":"pwd","source":"userShell","status":"completed"}`, "completed"},
		{"cleared", "updated", `{"type":"commandExecution","id":"cleared","command":"pwd","commandActions":[]}`, ""},
	}
	observed := make(map[string]types.ToolCall)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var event codextypes.ItemCompletedEvent
			if err := json.Unmarshal([]byte(`{"type":"item.completed","turnId":"turn-1","item":`+tc.item+`}`), &event); err != nil {
				t.Fatal(err)
			}
			call, ok := mapLiveToolItem(event.Item, tc.phase, event.TurnID)
			if !ok || call.Activity == nil || call.Activity.Outcome != tc.outcome || call.Activity.Agent != "codex" || call.Activity.Origin != "live" {
				t.Fatalf("mapped call = %#v / %#v", call, call.Activity)
			}
			observed[tc.name] = call
		})
	}
	if len(observed) != len(cases) {
		t.Fatal("fixture mapping incomplete")
	}
	complete := observed["complete"]
	if complete.Activity.DurationMs == nil || *complete.Activity.DurationMs != 0 || (*complete.Activity.Actions)[0].Path != "README.md" || complete.Meta["command"] != "cat README.md" || complete.Content[0].Text != "project documentation" {
		t.Fatalf("native fields or details lost: %#v", complete)
	}
	if observed["mcp"].Activity.Tool.Server != "github" || observed["mcp"].Activity.NativeTurnID != "turn-1" || observed["mcp"].Activity.ParentCallID != "" {
		t.Fatal("MCP identity or turn facts are incorrect")
	}
	if observed["incremental"].Status != "running" || observed["unknown"].Status != "unknown" || observed["unknown"].Activity.DurationMs != nil || len(*observed["mixed"].Activity.Actions) != 0 || observed["user"].Activity.Source != "user_shell" {
		t.Fatal("incremental/unknown/mixed/source fallback is incorrect")
	}
	if observed["cleared"].Activity.Actions == nil || len(*observed["cleared"].Activity.Actions) != 0 {
		t.Fatal("explicit empty native actions were treated as absent")
	}
	if folder := os.Getenv("ACTIVITY_FIXTURE_DIR"); folder != "" {
		payload, err := json.MarshalIndent(observed, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(folder, "codex.json"), payload, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
