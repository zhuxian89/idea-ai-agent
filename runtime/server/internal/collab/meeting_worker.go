package collab

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/turndiff"
)

type activeMeetingTurn struct {
	sessionKey string
	slotID     string
	cancel     context.CancelFunc
	replaced   bool
	done       chan struct{}
}

type meetingWorker struct {
	ctx       context.Context
	cancel    context.CancelFunc
	done      chan struct{}
	settled   *sync.Cond
	active    map[string]*activeMeetingTurn
	pausing   bool
	replacing int
	failures  map[string]error
}

// meetingMu protects the scheduling decision and the reservation for each member turn.
func (s *Service) launchMeetingLocked(rootID, runID string, failures map[string]error) {
	key := workerKey(rootID, runID)
	if s.meetings[key] != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	if failures == nil {
		failures = make(map[string]error)
	}
	w := &meetingWorker{ctx: ctx, cancel: cancel, done: make(chan struct{}), settled: sync.NewCond(&s.meetingMu), active: make(map[string]*activeMeetingTurn), failures: failures}
	s.meetings[key] = w
	go s.driveMeeting(rootID, runID, w)
}

func (s *Service) driveMeeting(rootID, runID string, w *meetingWorker) {
	s.meetingMu.Lock()
	defer s.meetingMu.Unlock()
	defer w.cancel()
	defer s.finishMeetingWorker(workerKey(rootID, runID), w)
	ctx := context.Background()
	for {
		for w.pausing && w.ctx.Err() == nil {
			w.settled.Wait()
		}
		store, run, detail, err := s.meetingState(ctx, rootID, runID)
		if err != nil {
			log.Printf("[collab] meeting state %s: %v", runID, err)
			return
		}
		round := detail.Rounds[run.Round-1]
		if run.Status != RunStatusRunning {
			return
		}
		if w.ctx.Err() != nil {
			s.stopMeetingWithError(store, run, round, errors.New("会议已暂停，可继续未交付的成员"))
			return
		}
		root, err := s.runner.RootPath(rootID)
		if err == nil {
			err = s.recoverMeetingDocs(root, run, &round)
		}
		if err == nil {
			if run.CurrentStep == meetingReview || run.CurrentStep == meetingPlan {
				round.Inputs = dedupeStrings(append(round.Inputs, meetingNoteInputs(detail.Rounds[:run.Round-1]...)...))
			}
			for _, prior := range detail.Rounds[:run.Round-1] {
				round.PriorTurns = append(round.PriorTurns, prior.Turns...)
			}
			candidates := selectMeetingBatch(run, round)
			var batch []MeetingTurn
			var blocked error
			for _, candidate := range candidates {
				if cause := w.failures[candidate.ID]; cause != nil {
					blocked = errors.Join(blocked, cause)
				} else if s.runner.StageTurnActive(run.RootID, candidate.SessionKey) {
					blocked = errors.Join(blocked, fmt.Errorf("%s 仍在执行", meetingMemberName(run, candidate.SlotID)))
				} else {
					turn := findMeetingTurn(&round, candidate.ID)
					turn.Status = StepStatusRunning
					turn.At = time.Now().UTC()
					batch = append(batch, *turn)
				}
			}
			switch {
			case len(candidates) == 0:
				err = advanceMeeting(root, &run, &round)
			case len(batch) == 0:
				err = blocked
			}
			if err == nil {
				err = s.saveMeeting(ctx, store, run, round)
			}
			if err == nil && run.Status != RunStatusRunning {
				return
			}
			if err == nil {
				for _, turn := range batch {
					s.startMeetingTurnLocked(w, store, root, run, round, turn)
				}
				for len(w.active) > 0 || w.replacing > 0 {
					w.settled.Wait()
				}
			}
		}
		if err != nil {
			s.stopMeetingWithError(store, run, round, err)
			return
		}
	}
}

