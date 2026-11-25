package codex

import (
	"encoding/json"
	"errors"
	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
	types "mindfs/server/internal/agent/types"
	"strconv"
	"strings"
)

func (s *session) handleAskUserRequest(req codexsdk.AskUserRequest) (codexsdk.AskUserResponse, error) {
	if req.Context != nil && req.Context.Err() != nil {
		return codexsdk.AskUserResponse{}, req.Context.Err()
	}
	callID := strings.TrimSpace(req.ItemID)
	if callID == "" {
		return codexsdk.AskUserResponse{}, errors.New("ask user question missing item id")
	}
	if len(req.Questions) == 0 {
		return codexsdk.AskUserResponse{}, errors.New("ask user question missing questions")
	}

	waiter := types.NewPendingQuestion[map[string]string](req.Context)
	s.questionMu.Lock()
	if s.questionWaits == nil {
		s.questionWaits = make(map[string]*types.PendingQuestion[map[string]string])
	}
	if _, exists := s.questionWaits[callID]; exists {
		s.questionMu.Unlock()
		return codexsdk.AskUserResponse{}, errors.New("ask user question already pending: " + callID)
	}
	s.questionWaits[callID] = waiter
	if s.questionItems == nil {
		s.questionItems = make(map[string][]codexsdk.AskUserQuestion)
	}
	s.questionItems[callID] = req.Questions
	s.questionMu.Unlock()
	defer func() {
		s.questionMu.Lock()
		delete(s.questionWaits, callID)
		delete(s.questionItems, callID)
		s.questionMu.Unlock()
	}()

	toolCall := codexAskUserToolCall(callID, req)
	s.emit(types.Event{
		Type:      types.EventTypeToolCall,
		SessionID: s.SessionID(),
		Data:      toolCall,
	})

	answers, err := waiter.Wait()
	if err != nil {
		return codexsdk.AskUserResponse{}, err
	}
	response := codexAskUserResponse(req.Questions, answers)
	if len(response.Answers) == 0 {
		return codexsdk.AskUserResponse{}, errors.New("empty ask user answers")
	}
	return response, nil
}

func (s *session) cancelPendingQuestions(err error) {
	if err == nil {
		err = errors.New("turn canceled")
	}
	s.questionMu.Lock()
	waiters := make([]*types.PendingQuestion[map[string]string], 0, len(s.questionWaits))
	for callID, waiter := range s.questionWaits {
		waiters = append(waiters, waiter)
		delete(s.questionWaits, callID)
		delete(s.questionItems, callID)
	}
	s.questionMu.Unlock()

	for _, waiter := range waiters {
		waiter.Cancel(err)
	}
}

func codexAskUserToolCall(callID string, req codexsdk.AskUserRequest) types.ToolCall {
	questions := make([]types.AskUserQuestionItem, 0, len(req.Questions))
	for _, question := range req.Questions {
		options := make([]types.AskUserQuestionOption, 0, len(question.Options))
		for _, option := range question.Options {
			options = append(options, types.AskUserQuestionOption{
				Label:       option.Label,
				Description: option.Description,
			})
		}
		questions = append(questions, types.AskUserQuestionItem{
			Question: question.Question,
			Header:   question.Header,
			Options:  options,
		})
	}

	raw, _ := json.Marshal(map[string]any{"questions": questions})
	meta := map[string]any{
		"toolUseId": callID,
		"questions": questions,
		"rawType":   "request_user_input",
		"input":     strings.TrimSpace(string(raw)),
	}
	if strings.TrimSpace(req.ThreadID) != "" {
		meta["threadId"] = strings.TrimSpace(req.ThreadID)
	}
	if strings.TrimSpace(req.TurnID) != "" {
		meta["turnId"] = strings.TrimSpace(req.TurnID)
	}
	return types.ToolCall{
		CallID:  callID,
		Title:   "ask user",
		Status:  "running",
		Kind:    types.ToolKindAskUser,
		RawType: "request_user_input",
		Meta:    meta,
	}
}

func codexAskUserResponse(questions []codexsdk.AskUserQuestion, answers map[string]string) codexsdk.AskUserResponse {
	response := codexsdk.AskUserResponse{Answers: make(map[string]codexsdk.AskUserAnswer)}
	for key, value := range answers {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		questionID := codexQuestionIDForAnswerKey(key, questions)
		if questionID == "" {
			continue
		}
		response.Answers[questionID] = codexsdk.AskUserAnswer{
			Answers: []string{value},
		}
	}
	return response
}

func codexQuestionIDForAnswerKey(key string, questions []codexsdk.AskUserQuestion) string {
	if strings.HasPrefix(key, "q_") {
		indexText := strings.TrimPrefix(key, "q_")
		for index, question := range questions {
			if indexText == strconv.Itoa(index) {
				return strings.TrimSpace(question.ID)
			}
		}
	}
	for _, question := range questions {
		if key == strings.TrimSpace(question.ID) {
			return key
		}
	}
	return ""
}

func (s *session) CurrentModel() string {
	if s == nil {
		return ""
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return strings.TrimSpace(s.threadOpts.Model)
}
