package usecase

import (
	"context"
	"strings"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/session"
)

// Match stable call IDs first, then ordered exchange text within the owning
// agent. Never use the current selector or timestamp proximity as identity.
func reconcileImportedActivity(ctx context.Context, manager *session.Manager, current *session.Session, agentName string, imported []agenttypes.ImportedExchange, copiedPrefix int, full bool) ([]agenttypes.ImportedExchange, error) {
	if len(current.Exchanges) == 0 {
		return imported, nil
	}
	aux, err := manager.GetExchangeAux(ctx, current.Key, 0)
	if err != nil {
		return nil, err
	}
	callSeq := make(map[string]int)
	liveCodexCommandTurns := make(map[string]bool)
	for seq, entries := range aux {
		for _, entry := range entries {
			if entry.ToolCall != nil && entry.ToolCall.CallID != "" {
				callSeq[entry.ToolCall.CallID] = seq
				call := entry.ToolCall
				if facts := call.Activity; facts != nil && facts.Agent == "codex" && facts.Origin == "live" &&
					facts.NativeTurnID != "" && call.Meta["rawType"] == "commandExecution" {
					liveCodexCommandTurns[facts.NativeTurnID] = true
				}
			}
		}
	}
	updates := []session.ExchangeAux{}
	metadata := []session.Exchange{}
	imported = append([]agenttypes.ImportedExchange(nil), imported...)
	position, lastMatched, userSeq := 0, -1, 0
	unmatched := []agenttypes.ImportedExchange{}
	for index, incoming := range imported {
		// Model exec wrappers and nested app-server commands are different
		// identity namespaces. A live-backed turn already shows the commands;
		// do not append its outer wrapper as another successful command. Keep
		// standalone imported turns and all directly identifiable tools intact.
		filtered := make([]agenttypes.ImportedExchangeAux, 0, len(incoming.Aux))
		for _, entry := range incoming.Aux {
			call := entry.ToolCall
			if call != nil && call.Activity != nil && callSeq[call.CallID] == 0 && agentName == "codex" &&
				call.Kind == agenttypes.ToolKindExecute && call.Meta["wrapperTool"] == "exec" && liveCodexCommandTurns[call.Activity.NativeTurnID] {
				continue
			}
			filtered = append(filtered, entry)
		}
		incoming.Aux = filtered
		imported[index] = incoming
		seq := 0
		for _, entry := range incoming.Aux {
			if entry.ToolCall != nil && callSeq[entry.ToolCall.CallID] > 0 {
				seq = callSeq[entry.ToolCall.CallID]
				break
			}
		}
		if full && seq == 0 && strings.TrimSpace(incoming.Content) != "" {
			for j := position; j < len(current.Exchanges); j++ {
				ex := current.Exchanges[j]
				if ex.Agent != "" && ex.Agent != agentName {
					continue
				}
				if ex.Role == incoming.Role && strings.TrimSpace(ex.Content) == strings.TrimSpace(incoming.Content) {
					seq, position = ex.Seq, j+1
					break
				}
			}
		}
		if incoming.Role == "user" {
			userSeq = seq
		}
		if seq == 0 && incoming.Role == "agent" && incoming.Content == "" && userSeq > 0 {
			// Old importers could omit a tools-only response entirely. Attach
			// its tools after the explicitly matched user without renumbering
			// stored exchanges or manufacturing an assistant text message.
			seq = userSeq
		}
		if seq == 0 {
			unmatched = append(unmatched, incoming)
			continue
		}
		lastMatched = index
		metadata = append(metadata, session.Exchange{Seq: seq, Role: incoming.Role, Agent: agentName, Effort: incoming.Effort, ContextWindow: incoming.ContextWindow})
		for _, entry := range incoming.Aux {
			if entry.ToolCall == nil {
				continue
			}
			toolSeq := seq
			if existing := callSeq[entry.ToolCall.CallID]; existing > 0 {
				toolSeq = existing
			}
			updates = append(updates, session.ExchangeAux{Seq: toolSeq, Line: entry.Line, ToolCall: entry.ToolCall})
		}
	}
	if err := manager.ReconcileImportedTools(ctx, current.Key, updates); err != nil {
		return nil, err
	}
	if err := manager.ReconcileReplyMetadata(ctx, current.Key, metadata); err != nil {
		return nil, err
	}
	if !full {
		return unmatched, nil
	}
	// A copied native prefix can contain text normalized differently by older
	// importers. Preserve that prefix instead of appending its messages again.
	start := lastMatched + 1
	if copiedPrefix > start {
		start = copiedPrefix
	}
	if start >= len(imported) {
		return nil, nil
	}
	return imported[start:], nil
}
