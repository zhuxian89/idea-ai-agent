package claude

import (
	"encoding/json"
	"strings"

	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"mindfs/server/internal/agent/types"
)

func claudeActivityFacts(name string, input json.RawMessage, parentCallID string) *types.ActivityFactsV1 {
	facts := &types.ActivityFactsV1{SchemaVersion: 1, Agent: "claude", Origin: "live", Source: "agent", Operation: "other",
		ParentCallID: parentCallID, Tool: &types.ActivityTool{Name: name}}
	var args struct {
		FilePath    string `json:"file_path"`
		Path        string `json:"path"`
		Pattern     string `json:"pattern"`
		Query       string `json:"query"`
		Description string `json:"description"`
	}
	// A partial input still has a reliable native tool name.
	_ = json.Unmarshal(input, &args)
	kind := mapToolKind(name)
	switch kind {
	case types.ToolKindExecute, types.ToolKindRead, types.ToolKindSearch, types.ToolKindWebSearch, types.ToolKindFetch:
		facts.Operation = string(kind)
	case types.ToolKindEdit, types.ToolKindDelete, types.ToolKindMove:
		facts.Operation = "file_change"
	case types.ToolKindTask:
		facts.Operation = "task"
	}
	if strings.HasPrefix(name, "mcp__") {
		facts.Operation = "mcp"
		parts := strings.SplitN(strings.TrimPrefix(name, "mcp__"), "__", 2)
		if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
			facts.Tool.Server, facts.Tool.Name = parts[0], parts[1]
		}
	}
	if kind == types.ToolKindExecute && strings.TrimSpace(args.Description) != "" {
		facts.DisplayLabel = &types.ActivityDisplayLabel{Text: args.Description, Source: "tool_argument"}
	}
	actions := []types.ActivityAction{}
	if kind == types.ToolKindRead && args.FilePath != "" {
		actions = append(actions, types.ActivityAction{Type: "read", Path: args.FilePath})
	} else if kind == types.ToolKindSearch {
		query := args.Pattern
		if query == "" {
			query = args.Query
		}
		if query != "" {
			actions = append(actions, types.ActivityAction{Type: "search", Query: query, Path: args.Path})
		}
	}
	if len(actions) > 0 {
		facts.Actions = &actions
	}
	return facts
}

// Read structured result fields, never infer status from words in stdout.
func claudeToolOutcome(msg claudeagent.UserMessage, kind types.ToolKind) string {
	var result map[string]any
	if kind == types.ToolKindExecute {
		_ = decodeToolResult(msg.ToolUseResult, &result)
		// Cancellation and interruption are more specific than the generic
		// error flag that the native result block may carry alongside them.
		for _, key := range []string{"interrupted", "cancelled", "canceled"} {
			if flag, ok := result[key].(bool); ok && flag {
				if key == "interrupted" {
					return "interrupted"
				}
				return "cancelled"
			}
		}
	}
	for _, block := range msg.Message.Content {
		if block.Type == "tool_result" && block.IsError != nil && *block.IsError {
			return "failed"
		}
	}
	// MCP and other tools may return arbitrary data with fields named status,
	// error or exitCode. Only the native result envelope determines their state.
	if kind != types.ToolKindExecute {
		return "completed"
	}
	for _, key := range []string{"is_error", "isError"} {
		if flag, ok := result[key].(bool); ok && flag {
			return "failed"
		}
	}
	for _, key := range []string{"exitCode", "exit_code"} {
		if code, ok := result[key].(float64); ok && code != 0 {
			return "failed"
		}
	}
	return "completed"
}

// A native result block carries its own ID. The legacy envelope fallback is
// used only for messages without blocks; concurrent calls are never guessed.
func (s *session) toolResultUpdates(msg claudeagent.UserMessage) []types.ToolCall {
	updates := []types.ToolCall{}
	hasBlocks := false
	for _, block := range msg.Message.Content {
		if block.Type != "tool_result" || block.ToolUseID == "" {
			continue
		}
		hasBlocks = true
		single := msg
		single.ParentToolUseID = &block.ToolUseID
		single.Message.Content = []claudeagent.UserContentBlock{block}
		if len(msg.Message.Content) != 1 || single.ToolUseResult == nil {
			single.ToolUseResult = block.Content
		}
		if single.ToolUseResult == nil {
			single.ToolUseResult = map[string]any{}
		}
		if update, ok := s.toolResultUpdate(single); ok {
			updates = append(updates, update)
		}
	}
	if !hasBlocks {
		if update, ok := s.toolResultUpdate(msg); ok {
			updates = append(updates, update)
		}
	}
	return updates
}

func (s *session) handleToolPermissionDenied(msg claudeagent.PermissionDeniedMessage) {
	if strings.TrimSpace(msg.ToolUseID) == "" {
		return
	}
	s.pendingToolMu.Lock()
	call, ok := s.pendingToolCalls[msg.ToolUseID]
	if ok {
		call.Activity = types.CloneActivityFacts(call.Activity)
		if call.Activity == nil {
			call.Activity = claudeActivityFacts(msg.ToolName, nil, "")
		}
		call.Activity.Outcome, call.Status = "declined", "declined"
		s.pendingToolCalls[msg.ToolUseID] = call
	}
	s.pendingToolMu.Unlock()
	if ok {
		s.emit(types.Event{Type: types.EventTypeToolUpdate, SessionID: s.SessionID(), Data: call})
	}
}
