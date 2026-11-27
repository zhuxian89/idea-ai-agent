package collab

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

type StartMeetingInput struct {
	StartQuickRunInput
	TopicMode         string `json:"topic_mode,omitempty"`
	FinalAuthorSlotID string `json:"final_author_slot_id,omitempty"`
	MaxRounds         int    `json:"max_rounds,omitempty"`
}

type MeetingActionInput struct {
	Round           int               `json:"round"`
	TurnID          string            `json:"turn_id,omitempty"`
	Attempt         time.Time         `json:"attempt,omitempty"`
	Action          string            `json:"action"`
	Text            string            `json:"text,omitempty"`
	Mentions        []string          `json:"mentions,omitempty"`
	Decisions       []MeetingDecision `json:"decisions,omitempty"`
	OverrideAll     bool              `json:"override_all,omitempty"`
	QuickTemplateID string            `json:"quick_template_id,omitempty"`
	PlanID          string            `json:"plan_id,omitempty"`
}

func (s *Service) StartMeeting(ctx context.Context, in StartMeetingInput) (RunDetail, error) {
	in.RootID = strings.TrimSpace(in.RootID)
	in.TaskPrompt = strings.TrimSpace(in.TaskPrompt)
	if in.RootID == "" || in.TaskPrompt == "" {
		return RunDetail{}, errors.New("请选择项目并填写会议议题")
	}
	tpl := Template{ID: in.TemplateID, Name: firstNonEmpty(in.TemplateName, "本次会议"), Mode: ModeGroup,
		Members: in.Members, SkillPaths: in.SkillPaths, FinalAuthorSlotID: in.FinalAuthorSlotID, MaxRounds: in.MaxRounds, TopicMode: in.TopicMode}
	if len(tpl.Members) == 0 && tpl.ID != "" {
		saved, found, err := s.templates.Get(tpl.ID)
		if err != nil {
			return RunDetail{}, err
		}
		if !found || saved.Mode != ModeGroup {
			return RunDetail{}, errors.New("请选择开大会模板")
		}
		tpl = saved
		if in.TopicMode != "" {
			tpl.TopicMode = in.TopicMode
		}
	}
	tpl, err := normalizeAndValidateTemplate(tpl, time.Now().UTC())
	if err != nil {
		return RunDetail{}, err
	}
	if statuses := s.runner.AgentStatuses(); len(statuses) > 0 {
		for _, member := range ValidateMembers(tpl.Members, statuses) {
			if !member.Available {
				return RunDetail{}, errors.New(member.Reason)
			}
		}
	}
	store, err := s.runner.GetCollabStore(in.RootID)
	if err != nil {
		return RunDetail{}, err
	}
	root, err := s.runner.RootPath(in.RootID)
	if err != nil {
		return RunDetail{}, err
	}
	run := Run{ID: newCollabID("run"), RootID: in.RootID, Mode: ModeGroup, Round: 1,
		Title: firstNonEmpty(in.Title, deriveRunTitle(in.TaskPrompt)), TaskPrompt: in.TaskPrompt, Snapshot: SnapshotTemplate(tpl),
		TemplateID: in.TemplateID, TemplateName: tpl.Name, Status: RunStatusRunning, CurrentStep: meetingProposal}
	if _, err := WriteRunDoc(root, run.ID, MeetingTopicDoc, "# 会议议题\n\n"+in.TaskPrompt); err != nil {
		return RunDetail{}, err
	}
	round := MeetingRound{RunID: run.ID, Number: 1, Inputs: []string{MeetingTopicDoc}}
	round.addMembers(run, meetingProposal)
	created, err := store.createMeeting(ctx, run, round)
	if err != nil {
		_, _ = CleanupRunDocs(root, run.ID, nil)
		return RunDetail{}, err
	}
	s.notifyRunUpdated(ctx, store, run.RootID, created)
	s.meetingMu.Lock()
	s.launchMeetingLocked(run.RootID, run.ID, nil)
	s.meetingMu.Unlock()
	return s.GetRunDetail(ctx, run.RootID, run.ID)
}

func (r *MeetingRound) addMembers(run Run, kind string) {
	for _, member := range run.Snapshot.Members {
		if kind == meetingPlan && member.SlotID != run.Snapshot.FinalAuthorSlotID ||
			kind == meetingConfirm && member.SlotID == run.Snapshot.FinalAuthorSlotID {
			continue
		}
		r.addTurn(run, kind, member.SlotID, "")
	}
}