func (s *Service) startMeetingTurnLocked(w *meetingWorker, store *Store, root string, run Run, round MeetingRound, turn MeetingTurn) {
	turnCtx, turnCancel := context.WithCancel(w.ctx)
	at := &activeMeetingTurn{
		slotID: turn.SlotID,
		cancel: turnCancel,
		done:   make(chan struct{}),
	}
	w.active[turn.ID] = at
	delete(w.failures, turn.ID)
	go func() {
		defer turnCancel()
		err := s.runMeetingTurn(w, at, turnCtx, store, root, run, round, turn)
		s.meetingMu.Lock()
		if w.active[turn.ID] == at {
			delete(w.active, turn.ID)
		}
		if err != nil && !at.replaced {
			w.failures[turn.ID] = err
		}
		close(at.done)
		w.settled.Broadcast()
		s.meetingMu.Unlock()
	}()
}

func (s *Service) finishMeetingWorker(key string, worker *meetingWorker) {
	delete(s.meetings, key)
	close(worker.done)
}

func (s *Service) stopMeetingWithError(store *Store, run Run, round MeetingRound, err error) {
	run.Status = RunStatusWaitingUser
	run.ErrorMessage = err.Error()
	for i := range round.Turns {
		if round.Turns[i].Status == StepStatusRunning {
			round.Turns[i].Status = StepStatusWaitingUser
		}
	}
	if saveErr := s.saveMeeting(context.Background(), store, run, round); saveErr != nil {
		log.Printf("[collab] meeting state %s: %v; original error: %v", run.ID, saveErr, err)
	}
}

func (s *Service) pauseMeeting(ctx context.Context, rootID, runID string) (RunDetail, error) {
	s.meetingMu.Lock()
	worker := s.meetings[workerKey(rootID, runID)]
	if worker != nil && !worker.pausing {
		worker.pausing = true
		var sessions []string
		for _, at := range worker.active {
			if at != nil && at.sessionKey != "" {
				sessions = append(sessions, at.sessionKey)
			}
		}
		go func() {
			for _, session := range sessions {
				if err := s.runner.CancelStageTurn(context.WithoutCancel(ctx), rootID, session); err != nil {
					log.Printf("[collab] meeting interrupt %s/%s: %v", runID, session, err)
				}
			}
			s.meetingMu.Lock()
			// Keep the turn contexts alive until their runners consume the native boundaries.
			for len(worker.active) > 0 || worker.replacing > 0 {
				worker.settled.Wait()
			}
			worker.cancel()
			worker.settled.Broadcast()
			s.meetingMu.Unlock()
		}()
	}
	s.meetingMu.Unlock()
	if worker != nil {
		select {
		case <-worker.done:
		case <-ctx.Done():
			return RunDetail{}, ctx.Err()
		}
	}
	return s.GetRunDetail(ctx, rootID, runID)
}

func (s *Service) continueMeeting(ctx context.Context, rootID, runID string) (RunDetail, error) {
	s.meetingMu.Lock()
	defer s.meetingMu.Unlock()
	store, run, detail, err := s.meetingState(ctx, rootID, runID)
	if err != nil {
		return RunDetail{}, err
	}
	round := detail.Rounds[run.Round-1]
	if (run.Status == RunStatusWaitingUser || run.Status == RunStatusRunning && s.meetings[workerKey(rootID, runID)] == nil) && !run.DocsCleaned &&
		(run.CurrentStep != meetingAligned && run.CurrentStep != meetingReady || hasPendingMeetingAnswer(round)) {
		run.Status, run.ErrorMessage = RunStatusRunning, ""
		if err := s.saveMeeting(ctx, store, run, round); err != nil {
			return RunDetail{}, err
		}
		s.launchMeetingLocked(rootID, runID, nil)
	}
	return s.GetRunDetail(ctx, rootID, runID)
}

