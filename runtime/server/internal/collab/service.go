package collab

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/turndiff"
)

type StageSessionRequest struct {
	RootID     string
	RunID      string
	StepKey    string
	SessionKey string
	Title      string
	Agent      string
	Model      string
	ReadOnly   bool
}

type StageTurnRequest struct {
	RootID         string
	SessionKey     string
	Agent          string
	Model          string
	Effort         string
	PermissionMode string
	ReadOnly       bool
	Prompt         string
	StreamFilter   *ControlStreamFilter
	SkipSwitchHint bool
	MemberSlotID   string
	OnRegistered   func() error
	OnToolCall     func(agenttypes.ToolCall)
	OnText         func(string)
}

type StageTurnResult struct {
	Blocks          []ControlBlock
	VisibleText     string
	DeliverableText string
	ResolvedModel   string
}

func (r StageTurnResult) deliverable() string {
	if strings.TrimSpace(r.DeliverableText) != "" {
		return r.DeliverableText
	}
	return r.VisibleText
}

type Runner interface {
	StageTurnActive(rootID, sessionKey string) bool
	CollabChangedFiles(ctx context.Context, rootID, runID string, since time.Time) (ChangeList, error)
	GetCollabStore(rootID string) (*Store, error)
	RootPath(rootID string) (string, error)
	AgentStatuses() []agent.Status
	EnsureStageSession(ctx context.Context, req StageSessionRequest) (string, error)
	RunStageTurn(ctx context.Context, req StageTurnRequest) (StageTurnResult, error)
	CancelStageTurn(ctx context.Context, rootID, sessionKey string) error
	DeleteStageSession(ctx context.Context, rootID, sessionKey string) error
	RunUpdated(rootID string, run Run, waitingCount int)
}

type TemplateWithAvailability struct {
	Template
	Availability []MemberAvailability `json:"availability"`
	AllAvailable bool                 `json:"all_available"`
}

type StartQuickRunInput struct {
	RootID       string       `json:"root_id"`
	Title        string       `json:"title,omitempty"`
	TaskPrompt   string       `json:"task_prompt"`
	TemplateID   string       `json:"template_id,omitempty"`
	TemplateName string       `json:"template_name,omitempty"`
	Members      []MemberSlot `json:"members"`
	SkillPaths   []string     `json:"skill_paths,omitempty"`
}

type ItemDecision struct {
	ItemID   string `json:"item_id"`
	Decision string `json:"decision"`
	Note     string `json:"note,omitempty"`
}

type SubmitDecisionsInput struct {
	Round     *int           `json:"round,omitempty"`
	RootID    string         `json:"root_id"`
	RunID     string         `json:"run_id"`
	Decisions []ItemDecision `json:"decisions"`
}

type activeWorker struct {
	seq    uint64
	paused bool
	cancel context.CancelFunc
	done   chan struct{}
}

type Service struct {
	templates *TemplateStore
	runner    Runner
	homeDir   string

	mu      sync.Mutex
	nextSeq uint64
	workers map[string]*activeWorker

	meetingMu   sync.Mutex
	meetings    map[string]*meetingWorker
	meetingLive sync.Map
}

func NewService(templates *TemplateStore, runner Runner) *Service {
	return &Service{
		templates: templates,
		runner:    runner,
		workers:   make(map[string]*activeWorker),
		meetings:  make(map[string]*meetingWorker),
	}
}

func (s *Service) SetHomeDir(homeDir string) {
	s.mu.Lock()
	s.homeDir = strings.TrimSpace(homeDir)
	s.mu.Unlock()
}

func (s *Service) ListTemplatesWithAvailability(mode string) ([]TemplateWithAvailability, []SkillSummary, error) {
	if s.templates == nil {
		return nil, nil, errors.New("template store not configured")
	}
	items, err := s.templates.List(mode)
	if err != nil {
		return nil, nil, err
	}
	var statuses []agent.Status
	if s.runner != nil {
		statuses = s.runner.AgentStatuses()
	}
	out := make([]TemplateWithAvailability, 0, len(items))
	for _, tpl := range items {
		checks := ValidateMembers(tpl.Members, statuses)
		allOK := len(checks) > 0
		for _, c := range checks {
			if !c.Available {
				allOK = false
				break
			}
		}
		out = append(out, TemplateWithAvailability{
			Template:     tpl,
			Availability: checks,
			AllAvailable: allOK,
		})
	}
	s.mu.Lock()
	home := s.homeDir
	s.mu.Unlock()
	return out, DiscoverUserSkills(home), nil
}

func (s *Service) SaveTemplate(tpl Template) (TemplateWithAvailability, error) {
	if s.templates == nil {
		return TemplateWithAvailability{}, errors.New("template store not configured")
	}
	saved, err := s.templates.Save(tpl)
	if err != nil {
		return TemplateWithAvailability{}, err
	}
	var statuses []agent.Status
	if s.runner != nil {
		statuses = s.runner.AgentStatuses()
	}
	checks := ValidateMembers(saved.Members, statuses)
	allOK := len(checks) > 0
	for _, c := range checks {
		if !c.Available {
			allOK = false
			break
		}
	}
	return TemplateWithAvailability{
		Template:     saved,
		Availability: checks,
		AllAvailable: allOK,
	}, nil
}

func (s *Service) DeleteTemplate(id string) error {
	if s.templates == nil {
		return errors.New("template store not configured")
	}
	return s.templates.Delete(id)
}

func (s *Service) ListRuns(ctx context.Context, rootID, mode string, limit int) ([]Run, int, error) {
	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		return nil, 0, err
	}
	runs, err := store.ListRuns(ctx, mode, limit)
	if err != nil {
		return nil, 0, err
	}
	waiting, err := store.CountWaitingRuns(ctx)
	if err != nil {
		return nil, 0, err
	}
	return runs, waiting, nil
}

