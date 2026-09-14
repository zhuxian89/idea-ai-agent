package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"mindfs/server/internal/agent/types"
)

func TestNativeActivityFixtures(t *testing.T) {
	s := &session{}
	observed := map[string]types.ToolCall{}
	s.OnUpdate(func(event types.Event) {
		if call, ok := event.Data.(types.ToolCall); ok {
			observed[call.CallID] = call
		}
	})
	var assistant claudeagent.AssistantMessage
	if err := json.Unmarshal([]byte(`{"type":"assistant","parent_tool_use_id":"parent-1","message":{"role":"assistant","content":[
		{"type":"tool_use","id":"bash","name":"Bash","input":{"command":"npm test","description":"检查测试结果"}},
		{"type":"tool_use","id":"read","name":"Read","input":{"file_path":"README.md"}},
		{"type":"tool_use","id":"search","name":"Grep","input":{"pattern":"activity","path":"src"}},
		{"type":"tool_use","id":"mcp","name":"mcp__github__get_issue","input":{"number":1}},
		{"type":"tool_use","id":"denied","name":"Bash","input":{"command":"git push"}},
		{"type":"tool_use","id":"cancelled","name":"Bash","input":{"command":"sleep 1"}},
		{"type":"tool_use","id":"interrupted","name":"Bash","input":{"command":"sleep 1"}}
	]}}`), &assistant); err != nil {
		t.Fatal(err)
	}
	s.handleAssistantMessage(assistant, false)
	observed["bash-start"] = observed["bash"]
	if observed["bash"].Activity.DisplayLabel.Text != "检查测试结果" || observed["bash"].Activity.ParentCallID != "parent-1" || observed["bash"].Activity.Outcome != "" {
		t.Fatal("Claude description/parent/start facts lost")
	}
	if (*observed["read"].Activity.Actions)[0].Path != "README.md" || (*observed["search"].Activity.Actions)[0].Query != "activity" || observed["mcp"].Activity.Tool.Server != "github" {
		t.Fatal("Claude structured action/MCP facts lost")
	}
	s.handleToolPermissionDenied(claudeagent.PermissionDeniedMessage{ToolUseID: "denied", ToolName: "Bash"})
	var result claudeagent.UserMessage
	if err := json.Unmarshal([]byte(`{"type":"user","message":{"role":"user","content":[
		{"type":"tool_result","tool_use_id":"read","content":"documentation","is_error":false},
		{"type":"tool_result","tool_use_id":"bash","content":"tests failed","is_error":true},
		{"type":"tool_result","tool_use_id":"mcp","content":{"status":"failed","exitCode":1},"is_error":false},
		{"type":"tool_result","tool_use_id":"denied","content":"permission denied","is_error":true},
		{"type":"tool_result","tool_use_id":"cancelled","content":{"cancelled":true},"is_error":true},
		{"type":"tool_result","tool_use_id":"interrupted","content":{"interrupted":true},"is_error":true}
	]}}`), &result); err != nil {
		t.Fatal(err)
	}
	s.handleUserMessage(result)
	for id, outcome := range map[string]string{"bash": "failed", "read": "completed", "mcp": "completed", "denied": "declined", "cancelled": "cancelled", "interrupted": "interrupted"} {
		call := observed[id]
		if call.Activity == nil || call.Activity.Outcome != outcome || call.Activity.DurationMs != nil {
			t.Fatalf("%s outcome/duration = %#v", id, call.Activity)
		}
	}
	if len(observed["bash"].Content) != 1 || len(observed["read"].Content) != 1 || observed["bash"].Content[0].Text != "tests failed" || observed["read"].Content[0].Text != "documentation" || len(s.pendingToolCalls) != 1 {
		t.Fatal("per-call result matching or original output lost")
	}
	// Duplicate result delivery cannot fall back onto the unrelated pending search.
	s.handleUserMessage(result)
	if observed["search"].Activity.Outcome != "" || len(s.pendingToolCalls) != 1 {
		t.Fatal("duplicate result was assigned to another call")
	}
	if folder := os.Getenv("ACTIVITY_FIXTURE_DIR"); folder != "" {
		payload, err := json.MarshalIndent(observed, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(folder, "claude.json"), payload, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestNativeBashOutcomeDoesNotReadStdoutOrTurnDuration(t *testing.T) {
	for _, tc := range []struct {
		raw     string
		outcome string
	}{
		{`{"stdout":"error: an example message","duration_ms":50000}`, "completed"},
		{`{"exitCode":2}`, "failed"},
		{`{"interrupted":true}`, "interrupted"},
		{`{"cancelled":true,"is_error":true}`, "cancelled"},
		{`{"canceled":true,"isError":true,"exitCode":1}`, "cancelled"},
	} {
		var value any
		if err := json.Unmarshal([]byte(tc.raw), &value); err != nil {
			t.Fatal(err)
		}
		if got := claudeToolOutcome(claudeagent.UserMessage{ToolUseResult: value}, types.ToolKindExecute); got != tc.outcome {
			t.Fatalf("%s => %s", tc.raw, got)
		}
	}
}
