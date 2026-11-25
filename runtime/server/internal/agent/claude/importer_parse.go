package claude

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	agenttypes "mindfs/server/internal/agent/types"
	"strings"
	"time"
)

func extractClaudeMessageText(raw any) string {
	if text := strings.TrimSpace(asString(raw)); text != "" {
		return text
	}
	parts, _ := raw.([]any)
	lines := make([]string, 0, len(parts))
	for _, part := range parts {
		item, _ := part.(map[string]any)
		if item == nil {
			continue
		}
		if strings.TrimSpace(asString(item["type"])) != "text" {
			continue
		}
		if text := strings.TrimSpace(asString(item["text"])); text != "" {
			lines = append(lines, text)
		}
	}
	return strings.TrimSpace(strings.Join(lines, "\n\n"))
}

func extractClaudeUserPreview(raw any) string {
	if text := strings.TrimSpace(asString(raw)); text != "" {
		if isMeaningfulClaudeUserText(text) {
			return text
		}
		return ""
	}
	parts, _ := raw.([]any)
	for index := len(parts) - 1; index >= 0; index-- {
		item, _ := parts[index].(map[string]any)
		if item == nil || strings.TrimSpace(asString(item["type"])) != "text" {
			continue
		}
		text := strings.TrimSpace(asString(item["text"]))
		if isMeaningfulClaudeUserText(text) {
			return text
		}
	}
	return ""
}

func extractClaudeImportedUserText(raw any) string {
	if text := strings.TrimSpace(asString(raw)); text != "" {
		if isMeaningfulClaudeUserText(text) {
			return text
		}
		return ""
	}
	parts, _ := raw.([]any)
	texts := make([]string, 0, len(parts))
	for _, value := range parts {
		item, _ := value.(map[string]any)
		if item == nil || strings.TrimSpace(asString(item["type"])) != "text" {
			continue
		}
		text := strings.TrimSpace(asString(item["text"]))
		if isMeaningfulClaudeUserText(text) {
			texts = append(texts, text)
		}
	}
	return strings.TrimSpace(strings.Join(texts, "\n\n"))
}

func extractClaudeToolUseAux(raw any) []agenttypes.ImportedExchangeAux {
	parts, _ := raw.([]any)
	aux := make([]agenttypes.ImportedExchangeAux, 0)
	textParts := make([]string, 0)
	for _, part := range parts {
		item, _ := part.(map[string]any)
		if item == nil {
			continue
		}
		switch strings.TrimSpace(asString(item["type"])) {
		case "text":
			if text := strings.TrimSpace(asString(item["text"])); text != "" {
				textParts = append(textParts, text)
			}
		case "tool_use":
			callID := strings.TrimSpace(asString(item["id"]))
			name := strings.TrimSpace(asString(item["name"]))
			if callID == "" {
				continue
			}
			input, _ := json.Marshal(item["input"])
			toolCall := newRunningToolCall(callID, name, "tool_use", input)
			toolCall.Activity = claudeActivityFacts(name, input, "")
			toolCall.Activity.Origin = "imported"
			aux = append(aux, agenttypes.ImportedExchangeAux{
				Line:     importedAssistantLine(strings.Join(textParts, "\n\n")),
				ToolCall: &toolCall,
			})
		}
	}
	return aux
}

