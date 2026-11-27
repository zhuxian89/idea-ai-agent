package collab

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

type UpdateRunMembersInput struct {
	RootID  string       `json:"root_id"`
	RunID   string       `json:"run_id"`
	Members []MemberSlot `json:"members"`
	Resume  bool         `json:"resume,omitempty"`
}

func (s *Service) UpdateRunMembers(ctx context.Context, in UpdateRunMembersInput) (RunDetail, error) {
	if s.runner == nil {
		return RunDetail{}, errors.New("collab runner not configured")
	}
	rootID := strings.TrimSpace(in.RootID)
	runID := strings.TrimSpace(in.RunID)
	if rootID == "" {
		return RunDetail{}, errors.New("root_id required")
	}
	if runID == "" {
		return RunDetail{}, errors.New("run_id required")
	}
	if len(in.Members) == 0 {
		return RunDetail{}, errors.New("请提供要修改的成员模型配置")
	}
	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		return RunDetail{}, err
	}
	run, err := store.GetRun(ctx, runID)
	if err != nil {
		return RunDetail{}, err
	}
	switch run.Mode {
	case ModeGroup:
		return s.updateMeetingMembers(ctx, rootID, runID, in.Members, in.Resume)
	case "", ModeQuick:
		return s.updateQuickRunMembers(ctx, store, rootID, runID, in.Members, in.Resume)
	default:
		return RunDetail{}, fmt.Errorf("不支持的协作模式：%s", run.Mode)
	}
}

func (s *Service) updateQuickRunMembers(ctx context.Context, store *Store, rootID, runID string, updates []MemberSlot, resume bool) (RunDetail, error) {
	runKey := workerKey(rootID, runID)

	s.mu.Lock()
	run, err := store.GetRun(ctx, runID)
	if err != nil {
		s.mu.Unlock()
		return RunDetail{}, err
	}
	if err := validateQuickRunEditable(run); err != nil {
		s.mu.Unlock()
		return RunDetail{}, err
	}
	nextMembers, changedSlots, changedMembers, err := applyMemberSlotUpdates(run.Snapshot.Members, updates, ModeQuick)
	if err != nil {
		s.mu.Unlock()
		return RunDetail{}, err
	}
	if len(changedMembers) > 0 {
		if statuses := s.runner.AgentStatuses(); len(statuses) > 0 {
			for _, check := range ValidateMembers(changedMembers, statuses) {
				if !check.Available {
					s.mu.Unlock()
					return RunDetail{}, errors.New(check.Reason)
				}
			}
		}
	}

	activeStep := findStep(&run, run.CurrentStep)
	worker := s.workers[runKey]
	restartActive := run.Status == RunStatusRunning && worker != nil && !worker.paused &&
		activeStep != nil && stepMatchesSlotSet(*activeStep, changedSlots)

	if restartActive {
		cancelSessionKey := strings.TrimSpace(activeStep.SessionKey)
		run.Snapshot.Members = nextMembers
		syncQuickRunPendingSteps(&run, changedSlots)
		run.UpdatedAt = time.Now().UTC()
		if err := store.UpdateRun(ctx, run); err != nil {
			s.mu.Unlock()
			return RunDetail{}, err
		}
		worker.paused = true
		worker.cancel()
		prevDone := worker.done
		s.mu.Unlock()
		s.notifyRunUpdated(context.WithoutCancel(ctx), store, rootID, run)

		if cancelSessionKey != "" {
			_ = s.runner.CancelStageTurn(context.WithoutCancel(ctx), rootID, cancelSessionKey)
		}
		select {
		case <-prevDone:
		case <-ctx.Done():
			s.pauseCurrentStep(context.Background(), store, rootID, runID, "已切换模型，等待旧回合结束时请求取消，请点击继续使用新模型执行")
			return RunDetail{}, ctx.Err()
		}

		bgCtx := context.WithoutCancel(ctx)
		s.mu.Lock()
		run, err = store.GetRun(bgCtx, runID)
		if err != nil {
			s.mu.Unlock()
			return RunDetail{}, err
		}
		if err := validateQuickRunEditable(run); err != nil {
			s.mu.Unlock()
			return RunDetail{}, err
		}
		if run.Status != RunStatusRunning {
			s.mu.Unlock()
			return s.GetRunDetail(bgCtx, rootID, runID)
		}
		syncQuickRunPendingSteps(&run, nil)
		if curStep := findStep(&run, run.CurrentStep); curStep != nil && curStep.Status != StepStatusDone && curStep.Status != StepStatusSkipped {
			curStep.Status = StepStatusPending
			curStep.Summary = "已切换模型，正在重新执行"
		}
		run.Status = RunStatusRunning
		run.ErrorMessage = ""
		run.UpdatedAt = time.Now().UTC()
		if err := store.UpdateRun(bgCtx, run); err != nil {
			s.mu.Unlock()
			return RunDetail{}, err
		}
		if cur := s.workers[runKey]; cur == nil || cur.paused {
			s.launchQuickWorkerLocked(rootID, runID, true, true)
		}
		s.mu.Unlock()
		s.notifyRunUpdated(bgCtx, store, rootID, run)
		return s.GetRunDetail(ctx, rootID, runID)
	}

	run.Snapshot.Members = nextMembers
	syncQuickRunPendingSteps(&run, changedSlots)
	run.UpdatedAt = time.Now().UTC()
	if err := store.UpdateRun(ctx, run); err != nil {
		s.mu.Unlock()
		return RunDetail{}, err
	}
	shouldResume := resume && (run.Status == RunStatusFailed || run.Status == RunStatusWaitingUser) &&
		run.CurrentStep != StepDecisions && run.CurrentStep != StepDone
	s.mu.Unlock()
	s.notifyRunUpdated(ctx, store, rootID, run)

	if shouldResume {
		return s.ContinueRun(ctx, rootID, runID)
	}
	return s.GetRunDetail(ctx, rootID, runID)
}

