package codex

import agenttypes "mindfs/server/internal/agent/types"

// token_count follows the assistant response in native JSONL, while
// turn_context precedes it. Keep the snapshot inside that native turn only.
type importedReplyMetadata struct {
	turnID     string
	effort     string
	agentIndex int
	seenItems  int
	window     *agenttypes.ContextWindow
}

func (m *importedReplyMetadata) start(turnID, effort string) {
	if turnID == "" || turnID != m.turnID {
		m.agentIndex = -1
		m.window = nil
	}
	m.turnID, m.effort = turnID, effort
}

func (m *importedReplyMetadata) attach(items []agenttypes.ImportedExchange) {
	if len(items) == 0 {
		return
	}
	index := len(items) - 1
	if items[index].Role == "user" {
		if len(items) > m.seenItems {
			m.agentIndex = -1
			m.window = nil
		}
		m.seenItems = len(items)
		return
	}
	// A new turn_context must not overwrite the previous turn before the
	// next assistant exchange exists. Updates within an exchange keep its index.
	if len(items) > m.seenItems || m.agentIndex == index {
		m.agentIndex = index
		items[index].Effort = m.effort
		if m.window != nil {
			value := *m.window
			items[index].ContextWindow = &value
		}
	}
	m.seenItems = len(items)
}

func (m *importedReplyMetadata) tokenCount(raw map[string]any, items []agenttypes.ImportedExchange) {
	payload, _ := raw["payload"].(map[string]any)
	if asString(payload["type"]) != "token_count" {
		return
	}
	info, _ := payload["info"].(map[string]any)
	last, _ := info["last_token_usage"].(map[string]any)
	used, usedOK := last["total_tokens"].(float64)
	capacity, capacityOK := info["model_context_window"].(float64)
	if !usedOK || !capacityOK || used < 0 || capacity <= 0 {
		return
	}
	// total_token_usage is cumulative billing usage, never Context occupancy.
	m.window = &agenttypes.ContextWindow{TotalTokens: int(used), ModelContextWindow: int(capacity)}
	if m.agentIndex >= 0 && m.agentIndex < len(items) {
		value := *m.window
		items[m.agentIndex].ContextWindow = &value
	}
}
