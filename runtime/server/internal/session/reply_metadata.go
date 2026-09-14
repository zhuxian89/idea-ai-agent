package session

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"

	agenttypes "mindfs/server/internal/agent/types"
)

type exchangeContextWindowKey struct{}

// A reply keeps its own snapshot; a session's latest Context belongs to no
// earlier reply and must not be used to fill missing history.
func WithExchangeContextWindow(ctx context.Context, window *agenttypes.ContextWindow) context.Context {
	return context.WithValue(ctx, exchangeContextWindowKey{}, cloneContextWindow(window))
}

func exchangeContextWindow(ctx context.Context) *agenttypes.ContextWindow {
	if ctx == nil {
		return nil
	}
	window, _ := ctx.Value(exchangeContextWindowKey{}).(*agenttypes.ContextWindow)
	return cloneContextWindow(window)
}

func cloneContextWindow(window *agenttypes.ContextWindow) *agenttypes.ContextWindow {
	if window == nil || window.TotalTokens < 0 || window.ModelContextWindow <= 0 {
		return nil
	}
	copy := *window
	return &copy
}

// Fill only missing metadata on exchanges already identified by native import.
// Text, timestamps, ordering and previously recorded values stay intact.
func (m *Manager) ReconcileReplyMetadata(_ context.Context, key string, incoming []Exchange) error {
	if len(incoming) == 0 {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	current, err := m.getSessionUnsafe(key, 0)
	if err != nil {
		return err
	}
	changed := false
	for _, update := range incoming {
		for index := range current.Exchanges {
			ex := &current.Exchanges[index]
			if ex.Seq != update.Seq || ex.Role != update.Role || (ex.Agent != "" && ex.Agent != update.Agent) {
				continue
			}
			if ex.Effort == "" && strings.TrimSpace(update.Effort) != "" {
				ex.Effort = strings.TrimSpace(update.Effort)
				changed = true
			}
			if cloneContextWindow(ex.ContextWindow) == nil {
				if window := cloneContextWindow(update.ContextWindow); window != nil {
					ex.ContextWindow = window
					changed = true
				}
			}
			break
		}
	}
	if !changed {
		return nil
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	for _, ex := range current.Exchanges {
		if err := encoder.Encode(ex); err != nil {
			return err
		}
	}
	path, err := m.exchangePath(key)
	if err != nil {
		return err
	}
	return m.root.WriteMetaFile(path, buffer.Bytes())
}
