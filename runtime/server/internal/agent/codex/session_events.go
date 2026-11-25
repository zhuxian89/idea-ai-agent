package codex

import (
	"encoding/json"
	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
	codextypes "github.com/fanwenlin/codex-go-sdk/types"
	"log"
	types "mindfs/server/internal/agent/types"
	"strings"
)

func (s *session) logRawToolItem(item codexsdk.ThreadItem) {
	if s == nil || s.agentDebugLog == nil || !isToolItem(item) {
		return
	}
	raw, err := json.Marshal(item)
	if err != nil {
		return
	}
	s.agentDebugLog.AppendRaw(raw)
}

func (s *session) handleRawEvent(event *codexsdk.RawEvent) bool {
	if event == nil {
		return false
	}
	switch normalizeEventType(event.Type) {
	case "thread.status.changed":
		return true
	case "thread.tokenUsage.updated":
		usage, ok := parseContextWindow(event.Raw)
		if !ok {
			return false
		}
		s.mu.Lock()
		s.contextWindow = usage
		s.mu.Unlock()
		return true
	case "item.plan.delta":
		plan, ok := parsePlanDelta(event.Raw)
		if !ok {
			return false
		}
		plan = s.accumulatePlanUpdate(plan)
		s.emit(types.Event{Type: types.EventTypePlanUpdate, SessionID: s.SessionID(), Data: plan})
		return true
	case "turn.plan.updated":
		todo, ok := parseTurnPlanUpdate(event.Raw)
		if !ok {
			return false
		}
		s.emit(types.Event{Type: types.EventTypeTodoUpdate, SessionID: s.SessionID(), Data: todo})
		return true
	}
	return false
}

func (s *session) accumulatePlanUpdate(plan types.PlanUpdate) types.PlanUpdate {
	if !plan.Delta {
		return plan
	}
	id := strings.TrimSpace(plan.ID)
	if id == "" {
		return plan
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.planTextByID == nil {
		s.planTextByID = make(map[string]string)
	}
	next := s.planTextByID[id] + plan.Content
	s.planTextByID[id] = next
	plan.Content = next
	plan.Delta = false
	return plan
}

func normalizeEventType(value string) string {
	return strings.ReplaceAll(strings.TrimSpace(value), "/", ".")
}

func parsePlanDelta(raw json.RawMessage) (types.PlanUpdate, bool) {
	var payload struct {
		ItemID string `json:"itemId"`
		Delta  string `json:"delta"`
		Raw    struct {
			ItemID string `json:"itemId"`
			Delta  string `json:"delta"`
		} `json:"raw"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return types.PlanUpdate{}, false
	}
	itemID := firstNonEmpty(payload.ItemID, payload.Raw.ItemID)
	delta := firstNonEmpty(payload.Delta, payload.Raw.Delta)
	if strings.TrimSpace(itemID) == "" && strings.TrimSpace(delta) == "" {
		return types.PlanUpdate{}, false
	}
	return types.PlanUpdate{ID: itemID, Content: delta, Delta: true}, true
}

func parseTurnPlanUpdate(raw json.RawMessage) (types.TodoUpdate, bool) {
	var payload struct {
		Plan []struct {
			Step   string `json:"step"`
			Status string `json:"status"`
		} `json:"plan"`
		Raw struct {
			Plan []struct {
				Step   string `json:"step"`
				Status string `json:"status"`
			} `json:"plan"`
		} `json:"raw"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return types.TodoUpdate{}, false
	}
	steps := payload.Plan
	if len(steps) == 0 {
		steps = payload.Raw.Plan
	}
	if len(steps) == 0 {
		return types.TodoUpdate{}, false
	}
	items := make([]types.TodoItem, 0, len(steps))
	for _, step := range steps {
		content := strings.TrimSpace(step.Step)
		if content == "" {
			continue
		}
		items = append(items, types.TodoItem{Content: content, Status: normalizeTodoStatus(step.Status)})
	}
	return types.TodoUpdate{Items: items}, len(items) > 0
}

func normalizeTodoStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "complete", "done":
		return "completed"
	case "inprogress", "in_progress", "running":
		return "in_progress"
	default:
		return "pending"
	}
}