func applyClaudeToolResults(
	items []importedExchangeLocator,
	locations map[string]importedToolLocation,
	raw any,
	toolUseResult any,
	timestamp time.Time,
) {
	parts, _ := raw.([]any)
	for _, part := range parts {
		item, _ := part.(map[string]any)
		if item == nil || strings.TrimSpace(asString(item["type"])) != "tool_result" {
			continue
		}
		callID := strings.TrimSpace(asString(item["tool_use_id"]))
		location, ok := locations[callID]
		if !ok || location.ExchangeIndex < 0 || location.ExchangeIndex >= len(items) {
			continue
		}
		exchange := &items[location.ExchangeIndex]
		if location.AuxIndex < 0 || location.AuxIndex >= len(exchange.Aux) {
			continue
		}
		aux := &exchange.Aux[location.AuxIndex]
		if aux.ToolCall == nil {
			continue
		}
		if !timestamp.IsZero() {
			exchange.Timestamp = timestamp
		}
		toolCall := *aux.ToolCall
		output := summarizeToolResult(toolCall.Kind, item["content"])
		if output == "" {
			output = summarizeGenericToolResult(item["content"])
		}
		result := toolUseResult
		if len(parts) != 1 || result == nil {
			result = item["content"]
		}
		outcome := importedClaudeOutcome(toolCall, item, result)
		toolCall.Activity.Outcome = outcome
		toolCall.Status = outcome
		if outcome == "completed" {
			toolCall.Status = "complete"
		}
		if strings.TrimSpace(output) != "" {
			toolCall.Meta = mergeToolCallMeta(toolCall.Meta, map[string]any{"output": output})
			if toolCall.Kind != agenttypes.ToolKindEdit || len(toolCall.Content) == 0 {
				toolCall.Content = []agenttypes.ToolCallContentItem{{Type: "text", Text: output}}
			}
		}
		if toolCall.Kind == agenttypes.ToolKindAskUser {
			if answers := importedClaudeAskUserAnswers(toolCall, toolUseResult); len(answers) > 0 {
				toolCall.Meta = mergeToolCallMeta(toolCall.Meta, map[string]any{"answers": answers})
			}
		}
		aux.ToolCall = &toolCall
	}
}

func importedClaudeAskUserAnswers(toolCall agenttypes.ToolCall, raw any) map[string]string {
	result, _ := raw.(map[string]any)
	rawAnswers, _ := result["answers"].(map[string]any)
	if len(rawAnswers) == 0 {
		return nil
	}
	input := importedClaudeToolInput(toolCall)
	questions, _ := input["questions"].([]any)
	answers := make(map[string]string)
	for index, value := range questions {
		question, _ := value.(map[string]any)
		if question == nil {
			continue
		}
		questionText := strings.TrimSpace(asString(question["question"]))
		if questionText == "" {
			continue
		}
		answer := strings.TrimSpace(asString(rawAnswers[questionText]))
		if answer != "" {
			answers[fmt.Sprintf("q_%d", index)] = answer
		}
	}
	return answers
}

func importedClaudeToolInput(toolCall agenttypes.ToolCall) map[string]any {
	if toolCall.Meta == nil {
		return nil
	}
	raw := strings.TrimSpace(asString(toolCall.Meta["input"]))
	if raw == "" {
		return nil
	}
	var input map[string]any
	if json.Unmarshal([]byte(raw), &input) != nil {
		return nil
	}
	return input
}

func importedAssistantLine(content string) int {
	if content == "" {
		return 0
	}
	return strings.Count(content, "\n") + 1
}

func isMeaningfulClaudeUserText(text string) bool {
	text = strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n"))
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	if strings.HasPrefix(lower, "<local-command-caveat>") ||
		strings.HasPrefix(lower, "<command-name>") ||
		strings.HasPrefix(lower, "<local-command-stdout>") ||
		strings.HasPrefix(lower, "<local-command-stderr>") ||
		strings.HasPrefix(lower, "this session was migrated from elsewhere.") ||
		strings.HasPrefix(lower, "this session is being continued from a previous conversation") {
		return false
	}
	if strings.Contains(lower, "<command-message>") || strings.Contains(lower, "<command-args>") {
		return false
	}
	if strings.Contains(lower, "<local-command-stdout>") || strings.Contains(lower, "<local-command-stderr>") {
		return false
	}
	if strings.Contains(lower, "<local-command-caveat>") {
		return false
	}
	if strings.Contains(lower, "\"type\": \"tool_result\"") || strings.Contains(lower, "'type': 'tool_result'") {
		return false
	}
	return true
}

