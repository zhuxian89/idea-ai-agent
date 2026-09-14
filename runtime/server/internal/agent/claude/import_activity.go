package claude

import (
	"encoding/json"
	"strings"

	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	agenttypes "mindfs/server/internal/agent/types"
)

func importedClaudeOutcome(call agenttypes.ToolCall, block map[string]any, result any) string {
	encoded, _ := json.Marshal(block)
	var native claudeagent.UserContentBlock
	_ = json.Unmarshal(encoded, &native)
	msg := claudeagent.UserMessage{ToolUseResult: result}
	msg.Message.Content = []claudeagent.UserContentBlock{native}
	outcome := claudeToolOutcome(msg, call.Kind)
	if call.Activity != nil && call.Activity.Outcome == "declined" && outcome == "failed" {
		return "declined"
	}
	return outcome
}

func importedClaudePermissionDenied(items []importedExchangeLocator, locations map[string]importedToolLocation, raw map[string]any) {
	location, ok := locations[strings.TrimSpace(asString(raw["tool_use_id"]))]
	if !ok {
		return
	}
	call := items[location.ExchangeIndex].Aux[location.AuxIndex].ToolCall
	if call != nil && call.Activity != nil {
		call.Activity.Outcome, call.Status = "declined", "declined"
	}
}

// Native replay can repeat a tool_use block. Keep its original position and
// result; a repeated start is not evidence that the call ran again.
func mergeImportedClaudeTools(items []importedExchangeLocator, locations map[string]importedToolLocation, aux []agenttypes.ImportedExchangeAux, parentID string) []agenttypes.ImportedExchangeAux {
	filtered := make([]agenttypes.ImportedExchangeAux, 0, len(aux))
	seen := make(map[string]bool)
	for _, entry := range aux {
		call := entry.ToolCall
		if call == nil {
			filtered = append(filtered, entry)
			continue
		}
		call.Activity.ParentCallID = parentID
		if location, ok := locations[call.CallID]; ok {
			old := items[location.ExchangeIndex].Aux[location.AuxIndex].ToolCall
			old.Activity = agenttypes.MergeActivityFacts(old.Activity, call.Activity)
			continue
		}
		if !seen[call.CallID] {
			filtered = append(filtered, entry)
			seen[call.CallID] = true
		}
	}
	return filtered
}
