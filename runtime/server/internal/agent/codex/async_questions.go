package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
	"mindfs/server/internal/agent/types"
)

type asyncQuestionPause struct {
	requests     []codexsdk.AskUserRequest
	stopTimer    *time.Timer
	stopDeadline <-chan time.Time
}

// Native async questions return "accepted" immediately. In the IDE, stop the
// native turn and reuse the explicit-answer flow before starting any more work.
// Keep the outer session pending throughout, including across history switches.
func (s *session) handleInteractiveStream(ctx context.Context, streamed *codexsdk.StreamedTurn) error {
	for {
		pause := &asyncQuestionPause{}
		err := s.handleStreamedEvents(ctx, streamed.Events, pause)
		if pause.stopTimer != nil {
			pause.stopTimer.Stop()
		}
		if err != nil {
			s.turn.Cancel()
			// The SDK may still deliver its terminal cancellation event. Drain it
			// so a failed pause cannot strand the producer on an unread channel.
			go func(events <-chan codexsdk.ThreadEvent) {
				for range events {
				}
			}(streamed.Events)
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if len(pause.requests) == 0 {
			return nil
		}

		type reply struct {
			Question string `json:"question"`
			Answer   string `json:"answer"`
		}
		answers := []reply{}
		for _, request := range pause.requests {
			response, err := s.handleAskUserRequest(request)
			if err != nil {
				return err
			}
			for _, question := range request.Questions {
				answer := strings.Join(response.Answers[question.ID].Answers, ", ")
				if strings.TrimSpace(answer) == "" {
					return errors.New("all async questions require an explicit answer")
				}
				answers = append(answers, reply{Question: question.Question, Answer: answer})
			}
			resolved := codexAskUserToolCall(request.ItemID, request)
			resolved.Status = "complete"
			s.emit(types.Event{Type: types.EventTypeToolUpdate, SessionID: s.SessionID(), Data: resolved})
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		// Async replies are new user input in the same native thread. Never submit
		// a synthetic server-request response or invent an answer/default choice.
		input, err := json.Marshal(struct {
			Answers []reply `json:"answers"`
		}{Answers: answers})
		if err != nil {
			return err
		}
		streamed, err = s.thread.RunStreamed(string(input), codexsdk.TurnOptions{Context: ctx})
		if err != nil {
			return err
		}
	}
}

func (s *session) pauseForAsyncQuestion(ctx context.Context, event *codexsdk.ItemCompletedEvent, message *codexsdk.AgentMessageItem, pause *asyncQuestionPause) error {
	callID := strings.TrimSpace(message.ID)
	if callID == "" {
		return errors.New("async question is missing its message id")
	}
	for _, request := range pause.requests {
		if request.ItemID == callID {
			return nil
		}
	}
	request := codexsdk.AskUserRequest{Context: ctx, ItemID: callID, ThreadID: event.ThreadID, TurnID: event.TurnID}
	for index, question := range message.Questions {
		if strings.TrimSpace(question.Title) == "" {
			return errors.New("async question is missing its title")
		}
		item := codexsdk.AskUserQuestion{ID: fmt.Sprintf("q_%d", index), Question: question.Title}
		for _, option := range question.Options {
			item.Options = append(item.Options, codexsdk.AskUserQuestionOption{Label: option})
		}
		request.Questions = append(request.Questions, item)
	}
	if len(pause.requests) == 0 {
		threadID := strings.TrimSpace(event.ThreadID)
		if threadID == "" {
			threadID = s.SessionID()
		}
		if threadID == "" || strings.TrimSpace(event.TurnID) == "" {
			return errors.New("async question is missing its native turn identity")
		}
		interruptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if _, err := s.client.AppServerRPC(interruptCtx, "turn/interrupt", map[string]any{"threadId": threadID, "turnId": event.TurnID}); err != nil {
			s.turn.Cancel()
			return fmt.Errorf("pause for user choice: %w", err)
		}
		pause.stopTimer = time.NewTimer(10 * time.Second)
		pause.stopDeadline = pause.stopTimer.C
	}
	pause.requests = append(pause.requests, request)
	return nil
}