func (r *MeetingRound) addTurn(run Run, kind, slotID, replyTo string) {
	memberName := ""
	for i, member := range run.Snapshot.Members {
		if member.SlotID == slotID {
			memberName = fmt.Sprintf("成员%d", i+1)
			break
		}
	}
	var doc string
	switch kind {
	case meetingProposal:
		doc = r.doc("01-独立提案/" + memberName + ".md")
	case meetingReview:
		doc = r.doc("02-互评/" + memberName + ".md")
	case meetingPlan:
		if currentMeetingPlan(*r) == nil {
			doc = MeetingPlanDoc
		} else {
			doc = r.doc(fmt.Sprintf("05-正式计划-m-%02d-%03d.md", r.Number, len(r.Turns)+1))
		}
	case meetingConfirm:
		plan := currentMeetingPlan(*r)
		replyTo = plan.ID
		if plan.Doc != MeetingPlanDoc {
			memberName = plan.ID + "-" + memberName
		}
		doc = r.doc("05-计划核对/" + memberName + ".md")
	case meetingAnswer:
		count := 1
		for _, turn := range r.Turns {
			if turn.Kind == kind && turn.SlotID == slotID {
				count++
			}
		}
		if count > 1 {
			memberName += fmt.Sprintf("-%02d", count)
		}
		doc = r.doc("04-补充答复/" + memberName + ".md")
	}
	id := fmt.Sprintf("m-%02d-%03d", r.Number, len(r.Turns)+1)
	turn := MeetingTurn{ID: id, Kind: kind, SlotID: slotID, ReplyTo: replyTo,
		Status: StepStatusPending, SessionKey: run.ID + "-" + id, Doc: doc}
	if kind == meetingConfirm {
		turn.PlanID, turn.ReplyTo = replyTo, ""
	}
	r.Turns = append(r.Turns, turn)
}

// The meeting lock serializes author actions with worker commits. Agent calls run outside it.
func (s *Service) meetingState(ctx context.Context, rootID, runID string) (*Store, Run, *MeetingDetail, error) {
	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		return nil, Run{}, nil, err
	}
	run, err := store.GetRun(ctx, runID)
	if err != nil {
		return nil, Run{}, nil, err
	}
	if run.Mode != ModeGroup {
		return nil, Run{}, nil, errors.New("请选择会议运行")
	}
	detail, err := store.readMeeting(ctx, run.ID)
	if err == nil && (run.Round < 1 || run.Round != len(detail.Rounds)) {
		err = errors.New("会议轮次记录不完整")
	}
	return store, run, detail, err
}

func (s *Service) saveMeeting(ctx context.Context, store *Store, run Run, rounds ...MeetingRound) error {
	run.UpdatedAt = time.Now().UTC()
	if err := store.saveMeeting(ctx, run, rounds...); err != nil {
		return err
	}
	s.notifyRunUpdated(ctx, store, run.RootID, run)
	return nil
}