func selectMeetingBatch(run Run, round MeetingRound) []MeetingTurn {
	if round.AnswerOnly || run.CurrentStep != meetingProposal {
		for _, turn := range round.Turns {
			if turn.Kind == meetingAnswer && turn.Status != StepStatusDone {
				return []MeetingTurn{turn}
			}
		}
	}
	if round.AnswerOnly {
		return nil
	}
	var batch []MeetingTurn
	for _, turn := range round.Turns {
		if turn.Kind == run.CurrentStep && turn.Status != StepStatusDone {
			batch = append(batch, turn)
			if run.CurrentStep != meetingProposal {
				break
			}
		}
	}
	return batch
}

func advanceMeeting(root string, run *Run, round *MeetingRound) error {
	if round.AnswerOnly {
		round.AnswerOnly = false
		run.Status = RunStatusWaitingUser
		return nil
	}
	switch run.CurrentStep {
	case meetingProposal:
		round.Items = meetingCandidates(*run, *round)
		if len(round.Items) == 0 {
			return errors.New("需要至少一份已交付的提案")
		}
		if _, err := WriteRunDoc(root, run.ID, round.doc(meetingReviewListDoc), renderMeetingItems(*run, *round)); err != nil {
			return err
		}
		round.addMembers(*run, meetingReview)
		run.CurrentStep = meetingReview
	case meetingReview:
		return finishMeetingReview(root, run, round)
	case meetingAligned:
		run.Status = RunStatusWaitingUser
	case meetingPlan:
		plan := currentMeetingPlan(*round)
		if plan != nil {
			if _, err := WriteRunDoc(root, run.ID, plan.Doc, renderMeetingPlan(*run, *round, *plan, false)); err != nil {
				return err
			}
		}
		run.Status, run.CurrentStep = RunStatusWaitingUser, meetingReady
	case meetingConfirm:
		plan := currentMeetingPlan(*round)
		if _, err := WriteRunDoc(root, run.ID, plan.Doc, renderMeetingPlan(*run, *round, *plan, true)); err != nil {
			return err
		}
		run.Status, run.CurrentStep = RunStatusWaitingUser, meetingReady
	case meetingReady:
		if run.CompletedAt != "" {
			run.Status = RunStatusCompleted
		} else {
			run.Status = RunStatusWaitingUser
		}
	}
	return nil
}

func finishMeetingReview(root string, run *Run, round *MeetingRound) error {
	round.Items = alignMeetingItems(*run, *round)
	round.SummaryDoc = round.doc(meetingSummaryDoc)
	round.SummaryAt = time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := WriteRunDoc(root, run.ID, round.SummaryDoc, renderMeetingItems(*run, *round)); err != nil {
		return err
	}
	run.Status, run.CurrentStep, run.ErrorMessage = RunStatusWaitingUser, meetingAligned, ""
	return nil
}

func findMeetingTurn(round *MeetingRound, id string) *MeetingTurn {
	for i := range round.Turns {
		if round.Turns[i].ID == id {
			return &round.Turns[i]
		}
	}
	return nil
}

func (s *Service) recoverMeetingDocs(root string, run Run, round *MeetingRound) error {
	for i := range round.Turns {
		if err := recoverMeetingTurnDoc(root, run, *round, &round.Turns[i]); err != nil {
			return err
		}
	}
	return nil
}

func recoverMeetingTurnDoc(root string, run Run, round MeetingRound, turn *MeetingTurn) error {
	if turn.Status == StepStatusDone {
		return nil
	}
	if turn.Status == meetingDelivering {
		if _, err := WriteRunDoc(root, run.ID, turn.Doc, meetingTurnDoc(run, round, *turn)); err != nil {
			return err
		}
		turn.Status = StepStatusDone
		return nil
	}
	body, err := ReadRunDoc(root, run.ID, turn.Doc)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	filter := NewControlStreamFilter()
	filter.Push(body)
	filter.Flush()
	if strings.TrimSpace(filter.VisibleText()) != "" {
		turn.Body = filter.VisibleText()
		if turn.Kind == meetingProposal || turn.Kind == meetingReview || turn.Kind == meetingConfirm {
			turn.Positions, turn.Confirmed, turn.PositionIssue = parseMeetingPositions(root, round, *turn, filter.Blocks())
		}
		turn.Status = StepStatusDone
		if turn.At.IsZero() {
			turn.At = time.Now().UTC()
		}
	}
	return nil
}