func (s *Service) GetRunDetail(ctx context.Context, rootID, runID string) (RunDetail, error) {
	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		return RunDetail{}, err
	}
	run, err := store.GetRun(ctx, runID)
	if err != nil {
		return RunDetail{}, err
	}
	items, err := store.ListReviewItems(ctx, runID)
	if err != nil {
		return RunDetail{}, err
	}
	rootPath, err := s.runner.RootPath(rootID)
	if err != nil {
		return RunDetail{}, err
	}
	docs, _ := ListRunDocs(rootPath, runID)
	var meeting *MeetingDetail
	if run.Mode == ModeGroup {
		meeting, err = store.readMeeting(ctx, runID)
		if err != nil {
			return RunDetail{}, err
		}
		if len(meeting.Rounds) > 0 {
			s.includeMeetingLive(run, &meeting.Rounds[len(meeting.Rounds)-1])
		}
	}
	return RunDetail{
		Meeting:     meeting,
		Run:         run,
		ReviewItems: items,
		Docs:        docs,
	}, nil
}

func (s *Service) ReadDoc(rootID, runID, docName string) (string, error) {
	rootPath, err := s.runner.RootPath(rootID)
	if err != nil {
		return "", err
	}
	return ReadRunDoc(rootPath, runID, docName)
}

func (s *Service) StartQuickRun(ctx context.Context, in StartQuickRunInput) (RunDetail, error) {
	detail, err := s.createQuickRun(ctx, in, newCollabID("run"), nil)
	if err == nil {
		s.launchQuickWorker(detail.Run.RootID, detail.Run.ID, false, false)
	}
	return detail, err
}

func (s *Service) createQuickRun(ctx context.Context, in StartQuickRunInput, runID string, meeting *MeetingRound) (RunDetail, error) {
	if s.runner == nil {
		return RunDetail{}, errors.New("collab runner not configured")
	}
	rootID := strings.TrimSpace(in.RootID)
	if rootID == "" {
		return RunDetail{}, errors.New("root_id required")
	}
	taskPrompt := strings.TrimSpace(in.TaskPrompt)
	if taskPrompt == "" {
		return RunDetail{}, errors.New("任务描述不能为空")
	}

	members := append([]MemberSlot(nil), in.Members...)
	skillPaths := append([]string(nil), in.SkillPaths...)
	tplID := strings.TrimSpace(in.TemplateID)
	tplName := strings.TrimSpace(in.TemplateName)
	if len(members) == 0 && tplID != "" && s.templates != nil {
		tpl, ok, err := s.templates.Get(tplID)
		if err != nil {
			return RunDetail{}, err
		}
		if !ok {
			return RunDetail{}, errors.New("所选模板不存在")
		}
		snap := SnapshotTemplate(tpl)
		members = snap.Members
		if len(skillPaths) == 0 {
			skillPaths = snap.SkillPaths
		}
		if tplName == "" {
			tplName = snap.TemplateName
		}
	}

	tempTpl, err := normalizeAndValidateTemplate(Template{
		ID:         tplID,
		Name:       firstNonEmpty(tplName, "本次快速协作"),
		Mode:       ModeQuick,
		Members:    members,
		SkillPaths: skillPaths,
	}, time.Now().UTC())
	if err != nil {
		return RunDetail{}, err
	}

	statuses := s.runner.AgentStatuses()
	if len(statuses) > 0 {
		for _, check := range ValidateMembers(tempTpl.Members, statuses) {
			if !check.Available {
				return RunDetail{}, errors.New(check.Reason)
			}
		}
	}

	primary, reviewer := extractQuickMembers(tempTpl.Members)
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = deriveRunTitle(taskPrompt)
	}
	snapshot := SnapshotTemplate(tempTpl)
	snapshot.TemplateID = tplID
	snapshot.TemplateName = tplName

	steps := []StepCard{
		{
			Key:     StepImpl,
			Title:   "主模型实现",
			Role:    RolePrimary,
			SlotID:  primary.SlotID,
			Agent:   primary.Agent,
			Model:   primary.Model,
			Effort:  primary.Effort,
			DocPath: DocRelPath(runID, (Run{Round: 1}).doc(DocImpl)),
			Status:  StepStatusPending,
		},
		{
			Key:      StepReview,
			Title:    "只读审核",
			Role:     RoleReviewer,
			SlotID:   reviewer.SlotID,
			Agent:    reviewer.Agent,
			Model:    reviewer.Model,
			Effort:   reviewer.Effort,
			ReadOnly: true,
			DocPath:  DocRelPath(runID, (Run{Round: 1}).doc(DocReview)),
			Status:   StepStatusPending,
		},
		{
			Key:     StepResponse,
			Title:   "主模型逐条回应",
			Role:    RolePrimary,
			SlotID:  primary.SlotID,
			Agent:   primary.Agent,
			Model:   primary.Model,
			Effort:  primary.Effort,
			DocPath: DocRelPath(runID, (Run{Round: 1}).doc(DocResponse)),
			Status:  StepStatusPending,
		},
		{
			Key:     StepDecisions,
			Title:   "分歧裁决",
			Role:    "author",
			DocPath: DocRelPath(runID, (Run{Round: 1}).doc(DocDecisions)),
			Status:  StepStatusPending,
		},
		{
			Key:     StepFixTest,
			Title:   "最终修改与测试",
			Role:    RolePrimary,
			SlotID:  primary.SlotID,
			Agent:   primary.Agent,
			Model:   primary.Model,
			Effort:  primary.Effort,
			DocPath: DocRelPath(runID, (Run{Round: 1}).doc(DocReport)),
			Status:  StepStatusPending,
		},
	}

	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		return RunDetail{}, err
	}
	run := Run{
		ID: runID, Round: 1,
		RootID:       rootID,
		Mode:         ModeQuick,
		Title:        title,
		TaskPrompt:   taskPrompt,
		TemplateID:   tplID,
		TemplateName: tplName,
		Snapshot:     snapshot,
		Status:       RunStatusRunning,
		CurrentStep:  StepImpl,
		Steps:        steps,
	}
	var created Run
	if meeting == nil {
		created, err = store.CreateRun(ctx, run)
	} else {
		created, err = store.createMeetingQuickRun(ctx, run, *meeting)
	}
	if err != nil {
		return RunDetail{}, err
	}
	s.notifyRunUpdated(ctx, store, rootID, created)
	return RunDetail{Run: created, ReviewItems: []ReviewItem{}, Docs: []string{}}, nil
}