func parseContextWindow(raw json.RawMessage) (types.ContextWindow, bool) {
	var payload struct {
		TokenUsage struct {
			Last *struct {
				TotalTokens int `json:"totalTokens"`
			} `json:"last"`
			ModelContextWindow int `json:"modelContextWindow"`
		} `json:"tokenUsage"`
		Raw json.RawMessage `json:"raw"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return types.ContextWindow{}, false
	}
	if payload.TokenUsage.Last == nil && len(payload.Raw) > 0 && string(payload.Raw) != "null" {
		return parseContextWindow(payload.Raw)
	}
	if payload.TokenUsage.Last == nil || payload.TokenUsage.Last.TotalTokens < 0 || payload.TokenUsage.ModelContextWindow <= 0 {
		return types.ContextWindow{}, false
	}
	return types.ContextWindow{
		TotalTokens:        payload.TokenUsage.Last.TotalTokens,
		ModelContextWindow: payload.TokenUsage.ModelContextWindow,
	}, true
}

func messageDelta(prev, next string) string {
	if next == "" {
		return ""
	}
	if prev == "" {
		return next
	}
	if strings.HasPrefix(next, prev) {
		return next[len(prev):]
	}
	return next
}

func mapToolItem(item codexsdk.ThreadItem, started bool) (types.ToolCall, bool) {
	switch v := item.(type) {
	case *codexsdk.CommandExecutionItem:
		status := normalizeStatus(string(v.Status), started)
		content := []types.ToolCallContentItem{}
		if v.AggregatedOutput != nil && strings.TrimSpace(*v.AggregatedOutput) != "" {
			content = append(content, types.ToolCallContentItem{Type: "text", Text: *v.AggregatedOutput})
		}
		meta := map[string]any{
			"rawType": "commandExecution",
			"command": v.Command,
		}
		if strings.TrimSpace(v.Source) != "" {
			meta["source"] = v.Source
		}
		if v.ExitCode != nil {
			meta["exitCode"] = *v.ExitCode
		}
		return types.ToolCall{
			CallID:  v.ID,
			Title:   codexCommandTitle(v.CommandActions, v.Command),
			Status:  status,
			Kind:    types.ToolKindExecute,
			Content: content,
			RawType: "commandExecution",
			Meta:    meta,
		}, true
	case *codexsdk.FileChangeItem:
		status := normalizeStatus(string(v.Status), started)
		locations := make([]types.ToolCallLocation, 0, len(v.Changes))
		content := []types.ToolCallContentItem{}
		for _, change := range v.Changes {
			if strings.TrimSpace(change.Path) == "" {
				continue
			}
			locations = append(locations, types.ToolCallLocation{Path: change.Path})
			if strings.TrimSpace(change.Diff) != "" {
				content = append(content, types.ToolCallContentItem{
					Type:       "text",
					Text:       change.Diff,
					Path:       change.Path,
					ChangeKind: string(change.Kind.Type),
				})
			}
		}
		if strings.TrimSpace(v.Output) != "" {
			content = append(content, types.ToolCallContentItem{Type: "text", Text: v.Output})
		}
		return types.ToolCall{
			CallID:    v.ID,
			Status:    status,
			Kind:      types.ToolKindEdit,
			Locations: locations,
			Content:   content,
			RawType:   "fileChange",
		}, true
	case *codexsdk.McpToolCallItem:
		status := normalizeStatus(string(v.Status), started)
		meta := map[string]any{
			"rawType": "mcpToolCall",
			"server":  v.Server,
			"tool":    v.Tool,
		}
		return types.ToolCall{
			CallID:  v.ID,
			Title:   firstNonEmpty(v.Tool, "mcp_tool"),
			Status:  status,
			Kind:    types.ToolKindOther,
			Content: errorContent(v.Error),
			RawType: "mcpToolCall",
			Meta:    meta,
		}, true
	case *codexsdk.WebSearchItem:
		query := strings.TrimSpace(v.Query)
		content := []types.ToolCallContentItem{}
		if query != "" {
			content = append(content, types.ToolCallContentItem{Type: "text", Text: "**Query:** " + query})
		}
		return types.ToolCall{
			CallID:  v.ID,
			Title:   firstNonEmpty(query, "web search"),
			Status:  normalizeStatus("", started),
			Kind:    types.ToolKindWebSearch,
			Content: content,
			RawType: "webSearch",
			Meta: map[string]any{
				"rawType": "webSearch",
				"query":   query,
			},
		}, true
	case *codexsdk.ErrorItem:
		message := strings.TrimSpace(v.Message)
		if message == "" {
			message = "codex item error"
		}
		return types.ToolCall{
			CallID:  v.ID,
			Title:   "error",
			Status:  "failed",
			Kind:    types.ToolKindOther,
			Content: []types.ToolCallContentItem{{Type: "text", Text: message}},
			RawType: "error",
			Meta: map[string]any{
				"rawType": "error",
			},
		}, true
	case *codexsdk.CollabToolCallItem:
		status := normalizeStatus(v.Status, started)
		meta := map[string]any{
			"rawType":           "collabToolCall",
			"type":              v.Type,
			"tool":              v.Tool,
			"status":            status,
			"senderThreadId":    v.SenderThreadID,
			"receiverThreadIds": append([]string(nil), v.ReceiverThreadIDs...),
			"agentsStates":      v.AgentsStates,
		}
		if prompt := stringPtrValue(v.Prompt); prompt != "" {
			meta["prompt"] = prompt
		}
		if model := stringPtrValue(v.Model); model != "" {
			meta["model"] = model
		}
		if effort := stringPtrValue(v.ReasoningEffort); effort != "" {
			meta["reasoningEffort"] = effort
		}
		if v.Arguments != nil {
			meta["arguments"] = v.Arguments
		}
		if v.Result != nil {
			meta["result"] = v.Result
		}
		content := collabToolContent(v)
		content = append(content, errorContent(v.Error)...)
		return types.ToolCall{
			CallID:  v.ID,
			Title:   collabToolTitle(v),
			Status:  status,
			Kind:    types.ToolKindTask,
			Content: content,
			RawType: "collabToolCall",
			Meta:    meta,
		}, true
	case *codextypes.UnknownItem:
		return mapUnknownToolItem(v, started)
	default:
		return types.ToolCall{}, false
	}
}

func codexCommandTitle(actions []codexsdk.CommandAction, command string) string {
	command = firstNonEmpty(strings.TrimSpace(command), "command")
	if len(actions) != 1 {
		for _, action := range actions {
			if action.Type == codexsdk.CommandActionTypeUnknown {
				return command
			}
		}
		if len(actions) > 1 {
			return "Explore files · " + command
		}
		return command
	}

	action := actions[0]
	path := ""
	if action.Path != nil {
		path = strings.TrimSpace(*action.Path)
	}
	switch action.Type {
	case codexsdk.CommandActionTypeRead:
		name := firstNonEmpty(strings.TrimSpace(action.Name), path)
		if name != "" {
			return "Read " + name + " · " + command
		}
		return "Read file · " + command
	case codexsdk.CommandActionTypeListFiles:
		if path != "" {
			return "List files in " + path + " · " + command
		}
		return "List files · " + command
	case codexsdk.CommandActionTypeSearch:
		query := ""
		if action.Query != nil {
			query = strings.TrimSpace(*action.Query)
		}
		switch {
		case query != "" && path != "":
			return "Search for " + query + " in " + path + " · " + command
		case query != "":
			return "Search for " + query + " · " + command
		case path != "":
			return "Search in " + path + " · " + command
		default:
			return "Search files · " + command
		}
	default:
		return command
	}
}

func mapUnknownToolItem(item *codextypes.UnknownItem, started bool) (types.ToolCall, bool) {
	if item == nil {
		return types.ToolCall{}, false
	}
	switch item.GetType() {
	case "dynamicToolCall":
		return mapDynamicToolCall(item.Raw, started)
	case "hookPrompt":
		return mapHookPrompt(item.Raw, started)
	case "imageGeneration":
		return mapImageGeneration(item.Raw, started)
	default:
		return types.ToolCall{}, false
	}
}

func mapDynamicToolCall(raw json.RawMessage, started bool) (types.ToolCall, bool) {
	var payload struct {
		ID           string          `json:"id"`
		Namespace    *string         `json:"namespace"`
		Tool         string          `json:"tool"`
		Arguments    json.RawMessage `json:"arguments"`
		Status       string          `json:"status"`
		ContentItems []struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			ImageURL string `json:"imageUrl"`
		} `json:"contentItems"`
		Success    *bool `json:"success"`
		DurationMs *int  `json:"durationMs"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return types.ToolCall{}, false
	}
	meta := map[string]any{
		"rawType": "dynamicToolCall",
		"tool":    payload.Tool,
	}
	if payload.Namespace != nil && strings.TrimSpace(*payload.Namespace) != "" {
		meta["namespace"] = strings.TrimSpace(*payload.Namespace)
	}
	if len(payload.Arguments) > 0 && string(payload.Arguments) != "null" {
		meta["arguments"] = string(payload.Arguments)
	}
	if payload.Success != nil {
		meta["success"] = *payload.Success
	}
	if payload.DurationMs != nil {
		meta["durationMs"] = *payload.DurationMs
	}
	content := make([]types.ToolCallContentItem, 0, len(payload.ContentItems))
	for _, item := range payload.ContentItems {
		if strings.TrimSpace(item.Text) != "" {
			content = append(content, types.ToolCallContentItem{Type: "text", Text: item.Text})
		} else if strings.TrimSpace(item.ImageURL) != "" {
			content = append(content, types.ToolCallContentItem{Type: "text", Text: item.ImageURL})
		}
	}
	return types.ToolCall{
		CallID:  payload.ID,
		Title:   firstNonEmpty(payload.Tool, "dynamic tool"),
		Status:  normalizeStatus(payload.Status, started),
		Kind:    types.ToolKindOther,
		Content: content,
		RawType: "dynamicToolCall",
		Meta:    meta,
	}, true
}