func (s *Service) MeetingAction(ctx context.Context, rootID, runID string, input MeetingActionInput) (RunDetail, error) {
	s.meetingMu.Lock()
	defer s.meetingMu.Unlock()
	store, run, detail, err := s.meetingState(ctx, rootID, runID)
	if err != nil {
		return RunDetail{}, err
	}
	if detail.QuickRunID != "" && input.Action == "implement" {
		return s.GetRunDetail(ctx, rootID, runID)
	}
	if input.Round != run.Round || detail.QuickRunID != "" || run.DocsCleaned {
		return RunDetail{}, errors.New("会议状态已改变，请刷新后再操作")
	}
	root, err := s.runner.RootPath(rootID)
	if err != nil {
		return RunDetail{}, err
	}
	round := detail.Rounds[run.Round-1]
	var updatedRounds []MeetingRound
	worker := s.meetings[workerKey(rootID, runID)]
	active := worker != nil
	if active && (worker.pausing || worker.replacing > 0) && input.Action != "retry_turn" {
		if worker.replacing > 0 {
			return RunDetail{}, errors.New("正在切换成员模型，请稍后操作")
		}
		return RunDetail{}, errors.New("会议正在暂停，请稍后操作")
	}
	switch input.Action {
	case "retry_turn":
		return s.retryMeetingTurnLocked(ctx, store, root, run, round, input)
	case "message":
		if run.Status == RunStatusCanceled {
			return RunDetail{}, errors.New("会议已取消")
		}
		if err := addMeetingNote(run, &round, input); err != nil {
			return RunDetail{}, err
		}
		if err := writeMeetingNotes(root, run, round); err != nil {
			return RunDetail{}, err
		}
		if round.Turns[len(round.Turns)-1].ReplyTo != "" {
			if !active && run.Status == RunStatusWaitingUser && run.CurrentStep != meetingAligned && run.CurrentStep != meetingReady {
				round.AnswerOnly = true
			}
			run.Status, run.ErrorMessage = RunStatusRunning, ""
		}
	case "next":
		if active || run.Status != RunStatusWaitingUser ||
			(run.CurrentStep != meetingAligned && run.CurrentStep != meetingProposal && run.CurrentStep != meetingReview) {
			return RunDetail{}, errors.New("当前轮仍在进行")
		}
		if run.CurrentStep == meetingAligned && !hasOpenMeetingItems(round.Items) {
			return RunDetail{}, errors.New("本轮已达成共识，可以生成正式计划")
		}
		if run.CurrentStep != meetingAligned {
			if err := s.recoverMeetingDocs(root, run, &round); err != nil {
				return RunDetail{}, err
			}
			if run.CurrentStep == meetingProposal {
				if err := advanceMeeting(root, &run, &round); err != nil {
					return RunDetail{}, err
				}
				run.Status, run.ErrorMessage = RunStatusRunning, ""
				break
			}
			if len(round.Items) == 0 {
				return RunDetail{}, errors.New("需要至少一份已交付的提案")
			}
			if !slices.ContainsFunc(round.Turns, func(turn MeetingTurn) bool {
				return turn.Kind == meetingReview && turn.Status == StepStatusDone
			}) {
				return RunDetail{}, errors.New("需要至少一份已交付的互评")
			}
			if err := finishMeetingReview(root, &run, &round); err != nil {
				return RunDetail{}, err
			}
			if !hasOpenMeetingItems(round.Items) {
				break
			}
			updatedRounds = append(updatedRounds, round)
		}
		detail.Rounds[run.Round-1] = round
		inputs := append([]string{MeetingTopicDoc}, meetingNoteInputs(detail.Rounds...)...)
		run.Round++
		run.CurrentStep, run.Status, run.ErrorMessage = meetingReview, RunStatusRunning, ""
		round = MeetingRound{RunID: run.ID, Number: run.Round, Inputs: inputs, Items: round.Items}
		round.addMembers(run, meetingReview)
	case "plan":
		if active || run.CurrentStep != meetingAligned || hasPendingMeetingAnswer(round) {
			return RunDetail{}, errors.New("请先完成本轮讨论")
		}
		if input.OverrideAll {
			direction := strings.TrimSpace(input.Text)
			if direction == "" {
				return RunDetail{}, errors.New("请填写你的修改方向")
			}
			round.Decisions = nil
			round.AuthorOverride = direction
			if _, err := WriteRunDoc(root, run.ID, round.doc(meetingDecisionDoc), renderMeetingOverride(direction)); err != nil {
				return RunDetail{}, err
			}
		} else {
			if err := validateMeetingDecisions(round.Items, input.Decisions); err != nil {
				return RunDetail{}, err
			}
			round.AuthorOverride = ""
			round.Decisions = append([]MeetingDecision(nil), input.Decisions...)
			if len(round.Decisions) > 0 {
				if _, err := WriteRunDoc(root, run.ID, round.doc(meetingDecisionDoc), renderMeetingDecisions(run, round)); err != nil {
					return RunDetail{}, err
				}
			}
		}
		round.addMembers(run, meetingPlan)
		run.CurrentStep, run.Status = meetingPlan, RunStatusRunning
	case "finish":
		if active || run.CurrentStep != meetingReady || run.Status != RunStatusWaitingUser || currentMeetingPlan(round) == nil {
			return RunDetail{}, errors.New("请先生成并核对正式计划")
		}
		run.Status, run.ErrorMessage = RunStatusCompleted, ""
		run.CompletedAt = time.Now().UTC().Format(time.RFC3339Nano)
	case "revise_plan", "implement":
		if active || run.CurrentStep != meetingReady || run.Status == RunStatusCompleted {
			return RunDetail{}, errors.New("请先生成并核对正式计划，已结束的会议不能再开始实现")
		}
		plan := currentMeetingPlan(round)
		if plan == nil || (input.PlanID != plan.ID && (input.PlanID != "" || plan.Doc != MeetingPlanDoc)) {
			return RunDetail{}, errors.New("正式计划版本已改变，请刷新后再操作")
		}
		disputed := meetingPlanDisputed(round, *plan)
		reason := strings.TrimSpace(input.Text)
		if input.Action == "revise_plan" && !disputed {
			return RunDetail{}, errors.New("当前正式计划没有明确异议")
		}
		if disputed {
			if input.PlanID != plan.ID || reason == "" {
				return RunDetail{}, errors.New("正式计划有异议，请说明退回或按当前稿实现的理由")
			}
			resolution := MeetingPlanResolution{PlanID: plan.ID, Action: input.Action, Reason: reason}
			round.PlanResolutions = append(round.PlanResolutions, resolution)
		}
		if input.Action == "implement" {
			return s.handoffMeeting(ctx, root, run, round, *plan, input.QuickTemplateID)
		}
		if _, err := WriteRunDoc(root, run.ID, meetingPlanResolutionDoc(*plan), "# 作者退回理由\n\n"+reason); err != nil {
			return RunDetail{}, err
		}
		round.addMembers(run, meetingPlan)
		run.CurrentStep, run.Status, run.ErrorMessage = meetingPlan, RunStatusRunning, ""
	default:
		return RunDetail{}, errors.New("未知会议操作")
	}
	if err := s.saveMeeting(ctx, store, run, append(updatedRounds, round)...); err != nil {
		return RunDetail{}, err
	}
	if run.Status == RunStatusRunning {
		s.launchMeetingLocked(rootID, runID, nil)
	}
	return s.GetRunDetail(ctx, rootID, runID)
}