func (s *Service) SubmitDecisions(ctx context.Context, in SubmitDecisionsInput) (RunDetail, error) {
	store, err := s.runner.GetCollabStore(in.RootID)
	if err != nil {
		return RunDetail{}, err
	}
	run, err := store.GetRun(ctx, in.RunID)
	if err != nil {
		return RunDetail{}, err
	}
	if (in.Round != nil && *in.Round != run.Round) || (in.Round == nil && run.Round > 1) {
		return RunDetail{}, errors.New("裁决轮次已变化，请刷新")
	}
	if run.CurrentStep != StepDecisions || run.Status != RunStatusWaitingUser {
		return RunDetail{}, errors.New("当前运行不在分歧裁决阶段")
	}
	items, err := store.ListReviewItems(ctx, run.ID)
	if err != nil {
		return RunDetail{}, err
	}
	byID := make(map[string]ItemDecision, len(in.Decisions))
	for _, d := range in.Decisions {
		byID[strings.ToUpper(strings.TrimSpace(d.ItemID))] = d
	}

	disputedCount := 0
	for i := range items {
		if items[i].PrimaryStatus != PrimaryStatusDisputed {
			continue
		}
		disputedCount++
		dec, ok := byID[strings.ToUpper(strings.TrimSpace(items[i].ItemID))]
		if !ok {
			return RunDetail{}, fmt.Errorf("请对分歧条目 %s 做出决定", items[i].ItemID)
		}
		choice := strings.TrimSpace(dec.Decision)
		note := strings.TrimSpace(dec.Note)
		switch choice {
		case DecisionAcceptReview, DecisionKeepPrimary:
		case DecisionCustom:
			if note == "" {
				return RunDetail{}, fmt.Errorf("条目 %s 选择了自定义指示，请填写说明", items[i].ItemID)
			}
		default:
			return RunDetail{}, fmt.Errorf("条目 %s 的裁决类型 %q 无效", items[i].ItemID, choice)
		}
		items[i].AuthorDecision = choice
		items[i].AuthorNote = note
		items[i].UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}

	rootPath, err := s.runner.RootPath(in.RootID)
	if err != nil {
		return RunDetail{}, err
	}
	nowStr := time.Now().UTC().Format(time.RFC3339Nano)
	if step := findStep(&run, StepDecisions); step != nil {
		if step.StartedAt == "" {
			step.StartedAt = nowStr
		}
		step.FinishedAt = nowStr
		step.Status = StepStatusDone
		step.Summary = fmt.Sprintf("已裁决 %d 条分歧", disputedCount)
	}
	run.CurrentStep = StepFixTest
	run.Status = RunStatusRunning
	run.ErrorMessage = ""
	run.UpdatedAt = time.Now().UTC()
	steps, err := json.Marshal(run.Steps)
	if err != nil {
		return RunDetail{}, err
	}
	key := workerKey(in.RootID, run.ID)
	s.mu.Lock()
	responseWorker := s.workers[key]
	s.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return RunDetail{}, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE collab_runs
SET current_step=?, status=?, step_status_json=?, error_message='', updated_at=?
WHERE id=? AND review_round=? AND current_step=? AND status=?`,
		run.CurrentStep, run.Status, string(steps), run.UpdatedAt.Format(time.RFC3339Nano),
		run.ID, run.Round, StepDecisions, RunStatusWaitingUser)
	if err != nil {
		return RunDetail{}, err
	}
	if count, err := res.RowsAffected(); err != nil {
		return RunDetail{}, err
	} else if count != 1 {
		return RunDetail{}, errors.New("裁决状态已变化，请刷新")
	}
	for _, item := range items {
		if item.PrimaryStatus != PrimaryStatusDisputed {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE collab_review_items
SET author_decision=?, author_note=?, updated_at=? WHERE run_id=? AND item_id=?`,
			item.AuthorDecision, item.AuthorNote, item.UpdatedAt, run.ID, item.ItemID); err != nil {
			return RunDetail{}, err
		}
	}
	if _, err := WriteRunDoc(rootPath, run.ID, run.doc(DocDecisions), renderDecisionsDoc(run, items)); err != nil {
		return RunDetail{}, err
	}
	if err := tx.Commit(); err != nil {
		return RunDetail{}, err
	}
	s.notifyRunUpdated(ctx, store, in.RootID, run)
	s.mu.Lock()
	// A progress check can start the final step after the commit. Only replace the response worker.
	if worker := s.workers[key]; worker == nil || worker == responseWorker {
		s.launchQuickWorkerLocked(in.RootID, run.ID, false, true)
	}
	s.mu.Unlock()
	return s.GetRunDetail(ctx, in.RootID, run.ID)
}

