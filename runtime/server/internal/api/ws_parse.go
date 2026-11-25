package api

import (
	"encoding/json"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/api/usecase"
	"strings"
)

func updateToEvent(update agenttypes.Event) *StreamEvent {
	switch update.Type {
	case agenttypes.EventTypeMessageChunk:
		if chunk, ok := update.Data.(agenttypes.MessageChunk); ok {
			return &StreamEvent{Type: "message_chunk", Data: chunk}
		}
	case agenttypes.EventTypeThoughtChunk:
		if chunk, ok := update.Data.(agenttypes.ThoughtChunk); ok {
			return &StreamEvent{Type: "thought_chunk", Data: chunk}
		}
	case agenttypes.EventTypeToolCall:
		if tc, ok := update.Data.(agenttypes.ToolCall); ok {
			return &StreamEvent{Type: "tool_call", Data: tc}
		}
	case agenttypes.EventTypeToolUpdate:
		if tu, ok := update.Data.(agenttypes.ToolCall); ok {
			return &StreamEvent{Type: "tool_call_update", Data: tu}
		}
	case agenttypes.EventTypeTodoUpdate:
		if todo, ok := update.Data.(agenttypes.TodoUpdate); ok {
			return &StreamEvent{Type: "todo_update", Data: todo}
		}
	case agenttypes.EventTypePlanUpdate:
		if plan, ok := update.Data.(agenttypes.PlanUpdate); ok {
			return &StreamEvent{Type: "plan_update", Data: plan}
		}
	case agenttypes.EventTypeCompact:
		if compact, ok := update.Data.(agenttypes.CompactNotice); ok {
			return &StreamEvent{Type: "compact_notice", Data: compact}
		}
	case agenttypes.EventTypeLogin:
		if login, ok := update.Data.(agenttypes.LoginNotice); ok {
			return &StreamEvent{Type: "login_notice", Data: login}
		}
	case agenttypes.EventTypeMessageDone:
		if done, ok := update.Data.(agenttypes.MessageDone); ok {
			return &StreamEvent{Type: "message_done", Data: done}
		}
		return &StreamEvent{Type: "message_done", Data: agenttypes.MessageDone{}}
	case agenttypes.EventTypeRecovery:
		if recovery, ok := update.Data.(agenttypes.RecoveryStatus); ok {
			return &StreamEvent{Type: "recovery", Data: recovery}
		}
		return &StreamEvent{Type: "recovery", Data: agenttypes.RecoveryStatus{}}
	}
	return nil
}

func normalizeAgentErrorMessage(err error) string {
	if err == nil {
		return "Unknown error"
	}
	raw := strings.TrimSpace(err.Error())
	if raw == "" {
		return "Unknown error"
	}
	var payload struct {
		Message string `json:"message"`
	}
	if strings.HasPrefix(raw, "{") && json.Unmarshal([]byte(raw), &payload) == nil && strings.TrimSpace(payload.Message) != "" {
		return strings.TrimSpace(payload.Message)
	}
	return raw
}

func parsePlanMessage(content string) (bool, string) {
	trimmed := strings.TrimSpace(content)
	lower := strings.ToLower(trimmed)
	if lower == "/plan" {
		return true, ""
	}
	if strings.HasPrefix(lower, "/plan ") {
		return true, strings.TrimSpace(trimmed[len("/plan"):])
	}
	return false, content
}

func getString(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	if value, ok := payload[key]; ok {
		if s, ok := value.(string); ok {
			return s
		}
	}
	return ""
}

func getInt(payload map[string]any, key string) int {
	if payload == nil {
		return 0
	}
	value, ok := payload[key]
	if !ok {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case float64:
		return int(typed)
	case string:
		parsed := 0
		for _, ch := range strings.TrimSpace(typed) {
			if ch < '0' || ch > '9' {
				return 0
			}
			parsed = parsed*10 + int(ch-'0')
		}
		return parsed
	default:
		return 0
	}
}

func normalizeFastServiceValue(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "on":
		return "on"
	case "off":
		return "off"
	default:
		return ""
	}
}

func getBool(payload map[string]any, key string) bool {
	if payload == nil {
		return false
	}
	value, ok := payload[key]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "true", "yes", "on", "fast":
			return true
		default:
			return false
		}
	default:
		return false
	}
}

func parseStringMap(raw any) map[string]string {
	items, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string]string, len(items))
	for key, value := range items {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		switch v := value.(type) {
		case string:
			if trimmed := strings.TrimSpace(v); trimmed != "" {
				out[key] = trimmed
			}
		case []any:
			parts := make([]string, 0, len(v))
			for _, item := range v {
				if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
					parts = append(parts, strings.TrimSpace(text))
				}
			}
			if len(parts) > 0 {
				out[key] = strings.Join(parts, ", ")
			}
		}
	}
	return out
}

func parseClientContext(payload map[string]any, rootID string) usecase.ClientContext {
	ctx := usecase.ClientContext{CurrentRoot: rootID}
	if payload == nil {
		return ctx
	}
	raw, ok := payload["context"]
	if !ok || raw == nil {
		return ctx
	}
	body, err := json.Marshal(raw)
	if err != nil {
		return ctx
	}
	if err := json.Unmarshal(body, &ctx); err != nil {
		return ctx
	}
	if ctx.CurrentRoot == "" {
		ctx.CurrentRoot = rootID
	}
	return ctx
}