func mapHookPrompt(raw json.RawMessage, started bool) (types.ToolCall, bool) {
	var payload struct {
		ID        string `json:"id"`
		Fragments []struct {
			Text      string `json:"text"`
			HookRunID string `json:"hookRunId"`
		} `json:"fragments"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return types.ToolCall{}, false
	}
	parts := make([]string, 0, len(payload.Fragments))
	hookRunIDs := make([]string, 0, len(payload.Fragments))
	for _, fragment := range payload.Fragments {
		if text := strings.TrimSpace(fragment.Text); text != "" {
			parts = append(parts, text)
		}
		if id := strings.TrimSpace(fragment.HookRunID); id != "" {
			hookRunIDs = append(hookRunIDs, id)
		}
	}
	meta := map[string]any{"rawType": "hookPrompt"}
	if len(hookRunIDs) > 0 {
		meta["hookRunIds"] = hookRunIDs
	}
	content := []types.ToolCallContentItem{}
	if len(parts) > 0 {
		content = append(content, types.ToolCallContentItem{Type: "text", Text: strings.Join(parts, "\n\n")})
	}
	return types.ToolCall{
		CallID:  payload.ID,
		Title:   "hook prompt",
		Status:  normalizeStatus("", started),
		Kind:    types.ToolKindOther,
		Content: content,
		RawType: "hookPrompt",
		Meta:    meta,
	}, true
}

func mapImageGeneration(raw json.RawMessage, started bool) (types.ToolCall, bool) {
	var payload struct {
		ID            string  `json:"id"`
		Status        string  `json:"status"`
		RevisedPrompt *string `json:"revisedPrompt"`
		Result        string  `json:"result"`
		SavedPath     string  `json:"savedPath"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return types.ToolCall{}, false
	}
	content := []types.ToolCallContentItem{}
	if prompt := stringPtrValue(payload.RevisedPrompt); prompt != "" {
		content = append(content, types.ToolCallContentItem{Type: "text", Text: prompt})
	}
	if strings.TrimSpace(payload.Result) != "" {
		content = append(content, types.ToolCallContentItem{Type: "text", Text: payload.Result})
	}
	if strings.TrimSpace(payload.SavedPath) != "" {
		content = append(content, types.ToolCallContentItem{Type: "text", Text: payload.SavedPath})
	}
	return types.ToolCall{
		CallID:  payload.ID,
		Title:   "image generation",
		Status:  normalizeStatus(payload.Status, started),
		Kind:    types.ToolKindOther,
		Content: content,
		RawType: "imageGeneration",
		Meta: map[string]any{
			"rawType": "imageGeneration",
		},
	}, true
}

