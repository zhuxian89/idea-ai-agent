package codex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	codextypes "github.com/fanwenlin/codex-go-sdk/types"
	agenttypes "mindfs/server/internal/agent/types"
)

func TestWrappedExecBlockFailureKeepsNativeIdentityAndScript(t *testing.T) {
	input := `text(await tools.exec_command({cmd:'sh -c "exit 7"'}));`
	call, ok := parseImportedCodexToolCall(map[string]any{"type": "custom_tool_call", "call_id": "wrapper", "name": "exec", "input": input}, 1)
	if !ok || call.Meta["wrapperTool"] != "exec" || call.Meta["wrapperInput"] != input || call.CallID != "wrapper" {
		t.Fatalf("lost wrapper provenance: %#v", call)
	}
	blocks := []any{map[string]any{"type": "input_text", "text": "Script completed"}, map[string]any{"type": "input_text", "text": `{"chunk_id":"native-result","exit_code":7,"output":""}`}}
	items := []agenttypes.ImportedExchange{{Role: "agent", Aux: []agenttypes.ImportedExchangeAux{{ToolCall: &call}}}}
	applyImportedCodexToolOutput(items, map[string]importedToolLocation{"wrapper": {ExchangeIndex: 0, AuxIndex: 0}}, map[string]any{"call_id": "wrapper", "status": "completed", "output": blocks}, time.Time{})
	if got := items[0].Aux[0].ToolCall; got.Status != "failed" || got.Activity.Outcome != "failed" {
		t.Fatalf("wrapper completion hid failed command: %#v", got)
	}
	if importedCodexWrappedExecFailed([]any{map[string]any{"type": "input_text", "text": `{"exit_code":7}`}}) {
		t.Fatal("arbitrary JSON without native execution envelope became failure")
	}
}

func TestImportedActivityFixtures(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rollout.jsonl")
	lines := []string{`{"type":"response_item","timestamp":"2026-09-14T01:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"检查项目"}]}}`, `{"type":"turn_context","payload":{"turn_id":"turn-1"}}`}
	cases := []struct {
		name, input string
		kind        agenttypes.ToolKind
	}{
		{"read_file", `{"path":"README.md"}`, agenttypes.ToolKindRead},
		{"list_dir", `{"path":"src"}`, agenttypes.ToolKindList},
		{"search_files", `{"query":"activity","path":"src"}`, agenttypes.ToolKindSearch},
		{"web_search", `{"query":"Codex"}`, agenttypes.ToolKindWebSearch},
		{"web_fetch", `{"url":"https://example.test"}`, agenttypes.ToolKindFetch},
		{"spawn_agent", `{"message":"inspect"}`, agenttypes.ToolKindTask},
		{"mcp__github__get_issue", `{}`, agenttypes.ToolKindOther},
		{"exec_command", `{"cmd":"false"}`, agenttypes.ToolKindExecute},
	}
	for _, tc := range cases {
		input, _ := json.Marshal(tc.input)
		line := `{"type":"response_item","timestamp":"2026-09-14T01:00:01Z","payload":{"type":"function_call","call_id":"` + tc.name + `","name":"` + tc.name + `","arguments":` + string(input) + `}}`
		lines = append(lines, line, `{"type":"response_item","timestamp":"2026-09-14T01:00:02Z","payload":{"type":"function_call_output","call_id":"`+tc.name+`","output":{"exit_code":1,"error":"business field","duration_ms":0}}}`, line)
	}
	native := `{"type":"commandExecution","id":"native","command":"cat README.md","status":"completed","source":"agent","durationMs":0,"exitCode":0,"commandActions":[{"type":"read","path":"README.md"}],"aggregatedOutput":"documentation"}`
	lines = append(lines, `{"type":"item.completed","turnId":"turn-1","timestamp":"2026-09-14T01:00:03Z","item":`+native+`}`, `{"type":"item.started","item":{"type":"commandExecution","id":"native","command":"cat README.md","status":"inProgress"}}`)
	original := []byte(strings.Join(lines, "\n"))
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	first, err := readCodexImportedExchanges(path, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := readCodexImportedExchanges(path, time.Time{})
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatal("reimport changed projection", err)
	}
	if len(first) != 2 || len(first[1].Aux) != len(cases)+1 {
		t.Fatalf("lost/duplicated tools: %#v", first)
	}
	observed := map[string]agenttypes.ToolCall{}
	for i, tc := range cases {
		call := *first[1].Aux[i].ToolCall
		if call.Kind != tc.kind || call.Activity == nil || call.Activity.Origin != "imported" || call.Activity.NativeTurnID != "turn-1" {
			t.Fatalf("%s: %#v", tc.name, call)
		}
		outcome := "completed"
		if tc.kind == agenttypes.ToolKindExecute {
			outcome = "failed"
		}
		if call.Activity.Outcome != outcome || call.Status == "running" {
			t.Fatalf("replay/result: %#v / %#v", call, call.Activity)
		}
		if tc.kind != agenttypes.ToolKindExecute && call.Activity.DurationMs != nil {
			t.Fatal("business duration treated as native timing")
		}
		observed[call.CallID] = call
	}
	call := *first[1].Aux[len(cases)].ToolCall
	var event codextypes.ItemCompletedEvent
	if err := json.Unmarshal([]byte(`{"type":"item.completed","item":`+native+`}`), &event); err != nil {
		t.Fatal(err)
	}
	live, _ := mapLiveToolItem(event.Item, "completed", "turn-1")
	live.Activity.Origin = "imported"
	if !reflect.DeepEqual(live.Activity, call.Activity) || call.Status != "complete" {
		t.Fatalf("live/native import differ: %#v / %#v", live.Activity, call.Activity)
	}
	observed[call.CallID] = call
	bytes, _ := os.ReadFile(path)
	if string(bytes) != string(original) {
		t.Fatal("native file was modified")
	}
	if folder := os.Getenv("ACTIVITY_HISTORY_FIXTURE_DIR"); folder != "" {
		payload, _ := json.MarshalIndent(observed, "", "  ")
		if err := os.WriteFile(filepath.Join(folder, "codex.json"), payload, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestImportedCodexOutcomeUsesNativeEnvelope(t *testing.T) {
	for _, state := range []string{"failed", "cancelled", "declined", "interrupted"} {
		call, _ := parseImportedCodexToolCall(map[string]any{"type": "function_call", "call_id": "call", "name": "exec_command", "arguments": `{"cmd":"pwd"}`}, 0)
		applyImportedCodexOutcome(&call, map[string]any{"status": state}, "error in stdout is not status", false)
		if call.Activity.Outcome != state || call.Activity.DurationMs != nil {
			t.Fatalf("%s: %#v", state, call.Activity)
		}
	}
}
