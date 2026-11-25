package usecase

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/session"
)

func currentAssistantLine(responseText string) int {
	if responseText == "" {
		return 0
	}
	return strings.Count(responseText, "\n") + 1
}

func hydratePendingToolCallAux(ctx context.Context, manager *session.Manager, sessionKey string, aux session.ExchangeAux) session.ExchangeAux {
	if manager == nil || aux.ToolCall == nil || strings.TrimSpace(aux.ToolCall.CallID) == "" {
		return aux
	}
	if aux.ToolCall.Kind != agenttypes.ToolKindAskUser {
		return aux
	}
	latest, err := manager.GetFullToolCall(ctx, sessionKey, aux.ToolCall.CallID)
	if err != nil || latest == nil {
		return aux
	}
	if latest.Kind != agenttypes.ToolKindAskUser {
		return aux
	}
	toolCall := *latest
	aux.ToolCall = &toolCall
	return aux
}

func dedupeExchangeAuxBuffer(items []session.ExchangeAux) []session.ExchangeAux {
	if len(items) == 0 {
		return nil
	}
	seenToolCallIDs := make(map[string]int, len(items))
	seenPlanIDs := make(map[string]struct{}, len(items))
	seenCompactIDs := make(map[string]struct{}, len(items))
	seenTodo := false
	seenTurnDiff := false
	out := make([]session.ExchangeAux, 0, len(items))
	for i := len(items) - 1; i >= 0; i-- {
		item := items[i]
		callID := ""
		if item.ToolCall != nil {
			callID = strings.TrimSpace(item.ToolCall.CallID)
		}
		if callID != "" {
			if existingIndex, exists := seenToolCallIDs[callID]; exists {
				if out[existingIndex].ToolCall != nil {
					merged := mergeBufferedToolCall(*item.ToolCall, *out[existingIndex].ToolCall)
					out[existingIndex].ToolCall = &merged
				}
				continue
			}
			seenToolCallIDs[callID] = len(out)
		}
		isTodo := item.Todo != nil || (item.ToolCall != nil && item.ToolCall.Kind == agenttypes.ToolKindTodo)
		if isTodo {
			if seenTodo {
				continue
			}
			seenTodo = true
		}
		if item.Plan != nil {
			planID := strings.TrimSpace(item.Plan.ID)
			if planID != "" {
				if _, exists := seenPlanIDs[planID]; exists {
					continue
				}
				seenPlanIDs[planID] = struct{}{}
			}
		}
		if item.Compact != nil {
			compactID := strings.TrimSpace(item.Compact.ID)
			if compactID != "" {
				if _, exists := seenCompactIDs[compactID]; exists {
					continue
				}
				seenCompactIDs[compactID] = struct{}{}
			}
		}
		if item.TurnDiff != nil {
			if seenTurnDiff {
				continue
			}
			seenTurnDiff = true
		}
		out = append(out, item)
	}
	for left, right := 0, len(out)-1; left < right; left, right = left+1, right-1 {
		out[left], out[right] = out[right], out[left]
	}
	return out
}

func shouldPersistToolCallAux(toolCall agenttypes.ToolCall) bool {
	if toolCall.RawType != "claude_task" {
		return true
	}
	return strings.TrimSpace(stringMeta(toolCall.Meta, "subtype")) != "task_progress"
}

func mergeBufferedToolCall(base, next agenttypes.ToolCall) agenttypes.ToolCall {
	merged := base
	merged.Activity = agenttypes.MergeActivityFacts(base.Activity, next.Activity)
	if strings.TrimSpace(next.CallID) != "" {
		merged.CallID = next.CallID
	}
	if strings.TrimSpace(next.Title) != "" {
		merged.Title = next.Title
	}
	if strings.TrimSpace(next.Status) != "" {
		merged.Status = agenttypes.MergeToolStatus(base.Status, next.Status)
	}
	if next.Kind != "" {
		merged.Kind = next.Kind
	}
	if len(next.Content) > 0 {
		merged.Content = append([]agenttypes.ToolCallContentItem(nil), next.Content...)
	}
	if len(next.Locations) > 0 {
		merged.Locations = append([]agenttypes.ToolCallLocation(nil), next.Locations...)
	}
	if strings.TrimSpace(next.RawType) != "" {
		merged.RawType = next.RawType
	}
	if len(base.Meta) > 0 || len(next.Meta) > 0 {
		merged.Meta = make(map[string]any, len(base.Meta)+len(next.Meta))
		for key, value := range base.Meta {
			merged.Meta[key] = value
		}
		for key, value := range next.Meta {
			merged.Meta[key] = value
		}
		if stringMeta(base.Meta, "taskTool") == "TaskCreate" && stringMeta(next.Meta, "taskTool") == "TaskUpdate" {
			merged.Meta["taskTool"] = "TaskCreate"
		}
	}
	return merged
}

func appendResponseChunk(responseText, lastResponseUpdateType, chunk string) string {
	if responseText != "" &&
		(lastResponseUpdateType == string(agenttypes.EventTypeThoughtChunk) ||
			lastResponseUpdateType == string(agenttypes.EventTypeToolCall) ||
			lastResponseUpdateType == string(agenttypes.EventTypeToolUpdate) ||
			lastResponseUpdateType == string(agenttypes.EventTypeTodoUpdate) ||
			lastResponseUpdateType == string(agenttypes.EventTypePlanUpdate) ||
			lastResponseUpdateType == string(agenttypes.EventTypeCompact)) &&
		!strings.HasSuffix(responseText, "\n\n") &&
		!strings.HasSuffix(responseText, "\n") {
		responseText += "\n\n"
	}
	return responseText + chunk
}