func (s *Service) PauseRun(ctx context.Context, rootID, runID string) (RunDetail, error) {
	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		return RunDetail{}, err
	}
	run, err := store.GetRun(ctx, runID)
	if err != nil {
		return RunDetail{}, err
	}
	if run.Mode == ModeGroup {
		return s.pauseMeeting(ctx, rootID, runID)
	}
	runKey := workerKey(rootID, runID)
	s.mu.Lock()
	w := s.workers[runKey]
	if w != nil {
		w.paused = true
		w.cancel()
	}
	s.mu.Unlock()
	if step := findStep(&run, run.CurrentStep); step != nil && step.SessionKey != "" {
		_ = s.runner.CancelStageTurn(ctx, rootID, step.SessionKey)
	}
	s.pauseCurrentStep(ctx, store, rootID, runID, "已暂停，可在右侧对话人工干预后继续")
	return s.GetRunDetail(ctx, rootID, runID)
}

func (s *Service) ContinueRun(ctx context.Context, rootID, runID string) (RunDetail, error) {
	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		return RunDetail{}, err
	}
	run, err := store.GetRun(ctx, runID)
	if err != nil {
		return RunDetail{}, err
	}
	if run.Mode == ModeGroup {
		return s.continueMeeting(ctx, rootID, runID)
	}
	action, err := s.checkQuickProgress(ctx, store, rootID, runID)
	if err != nil {
		return RunDetail{}, err
	}
	detail, err := s.GetRunDetail(ctx, rootID, runID)
	detail.ProgressAction = action
	return detail, err
}

func (s *Service) checkQuickProgress(ctx context.Context, store *Store, rootID, runID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := store.GetRun(ctx, runID)
	if err != nil {
		return "", err
	}
	if run.Mode != ModeQuick || run.CurrentStep == StepDone || run.Status == RunStatusCompleted || run.Status == RunStatusCanceled {
		return "unchanged", nil
	}
	if run.CurrentStep == StepDecisions {
		return "waiting_for_decisions", nil
	}
	worker := s.workers[workerKey(rootID, runID)]
	if run.Status == RunStatusRunning && worker != nil {
		return "running", nil
	}
	if run.Status != RunStatusRunning && run.Status != RunStatusWaitingUser && run.Status != RunStatusFailed {
		return "unchanged", nil
	}
	// Claim exactly the saved stage. A concurrent transition must not be overwritten.
	res, err := store.db.ExecContext(ctx, `UPDATE collab_runs
SET status=?, error_message='', updated_at=?
WHERE id=? AND review_round=? AND current_step=? AND status=? AND updated_at=?`,
		RunStatusRunning, time.Now().UTC().Format(time.RFC3339Nano),
		run.ID, run.Round, run.CurrentStep, run.Status, run.UpdatedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return "", err
	}
	if n, err := res.RowsAffected(); err != nil {
		return "", err
	} else if n == 0 {
		return "changed", nil
	}
	s.launchQuickWorkerLocked(rootID, run.ID, true, worker != nil)
	return "resumed", nil
}

func (s *Service) CleanupDocs(ctx context.Context, rootID, runID string, keepDocs []string) (RunDetail, []string, error) {
	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		return RunDetail{}, nil, err
	}
	run, err := store.GetRun(ctx, runID)
	if err != nil {
		return RunDetail{}, nil, err
	}
	if run.Mode == ModeGroup && run.Status != RunStatusCompleted {
		return RunDetail{}, nil, errors.New("会议确认并开始实现后才能清理过程文件")
	}
	rootPath, err := s.runner.RootPath(rootID)
	if err != nil {
		return RunDetail{}, nil, err
	}
	removed, err := CleanupRunDocs(rootPath, runID, keepDocs)
	if err != nil {
		return RunDetail{}, nil, err
	}
	remaining, _ := ListRunDocs(rootPath, runID)
	run.DocsCleaned = len(remaining) == 0
	run.UpdatedAt = time.Now().UTC()
	if err := store.UpdateRun(ctx, run); err != nil {
		return RunDetail{}, removed, err
	}
	s.notifyRunUpdated(ctx, store, rootID, run)
	detail, err := s.GetRunDetail(ctx, rootID, runID)
	return detail, removed, err
}

func (s *Service) DeleteRun(ctx context.Context, rootID, runID string) error {
	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		return err
	}
	run, err := store.GetRun(ctx, runID)
	if err != nil {
		return err
	}
	if run.Mode == ModeGroup {
		return s.deleteMeeting(ctx, rootID, runID)
	}
	runKey := workerKey(rootID, runID)
	s.mu.Lock()
	if w := s.workers[runKey]; w != nil {
		w.paused = true
		w.cancel()
		delete(s.workers, runKey)
	}
	s.mu.Unlock()
	for n := 1; n < run.Round; n++ {
		for _, key := range []string{StepReview, StepResponse, StepFixTest} {
			_ = s.runner.DeleteStageSession(ctx, rootID, roundSessionKey(run.ID, n, key))
		}
	}
	for _, step := range run.Steps {
		if strings.TrimSpace(step.SessionKey) != "" {
			_ = s.runner.DeleteStageSession(ctx, rootID, step.SessionKey)
		}
	}
	if rootPath, rootErr := s.runner.RootPath(rootID); rootErr == nil {
		_, _ = CleanupRunDocs(rootPath, runID, nil)
	}
	if err := store.DeleteRun(ctx, runID); err != nil {
		return err
	}
	waiting, _ := store.CountWaitingRuns(ctx)
	s.runner.RunUpdated(rootID, Run{ID: runID, RootID: rootID, Status: "deleted"}, waiting)
	return nil
}

func (s *Service) launchQuickWorker(rootID, runID string, continuation, queueAfterCurrent bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.launchQuickWorkerLocked(rootID, runID, continuation, queueAfterCurrent)
}