func (s *Service) runMeetingTurn(worker *meetingWorker, activeTurn *activeMeetingTurn, ctx context.Context, store *Store, root string, run Run, round MeetingRound, turn MeetingTurn) error {
	var member MemberSlot
	for _, slot := range run.Snapshot.Members {
		if slot.SlotID == turn.SlotID {
			member = slot
			break
		}
	}
	mode := member.PermissionMode
	readOnly := mode == ""
	if mode == meetingAgentDefaultMode {
		mode = ""
	}
	key, err := s.runner.EnsureStageSession(ctx, StageSessionRequest{
		RootID: run.RootID, RunID: run.ID, StepKey: turn.ID, SessionKey: turn.SessionKey,
		Title: meetingMemberName(run, member.SlotID), Agent: member.Agent, Model: member.Model, ReadOnly: readOnly,
	})
	if err != nil {
		return err
	}

	if turn.Kind == meetingReview && round.Number > 1 {
		preview := MeetingRound{}
		for _, item := range round.Items {
			if !item.Aligned {
				preview.Items = append(preview.Items, item)
			}
		}
		if _, err := WriteRunDoc(root, run.ID, round.doc(meetingReviewListDoc), renderMeetingItems(run, preview)); err != nil {
			return err
		}
	}
	s.mu.Lock()
	home := s.homeDir
	s.mu.Unlock()
	standards := BuildReviewerStandardsSection(LoadStandards(StandardsOptions{RootPath: root, HomeDir: home, SkillPaths: run.Snapshot.SkillPaths}))
	before, snapErr := turndiff.Capture(ctx, root)
	audit := newMeetingReadAudit(root, run, round, turn)
	filter := NewControlStreamFilter()
	live := &meetingLiveTurn{}
	liveKey := workerKey(run.RootID, turn.SessionKey)
	s.meetingLive.Store(liveKey, live)
	defer s.meetingLive.Delete(liveKey)
	s.meetingMu.Lock()
	if worker.pausing || activeTurn.replaced {
		s.meetingMu.Unlock()
		return context.Canceled
	}
	s.meetingMu.Unlock()
	result, turnErr := s.runner.RunStageTurn(ctx, StageTurnRequest{RootID: run.RootID, SessionKey: key,
		Agent: member.Agent, Model: member.Model, Effort: member.Effort, PermissionMode: mode, ReadOnly: readOnly, SkipSwitchHint: true, MemberSlotID: member.SlotID,
		Prompt: meetingPrompt(run, round, turn, standards), StreamFilter: filter,
		OnRegistered: func() error {
			s.meetingMu.Lock()
			defer s.meetingMu.Unlock()
			if worker.pausing || activeTurn.replaced {
				return context.Canceled
			}
			activeTurn.sessionKey = key
			return nil
		},
		OnToolCall: func(tool agenttypes.ToolCall) {
			if audit.observe(tool) {
				s.recordMeetingBlindRead(run, turn, audit.paths())
			}
		},
		OnText: func(delta string) { s.streamMeetingText(run, turn, live, delta) }})
	turn.ReadOnlyState, _, turn.ReadOnlyNote = FinishReadOnlySnapshot(context.Background(), before, snapErr)
	turn.Body = filter.VisibleText()
	turn.BlindReads = audit.paths()
	turn.Agent = member.Agent
	turn.Model = firstNonEmpty(result.ResolvedModel, member.Model)
	if turn.Kind == meetingProposal || turn.Kind == meetingReview || turn.Kind == meetingConfirm {
		turn.Positions, turn.Confirmed, turn.PositionIssue = parseMeetingPositions(root, round, turn, filter.Blocks())
	}

	s.meetingMu.Lock()
	defer s.meetingMu.Unlock()
	if activeTurn.replaced {
		return context.Canceled
	}
	_, current, detail, err := s.meetingState(context.Background(), run.RootID, run.ID)
	if err != nil {
		return err
	}
	currentRound := detail.Rounds[current.Round-1]
	persisted := findMeetingTurn(&currentRound, turn.ID)
	if worker.pausing && turnErr == nil {
		turnErr = context.Canceled
	}
	if turnErr != nil || strings.TrimSpace(turn.Body) == "" {
		persisted.Status = StepStatusWaitingUser
		persisted.Body = turn.Body
		persisted.BlindReads = dedupeStrings(append(persisted.BlindReads, turn.BlindReads...))
		persisted.ReadOnlyState, persisted.ReadOnlyNote = turn.ReadOnlyState, turn.ReadOnlyNote
		if err := s.saveMeeting(context.Background(), store, current, currentRound); err != nil {
			return errors.Join(turnErr, err)
		}
		if turnErr != nil {
			return fmt.Errorf("%s：%w", meetingMemberName(run, member.SlotID), turnErr)
		}
		return fmt.Errorf("%s 尚未交付正文", meetingMemberName(run, member.SlotID))
	}
	turn.BlindReads = dedupeStrings(append(persisted.BlindReads, turn.BlindReads...))
	if persisted.ReadOnlyState == ReadOnlyModified && turn.ReadOnlyState != ReadOnlyModified {
		turn.ReadOnlyState, turn.ReadOnlyNote = persisted.ReadOnlyState, persisted.ReadOnlyNote
	}
	turn.Status = meetingDelivering
	*persisted = turn
	if err := s.saveMeeting(context.Background(), store, current, currentRound); err != nil {
		return err
	}
	if _, err := WriteRunDoc(root, run.ID, turn.Doc, meetingTurnDoc(run, currentRound, turn)); err != nil {
		return err
	}
	persisted.Status = StepStatusDone
	return s.saveMeeting(context.Background(), store, current, currentRound)
}

