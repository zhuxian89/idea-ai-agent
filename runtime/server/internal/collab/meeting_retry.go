package collab

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"
)

func (s *Service) retryMeetingTurnLocked(ctx context.Context, store *Store, root string, run Run, round MeetingRound, input MeetingActionInput) (RunDetail, error) {
	turn := findMeetingTurn(&round, input.TurnID)
	if turn == nil || turn.Kind == meetingAuthor {
		return RunDetail{}, errors.New("找不到本轮成员发言")
	}
	result := func(action string) (RunDetail, error) {
		detail, err := s.GetRunDetail(ctx, run.RootID, run.ID)
		detail.ProgressAction = action
		return detail, err
	}
	if turn.Status == StepStatusDone {
		return result("unchanged")
	}
	worker := s.meetings[workerKey(run.RootID, run.ID)]
	active := false
	if worker != nil {
		_, active = worker.active[turn.ID]
	}
	if active || s.runner.StageTurnActive(run.RootID, turn.SessionKey) {
		return result("running")
	}
	if !turn.At.Equal(input.Attempt) {
		return result("changed")
	}
	if run.Status != RunStatusWaitingUser && run.Status != RunStatusRunning || turn.Status == StepStatusPending {
		return RunDetail{}, errors.New("当前发言不能重试")
	}
	candidates := selectMeetingBatch(run, round)
	if !slices.ContainsFunc(candidates, func(t MeetingTurn) bool { return t.ID == turn.ID }) {
		return RunDetail{}, errors.New("当前阶段不能重试这条发言")
	}
	if worker != nil {
		if worker.pausing || worker.ctx.Err() != nil {
			return RunDetail{}, errors.New("会议正在暂停，请稍后重试")
		}
		if worker.replacing > 0 {
			return RunDetail{}, errors.New("正在切换成员模型，请稍后重试")
		}
		// The scheduler claims the first batch after the action releases meetingMu.
		if len(worker.active) == 0 && worker.failures[turn.ID] == nil {
			return result("running")
		}
		// A parallel proposal can be retried before its peers finish. Recover this
		// member's delivery only; peers still own their output files.
		if err := recoverMeetingTurnDoc(root, run, round, turn); err != nil {
			return RunDetail{}, err
		}
		if turn.Status == StepStatusDone {
			if err := s.saveMeeting(ctx, store, run, round); err != nil {
				return RunDetail{}, err
			}
			return result("unchanged")
		}
		if run.CurrentStep != meetingProposal && len(worker.active) > 0 {
			return RunDetail{}, errors.New("请等待当前成员完成发言")
		}
		turn.Status, turn.At = StepStatusRunning, time.Now().UTC()
		if err := s.saveMeeting(ctx, store, run, round); err != nil {
			return RunDetail{}, err
		}
		s.startMeetingTurnLocked(worker, store, root, run, round, *turn)
	} else {
		// Leave other interrupted members for the author's next retry.
		held := make(map[string]error)
		for _, other := range candidates {
			if other.ID != turn.ID {
				held[other.ID] = fmt.Errorf("%s 等待继续", meetingMemberName(run, other.SlotID))
			}
		}
		run.Status, run.ErrorMessage = RunStatusRunning, ""
		if err := s.saveMeeting(ctx, store, run, round); err != nil {
			return RunDetail{}, err
		}
		s.launchMeetingLocked(run.RootID, run.ID, held)
	}
	return result("resumed")
}