func (s *Service) launchQuickWorkerLocked(rootID, runID string, continuation, queueAfterCurrent bool) {
	key := workerKey(rootID, runID)
	// A confirmed continuation can arrive while the previous worker is still returning.
	if cur := s.workers[key]; cur != nil && !cur.paused && !queueAfterCurrent {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.nextSeq++
	mySeq := s.nextSeq
	prev := s.workers[key]
	if prev != nil {
		prev.cancel()
	}
	worker := &activeWorker{
		seq:    mySeq,
		cancel: cancel,
		done:   make(chan struct{}),
	}
	s.workers[key] = worker

	go func() {
		defer func() {
			cancel()
			s.mu.Lock()
			if s.workers[key] == worker {
				delete(s.workers, key)
			}
			close(worker.done)
			s.mu.Unlock()
		}()
		if prev != nil {
			select {
			case <-prev.done:
			case <-ctx.Done():
				return
			}
		}
		s.executeQuickRun(ctx, rootID, runID, mySeq, continuation)
	}()
}

func (s *Service) canMutateWorkerState(runKey string, seq uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	w := s.workers[runKey]
	return w != nil && w.seq == seq && !w.paused
}

func (s *Service) executeQuickRun(ctx context.Context, rootID, runID string, workerSeq uint64, initialContinuation bool) {
	runKey := workerKey(rootID, runID)
	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		log.Printf("[collab] store.error root=%s run=%s err=%v", rootID, runID, err)
		return
	}
	rootPath, err := s.runner.RootPath(rootID)
	if err != nil {
		log.Printf("[collab] root_path.error root=%s run=%s err=%v", rootID, runID, err)
		return
	}

	continuation := initialContinuation

	for {
		if !s.canMutateWorkerState(runKey, workerSeq) {
			return
		}
		if ctx.Err() != nil {
			s.pauseCurrentStep(context.Background(), store, rootID, runID, "已暂停，可在右侧对话人工干预后继续")
			return
		}
		run, err := store.GetRun(context.Background(), runID)
		if err != nil {
			return
		}
		run.workerSeq = workerSeq
		if run.Status == RunStatusWaitingUser || run.Status == RunStatusCompleted || run.Status == RunStatusCanceled || run.Status == RunStatusFailed {
			return
		}

		isCont := continuation
		continuation = false

		switch run.CurrentStep {
		case StepImpl:
			step := findStep(&run, StepImpl)
			_, err = s.beginStep(ctx, store, rootID, &run, step, false, "正在实现并整理交付说明")
			if err != nil {
				if s.canMutateWorkerState(runKey, workerSeq) {
					s.failCurrentStep(context.Background(), store, rootID, &run, step, err)
				}
				return
			}
			res, turnErr := s.handoffTurn(ctx, rootPath, run, step, taskFile, implementationInstructions(run))
			recordStepResolvedModel(&run, step, res.ResolvedModel)
			if turnErr != nil {
				if s.canMutateWorkerState(runKey, workerSeq) {
					s.handleTurnError(context.Background(), store, rootID, &run, step, turnErr)
				}
				return
			}
			if !s.canMutateWorkerState(runKey, workerSeq) {
				return
			}
			if err := saveTurnDocument(rootPath, run, DocImpl, res.deliverable()); err != nil {
				s.failCurrentStep(ctx, store, rootID, &run, step, err)
				return
			}
			summary := "已交付 " + run.doc(DocImpl)
			step.Status = StepStatusDone
			step.Summary = summary
			step.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
			run.CurrentStep = StepReview
			run.UpdatedAt = time.Now().UTC()
			if !s.commitRunProgress(context.Background(), store, rootID, &run, step) {
				return
			}

		case StepReview:
			step := findStep(&run, StepReview)
			previousROState, previousRONote := ReadOnlyCheckState(run.ReadOnlyCheckState), run.ReadOnlyCheckNote
			if previousROState == "" || previousROState == ReadOnlyClean {
				run.ReadOnlyCheckState = string(ReadOnlyUnobserved)
				run.ReadOnlyCheckNote = "审核回合尚未完成工作区对比"
			}
			_, err = s.beginStep(ctx, store, rootID, &run, step, true, "正在按任务和改动清单进行只读审核")
			if err != nil {
				if s.canMutateWorkerState(runKey, workerSeq) {
					s.failCurrentStep(context.Background(), store, rootID, &run, step, err)
				}
				return
			}
			s.mu.Lock()
			home := s.homeDir
			s.mu.Unlock()
			standards := BuildReviewerStandardsSection(LoadStandards(StandardsOptions{
				RootPath:   rootPath,
				HomeDir:    home,
				SkillPaths: run.Snapshot.SkillPaths,
			}))
			// Old runs may first resume in review before the task file exists.
			if _, err := WriteRunDoc(rootPath, run.ID, taskFile, implementationInstructions(run)); err != nil {
				s.failCurrentStep(ctx, store, rootID, &run, step, err)
				return
			}
			if note := strings.TrimSpace(step.AuthorNote); note != "" {
				if _, err := WriteRunDoc(rootPath, run.ID, run.doc(authorReviewNoteFile), "# 作者补充审核意见\n\n"+note+"\n"); err != nil {
					s.failCurrentStep(ctx, store, rootID, &run, step, err)
					return
				}
			}
			changes, err := s.changedFiles(ctx, rootID, run, step.ChangesSince)
			if err == nil {
				_, err = WriteRunDoc(rootPath, run.ID, run.doc(changeListFile), changes.Markdown())
			}
			if err != nil {
				s.failCurrentStep(ctx, store, rootID, &run, step, err)
				return
			}
			prevReviewDisk, _ := ReadRunDoc(rootPath, run.ID, run.doc(DocReview))
			beforeRO, roSnapErr := turndiff.Capture(ctx, rootPath)
			res, turnErr := s.handoffTurn(ctx, rootPath, run, step, run.doc("02-审核依据.md"), reviewInstructions(run, standards))
			recordStepResolvedModel(&run, step, res.ResolvedModel)
			if !s.canMutateWorkerState(runKey, workerSeq) {
				return
			}
			roState, _, roNote := FinishReadOnlySnapshot(context.Background(), beforeRO, roSnapErr)
			if turnErr != nil && roState == ReadOnlyClean {
				roState, roNote = ReadOnlyUnobserved, "审核回合中断，无法确认全程无文件改动"
			}
			if previousROState == ReadOnlyModified || (previousROState == ReadOnlyUnobserved && roState != ReadOnlyModified) {
				roState, roNote = previousROState, previousRONote
			}
			run.ReadOnlyCheckState = string(roState)
			run.ReadOnlyCheckNote = roNote
			if !s.canMutateWorkerState(runKey, workerSeq) {
				return
			}
			if turnErr != nil {
				s.handleTurnError(context.Background(), store, rootID, &run, step, turnErr)
				return
			}

			reviewBody := strings.TrimSpace(res.deliverable())
			if prevClean := stripReviewVerificationFooter(prevReviewDisk); isCont && prevClean != "" && reviewBody == "" {
				reviewBody = prevClean
			}

			parsed, parseErr := parseRoundReviewControl(res.Blocks, run.Round, step)
			if parseErr != nil {
				if _, err := WriteRunDoc(rootPath, run.ID, run.doc(DocReview), reviewBody); err != nil {
					s.failCurrentStep(ctx, store, rootID, &run, step, err)
					return
				}
				step.Status = StepStatusWaitingUser
				step.Summary = parseErr.Error() + "，请继续补齐审核意见"
				run.Status = RunStatusWaitingUser
				run.UpdatedAt = time.Now().UTC()
				_ = s.commitRunProgress(context.Background(), store, rootID, &run, step)
				return
			}

			verified := VerifyCitations(rootPath, parsed.Items)
			reviewDoc := renderReviewDocWithCitations(reviewBody, verified, roState, roNote)
			if len(parsed.Resolved) > 0 {
				reviewDoc += "\n已解决的原意见：" + strings.Join(parsed.Resolved, "、") + "\n"
			}
			if _, wErr := WriteRunDoc(rootPath, run.ID, run.doc(DocReview), reviewDoc); wErr != nil {
				s.failCurrentStep(context.Background(), store, rootID, &run, step, wErr)
				return
			}
			if err := store.ReplaceReviewItems(context.Background(), run.ID, verified); err != nil {
				s.failCurrentStep(context.Background(), store, rootID, &run, step, err)
				return
			}

			nowStr := time.Now().UTC().Format(time.RFC3339Nano)
			step.Status = StepStatusDone
			step.FinishedAt = nowStr
			if len(verified) == 0 {
				step.Summary = firstNonEmpty(strings.TrimSpace(parsed.Summary), "未发现问题（0 条意见）")
				if s3 := findStep(&run, StepResponse); s3 != nil {
					s3.Status = StepStatusSkipped
					s3.Summary = "审核无修改意见"
				}
				if s4 := findStep(&run, StepDecisions); s4 != nil {
					s4.Status = StepStatusSkipped
					s4.Summary = "无分歧"
				}
				run.CurrentStep = StepFixTest
			} else {
				unverifiedCount := 0
				for _, it := range verified {
					if !it.CitationVerified {
						unverifiedCount++
					}
				}
				sum := firstNonEmpty(strings.TrimSpace(parsed.Summary), fmt.Sprintf("提出 %d 条审核意见", len(verified)))
				if unverifiedCount > 0 {
					sum += fmt.Sprintf("（%d 条出处待核实）", unverifiedCount)
				}
				step.Summary = sum
				run.CurrentStep = StepResponse
			}
			run.UpdatedAt = time.Now().UTC()
			if !s.commitRunProgress(context.Background(), store, rootID, &run, step) {
				return
			}

		case StepResponse:
			step := findStep(&run, StepResponse)
			items, err := store.ListReviewItems(context.Background(), run.ID)
			if err != nil {
				s.failCurrentStep(context.Background(), store, rootID, &run, step, err)
				return
			}
			respondedCount := 0
			var unresponded []string
			for _, it := range items {
				if strings.TrimSpace(it.PrimaryStatus) == "" {
					unresponded = append(unresponded, it.ItemID)
				} else {
					respondedCount++
				}
			}
			hasPartialResponses := isCont && respondedCount > 0
			var missingIDs []string
			if hasPartialResponses {
				missingIDs = unresponded
			}
			_, err = s.beginStep(ctx, store, rootID, &run, step, false, fmt.Sprintf("逐条回应 %d 条审核意见", len(items)))
			if err != nil {
				if s.canMutateWorkerState(runKey, workerSeq) {
					s.failCurrentStep(context.Background(), store, rootID, &run, step, err)
				}
				return
			}
			prevRespDisk, _ := ReadRunDoc(rootPath, run.ID, run.doc(DocResponse))
			res, turnErr := s.handoffTurn(ctx, rootPath, run, step, run.doc("03-回应要求.md"), responseInstructions(run, missingIDs))
			recordStepResolvedModel(&run, step, res.ResolvedModel)
			if turnErr != nil {
				if s.canMutateWorkerState(runKey, workerSeq) {
					s.handleTurnError(context.Background(), store, rootID, &run, step, turnErr)
				}
				return
			}
			if !s.canMutateWorkerState(runKey, workerSeq) {
				return
			}

			reconciled, respSummary, stillMissing := ReconcilePrimaryResponses(items, res.Blocks)
			afterRespDisk, _ := ReadRunDoc(rootPath, run.ID, run.doc(DocResponse))
			mergedRespDoc := buildResponseDocContent(prevRespDisk, afterRespDisk, res.deliverable(), hasPartialResponses, reconciled, len(stillMissing) == 0)
			if _, wErr := WriteRunDoc(rootPath, run.ID, run.doc(DocResponse), mergedRespDoc); wErr != nil {
				s.failCurrentStep(context.Background(), store, rootID, &run, step, wErr)
				return
			}

			if len(stillMissing) > 0 {
				if err := store.ReplaceReviewItems(context.Background(), run.ID, reconciled); err != nil {
					s.failCurrentStep(context.Background(), store, rootID, &run, step, err)
					return
				}
				step.Status = StepStatusWaitingUser
				step.Summary = fmt.Sprintf("回应缺少条目 %s，未通过完整性校验，请点击继续补齐", strings.Join(stillMissing, ", "))
				run.Status = RunStatusWaitingUser
				run.UpdatedAt = time.Now().UTC()
				_ = s.commitRunProgress(context.Background(), store, rootID, &run, step)
				return
			}

			if err := store.ReplaceReviewItems(context.Background(), run.ID, reconciled); err != nil {
				s.failCurrentStep(context.Background(), store, rootID, &run, step, err)
				return
			}

			disputed := 0
			for _, it := range reconciled {
				if it.PrimaryStatus == PrimaryStatusDisputed {
					disputed++
				}
			}
			nowStr := time.Now().UTC().Format(time.RFC3339Nano)
			step.Status = StepStatusDone
			step.FinishedAt = nowStr
			step.Summary = respSummary

			if disputed > 0 {
				run.CurrentStep = StepDecisions
				run.Status = RunStatusWaitingUser
				if s4 := findStep(&run, StepDecisions); s4 != nil {
					s4.Status = StepStatusWaitingUser
					s4.StartedAt = nowStr
					s4.Summary = fmt.Sprintf("%d 条分歧等待作者拍板", disputed)
				}
				run.UpdatedAt = time.Now().UTC()
				_ = s.commitRunProgress(context.Background(), store, rootID, &run, step)
				return
			}

			if s4 := findStep(&run, StepDecisions); s4 != nil {
				s4.Status = StepStatusSkipped
				s4.Summary = "无分歧"
			}
			run.CurrentStep = StepFixTest
			run.UpdatedAt = time.Now().UTC()
			if !s.commitRunProgress(context.Background(), store, rootID, &run, step) {
				return
			}

		case StepFixTest:
			step := findStep(&run, StepFixTest)
			_, err = s.beginStep(ctx, store, rootID, &run, step, false, "执行裁决修改并运行项目测试/构建")
			if err != nil {
				if s.canMutateWorkerState(runKey, workerSeq) {
					s.failCurrentStep(context.Background(), store, rootID, &run, step, err)
				}
				return
			}
			res, turnErr := s.handoffTurn(ctx, rootPath, run, step, run.doc("05-交付要求.md"), reportInstructions(run))
			recordStepResolvedModel(&run, step, res.ResolvedModel)
			if turnErr != nil {
				if s.canMutateWorkerState(runKey, workerSeq) {
					s.handleTurnError(context.Background(), store, rootID, &run, step, turnErr)
				}
				return
			}
			if !s.canMutateWorkerState(runKey, workerSeq) {
				return
			}
			reportBody := res.deliverable()
			if strings.TrimSpace(reportBody) == "" {
				s.failCurrentStep(ctx, store, rootID, &run, step, errors.New("缺少最终改动结果正文"))
				return
			}
			testStatus, testCmd, testSum := parseReportControl(res.Blocks)
			changes, err := s.changedFiles(ctx, rootID, run, "")
			if err == nil {
				err = saveTurnDocument(rootPath, run, DocReport, renderReportDoc(reportBody, testCmd, changes))
			}
			if err != nil {
				s.failCurrentStep(ctx, store, rootID, &run, step, err)
				return
			}
			now := time.Now().UTC()
			nowStr := now.Format(time.RFC3339Nano)
			step.Status = StepStatusDone
			step.FinishedAt = nowStr
			step.Summary = testSum
			run.TestStatus = testStatus
			run.TestCommand = testCmd
			run.TestSummary = testSum
			run.CurrentStep = StepDone
			run.Status = RunStatusCompleted
			run.CompletedAt = nowStr
			run.UpdatedAt = now
			_ = s.commitRunProgress(context.Background(), store, rootID, &run, step)
			return

		default:
			return
		}
	}
}