func isToolItem(item codexsdk.ThreadItem) bool {
	switch item.(type) {
	case *codexsdk.CommandExecutionItem, *codexsdk.FileChangeItem, *codexsdk.McpToolCallItem, *codexsdk.WebSearchItem, *codexsdk.ErrorItem, *codexsdk.CollabToolCallItem:
		return true
	case *codextypes.UnknownItem:
		switch item.GetType() {
		case "dynamicToolCall", "hookPrompt", "imageGeneration":
			return true
		}
		return false
	default:
		return false
	}
}

func errorContent(err *codexsdk.McpToolCallError) []types.ToolCallContentItem {
	if err == nil || strings.TrimSpace(err.Message) == "" {
		return []types.ToolCallContentItem{}
	}
	return []types.ToolCallContentItem{{Type: "text", Text: err.Message}}
}

func collabToolContent(item *codexsdk.CollabToolCallItem) []types.ToolCallContentItem {
	if item == nil {
		return nil
	}
	if strings.EqualFold(strings.TrimSpace(item.Tool), "wait") {
		return nil
	}
	if prompt := stringPtrValue(item.Prompt); prompt != "" {
		return []types.ToolCallContentItem{{Type: "text", Text: prompt}}
	}
	return nil
}

func collabToolTitle(item *codexsdk.CollabToolCallItem) string {
	if item == nil {
		return "collab_tool"
	}
	receiver := firstNonEmpty(item.ReceiverThreadIDs...)
	tool := strings.TrimSpace(item.Tool)
	switch tool {
	case "spawnAgent":
		parts := make([]string, 0, 2)
		if model := stringPtrValue(item.Model); model != "" {
			parts = append(parts, model)
		}
		if effort := stringPtrValue(item.ReasoningEffort); effort != "" {
			parts = append(parts, effort)
		}
		settings := ""
		if len(parts) > 0 {
			settings = " (" + strings.Join(parts, " ") + ")"
		}
		prompt := truncateRunes(stringPtrValue(item.Prompt), 80)
		return strings.TrimSpace("Spawn " + receiver + settings + "  " + prompt)
	case "wait":
		return strings.TrimSpace("Waiting for " + receiver)
	default:
		return firstNonEmpty(tool, "collab_tool")
	}
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if limit <= 0 || len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit]) + "..."
}

func normalizeStatus(status string, started bool) string {
	s := strings.ToLower(strings.TrimSpace(status))
	switch s {
	case "inprogress", "in_progress", "running", "pending":
		return "running"
	case "completed", "complete", "success":
		return "complete"
	case "failed", "error", "declined":
		return "failed"
	case "":
		if started {
			return "running"
		}
		return "complete"
	default:
		return s
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func logUnhandledEvent(sessionKey, scope string, raw []byte) {
	const maxRawLogBytes = 1024
	if len(raw) > maxRawLogBytes {
		raw = append(raw[:maxRawLogBytes], []byte("...(truncated)")...)
	}
	log.Printf("[agent/codex] unhandled.%s raw=%s", scope, string(raw))
}