func (s *Service) updateMeetingMembers(ctx context.Context, rootID, runID string, updates []MemberSlot, resume bool) (RunDetail, error) {
	key := workerKey(rootID, runID)

	s.meetingMu.Lock()
	store, run, detail, err := s.meetingState(ctx, rootID, runID)
	if err != nil {
		s.meetingMu.Unlock()
		return RunDetail{}, err
	}
	if detail.QuickRunID != "" || run.Status == RunStatusCompleted || run.Status == RunStatusCanceled || run.DocsCleaned {
		s.meetingMu.Unlock()
		return RunDetail{}, errors.New("会议已结束，无法修改参会模型")
	}
	worker := s.meetings[key]
	if worker != nil && worker.pausing {
		s.meetingMu.Unlock()
		return RunDetail{}, errors.New("会议正在暂停，请稍后修改模型")
	}
	if worker != nil && worker.replacing > 0 {
		s.meetingMu.Unlock()
		return RunDetail{}, errors.New("正在切换成员模型，请稍后操作")
	}

	nextMembers, changedSlots, changedMembers, err := applyMemberSlotUpdates(run.Snapshot.Members, updates, ModeGroup)
	if err != nil {
		s.meetingMu.Unlock()
		return RunDetail{}, err
	}
	if len(changedMembers) > 0 {
		if statuses := s.runner.AgentStatuses(); len(statuses) > 0 {
			for _, check := range ValidateMembers(changedMembers, statuses) {
				if !check.Available {
					s.meetingMu.Unlock()
					return RunDetail{}, errors.New(check.Reason)
				}
			}
		}
	}

	run.Snapshot.Members = nextMembers
	if err := s.saveMeeting(ctx, store, run); err != nil {
		s.meetingMu.Unlock()
		return RunDetail{}, err
	}

	round := detail.Rounds[run.Round-1]
	type replacedTurn struct {
		turnID string
		active *activeMeetingTurn
	}
	var toReplace []replacedTurn
	if worker != nil {
		for _, turn := range round.Turns {
			if changedSlots[turn.SlotID] {
				delete(worker.failures, turn.ID)
			}
		}
		for turnID, at := range worker.active {
			if at != nil && changedSlots[at.slotID] {
				at.replaced = true
				at.cancel()
				toReplace = append(toReplace, replacedTurn{turnID: turnID, active: at})
			}
		}
	}

	if len(toReplace) > 0 {
		worker.replacing++
		s.meetingMu.Unlock()

		for _, item := range toReplace {
			if item.active.sessionKey != "" {
				_ = s.runner.CancelStageTurn(context.WithoutCancel(ctx), rootID, item.active.sessionKey)
			}
		}
		var waitErr error
		for _, item := range toReplace {
			select {
			case <-item.active.done:
			case <-ctx.Done():
				waitErr = ctx.Err()
			}
		}

		s.meetingMu.Lock()
		worker.replacing--
		if waitErr == nil && !worker.pausing && worker.ctx.Err() == nil && s.meetings[key] == worker {
			if latestStore, latestRun, latestDetail, stateErr := s.meetingState(context.Background(), rootID, runID); stateErr == nil && latestRun.Status == RunStatusRunning {
				latestRound := latestDetail.Rounds[latestRun.Round-1]
				if rootPath, rootErr := s.runner.RootPath(rootID); rootErr == nil {
					var restart []MeetingTurn
					for _, item := range toReplace {
						turn := findMeetingTurn(&latestRound, item.turnID)
						if turn != nil && turn.Status != StepStatusDone && worker.active[turn.ID] == nil {
							turn.Status = StepStatusRunning
							turn.At = time.Now().UTC()
							turn.Agent = ""
							turn.Model = ""
							turn.Body = ""
							restart = append(restart, *turn)
						}
					}
					if len(restart) > 0 {
						if saveErr := s.saveMeeting(context.Background(), latestStore, latestRun, latestRound); saveErr == nil {
							for _, turn := range restart {
								s.startMeetingTurnLocked(worker, latestStore, rootPath, latestRun, latestRound, turn)
							}
						}
					}
				}
			}
		}
		worker.settled.Broadcast()
		s.meetingMu.Unlock()
		if waitErr != nil {
			return RunDetail{}, waitErr
		}
		return s.GetRunDetail(ctx, rootID, runID)
	}

	if worker != nil && resume && !worker.pausing && worker.ctx.Err() == nil && run.Status == RunStatusRunning {
		if rootPath, rootErr := s.runner.RootPath(rootID); rootErr == nil {
			candidates := selectMeetingBatch(run, round)
			var restart []MeetingTurn
			for _, candidate := range candidates {
				if !changedSlots[candidate.SlotID] || worker.active[candidate.ID] != nil || candidate.Status == StepStatusDone {
					continue
				}
				if run.CurrentStep != meetingProposal && len(worker.active) > 0 {
					continue
				}
				if turn := findMeetingTurn(&round, candidate.ID); turn != nil {
					turn.Status = StepStatusRunning
					turn.At = time.Now().UTC()
					turn.Agent = ""
					turn.Model = ""
					restart = append(restart, *turn)
				}
			}
			if len(restart) > 0 {
				if saveErr := s.saveMeeting(ctx, store, run, round); saveErr == nil {
					for _, turn := range restart {
						s.startMeetingTurnLocked(worker, store, rootPath, run, round, turn)
					}
				}
			}
		}
	} else if worker == nil && resume &&
		(run.Status == RunStatusWaitingUser || run.Status == RunStatusFailed || run.Status == RunStatusRunning) &&
		(run.CurrentStep != meetingAligned && run.CurrentStep != meetingReady || hasPendingMeetingAnswer(round)) {
		run.Status = RunStatusRunning
		run.ErrorMessage = ""
		if err := s.saveMeeting(ctx, store, run, round); err != nil {
			s.meetingMu.Unlock()
			return RunDetail{}, err
		}
		s.launchMeetingLocked(rootID, runID, nil)
	}

	s.meetingMu.Unlock()
	return s.GetRunDetail(ctx, rootID, runID)
}

