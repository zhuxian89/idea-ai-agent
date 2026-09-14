package claudeagent

import (
	"encoding/json"
	"testing"
)

func TestToolResultBlockPreservesNativeIdentityContentAndError(t *testing.T) {
	var message UserMessage
	data := `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"call-1","content":[{"type":"text","text":"original error"}],"is_error":true}]}}`
	if err := json.Unmarshal([]byte(data), &message); err != nil {
		t.Fatal(err)
	}
	block := message.Message.Content[0]
	if block.ToolUseID != "call-1" || block.IsError == nil || !*block.IsError || block.Content == nil {
		t.Fatalf("result fields lost: %#v", block)
	}
	payload, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	var again UserMessage
	if err := json.Unmarshal(payload, &again); err != nil || again.Message.Content[0].ToolUseID != "call-1" {
		t.Fatalf("roundtrip failed: %s, %v", payload, err)
	}
}
