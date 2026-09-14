package session

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"

	agenttypes "mindfs/server/internal/agent/types"
)

// ReconcileImportedTools updates only derived auxiliary history. Native files,
// exchange text and sequence numbers are never rewritten. The whole batch uses
// one read and an atomic write under the session lock, not per-tool detail IO.
func (m *Manager) ReconcileImportedTools(_ context.Context, key string, incoming []ExchangeAux) error {
	if len(incoming) == 0 {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	entries, err := m.loadExchangeAuxEntries(key, 0)
	if err != nil {
		return err
	}
	original := append([]ExchangeAux(nil), entries...)
	// Older persisted replay entries may share an ID. Coalesce only calls in
	// this native batch, keeping the first position and all prior detail fields.
	wanted := make(map[string]bool)
	for _, entry := range incoming {
		if entry.ToolCall != nil && entry.ToolCall.CallID != "" {
			wanted[entry.ToolCall.CallID] = true
		}
	}
	positions := make(map[string]int)
	unique := make([]ExchangeAux, 0, len(entries))
	for _, entry := range entries {
		if entry.ToolCall != nil && wanted[entry.ToolCall.CallID] {
			if at, ok := positions[entry.ToolCall.CallID]; ok {
				merged := mergeToolCall(*unique[at].ToolCall, *entry.ToolCall)
				unique[at].ToolCall = &merged
				continue
			}
			positions[entry.ToolCall.CallID] = len(unique)
		}
		unique = append(unique, entry)
	}
	entries = unique
	find := func(callID string) int {
		for i, entry := range entries {
			if entry.ToolCall != nil && entry.ToolCall.CallID == callID {
				return i
			}
		}
		return -1
	}
	for i, entry := range incoming {
		if entry.Seq <= 0 || entry.ToolCall == nil || strings.TrimSpace(entry.ToolCall.CallID) == "" {
			continue
		}
		if index := find(entry.ToolCall.CallID); index >= 0 {
			base := entries[index].ToolCall
			merged := mergeToolCall(*base, *entry.ToolCall)
			// A legacy function-call projection must not erase richer live
			// command actions/source/timing. Import fills its absent fields.
			if base.Activity != nil && base.Activity.Origin == "live" {
				merged.Activity = agenttypes.MergeActivityFacts(entry.ToolCall.Activity, base.Activity)
			}
			entries[index].ToolCall = &merged
			continue
		}
		// Insert before the next known native call in this exchange. This
		// restores previously filtered calls without moving existing records.
		at := len(entries)
		for _, next := range incoming[i+1:] {
			if next.Seq != entry.Seq || next.ToolCall == nil {
				continue
			}
			if index := find(next.ToolCall.CallID); index >= 0 && entries[index].Seq == entry.Seq {
				at = index
				break
			}
		}
		if at == len(entries) {
			for index := len(entries) - 1; index >= 0; index-- {
				if entries[index].Seq == entry.Seq {
					at = index + 1
					break
				}
			}
		}
		call := cloneToolCall(*entry.ToolCall)
		entry.ToolCall = &call
		entries = append(entries, ExchangeAux{})
		copy(entries[at+1:], entries[at:])
		entries[at] = entry
	}
	if reflect.DeepEqual(original, entries) {
		return nil
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	for _, entry := range entries {
		if err := encoder.Encode(entry); err != nil {
			return err
		}
	}
	path, err := m.auxPath(key)
	if err != nil {
		return err
	}
	return m.root.WriteMetaFile(path, buffer.Bytes())
}