func (s *Service) recordMeetingBlindRead(run Run, turn MeetingTurn, paths []string) {
	s.meetingMu.Lock()
	defer s.meetingMu.Unlock()
	ctx := context.Background()
	store, latest, detail, err := s.meetingState(ctx, run.RootID, run.ID)
	if err == nil {
		round := detail.Rounds[run.Round-1]
		persisted := findMeetingTurn(&round, turn.ID)
		persisted.BlindReads = dedupeStrings(append(persisted.BlindReads, paths...))
		err = s.saveMeeting(ctx, store, latest, round)
	}
	if err != nil {
		log.Printf("[collab] meeting read audit %s: %v", run.ID, err)
	}
}

func meetingTurnDoc(run Run, round MeetingRound, turn MeetingTurn) string {
	if turn.Kind == meetingPlan {
		return renderMeetingPlan(run, round, turn, false)
	}
	return turn.Body
}

func renderMeetingPlan(run Run, round MeetingRound, plan MeetingTurn, includeConfirmations bool) string {
	var b strings.Builder
	b.WriteString(meetingPlanBody(plan.Body))
	if round.AuthorOverride != "" {
		b.WriteString("\n\n## 作者方向（已否决全部议题）\n\n")
		b.WriteString("裁决原文：`" + DocRelPath(run.ID, round.doc(meetingDecisionDoc)) + "`\n\n")
		b.WriteString(strings.TrimSpace(round.AuthorOverride) + "\n")
	} else {
		if len(round.Decisions) > 0 {
			b.WriteString("\n\n## 作者逐条裁决\n\n")
			b.WriteString("裁决原文：`" + DocRelPath(run.ID, round.doc(meetingDecisionDoc)) + "`\n")
			for _, decision := range round.Decisions {
				switch decision.Choice {
				case "adopt":
					fmt.Fprintf(&b, "\n### %s 采纳 %s\n", decision.ItemID, meetingMemberName(run, decision.SlotID))
					if adopted, ok := round.AdoptedPositions[decision.ItemID]; ok {
						writeMeetingPosition(&b, run, adopted)
						continue
					}
					for _, item := range round.Items {
						if item.ID == decision.ItemID {
							if selected := adoptedMeetingPosition(item, decision); selected != nil {
								writeMeetingPosition(&b, run, *selected)
							}
							break
						}
					}
				case "custom":
					fmt.Fprintf(&b, "\n### %s 作者说明\n\n%s\n", decision.ItemID, strings.TrimSpace(decision.Note))
				}
			}
		}
		b.WriteString("\n\n## 未解决的分歧\n")
		deferred := false
		for _, item := range round.Items {
			if !slices.ContainsFunc(round.Decisions, func(d MeetingDecision) bool { return d.ItemID == item.ID && d.Choice == "defer" }) {
				continue
			}
			deferred = true
			fmt.Fprintf(&b, "\n### %s %s · 暂不决定\n", item.ID, item.Title)
			writeMeetingItemPositions(&b, run, item)
		}
		if !deferred {
			b.WriteString("\n无。\n")
		}
	}
	if includeConfirmations {
		b.WriteString("\n## 成员表述核对\n")
		for _, turn := range round.Turns {
			if !meetingConfirmationFor(turn, plan) {
				continue
			}
			status := "未确认"
			if turn.Confirmed != nil && *turn.Confirmed {
				status = "已确认"
			} else if turn.Confirmed != nil {
				status = "有异议"
			}
			fmt.Fprintf(&b, "\n- %s · %s · `%s`", meetingMemberName(run, turn.SlotID), status, DocRelPath(run.ID, turn.Doc))
		}
	}
	return b.String()
}

