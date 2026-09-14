package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
)

func TestImportedActivityFixtures(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.jsonl")
	lines := []string{`{"type":"user","uuid":"u1","timestamp":"2026-09-14T01:00:00Z","message":{"content":[{"type":"text","text":"检查项目"}]}}`}
	cases := []struct{ name, input, result, outcome string }{
		{"Read", `{"file_path":"README.md"}`, `"documentation"`, "completed"},
		{"Grep", `{"pattern":"activity","path":"src"}`, `"matches"`, "completed"},
		{"WebSearch", `{"query":"Codex"}`, `"links"`, "completed"},
		{"WebFetch", `{"url":"https://example.test"}`, `"page"`, "completed"},
		{"Agent", `{"description":"检查测试"}`, `"done"`, "completed"},
		{"mcp__github__get_issue", `{}`, `{"status":"failed","error":"business field","exitCode":1}`, "completed"},
		{"Bash", `{"command":"go test ./...","description":"检查测试结果"}`, `{"cancelled":true}`, "cancelled"},
		{"Bash", `{"command":"sleep 5"}`, `{"interrupted":true}`, "interrupted"},
		{"Bash", `{"command":"false"}`, `{"exitCode":1}`, "failed"},
		{"Bash", `{"command":"git push"}`, `"permission denied"`, "declined"},
	}
	for i, tc := range cases {
		id := string(rune('a' + i))
		line := `{"type":"assistant","uuid":"a-` + id + `","parent_tool_use_id":"parent","timestamp":"2026-09-14T01:00:01Z","message":{"content":[{"type":"tool_use","id":"` + id + `","name":"` + tc.name + `","input":` + tc.input + `}]}}`
		lines = append(lines, line)
		if tc.outcome == "declined" {
			lines = append(lines, `{"type":"system","subtype":"permission_denied","tool_use_id":"`+id+`","tool_name":"Bash"}`)
		}
		isError := "false"
		if tc.outcome != "completed" {
			isError = "true"
		}
		lines = append(lines, `{"type":"user","timestamp":"2026-09-14T01:00:02Z","toolUseResult":`+tc.result+`,"message":{"content":[{"type":"tool_result","tool_use_id":"`+id+`","content":`+tc.result+`,"is_error":`+isError+`}]}}`, line)
	}
	lines = append(lines, `{"type":"assistant","uuid":"end","timestamp":"2026-09-14T01:00:03Z","message":{"content":[{"type":"text","text":"检查完成"}]}}`)
	original := []byte(strings.Join(lines, "\n"))
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	first, err := readClaudeImportedExchanges(path, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := readClaudeImportedExchanges(path, time.Time{})
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatal("reimport changed projection", err)
	}
	if len(first) != 2 || len(first[1].Aux) != len(cases) {
		t.Fatalf("lost/duplicated tools: %#v", first)
	}
	observed := map[string]agenttypes.ToolCall{}
	for i, tc := range cases {
		call := *first[1].Aux[i].ToolCall
		if call.Activity == nil || call.Activity.Origin != "imported" || call.Activity.Agent != "claude" || call.Activity.ParentCallID != "parent" || call.Activity.Outcome != tc.outcome || call.Activity.DurationMs != nil {
			t.Fatalf("%s facts: %#v", tc.name, call.Activity)
		}
		live := claudeActivityFacts(tc.name, json.RawMessage(tc.input), "parent")
		live.Origin, live.Outcome = "imported", tc.outcome
		if !reflect.DeepEqual(live, call.Activity) {
			t.Fatalf("live/import differ: %#v / %#v", live, call.Activity)
		}
		observed[call.CallID] = call
	}
	bytes, _ := os.ReadFile(path)
	if string(bytes) != string(original) {
		t.Fatal("native file was modified")
	}
	if folder := os.Getenv("ACTIVITY_HISTORY_FIXTURE_DIR"); folder != "" {
		payload, _ := json.MarshalIndent(observed, "", "  ")
		if err := os.WriteFile(filepath.Join(folder, "claude.json"), payload, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