func hasOpenMeetingItems(items []MeetingItem) bool {
	return slices.ContainsFunc(items, func(item MeetingItem) bool { return !item.Aligned })
}

func (s *Service) handoffMeeting(ctx context.Context, root string, run Run, round MeetingRound, plan MeetingTurn, templateID string) (RunDetail, error) {
	body, err := ReadRunDoc(root, run.ID, plan.Doc)
	if err != nil {
		return RunDetail{}, err
	}
	in := StartQuickRunInput{RootID: run.RootID, Title: run.Title, TemplateID: templateID,
		TaskPrompt: body + "\n\n会议正式计划出处：`" + DocRelPath(run.ID, plan.Doc) + "`"}
	if templateID != "" {
		tpl, found, err := s.templates.Get(templateID)
		if err != nil {
			return RunDetail{}, err
		}
		if !found || tpl.Mode != ModeQuick {
			return RunDetail{}, errors.New("请选择快速模式模板")
		}
	} else {
		for _, member := range run.Snapshot.Members {
			if member.SlotID == run.Snapshot.FinalAuthorSlotID {
				member.Role = RolePrimary
				if member.PermissionMode == meetingAgentDefaultMode {
					member.PermissionMode = ""
				}
				in.Members = append(in.Members, member)
			}
		}
		for _, member := range run.Snapshot.Members {
			if member.SlotID != run.Snapshot.FinalAuthorSlotID {
				member.Role = RoleReviewer
				in.Members = append(in.Members, member)
				break
			}
		}
		in.SkillPaths = run.Snapshot.SkillPaths
	}
	quick, err := s.createQuickRun(ctx, in, newCollabID("run"), &round)
	if err != nil {
		return RunDetail{}, err
	}
	s.launchQuickWorker(run.RootID, quick.Run.ID, false, false)
	store, err := s.runner.GetCollabStore(run.RootID)
	if err != nil {
		return RunDetail{}, err
	}
	run, err = store.GetRun(context.Background(), run.ID)
	if err != nil {
		return RunDetail{}, err
	}
	s.notifyRunUpdated(context.Background(), store, run.RootID, run)
	return s.GetRunDetail(ctx, run.RootID, run.ID)
}
