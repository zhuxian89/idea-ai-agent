package codex

import (
	"encoding/json"
	"strings"
	"time"

	codextypes "github.com/fanwenlin/codex-go-sdk/types"
	agenttypes "mindfs/server/internal/agent/types"
)

func importedCodexActivity(name string, kind agenttypes.ToolKind, input any, payload map[string]any) *agenttypes.ActivityFactsV1 {
	facts := &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: "codex", Origin: "imported", Operation: "other", Source: "agent", Tool: &agenttypes.ActivityTool{Name: name}}
	switch kind {
	case agenttypes.ToolKindExecute, agenttypes.ToolKindRead, agenttypes.ToolKindList, agenttypes.ToolKindSearch, agenttypes.ToolKindWebSearch, agenttypes.ToolKindFetch, agenttypes.ToolKindTask:
		facts.Operation = string(kind)
	case agenttypes.ToolKindEdit, agenttypes.ToolKindDelete, agenttypes.ToolKindMove:
		facts.Operation = "file_change"
	}
	if strings.HasPrefix(name, "mcp__") {
		facts.Operation = "mcp"
		parts := strings.SplitN(strings.TrimPrefix(name, "mcp__"), "__", 2)
		if len(parts) == 2 {
			facts.Tool.Server, facts.Tool.Name = parts[0], parts[1]
		}
	} else if strings.HasPrefix(name, "mcp.") {
		facts.Operation = "mcp"
	}
	args := importedCodexInputObject(input)
	path := asString(args["file_path"])
	if path == "" {
		path = asString(args["path"])
	}
	query := asString(args["pattern"])
	if query == "" {
		query = asString(args["query"])
	}
	if (kind == agenttypes.ToolKindRead || kind == agenttypes.ToolKindList) && path != "" {
		actions := []agenttypes.ActivityAction{{Type: string(kind), Path: path}}
		facts.Actions = &actions
	} else if kind == agenttypes.ToolKindSearch && query != "" {
		actions := []agenttypes.ActivityAction{{Type: "search", Path: path, Query: query}}
		facts.Actions = &actions
	}
	facts.Outcome = importedCodexOutcome(asString(payload["status"]))
	return facts
}

func importedCodexOutcome(status string) string {
	if status == "succeeded" {
		return "completed"
	}
	return agenttypes.NativeToolOutcome(status)
}

// Codex exec wrappers return text blocks containing the structured result of
// exec_command. Wrapper completion alone does not prove the command succeeded.
func importedCodexWrappedExecFailed(output any) bool {
	blocks, ok := output.([]any)
	if !ok {
		_ = json.Unmarshal([]byte(asString(output)), &blocks)
	}
	for _, block := range blocks {
		item, _ := block.(map[string]any)
		if asString(item["type"]) != "input_text" {
			continue
		}
		result := importedCodexInputObject(item["text"])
		// Only the native execution envelope, not arbitrary JSON in logs.
		if asString(result["chunk_id"]) == "" {
			continue
		}
		if code, ok := result["exit_code"].(float64); ok && code != 0 {
			return true
		}
	}
	return false
}

func applyImportedCodexOutcome(call *agenttypes.ToolCall, payload map[string]any, output any, failed bool) {
	outcome := importedCodexOutcome(asString(payload["status"]))
	if outcome == "completed" && failed && call.Kind == agenttypes.ToolKindExecute && call.Meta["wrapperTool"] == "exec" {
		outcome = "failed"
	}
	if outcome == "" {
		outcome = "completed"
		// Native execute/edit envelopes have execution semantics. An MCP
		// business object with an error or exit_code key does not.
		if (call.Kind == agenttypes.ToolKindExecute || call.Kind == agenttypes.ToolKindEdit) && failed {
			outcome = "failed"
		}
		if isError, _ := payload["is_error"].(bool); isError {
			outcome = "failed"
		}
	}
	if call.Kind == agenttypes.ToolKindExecute {
		result := importedCodexInputObject(output)
		for _, key := range []string{"cancelled", "canceled", "interrupted"} {
			if value, _ := result[key].(bool); value {
				outcome = "cancelled"
				if key == "interrupted" {
					outcome = "interrupted"
				}
			}
		}
		// Only explicit native milliseconds; never parse formatted wall-time
		// text or subtract exchange timestamps to manufacture a tool duration.
		for _, key := range []string{"duration_ms", "durationMs"} {
			if value, ok := result[key].(float64); ok {
				call.Activity.DurationMs = agenttypes.NativeToolDuration(&value)
			}
		}
	}
	if call.Activity != nil {
		if call.Activity.Outcome == "declined" && outcome == "failed" {
			outcome = "declined"
		}
		call.Activity.Outcome = outcome
	}
	call.Status = outcome
	if outcome == "completed" {
		call.Status = "complete"
	}
}

func mergeImportedCodexCall(items []agenttypes.ImportedExchange, locations map[string]importedToolLocation, next agenttypes.ToolCall) bool {
	location, ok := locations[next.CallID]
	if !ok {
		return false
	}
	old := items[location.ExchangeIndex].Aux[location.AuxIndex].ToolCall
	if agenttypes.NativeToolOutcome(old.Status) != "" && agenttypes.IsRunningToolStatus(next.Status) {
		old.Activity = agenttypes.MergeActivityFacts(next.Activity, old.Activity)
	} else {
		old.Activity = agenttypes.MergeActivityFacts(old.Activity, next.Activity)
	}
	old.Status = agenttypes.MergeToolStatus(old.Status, next.Status)
	if len(next.Content) > 0 {
		old.Content = next.Content
	}
	if len(next.Locations) > 0 {
		old.Locations = next.Locations
	}
	if old.Meta == nil {
		old.Meta = map[string]any{}
	}
	for key, value := range next.Meta {
		old.Meta[key] = value
	}
	return true
}

func appendImportedCodexNativeItem(items []agenttypes.ImportedExchange, locations map[string]importedToolLocation, payload map[string]any, phase, turnID string, timestamp time.Time) []agenttypes.ImportedExchange {
	// Decode only tool items already supported by the live adapter. Other
	// response items (reasoning, messages, etc.) keep their original handling.
	switch asString(payload["type"]) {
	case "commandExecution", "command_execution", "mcpToolCall", "mcp_tool_call", "fileChange", "file_change", "webSearch", "web_search", "collabToolCall", "collabAgentToolCall", "collab_tool_call", "dynamicToolCall", "imageView":
	default:
		return items
	}
	encoded, err := json.Marshal(map[string]any{"type": "item." + phase, "item": payload})
	if err != nil {
		return items
	}
	var event codextypes.ItemCompletedEvent
	if json.Unmarshal(encoded, &event) != nil || event.Item == nil {
		return items
	}
	call, ok := mapLiveToolItem(event.Item, phase, turnID)
	if !ok || strings.TrimSpace(call.CallID) == "" {
		return items
	}
	call.Activity.Origin = "imported"
	if mergeImportedCodexCall(items, locations, call) {
		return items
	}
	var exchangeIndex, auxIndex int
	items, exchangeIndex, auxIndex = appendMergedCodexExchange(items, "agent", "", timestamp, []agenttypes.ImportedExchangeAux{{ToolCall: &call}})
	locations[call.CallID] = importedToolLocation{ExchangeIndex: exchangeIndex, AuxIndex: auxIndex}
	return items
}
