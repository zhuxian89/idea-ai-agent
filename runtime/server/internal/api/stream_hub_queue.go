package api

import (
	"strings"
	"time"
)

func (h *StreamHub) queueSnapshot(sessionKey string) (string, []QueuedUserMessage, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	state := h.pendingSessions[sessionKey]
	if state == nil {
		return "", nil, false
	}
	return state.RootID, cloneQueue(state.Queue), state.QueueFrozen
}

func (h *StreamHub) EnqueueSessionMessage(rootID, sessionKey, sessionTitle string, item QueuedUserMessage) []QueuedUserMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.enqueueSessionMessageLocked(rootID, sessionKey, sessionTitle, item)
}

func (h *StreamHub) reserveOrQueueSessionMessage(rootID, key, title string, item QueuedUserMessage) ([]QueuedUserMessage, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.ensurePendingSessionLocked(key)
	if state.Active || len(state.Queue) > 0 {
		if !state.Active {
			state.QueueFrozen = false
		}
		return h.enqueueSessionMessageLocked(rootID, key, title, item), true
	}
	delete(h.completed, key)
	state.RootID, state.SessionTitle, state.Active = rootID, title, true
	state.UpdatedAt = time.Now().UTC()
	return nil, false
}

func (h *StreamHub) enqueueSessionMessageLocked(rootID, sessionKey, sessionTitle string, item QueuedUserMessage) []QueuedUserMessage {
	if item.ID == "" {
		item.ID = time.Now().UTC().Format("20060102150405.000000000")
	}
	if item.Timestamp.IsZero() {
		item.Timestamp = time.Now().UTC()
	}
	state := h.ensurePendingSessionLocked(sessionKey)
	state.RootID = rootID
	if strings.TrimSpace(sessionTitle) != "" {
		state.SessionTitle = strings.TrimSpace(sessionTitle)
	}
	state.Queue = append(state.Queue, item)
	state.UpdatedAt = item.Timestamp
	h.clearReplayStatesForSessionLocked(sessionKey)
	return cloneQueue(state.Queue)
}

func (h *StreamHub) RemoveQueuedSessionMessage(sessionKey, queueID string) []QueuedUserMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.pendingSessions[sessionKey]
	if state == nil || queueID == "" {
		return nil
	}
	next := state.Queue[:0]
	for _, item := range state.Queue {
		if item.ID == queueID {
			continue
		}
		next = append(next, item)
	}
	state.Queue = next
	state.UpdatedAt = time.Now().UTC()
	h.clearReplayStatesForSessionLocked(sessionKey)
	return cloneQueue(state.Queue)
}

func (h *StreamHub) UpdateQueuedSessionMessage(sessionKey, queueID, content string) []QueuedUserMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.pendingSessions[sessionKey]
	if state == nil || queueID == "" {
		return nil
	}
	for i := range state.Queue {
		if state.Queue[i].ID == queueID {
			state.Queue[i].Content = content
			break
		}
	}
	state.UpdatedAt = time.Now().UTC()
	h.clearReplayStatesForSessionLocked(sessionKey)
	return cloneQueue(state.Queue)
}

func (h *StreamHub) FreezeQueuedSessionMessages(sessionKey string) ([]QueuedUserMessage, bool) {
	if blank(sessionKey) {
		return nil, false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.pendingSessions[sessionKey]
	if state == nil || len(state.Queue) == 0 {
		return nil, false
	}
	state.QueueFrozen = true
	state.UpdatedAt = time.Now().UTC()
	return cloneQueue(state.Queue), true
}

func (h *StreamHub) UnfreezeQueuedSessionMessages(sessionKey string) ([]QueuedUserMessage, bool) {
	if blank(sessionKey) {
		return nil, false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.pendingSessions[sessionKey]
	if state == nil || !state.QueueFrozen {
		if state == nil {
			return nil, false
		}
		return cloneQueue(state.Queue), false
	}
	state.QueueFrozen = false
	state.UpdatedAt = time.Now().UTC()
	return cloneQueue(state.Queue), true
}

func (h *StreamHub) PopQueuedSessionMessage(sessionKey, queueID string) (QueuedUserMessage, []QueuedUserMessage, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.popQueuedSessionMessageLocked(sessionKey, queueID)
}

func (h *StreamHub) reserveNextQueuedSessionMessage(sessionKey string) (QueuedUserMessage, []QueuedUserMessage, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.pendingSessions[sessionKey]
	if state == nil || state.Active {
		return QueuedUserMessage{}, nil, false
	}
	item, queue, ok := h.popQueuedSessionMessageLocked(sessionKey, "")
	if ok {
		delete(h.completed, sessionKey)
		state.Active = true
	}
	return item, queue, ok
}

func (h *StreamHub) popQueuedSessionMessageLocked(sessionKey, queueID string) (QueuedUserMessage, []QueuedUserMessage, bool) {
	state := h.pendingSessions[sessionKey]
	if state == nil || len(state.Queue) == 0 {
		return QueuedUserMessage{}, nil, false
	}
	index := 0
	if trimmedQueueID := strings.TrimSpace(queueID); trimmedQueueID != "" {
		index = -1
		for i := range state.Queue {
			if state.Queue[i].ID == trimmedQueueID {
				index = i
				break
			}
		}
		if index < 0 {
			return QueuedUserMessage{}, cloneQueue(state.Queue), false
		}
	} else if state.QueueFrozen {
		return QueuedUserMessage{}, cloneQueue(state.Queue), false
	}
	item := state.Queue[index]
	state.Queue = append(state.Queue[:index], state.Queue[index+1:]...)
	state.UpdatedAt = time.Now().UTC()
	h.clearReplayStatesForSessionLocked(sessionKey)
	return item, cloneQueue(state.Queue), true
}

func (h *StreamHub) PromoteQueuedSessionMessage(sessionKey, queueID string) ([]QueuedUserMessage, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.pendingSessions[sessionKey]
	if state == nil || len(state.Queue) == 0 || strings.TrimSpace(queueID) == "" {
		return nil, false
	}
	index := -1
	for i := range state.Queue {
		if state.Queue[i].ID == queueID {
			index = i
			break
		}
	}
	if index < 0 {
		return cloneQueue(state.Queue), false
	}
	if index > 0 {
		item := state.Queue[index]
		copy(state.Queue[1:index+1], state.Queue[0:index])
		state.Queue[0] = item
	}
	state.QueueFrozen = false
	state.UpdatedAt = time.Now().UTC()
	h.clearReplayStatesForSessionLocked(sessionKey)
	return cloneQueue(state.Queue), true
}

func (h *StreamHub) SetPendingReply(rootID, sessionKey, sessionTitle string) {
	if blank(sessionKey) {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.ensurePendingSessionLocked(sessionKey)
	delete(h.completed, sessionKey)
	state.RootID = rootID
	state.SessionTitle = strings.TrimSpace(sessionTitle)
	state.Active = true
	if state.UpdatedAt.IsZero() {
		state.UpdatedAt = time.Now().UTC()
	}
}