func validateQuickRunEditable(run Run) error {
	if run.Status == RunStatusCanceled {
		return errors.New("已取消的协作不能修改模型")
	}
	if run.Status == RunStatusCompleted && run.DocsCleaned {
		return errors.New("该协作过程文档已清理，无法再修改模型")
	}
	return nil
}

func applyMemberSlotUpdates(existing []MemberSlot, updates []MemberSlot, mode string) ([]MemberSlot, map[string]bool, []MemberSlot, error) {
	if len(existing) == 0 {
		return nil, nil, nil, errors.New("当前协作没有可修改的成员槽位")
	}
	next := make([]MemberSlot, len(existing))
	copy(next, existing)
	seen := make(map[string]bool, len(updates))
	changedSlots := make(map[string]bool)
	var changedMembers []MemberSlot

	for _, upd := range updates {
		idx := findMemberSlotIndex(next, upd, mode)
		if idx < 0 {
			return nil, nil, nil, fmt.Errorf("未找到对应的成员槽位：%s", firstNonEmpty(upd.SlotID, upd.Role))
		}
		target := next[idx]
		if seen[target.SlotID] {
			return nil, nil, nil, fmt.Errorf("成员槽位重复：%s", target.SlotID)
		}
		seen[target.SlotID] = true

		agentName := strings.TrimSpace(upd.Agent)
		if agentName == "" {
			return nil, nil, nil, errors.New("每个成员都必须指定原生 Agent 标识")
		}
		updated := target
		updated.Agent = agentName
		updated.Model = strings.TrimSpace(upd.Model)
		updated.Effort = strings.TrimSpace(upd.Effort)
		updated.PermissionMode = strings.TrimSpace(upd.PermissionMode)
		if mode == ModeQuick && updated.Role == RoleReviewer {
			updated.PermissionMode = ""
		}
		if updated != target {
			next[idx] = updated
			changedSlots[updated.SlotID] = true
			changedMembers = append(changedMembers, updated)
		}
	}
	return next, changedSlots, changedMembers, nil
}