// These sections are generated from the author's actual decisions and member confirmations.
func meetingPlanBody(body string) string {
	var b strings.Builder
	var fence byte
	var fenceLen, skipHeading int
	for _, line := range strings.Split(body, "\n") {
		if fence != 0 {
			if isClosingFence(line, fence, fenceLen) {
				fence = 0
			}
		} else if ch, n, _, ok := parseOpeningFence(line); ok {
			fence, fenceLen = ch, n
		} else {
			heading, title, ok := strings.Cut(strings.TrimSpace(line), " ")
			if ok && heading != "" && strings.Trim(heading, "#") == "" {
				if len(heading) <= skipHeading {
					skipHeading = 0
				}
				switch strings.Trim(title, " #：:") {
				case "未解决的分歧", "成员表述核对", "作者逐条裁决", "作者方向（已否决全部议题）":
					skipHeading = len(heading)
				}
			}
		}
		if skipHeading == 0 {
			fmt.Fprintln(&b, line)
		}
	}
	return strings.TrimRight(b.String(), "\r\n")
}

func (s *Service) deleteMeeting(ctx context.Context, rootID, runID string) error {
	if _, err := s.pauseMeeting(ctx, rootID, runID); err != nil {
		return err
	}
	s.meetingMu.Lock()
	defer s.meetingMu.Unlock()
	store, _, detail, err := s.meetingState(ctx, rootID, runID)
	if err != nil {
		return err
	}
	if s.meetings[workerKey(rootID, runID)] != nil {
		return errors.New("会议已继续，请暂停后再删除")
	}
	if detail.QuickRunID != "" {
		if err := s.DeleteRun(ctx, rootID, detail.QuickRunID); err != nil && !errors.Is(err, ErrRunNotFound) {
			return err
		}
	}
	for _, round := range detail.Rounds {
		for _, turn := range round.Turns {
			if turn.SessionKey != "" && !turn.At.IsZero() {
				_ = s.runner.DeleteStageSession(ctx, rootID, turn.SessionKey)
			}
		}
	}
	root, err := s.runner.RootPath(rootID)
	if err != nil {
		return err
	}
	if _, err := CleanupRunDocs(root, runID, nil); err != nil {
		return err
	}
	if err := store.DeleteRun(ctx, runID); err != nil {
		return err
	}
	s.notifyRunUpdated(ctx, store, rootID, Run{ID: runID, RootID: rootID, Status: "deleted"})
	return nil
}