func appendMergedClaudeExchangeLocator(
	items []importedExchangeLocator,
	role, content string,
	ts time.Time,
	uuid string,
	aux []agenttypes.ImportedExchangeAux,
	segment importedContentSegment,
) ([]importedExchangeLocator, int, int) {
	content = strings.TrimSpace(content)
	if content == "" && len(aux) == 0 {
		return items, -1, 0
	}
	if len(items) > 0 && items[len(items)-1].Role == role {
		last := &items[len(items)-1]
		lineOffset := importedAssistantLine(last.Content)
		if content != "" {
			if last.Content == "" {
				last.Content = content
			} else {
				last.Content = strings.TrimSpace(last.Content + "\n\n" + content)
			}
		}
		if !ts.IsZero() {
			last.Timestamp = ts
		}
		if strings.TrimSpace(uuid) != "" {
			last.ClaudeLastMessageUUID = strings.TrimSpace(uuid)
		}
		if segment.Content != "" {
			last.Segments = append(last.Segments, segment)
		}
		auxStart := len(last.Aux)
		for _, item := range aux {
			item.Line += lineOffset
			last.Aux = append(last.Aux, item)
		}
		return items, len(items) - 1, auxStart
	}
	item := importedExchangeLocator{
		ImportedExchange: agenttypes.ImportedExchange{
			Role:      role,
			Content:   content,
			Timestamp: ts,
			Aux:       aux,
		},
		ClaudeLastMessageUUID: strings.TrimSpace(uuid),
	}
	if segment.Content != "" {
		item.Segments = append(item.Segments, segment)
	}
	items = append(items, item)
	return items, len(items) - 1, 0
}

// isClaudeTaskNotificationLine reports whether the raw JSONL line was emitted
// by the native CLI as a background task notification rather than typed by the
// user. Only the explicit origin marker is trusted: identical text quoted or
// pasted by a real user carries no origin and must stay visible, and unknown
// origin kinds are treated as user content.
func isClaudeTaskNotificationLine(raw map[string]any) bool {
	origin, _ := raw["origin"].(map[string]any)
	if origin == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(asString(origin["kind"])), "task-notification")
}

// ProjectExternalSessionDisplay derives display-only content overrides for the
// canonical user exchanges ImportExternalSession returns for the same input.
// It reuses the same parse and merge rules, and records every intermediate
// merged state as a snapshot so persisted caches taken from an earlier, shorter
// prefix of the JSONL file still match. The native file itself, the canonical
// exchange list, and Seq/AgentCtxSeq bookkeeping are never modified.
func (i *Importer) ProjectExternalSessionDisplay(ctx context.Context, in agenttypes.ImportExternalSessionInput) (agenttypes.ExternalSessionDisplayProjection, error) {
	rootPath := normalizeComparablePath(in.RootPath)
	if rootPath == "" {
		return agenttypes.ExternalSessionDisplayProjection{}, errors.New("root path required")
	}
	targetID := strings.TrimSpace(in.AgentSessionID)
	if targetID == "" {
		return agenttypes.ExternalSessionDisplayProjection{}, errors.New("agent session id required")
	}
	file, ok, err := i.resolveClaudeDisplaySessionFile(ctx, targetID, rootPath)
	if err != nil {
		return agenttypes.ExternalSessionDisplayProjection{}, err
	}
	if !ok {
		return agenttypes.ExternalSessionDisplayProjection{}, errors.New("external session not found")
	}
	locators, err := readClaudeImportedExchangeLocators(file.Path, time.Time{})
	if err != nil {
		return agenttypes.ExternalSessionDisplayProjection{}, err
	}
	users := make(map[int][]agenttypes.ExternalSessionDisplaySnapshot)
	for index, locator := range locators {
		if locator.Role != "user" || len(locator.Segments) == 0 {
			continue
		}
		snapshots := claudeUserDisplaySnapshots(locator.Segments)
		if len(snapshots) > 0 {
			users[index] = snapshots
		}
	}
	return agenttypes.ExternalSessionDisplayProjection{
		AgentSessionID: file.AgentSessionID,
		Users:          users,
	}, nil
}