func randomHex(bytes int) string {
	if bytes <= 0 {
		return ""
	}
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func stringMeta(meta map[string]any, key string) string {
	if meta == nil {
		return ""
	}
	value, _ := meta[key].(string)
	return strings.TrimSpace(value)
}

func stringSliceMeta(meta map[string]any, key string) []string {
	if meta == nil {
		return nil
	}
	switch value := meta[key].(type) {
	case []string:
		return append([]string(nil), value...)
	case []any:
		out := make([]string, 0, len(value))
		for _, item := range value {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				out = append(out, strings.TrimSpace(text))
			}
		}
		return out
	default:
		return nil
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if limit <= 0 || len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit]) + "..."
}

type pathNormalizer interface {
	NormalizePath(string) (string, error)
}

func normalizeAgentUpdatePaths(root pathNormalizer, update agenttypes.Event) agenttypes.Event {
	if root == nil {
		return update
	}
	if turnDiff, ok := update.Data.(agenttypes.TurnDiffUpdate); ok {
		turnDiff.Diff = normalizeDiffTextPaths(root, turnDiff.Diff)
		update.Data = turnDiff
		return update
	}
	toolCall, ok := update.Data.(agenttypes.ToolCall)
	if !ok {
		return update
	}

	for i := range toolCall.Locations {
		toolCall.Locations[i].Path = normalizeToolPath(root, toolCall.Locations[i].Path)
	}
	for i := range toolCall.Content {
		toolCall.Content[i].Path = normalizeToolPath(root, toolCall.Content[i].Path)
		if toolCall.Content[i].Type == "text" {
			toolCall.Content[i].Text = normalizeDiffTextPaths(root, toolCall.Content[i].Text)
		}
	}
	if toolCall.Meta != nil {
		if filePath, ok := toolCall.Meta["filePath"].(string); ok {
			toolCall.Meta["filePath"] = normalizeToolPath(root, filePath)
		}
		if path, ok := toolCall.Meta["path"].(string); ok {
			toolCall.Meta["path"] = normalizeToolPath(root, path)
		}
	}
	update.Data = toolCall
	return update
}

func compactAgentUpdate(update agenttypes.Event) agenttypes.Event {
	switch update.Type {
	case agenttypes.EventTypeToolCall, agenttypes.EventTypeToolUpdate:
		if toolCall, ok := update.Data.(agenttypes.ToolCall); ok {
			update.Data = session.CompactToolCall(toolCall)
		}
	}
	return update
}

func normalizeToolPath(root pathNormalizer, path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	normalized, err := root.NormalizePath(path)
	if err != nil {
		return path
	}
	return normalized
}

func relatedFileRecordPath(managedRootAbs, runtimeRootAbs, path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	slashPath := filepath.ToSlash(path)
	if strings.HasPrefix(slashPath, ".worktree/task-") {
		return filepath.Clean(filepath.Join(managedRootAbs, filepath.FromSlash(slashPath)))
	}
	runtimeRootAbs = strings.TrimSpace(runtimeRootAbs)
	managedRootAbs = strings.TrimSpace(managedRootAbs)
	if runtimeRootAbs != "" && managedRootAbs != "" && !sameManagedDirPath(runtimeRootAbs, managedRootAbs) {
		return filepath.Clean(filepath.Join(runtimeRootAbs, filepath.FromSlash(slashPath)))
	}
	return path
}

func normalizeDiffTextPaths(root pathNormalizer, text string) string {
	if strings.TrimSpace(text) == "" {
		return text
	}
	lines := strings.Split(text, "\n")
	changed := false
	for i, line := range lines {
		next, ok := normalizeDiffLine(root, line)
		if !ok || next == line {
			continue
		}
		lines[i] = next
		changed = true
	}
	if !changed {
		return text
	}
	return strings.Join(lines, "\n")
}

func normalizeDiffLine(root pathNormalizer, line string) (string, bool) {
	switch {
	case strings.HasPrefix(line, "diff --git "):
		rest := strings.TrimPrefix(line, "diff --git ")
		parts := strings.SplitN(rest, " ", 2)
		if len(parts) != 2 {
			return line, false
		}
		left, leftOK := normalizeDiffRef(root, parts[0])
		right, rightOK := normalizeDiffRef(root, parts[1])
		if !leftOK && !rightOK {
			return line, false
		}
		return "diff --git " + left + " " + right, true
	case strings.HasPrefix(line, "--- "):
		next, ok := normalizeDiffRef(root, strings.TrimPrefix(line, "--- "))
		if !ok {
			return line, false
		}
		return "--- " + next, true
	case strings.HasPrefix(line, "+++ "):
		next, ok := normalizeDiffRef(root, strings.TrimPrefix(line, "+++ "))
		if !ok {
			return line, false
		}
		return "+++ " + next, true
	default:
		return line, false
	}
}

func normalizeDiffRef(root pathNormalizer, ref string) (string, bool) {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" || trimmed == "/dev/null" {
		return ref, false
	}

	prefix := ""
	path := trimmed
	switch {
	case strings.HasPrefix(trimmed, "a/"), strings.HasPrefix(trimmed, "b/"):
		prefix = trimmed[:2]
		path = trimmed[2:]
	}

	normalized := normalizeToolPath(root, path)
	if normalized == path || normalized == "" {
		return ref, false
	}
	return prefix + normalized, true
}
