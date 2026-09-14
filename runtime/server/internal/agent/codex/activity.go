package codex

import (
	"encoding/json"
	"strings"

	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
	codextypes "github.com/fanwenlin/codex-go-sdk/types"
	"mindfs/server/internal/agent/types"
)

// This is the live event boundary. Importers retain their existing behavior.
func mapLiveToolItem(item codexsdk.ThreadItem, phase, turnID string) (types.ToolCall, bool) {
	call, ok := mapToolItem(item, phase == "started")
	if !ok {
		return call, false
	}
	facts := &types.ActivityFactsV1{SchemaVersion: 1, Agent: "codex", Origin: "live", Source: "agent", Operation: "other", NativeTurnID: turnID}
	nativeStatus := ""
	switch native := item.(type) {
	case *codexsdk.CommandExecutionItem:
		facts.Operation, facts.Source = "execute", "unknown"
		if native.Source == "userShell" {
			facts.Source = "user_shell"
		} else if native.Source == "agent" {
			facts.Source = "agent"
		}
		facts.Actions = codexActivityActions(native.CommandActions)
		facts.DurationMs = types.NativeToolDuration(native.DurationMs)
		nativeStatus = string(native.Status)
		if native.ExitCode != nil && *native.ExitCode != 0 {
			nativeStatus = "failed"
		}
	case *codexsdk.McpToolCallItem:
		facts.Operation = "mcp"
		facts.Tool = &types.ActivityTool{Name: native.Tool, Server: native.Server}
		facts.DurationMs = types.NativeToolDuration(native.DurationMs)
		nativeStatus = string(native.Status)
		if native.Error != nil {
			nativeStatus = "failed"
		}
	case *codexsdk.FileChangeItem:
		facts.Operation, nativeStatus = "file_change", string(native.Status)
	case *codexsdk.WebSearchItem:
		facts.Operation = "web_search"
	case *codexsdk.ErrorItem:
		nativeStatus = "failed"
	case *codexsdk.CollabToolCallItem:
		facts.Operation = "task"
		facts.Tool = &types.ActivityTool{Name: native.Tool}
		nativeStatus = native.Status
		if native.Error != nil {
			nativeStatus = "failed"
		}
	case *codextypes.UnknownItem:
		var payload struct {
			Status     string   `json:"status"`
			Success    *bool    `json:"success"`
			DurationMs *float64 `json:"durationMs"`
			Tool       string   `json:"tool"`
			Namespace  string   `json:"namespace"`
		}
		if json.Unmarshal(native.Raw, &payload) == nil {
			nativeStatus = payload.Status
			facts.DurationMs = types.NativeToolDuration(payload.DurationMs)
			if payload.Tool != "" {
				facts.Tool = &types.ActivityTool{Name: payload.Tool, Server: payload.Namespace}
			}
			if payload.Success != nil {
				nativeStatus = "completed"
				if !*payload.Success {
					nativeStatus = "failed"
				}
			}
		}
	}
	facts.Outcome = types.NativeToolOutcome(nativeStatus)
	if facts.Outcome == "" && phase == "completed" && strings.TrimSpace(nativeStatus) == "" {
		facts.Outcome = "completed"
	}
	// An item update without a status is not evidence of completion.
	if facts.Outcome != "" {
		call.Status = facts.Outcome
		if facts.Outcome == "completed" {
			call.Status = "complete"
		}
	} else if phase == "completed" {
		call.Status = "unknown"
	} else {
		call.Status = "running"
	}
	call.Activity = facts
	return call, true
}

func codexActivityActions(native []codexsdk.CommandAction) *[]types.ActivityAction {
	if native == nil {
		return nil
	}
	actions := make([]types.ActivityAction, 0, len(native))
	for _, action := range native {
		projected := types.ActivityAction{Path: stringPtrValue(action.Path)}
		switch action.Type {
		case codexsdk.CommandActionTypeRead:
			projected.Type, projected.Name = "read", action.Name
		case codexsdk.CommandActionTypeListFiles:
			projected.Type = "list"
		case codexsdk.CommandActionTypeSearch:
			projected.Type, projected.Query = "search", stringPtrValue(action.Query)
		default:
			// Clear any earlier all-known projection instead of misrepresenting
			// mixed commands as only the recognized read/search operations.
			empty := []types.ActivityAction{}
			return &empty
		}
		actions = append(actions, projected)
	}
	return &actions
}
