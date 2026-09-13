package codex

import (
	"encoding/json"
	"strings"

	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
)

// The native server decides when approval is necessary and which decisions
// are available. Keep its command, paths and reason visible to the user.
func (s *session) handleApprovalRequest(req codexsdk.ApprovalRequest) (codexsdk.ApprovalDecision, error) {
	var params struct {
		AvailableDecisions []json.RawMessage `json:"availableDecisions"`
	}
	_ = json.Unmarshal(req.Params, &params)
	if len(params.AvailableDecisions) == 0 {
		params.AvailableDecisions = []json.RawMessage{json.RawMessage(`"accept"`), json.RawMessage(`"decline"`)}
	}
	decisions := make(map[string]codexsdk.ApprovalDecision)
	options := make([]codexsdk.AskUserQuestionOption, 0, len(params.AvailableDecisions))
	for _, raw := range params.AvailableDecisions {
		value := string(raw)
		_ = json.Unmarshal(raw, &value)
		label := value
		switch value {
		case "accept":
			label = "允许本次执行"
		case "acceptForSession":
			label = "允许本会话执行"
		case "decline":
			label = "拒绝执行"
		case "cancel":
			label = "取消当前任务"
		}
		decisions[label] = codexsdk.ApprovalDecision(value)
		options = append(options, codexsdk.AskUserQuestionOption{Label: label, Description: value})
	}
	response, err := s.handleAskUserRequest(codexsdk.AskUserRequest{
		Context:   req.Context,
		ItemID:    "approval-" + req.ItemID,
		Questions: []codexsdk.AskUserQuestion{{ID: "decision", Header: "执行授权", Question: "Codex 请求授权：" + req.ItemType + "\n" + strings.TrimSpace(string(req.Params)), Options: options}},
	})
	if err != nil {
		return codexsdk.ApprovalDecisionRejected, err
	}
	if answers := response.Answers["decision"].Answers; len(answers) == 1 {
		if decision, ok := decisions[answers[0]]; ok {
			return decision, nil
		}
	}
	return codexsdk.ApprovalDecisionRejected, nil
}