func (s *Service) beginStep(ctx context.Context, store *Store, rootID string, run *Run, step *StepCard, readOnly bool, runningSummary string) (string, error) {
	if step == nil {
		return "", errors.New("step card missing")
	}
	targetKey := strings.TrimSpace(step.SessionKey)
	if targetKey == "" {
		targetKey = roundSessionKey(run.ID, run.Round, step.Key)
	}
	sessKey, err := s.runner.EnsureStageSession(ctx, StageSessionRequest{
		RootID:     rootID,
		RunID:      run.ID,
		StepKey:    step.Key,
		SessionKey: targetKey,
		Title:      step.Title + " · " + run.Title,
		Agent:      step.Agent,
		Model:      step.Model,
		ReadOnly:   readOnly,
	})
	if err != nil {
		return "", err
	}
	step.SessionKey = sessKey
	step.Status = StepStatusRunning
	step.Summary = runningSummary
	if step.StartedAt == "" {
		step.StartedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	run.Status = RunStatusRunning
	run.ErrorMessage = ""
	run.UpdatedAt = time.Now().UTC()
	if err := s.persistQuickRun(context.Background(), store, run, step.Key); err != nil {
		return "", err
	}
	s.notifyRunUpdated(context.Background(), store, rootID, *run)
	return sessKey, nil
}

var errWorkerSuperseded = errors.New("collab worker superseded")

func (s *Service) commitRunProgress(ctx context.Context, store *Store, rootID string, run *Run, step *StepCard) bool {
	stepKey := ""
	if step != nil {
		stepKey = step.Key
	}
	if err := s.persistQuickRun(ctx, store, run, stepKey); err != nil {
		if errors.Is(err, errWorkerSuperseded) {
			return false
		}
		log.Printf("[collab] update_run.error root=%s run=%s step=%s err=%v", rootID, run.ID, run.CurrentStep, err)
		s.failCurrentStep(ctx, store, rootID, run, step, fmt.Errorf("保存阶段状态失败: %w", err))
		return false
	}
	s.notifyRunUpdated(ctx, store, rootID, *run)
	return true
}

func (s *Service) handleTurnError(ctx context.Context, store *Store, rootID string, run *Run, step *StepCard, err error) {
	if isCanceledError(err) {
		if step != nil {
			step.Status = StepStatusWaitingUser
			step.Summary = "已暂停，可在右侧对话人工干预后点击继续"
		}
		run.Status = RunStatusWaitingUser
		run.UpdatedAt = time.Now().UTC()
		_ = s.commitRunProgress(ctx, store, rootID, run, step)
		return
	}
	s.failCurrentStep(ctx, store, rootID, run, step, err)
}

func (s *Service) pauseCurrentStep(ctx context.Context, store *Store, rootID, runID, summary string) {
	s.mu.Lock()
	run, err := store.GetRun(ctx, runID)
	if err != nil || run.Status == RunStatusCompleted || run.Status == RunStatusCanceled || run.Status == RunStatusWaitingUser {
		s.mu.Unlock()
		return
	}
	if step := findStep(&run, run.CurrentStep); step != nil {
		step.Status = StepStatusWaitingUser
		step.Summary = summary
	}
	run.Status = RunStatusWaitingUser
	run.UpdatedAt = time.Now().UTC()
	_ = store.UpdateRun(ctx, run)
	s.mu.Unlock()
	s.notifyRunUpdated(ctx, store, rootID, run)
}

func (s *Service) failCurrentStep(ctx context.Context, store *Store, rootID string, run *Run, step *StepCard, err error) {
	msg := "执行失败"
	if err != nil {
		msg = strings.TrimSpace(err.Error())
	}
	stepKey := ""
	if step != nil {
		stepKey = step.Key
		step.Status = StepStatusFailed
		step.Summary = msg
	}
	run.Status = RunStatusFailed
	run.ErrorMessage = msg
	run.UpdatedAt = time.Now().UTC()
	if persistErr := s.persistQuickRun(ctx, store, run, stepKey); errors.Is(persistErr, errWorkerSuperseded) {
		return
	}
	s.notifyRunUpdated(ctx, store, rootID, *run)
}

func (s *Service) persistQuickRun(ctx context.Context, store *Store, run *Run, activeStepKey string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if run.workerSeq != 0 {
		w := s.workers[workerKey(run.RootID, run.ID)]
		if w == nil || w.seq != run.workerSeq || w.paused {
			return errWorkerSuperseded
		}
	}
	if latest, err := store.GetRun(ctx, run.ID); err == nil {
		mergeLatestQuickMembers(run, latest, activeStepKey)
	}
	return store.UpdateRun(ctx, *run)
}

func (s *Service) notifyRunUpdated(ctx context.Context, store *Store, rootID string, run Run) {
	waiting, _ := store.CountWaitingRuns(ctx)
	if s.runner != nil {
		s.runner.RunUpdated(rootID, run, waiting)
	}
}

func recordStepResolvedModel(run *Run, step *StepCard, resolvedModel string) {
	resolved := strings.TrimSpace(resolvedModel)
	if resolved == "" || step == nil {
		return
	}
	if strings.TrimSpace(step.Model) == "" {
		step.Model = resolved
	}
	if run == nil {
		return
	}
	for i := range run.Snapshot.Members {
		member := &run.Snapshot.Members[i]
		sameSlot := strings.TrimSpace(step.SlotID) != "" && member.SlotID == step.SlotID
		sameRole := strings.TrimSpace(step.Role) != "" && member.Role == step.Role
		if (sameSlot || sameRole) && strings.TrimSpace(member.Model) == "" {
			member.Model = resolved
			run.resolvedMember = &resolvedMemberModel{
				SlotID: member.SlotID,
				Role:   member.Role,
				Agent:  member.Agent,
				Model:  resolved,
			}
		}
	}
}

func findStep(run *Run, key string) *StepCard {
	if run == nil {
		return nil
	}
	for i := range run.Steps {
		if run.Steps[i].Key == key {
			return &run.Steps[i]
		}
	}
	return nil
}

func extractQuickMembers(members []MemberSlot) (primary, reviewer MemberSlot) {
	for _, m := range members {
		switch m.Role {
		case RolePrimary:
			primary = m
		case RoleReviewer:
			reviewer = m
		}
	}
	return primary, reviewer
}

func workerKey(rootID, runID string) string {
	return strings.TrimSpace(rootID) + "::" + strings.TrimSpace(runID)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func isCanceledError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return true
	}
	lower := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(lower, "context canceled") ||
		strings.Contains(lower, "context cancelled") ||
		strings.Contains(lower, "turn canceled") ||
		strings.Contains(lower, "turn cancelled") ||
		strings.Contains(lower, "cancelled")
}