func findMemberSlotIndex(members []MemberSlot, target MemberSlot, mode string) int {
	slotID := strings.TrimSpace(target.SlotID)
	role := strings.TrimSpace(target.Role)
	if slotID != "" {
		for i, m := range members {
			if m.SlotID == slotID {
				return i
			}
		}
	}
	if mode == ModeQuick && role != "" {
		for i, m := range members {
			if m.Role == role {
				return i
			}
		}
	}
	return -1
}

func stepMatchesSlotSet(step StepCard, slots map[string]bool) bool {
	if len(slots) == 0 {
		return false
	}
	if strings.TrimSpace(step.SlotID) != "" && slots[step.SlotID] {
		return true
	}
	if step.Role == RolePrimary && slots["primary"] {
		return true
	}
	if step.Role == RoleReviewer && slots["reviewer"] {
		return true
	}
	return false
}

func syncQuickRunPendingSteps(run *Run, changedSlots map[string]bool) {
	if run == nil {
		return
	}
	primary, reviewer := extractQuickMembers(run.Snapshot.Members)
	for i := range run.Steps {
		step := &run.Steps[i]
		if step.Status == StepStatusDone || step.Status == StepStatusSkipped {
			continue
		}
		if len(changedSlots) > 0 && !stepMatchesSlotSet(*step, changedSlots) {
			continue
		}
		switch step.Role {
		case RolePrimary:
			if primary.Agent != "" {
				step.SlotID = primary.SlotID
				step.Agent = primary.Agent
				step.Model = primary.Model
				step.Effort = primary.Effort
			}
		case RoleReviewer:
			if reviewer.Agent != "" {
				step.SlotID = reviewer.SlotID
				step.Agent = reviewer.Agent
				step.Model = reviewer.Model
				step.Effort = reviewer.Effort
			}
		}
	}
}

func sameQuickMemberSlot(a, b MemberSlot) bool {
	if strings.TrimSpace(a.SlotID) != "" && a.SlotID == b.SlotID {
		return true
	}
	return strings.TrimSpace(a.Role) != "" && a.Role == b.Role
}

func mergeLatestQuickMembers(dst *Run, latest Run, activeStepKey string) {
	if dst == nil || len(latest.Snapshot.Members) == 0 {
		return
	}
	merged := make([]MemberSlot, len(latest.Snapshot.Members))
	copy(merged, latest.Snapshot.Members)
	if backfill := dst.resolvedMember; backfill != nil && strings.TrimSpace(backfill.Model) != "" {
		backfillSlot := MemberSlot{SlotID: backfill.SlotID, Role: backfill.Role}
		for i := range merged {
			if strings.TrimSpace(merged[i].Model) == "" &&
				sameQuickMemberSlot(backfillSlot, merged[i]) &&
				merged[i].Agent == backfill.Agent {
				merged[i].Model = backfill.Model
				break
			}
		}
		dst.resolvedMember = nil
	}
	dst.Snapshot.Members = merged

	primary, reviewer := extractQuickMembers(dst.Snapshot.Members)
	for i := range dst.Steps {
		step := &dst.Steps[i]
		if step.Key == activeStepKey || step.Status == StepStatusDone || step.Status == StepStatusSkipped {
			continue
		}
		switch step.Role {
		case RolePrimary:
			if primary.Agent != "" {
				step.SlotID = primary.SlotID
				step.Agent = primary.Agent
				step.Model = primary.Model
				step.Effort = primary.Effort
			}
		case RoleReviewer:
			if reviewer.Agent != "" {
				step.SlotID = reviewer.SlotID
				step.Agent = reviewer.Agent
				step.Model = reviewer.Model
				step.Effort = reviewer.Effort
			}
		}
	}
}
