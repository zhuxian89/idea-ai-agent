package codex

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
	"mindfs/server/internal/agent/types"
)

func (s *session) handleNativeRequest(req codexsdk.ServerRequest) (any, error) {
	var params struct {
		ServerName      string         `json:"serverName"`
		Message         string         `json:"message"`
		Mode            string         `json:"mode"`
		URL             string         `json:"url"`
		RequestedSchema map[string]any `json:"requestedSchema"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return nil, err
	}
	var native *types.NativeInteraction
	switch req.Method {
	case "mcpServer/elicitation/request":
		var err error
		native, err = types.NewElicitation(params.ServerName, params.Message, params.Mode, params.URL, params.RequestedSchema)
		if err != nil {
			return nil, err
		}
	case "item/permissions/requestApproval":
		var details map[string]any
		if err := json.Unmarshal(req.Params, &details); err != nil {
			return nil, err
		}
		message, _ := details["reason"].(string)
		native = &types.NativeInteraction{Kind: "permissions", Title: "Codex · Permissions", Message: message, Details: details, Actions: []string{"allow_turn", "allow_session", "decline"}}
	default:
		return nil, fmt.Errorf("unsupported native request: %s", req.Method)
	}
	id := "codex-native-" + strconv.FormatInt(req.ID, 10)
	waiter := types.NewPendingQuestion[map[string]string](req.Context)
	s.questionMu.Lock()
	if s.questionWaits == nil {
		s.questionWaits = make(map[string]*types.PendingQuestion[map[string]string])
	}
	if s.nativeInteractions == nil {
		s.nativeInteractions = make(map[string]*types.NativeInteraction)
	}
	if _, exists := s.questionWaits[id]; exists {
		s.questionMu.Unlock()
		return nil, fmt.Errorf("native request already pending: %s", id)
	}
	s.questionWaits[id], s.nativeInteractions[id] = waiter, native
	s.questionMu.Unlock()
	defer func() {
		s.questionMu.Lock()
		delete(s.questionWaits, id)
		delete(s.nativeInteractions, id)
		s.questionMu.Unlock()
	}()
	call := native.ToolCall(id)
	s.emit(types.Event{Type: types.EventTypeToolCall, SessionID: s.SessionID(), Data: call})
	answers, err := waiter.Wait()
	call.Meta = map[string]any{"toolUseId": id, "nativeInteraction": native, "questions": call.Meta["questions"]}
	call.Status = "complete"
	if err != nil {
		call.Status = "canceled"
	} else {
		call.Meta["answers"] = answers
		call.Meta["answeredAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	s.emit(types.Event{Type: types.EventTypeToolUpdate, SessionID: s.SessionID(), Data: call})
	if err != nil {
		return nil, err
	}
	return native.Result(answers)
}
