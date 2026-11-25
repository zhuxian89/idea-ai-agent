package api

import (
	"strings"
	"time"
)

func buildSessionStreamResponse(rootID, sessionKey string, event *StreamEvent) WSResponse {
	return WSResponse{
		Type: "session.stream",
		Payload: map[string]any{
			"root_id":     rootID,
			"session_key": sessionKey,
			"event":       event,
		},
	}
}

func buildSessionDoneResponse(rootID, sessionKey, requestID string, replay bool) WSResponse {
	payload := map[string]any{
		"root_id":     rootID,
		"session_key": sessionKey,
	}
	if replay {
		payload["replay"] = true
	}
	return WSResponse{
		ID:      requestID,
		Type:    "session.done",
		Payload: payload,
	}
}

func buildSlashCommandStreamResponse(rootID, sessionKey, command, requestID string, event *StreamEvent) WSResponse {
	return WSResponse{
		ID:   requestID,
		Type: "session.slash_command.stream",
		Payload: map[string]any{
			"root_id":     rootID,
			"session_key": sessionKey,
			"command":     command,
			"request_id":  requestID,
			"event":       event,
		},
	}
}

func buildSlashCommandDoneResponse(rootID, sessionKey, command, requestID string) WSResponse {
	return WSResponse{
		ID:   requestID,
		Type: "session.slash_command.done",
		Payload: map[string]any{
			"root_id":     rootID,
			"session_key": sessionKey,
			"command":     command,
			"request_id":  requestID,
		},
	}
}

func buildSessionUserMessageResponse(rootID, sessionKey, sessionType, sessionName, agentName, model, mode, effort, fastService string, planMode bool, content string, timestamp time.Time, queued bool) WSResponse {
	queueState := "active"
	if queued {
		queueState = "dequeued"
	}
	sessionPayload := map[string]any{
		"key":          sessionKey,
		"type":         sessionType,
		"agent":        agentName,
		"model":        model,
		"mode":         mode,
		"effort":       effort,
		"fast_service": fastService,
		"plan_mode":    planMode,
		"created_at":   timestamp,
		"updated_at":   timestamp,
	}
	if strings.TrimSpace(sessionName) != "" {
		sessionPayload["name"] = sessionName
	}
	return WSResponse{
		Type: "session.user_message",
		Payload: map[string]any{
			"root_id":     rootID,
			"session_key": sessionKey,
			"session":     sessionPayload,
			"exchange": map[string]any{
				"role":         "user",
				"agent":        agentName,
				"model":        model,
				"mode":         mode,
				"effort":       effort,
				"fast_service": fastService,
				"content":      content,
				"timestamp":    timestamp,
				"queued":       queued,
				"queue_state":  queueState,
			},
		},
	}
}

func buildSessionQueueUpdatedResponse(rootID, sessionKey string, queue []QueuedUserMessage, frozen bool) WSResponse {
	return WSResponse{
		Type: "session.queue.updated",
		Payload: map[string]any{
			"root_id":      rootID,
			"session_key":  sessionKey,
			"queue":        queue,
			"queue_frozen": frozen,
		},
	}
}

func (h *StreamHub) ensurePendingSessionLocked(sessionKey string) *SessionPendingState {
	state := h.pendingSessions[sessionKey]
	if state == nil {
		state = &SessionPendingState{}
		h.pendingSessions[sessionKey] = state
	}
	return state
}
