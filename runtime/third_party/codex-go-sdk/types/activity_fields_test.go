package types

import (
	"encoding/json"
	"testing"
)

func TestNativeToolDurationFields(t *testing.T) {
	for _, payload := range []string{
		`{"id":"cmd","type":"commandExecution","command":"pwd","durationMs":0}`,
		`{"id":"cmd","type":"command_execution","command":"pwd","duration_ms":0}`,
	} {
		var item CommandExecutionItem
		if err := json.Unmarshal([]byte(payload), &item); err != nil || item.DurationMs == nil || *item.DurationMs != 0 {
			t.Fatalf("duration decode: %#v, %v", item, err)
		}
	}
	var command CommandExecutionItem
	if err := json.Unmarshal([]byte(`{"id":"old","command":"pwd"}`), &command); err != nil || command.DurationMs != nil {
		t.Fatalf("missing duration must stay absent: %#v, %v", command, err)
	}
	var mcp McpToolCallItem
	if err := json.Unmarshal([]byte(`{"id":"mcp","type":"mcpToolCall","durationMs":12.5}`), &mcp); err != nil || mcp.DurationMs == nil || *mcp.DurationMs != 12.5 {
		t.Fatalf("MCP duration decode: %#v, %v", mcp, err)
	}
}
