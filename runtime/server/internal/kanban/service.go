package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mindfs/server/internal/fs"
	"strconv"
	"strings"
	"sync"
	"time"
)

type RootProvider interface {
	GetRoot(rootID string) (fs.RootInfo, error)
	ListRoots() []fs.RootInfo
}

type Service struct {
	Templates *TemplateStore
	Roots     RootProvider
	Runner    Runner

	mu           sync.Mutex
	stores       map[string]*TaskStore
	scheduleRun  map[string]bool
	schedulePend map[string]bool
}

var errStopTaskExecution = errors.New("stop task execution")

func NewService(templates *TemplateStore, roots RootProvider) *Service {
	return &Service{Templates: templates, Roots: roots, stores: map[string]*TaskStore{}, scheduleRun: map[string]bool{}, schedulePend: map[string]bool{}}
}

func (s *Service) SetRunner(runner Runner) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.Runner = runner
	s.mu.Unlock()
}

type CreateTaskInput struct {
	RootID             string
	TaskTemplateID     string
	Input              string
	CreateWorktree     bool
	WorktreeBranchMode string
	WorktreeBranch     string
}

type MoveInput struct {
	RootID     string
	TaskID     string
	Reason     string
	StageIndex int
}

type UpdateTaskInput struct {
	RootID             string
	TaskID             string
	Input              string
	CreateWorktree     *bool
	WorktreeBranchMode string
	WorktreeBranch     string
}

func (s *Service) ListStageTemplates(ctx context.Context) ([]StageTemplate, error) {
	if s == nil || s.Templates == nil {
		return nil, errors.New("template store not configured")
	}
	return s.Templates.ListStageTemplates()
}

func (s *Service) ListTasks(ctx context.Context, rootID string, opts ListTasksOptions) ([]Task, error) {
	store, err := s.taskStore(rootID)
	if err != nil {
		return nil, err
	}
	return store.ListTasks(ctx, opts)
}

func (s *Service) ListTaskDetails(ctx context.Context, rootID string, opts ListTasksOptions) ([]TaskDetail, error) {
	store, err := s.taskStore(rootID)
	if err != nil {
		return nil, err
	}
	return store.ListTaskDetails(ctx, opts)
}

func (s *Service) GetTask(ctx context.Context, rootID, taskID string) (TaskDetail, error) {
	store, err := s.taskStore(rootID)
	if err != nil {
		return TaskDetail{}, err
	}
	return store.GetDetail(ctx, taskID)
}

func (s *Service) UpdateCurrentInput(ctx context.Context, in UpdateTaskInput) (TaskDetail, error) {
	store, err := s.taskStore(in.RootID)
	if err != nil {
		return TaskDetail{}, err
	}
	task, err := store.GetTask(ctx, in.TaskID)
	if err != nil {
		return TaskDetail{}, err
	}
	run, err := store.LatestStageRun(ctx, task.ID, task.CurrentStageIndex)
	if err != nil {
		return TaskDetail{}, err
	}
	input := strings.TrimSpace(in.Input)
	payload := map[string]any{"input": input}
	if in.CreateWorktree != nil {
		if task.CurrentStageIndex != 0 {
			return TaskDetail{}, errors.New("create_worktree can only be changed in first stage")
		}
		if strings.TrimSpace(task.WorktreePath) != "" {
			return TaskDetail{}, errors.New("create_worktree cannot be changed after worktree is created")
		}
		now := time.Now().UTC()
		task.CreateWorktree = *in.CreateWorktree
		task.WorktreeBranchMode, task.WorktreeBranch = normalizeTaskWorktreeBranch(in.WorktreeBranchMode, in.WorktreeBranch)
		task.AuxFlags.SessionError = ""
		task.UpdatedAt = now
		run.Input = input
		event := TaskEvent{
			ID:         newID("event"),
			TaskID:     task.ID,
			StageRunID: run.ID,
			Type:       "stage_input_updated",
			Payload: eventPayload(map[string]any{
				"input":                input,
				"create_worktree":      *in.CreateWorktree,
				"worktree_branch_mode": task.WorktreeBranchMode,
				"worktree_branch":      task.WorktreeBranch,
			}),
			CreatedAt: now,
		}
		if err := store.UpdateTaskAndStageRun(ctx, task, run, event); err != nil {
			return TaskDetail{}, err
		}
		detail, err := store.GetDetail(ctx, task.ID)
		if err == nil && s.Runner != nil {
			s.Runner.TaskUpdated(task.RootID, detail)
		}
		return detail, err
	}
	if err := store.UpdateStageRunInput(ctx, run.ID, input); err != nil {
		return TaskDetail{}, err
	}
	if strings.TrimSpace(task.AuxFlags.SessionError) != "" {
		empty := ""
		_ = store.UpdateTaskAuxFlags(ctx, task.ID, TaskAuxFlagsPatch{SessionError: &empty})
	}
	_ = store.AddEvent(ctx, TaskEvent{
		ID:         newID("event"),
		TaskID:     task.ID,
		StageRunID: run.ID,
		Type:       "stage_input_updated",
		Payload:    eventPayload(payload),
		CreatedAt:  time.Now().UTC(),
	})
	detail, err := store.GetDetail(ctx, task.ID)
	if err == nil && s.Runner != nil {
		s.Runner.TaskUpdated(task.RootID, detail)
	}
	return detail, err
}

func (s *Service) UpdateFirstInput(ctx context.Context, in UpdateTaskInput) (TaskDetail, error) {
	return s.UpdateCurrentInput(ctx, in)
}

func (s *Service) Next(ctx context.Context, in MoveInput) (TaskDetail, error) {
	detail, err := s.moveRelative(ctx, in, 1, "user_approved", StageStatusApproved)
	if err == nil {
		s.Schedule(in.RootID)
		s.RunTask(detail.Task.RootID, detail.Task.ID)
	}
	return detail, err
}

func (s *Service) RunNow(ctx context.Context, in MoveInput) (TaskDetail, error) {
	store, err := s.taskStore(in.RootID)
	if err != nil {
		return TaskDetail{}, err
	}
	task, err := store.GetTask(ctx, in.TaskID)
	if err != nil {
		return TaskDetail{}, err
	}
	if isTerminalStatus(task.Status) {
		return store.GetDetail(ctx, task.ID)
	}
	if task.Status != StatusQueued {
		return TaskDetail{}, errors.New("task is not queued")
	}
	if task.SchedulerAdmitted {
		detail, err := store.GetDetail(ctx, task.ID)
		if err == nil {
			s.RunTask(detail.Task.RootID, detail.Task.ID)
		}
		return detail, err
	}
	tmpl, err := s.Templates.GetTaskTemplate(task.TaskTemplateID)
	if err != nil {
		_ = s.recordTaskError(ctx, store, task, "", err.Error())
		return TaskDetail{}, err
	}
	if err := s.admitTask(ctx, store, task, tmpl); err != nil {
		return TaskDetail{}, err
	}
	_ = store.AddEvent(ctx, TaskEvent{
		ID:        newID("event"),
		TaskID:    task.ID,
		Type:      "run_now",
		Payload:   eventPayload(map[string]any{"reason": strings.TrimSpace(in.Reason)}),
		CreatedAt: time.Now().UTC(),
	})
	detail, err := store.GetDetail(ctx, task.ID)
	if err == nil {
		s.RunTask(detail.Task.RootID, detail.Task.ID)
	}
	return detail, err
}

func (s *Service) Prev(ctx context.Context, in MoveInput) (TaskDetail, error) {
	detail, err := s.moveRelative(ctx, in, -1, "user_rejected", StageStatusRejected)
	if err == nil {
		s.RunTask(detail.Task.RootID, detail.Task.ID)
	}
	return detail, err
}

func (s *Service) Jump(ctx context.Context, in MoveInput) (TaskDetail, error) {
	store, task, tmpl, err := s.loadForMove(ctx, in.RootID, in.TaskID)
	if err != nil {
		return TaskDetail{}, err
	}
	if in.StageIndex < 0 || in.StageIndex >= len(tmpl.Stages) {
		return TaskDetail{}, errors.New("stage_index out of range")
	}
	detail, err := s.moveTo(ctx, store, task, tmpl, in.StageIndex, "moved", "", in.Reason)
	if err == nil {
		s.RunTask(detail.Task.RootID, detail.Task.ID)
	}
	return detail, err
}

func (s *Service) Pause(ctx context.Context, in MoveInput) (TaskDetail, error) {
	return s.setTaskStatus(ctx, in.RootID, in.TaskID, StatusPaused, "paused", in.Reason, false)
}

func (s *Service) Resume(ctx context.Context, in MoveInput) (TaskDetail, error) {
	store, err := s.taskStore(in.RootID)
	if err != nil {
		return TaskDetail{}, err
	}
	task, err := store.GetTask(ctx, in.TaskID)
	if err != nil {
		return TaskDetail{}, err
	}
	status := StatusRunning
	if !task.SchedulerAdmitted {
		status = StatusQueued
	}
	detail, err := s.setTaskStatus(ctx, in.RootID, in.TaskID, status, "resumed", in.Reason, false)
	if err == nil {
		s.Schedule(in.RootID)
		s.RunTask(detail.Task.RootID, detail.Task.ID)
	}
	return detail, err
}

func (s *Service) Fail(ctx context.Context, in MoveInput) (TaskDetail, error) {
	return s.setTaskStatus(ctx, in.RootID, in.TaskID, StatusFail, "stage_failed", in.Reason, true)
}

func (s *Service) Cancel(ctx context.Context, in MoveInput) (TaskDetail, error) {
	return s.setTaskStatus(ctx, in.RootID, in.TaskID, StatusCancelled, "cancelled", in.Reason, true)
}

func (s *Service) Complete(ctx context.Context, in MoveInput) (TaskDetail, error) {
	store, task, tmpl, err := s.loadForMove(ctx, in.RootID, in.TaskID)
	if err != nil {
		return TaskDetail{}, err
	}
	if isTerminalStatus(task.Status) {
		return store.GetDetail(ctx, task.ID)
	}
	if task.CurrentStageIndex < 0 || task.CurrentStageIndex >= len(tmpl.Stages) {
		return TaskDetail{}, errors.New("current stage out of range")
	}
	if task.CurrentStageIndex != len(tmpl.Stages)-1 {
		return TaskDetail{}, errors.New("task is not in final stage")
	}
	if task.Status != StatusWaitingUser {
		return TaskDetail{}, errors.New("task is not waiting for user")
	}
	if latest, err := store.LatestStageRun(ctx, task.ID, task.CurrentStageIndex); err == nil {
		if latest.Status != StageStatusSuccess {
			_ = store.UpdateStageRunStatus(ctx, latest.ID, StageStatusApproved)
		}
	}
	if err := s.finishTask(ctx, store, task, StatusSuccess, "completed", in.Reason); err != nil {
		return TaskDetail{}, err
	}
	detail, err := store.GetDetail(ctx, task.ID)
	if err == nil {
		s.Schedule(task.RootID)
	}
	return detail, err
}

func (s *Service) Status(ctx context.Context, rootID, taskID string) (TaskDetail, error) {
	return s.GetTask(ctx, rootID, taskID)
}

func (s *Service) Schedule(rootID string) {
	if s == nil || s.Runner == nil {
		return
	}
	rootID = strings.TrimSpace(rootID)
	if rootID == "" {
		return
	}
	s.mu.Lock()
	if s.scheduleRun == nil {
		s.scheduleRun = map[string]bool{}
	}
	if s.scheduleRun[rootID] {
		if s.schedulePend == nil {
			s.schedulePend = map[string]bool{}
		}
		s.schedulePend[rootID] = true
		s.mu.Unlock()
		return
	}
	s.scheduleRun[rootID] = true
	s.mu.Unlock()
	go func() {
		for {
			if err := s.schedule(context.Background(), rootID); err != nil {
				log.Printf("[kanban] schedule.error root=%s err=%v", rootID, err)
			}
			s.mu.Lock()
			pending := s.schedulePend[rootID]
			if pending {
				delete(s.schedulePend, rootID)
				s.mu.Unlock()
				continue
			}
			delete(s.scheduleRun, rootID)
			s.mu.Unlock()
			return
		}
	}()
}

func (s *Service) RunTask(rootID, taskID string) {
	if s == nil || s.Runner == nil {
		return
	}
	rootID = strings.TrimSpace(rootID)
	taskID = strings.TrimSpace(taskID)
	if rootID == "" || taskID == "" {
		return
	}
	go func() {
		if err := s.executeTask(context.Background(), rootID, taskID); err != nil {
			log.Printf("[kanban] task.execute.error root=%s task=%s err=%v", rootID, taskID, err)
		}
		s.Schedule(rootID)
	}()
}

func (s *Service) UpdateTaskAuxFlags(ctx context.Context, rootID, taskID string, patch TaskAuxFlagsPatch, eventType string) (TaskDetail, error) {
	store, err := s.taskStore(rootID)
	if err != nil {
		return TaskDetail{}, err
	}
	task, err := store.GetTask(ctx, taskID)
	if err != nil {
		return TaskDetail{}, err
	}
	if isTerminalStatus(task.Status) && patch.AskUserWaiting != nil && *patch.AskUserWaiting {
		return store.GetDetail(ctx, task.ID)
	}
	if err := store.UpdateTaskAuxFlags(ctx, task.ID, patch); err != nil {
		return TaskDetail{}, err
	}
	if strings.TrimSpace(eventType) != "" {
		stageRunID := ""
		if run, err := store.LatestStageRun(ctx, task.ID, task.CurrentStageIndex); err == nil {
			stageRunID = run.ID
		}
		_ = store.AddEvent(ctx, TaskEvent{
			ID:         newID("event"),
			TaskID:     task.ID,
			StageRunID: stageRunID,
			Type:       strings.TrimSpace(eventType),
			Payload:    eventPayload(map[string]any{"aux_flags": patchPayload(patch)}),
			CreatedAt:  time.Now().UTC(),
		})
	}
	detail, err := store.GetDetail(ctx, task.ID)
	if err == nil && s.Runner != nil {
		s.Runner.TaskUpdated(rootID, detail)
	}
	return detail, err
}

func patchPayload(patch TaskAuxFlagsPatch) map[string]any {
	out := map[string]any{}
	if patch.AskUserWaiting != nil {
		out["ask_user_waiting"] = *patch.AskUserWaiting
	}
	if patch.HasPlan != nil {
		out["has_plan"] = *patch.HasPlan
	}
	if patch.HasTodos != nil {
		out["has_todos"] = *patch.HasTodos
	}
	if patch.HasTask != nil {
		out["has_task"] = *patch.HasTask
	}
	if patch.SessionError != nil {
		out["session_error"] = strings.TrimSpace(*patch.SessionError)
	}
	return out
}

func (s *Service) schedule(ctx context.Context, rootID string) error {
	store, err := s.taskStore(rootID)
	if err != nil {
		return err
	}
	for {
		all, err := store.ListTasks(ctx, ListTasksOptions{})
		if err != nil {
			return err
		}
		queued, err := store.ListQueuedTasks(ctx)
		if err != nil {
			return err
		}
		started := false
		for _, task := range queued {
			if task.SchedulerAdmitted || isTerminalStatus(task.Status) || task.Status != StatusQueued || strings.TrimSpace(task.AuxFlags.SessionError) != "" {
				continue
			}
			tmpl, err := s.Templates.GetTaskTemplate(task.TaskTemplateID)
			if err != nil {
				_ = s.recordTaskError(ctx, store, task, "", err.Error())
				continue
			}
			if !s.hasSlot(task, tmpl, all) {
				continue
			}
			if err := s.admitTask(ctx, store, task, tmpl); err != nil {
				log.Printf("[kanban] task.admit.error root=%s task=%s err=%v", rootID, task.ID, err)
				continue
			}
			started = true
			s.RunTask(rootID, task.ID)
			break
		}
		if !started {
			return nil
		}
	}
}

func (s *Service) hasSlot(candidate Task, tmpl TaskTemplate, tasks []Task) bool {
	limit := tmpl.MaxConcurrency
	if limit <= 0 {
		limit = 1
	}
	if !candidate.CreateWorktree {
		limit = 1
	}
	used := 0
	for _, task := range tasks {
		if task.ID == candidate.ID || !task.SchedulerAdmitted || isTerminalStatus(task.Status) {
			continue
		}
		if !candidate.CreateWorktree {
			if !task.CreateWorktree {
				used++
			}
			continue
		}
		if task.CreateWorktree && task.TaskTemplateID == candidate.TaskTemplateID {
			used++
		}
	}
	return used < limit
}

func (s *Service) admitTask(ctx context.Context, store *TaskStore, task Task, tmpl TaskTemplate) error {
	now := time.Now().UTC()
	task.SchedulerAdmitted = true
	task.Status = StatusRunning
	task.UpdatedAt = now
	if task.CreateWorktree && strings.TrimSpace(task.WorktreePath) == "" {
		updated, err := s.ensureTaskWorktree(ctx, store, task)
		if err != nil {
			return s.failTask(ctx, store, task, "", err)
		}
		task = updated
		task.SchedulerAdmitted = true
		task.Status = StatusRunning
		task.UpdatedAt = now
	}
	if err := store.UpdateTask(ctx, task); err != nil {
		return err
	}
	detail, err := store.GetDetail(ctx, task.ID)
	if err == nil && s.Runner != nil {
		s.Runner.TaskUpdated(task.RootID, detail)
	}
	return err
}

func (s *Service) moveRelative(ctx context.Context, in MoveInput, delta int, eventType, previousRunStatus string) (TaskDetail, error) {
	store, task, tmpl, err := s.loadForMove(ctx, in.RootID, in.TaskID)
	if err != nil {
		return TaskDetail{}, err
	}
	target := task.CurrentStageIndex + delta
	if target < 0 || target >= len(tmpl.Stages) {
		return TaskDetail{}, errors.New("target stage out of range")
	}
	if task.CurrentStageIndex < 0 || task.CurrentStageIndex >= len(tmpl.Stages) {
		return TaskDetail{}, errors.New("current stage out of range")
	}
	latest, latestErr := store.LatestStageRun(ctx, task.ID, task.CurrentStageIndex)
	if latestErr != nil {
		return TaskDetail{}, latestErr
	}
	if delta > 0 && latest.Status == StageStatusRunning {
		return TaskDetail{}, errors.New("current stage is running")
	}
	if delta > 0 && stageRequiresCurrentInput(tmpl.Stages[target].Snapshot, task.CurrentStageIndex) && strings.TrimSpace(latest.Input) == "" {
		return TaskDetail{}, errors.New("current stage input required")
	}
	if delta > 0 && task.CreateWorktree && strings.TrimSpace(task.WorktreePath) == "" {
		updated, err := s.ensureTaskWorktree(ctx, store, task)
		if err != nil {
			if recordErr := s.recordTaskError(ctx, store, task, latest.ID, err.Error()); recordErr != nil {
				return TaskDetail{}, recordErr
			}
			return TaskDetail{}, err
		}
		task = updated
	}
	if previousRunStatus != "" {
		_ = store.UpdateStageRunStatus(ctx, latest.ID, previousRunStatus)
	}
	return s.moveTo(ctx, store, task, tmpl, target, eventType, previousRunStatus, in.Reason)
}

func stageRequiresCurrentInput(stage StageTemplate, currentStageIndex int) bool {
	prompt := stage.PromptTemplate
	return strings.Contains(prompt, "{previous_input}") ||
		(currentStageIndex == 0 && strings.Contains(prompt, "{task_initial_input}"))
}

func (s *Service) moveTo(ctx context.Context, store *TaskStore, task Task, tmpl TaskTemplate, target int, eventType, previousRunStatus, reason string) (TaskDetail, error) {
	now := time.Now().UTC()
	stage := tmpl.Stages[target].Snapshot
	status := StatusWaitingUser
	if stage.Role == RoleAgent || stage.AutoAdvance {
		if task.SchedulerAdmitted {
			status = StatusRunning
		} else {
			status = StatusQueued
		}
	}
	task.CurrentStageIndex = target
	task.Status = status
	task.AuxFlags.SessionError = ""
	task.UpdatedAt = now
	run := StageRun{
		ID:         newID("run"),
		TaskID:     task.ID,
		StageIndex: target,
		StageName:  stage.Name,
		Role:       stage.Role,
		Status:     StageStatusPending,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if stage.Role == RoleUser && !stage.AutoAdvance {
		run.Status = StageStatusWaitingUser
	}
	event := TaskEvent{
		ID:         newID("event"),
		TaskID:     task.ID,
		StageRunID: run.ID,
		Type:       eventType,
		Payload:    eventPayload(map[string]any{"reason": strings.TrimSpace(reason), "stage_index": target}),
		CreatedAt:  now,
	}
	if err := store.MoveTask(ctx, task, run, event); err != nil {
		return TaskDetail{}, err
	}
	return store.GetDetail(ctx, task.ID)
}

func (s *Service) setTaskStatus(ctx context.Context, rootID, taskID, status, eventType, reason string, terminal bool) (TaskDetail, error) {
	store, err := s.taskStore(rootID)
	if err != nil {
		return TaskDetail{}, err
	}
	admitted := (*bool)(nil)
	if terminal {
		no := false
		admitted = &no
	}
	if err := store.UpdateTaskStatus(ctx, taskID, status, admitted, terminal); err != nil {
		return TaskDetail{}, err
	}
	_ = store.AddEvent(ctx, TaskEvent{
		ID:        newID("event"),
		TaskID:    strings.TrimSpace(taskID),
		Type:      eventType,
		Payload:   eventPayload(map[string]any{"reason": strings.TrimSpace(reason)}),
		CreatedAt: time.Now().UTC(),
	})
	detail, err := store.GetDetail(ctx, taskID)
	if err == nil && terminal {
		s.Schedule(rootID)
	}
	return detail, err
}

func (s *Service) loadForMove(ctx context.Context, rootID, taskID string) (*TaskStore, Task, TaskTemplate, error) {
	store, err := s.taskStore(rootID)
	if err != nil {
		return nil, Task{}, TaskTemplate{}, err
	}
	task, err := store.GetTask(ctx, taskID)
	if err != nil {
		return nil, Task{}, TaskTemplate{}, err
	}
	tmpl, err := s.Templates.GetTaskTemplate(task.TaskTemplateID)
	if err != nil {
		return nil, Task{}, TaskTemplate{}, err
	}
	return store, task, tmpl, nil
}

func (s *Service) taskStore(rootID string) (*TaskStore, error) {
	rootID = strings.TrimSpace(rootID)
	if rootID == "" {
		return nil, errors.New("root_id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stores == nil {
		s.stores = map[string]*TaskStore{}
	}
	if store := s.stores[rootID]; store != nil {
		return store, nil
	}
	if s.Roots == nil {
		return nil, errors.New("root provider not configured")
	}
	root, err := s.Roots.GetRoot(rootID)
	if err != nil {
		return nil, err
	}
	store, err := NewTaskStore(root)
	if err != nil {
		return nil, err
	}
	s.stores[rootID] = store
	return store, nil
}

func eventPayload(value map[string]any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func eventReason(payload string) string {
	var value struct {
		Reason string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(payload)), &value); err != nil {
		return ""
	}
	return strings.TrimSpace(value.Reason)
}

type TaskControlPromptContext struct {
	RootID            string
	TaskNumber        int
	CurrentStageIndex string
	CurrentStageName  string
	Enabled           bool
}

func BuildAgentPrompt(template string, values map[string]string, control TaskControlPromptContext) string {
	out := template
	for key, value := range values {
		out = strings.ReplaceAll(out, "{"+key+"}", value)
	}
	if control.Enabled {
		taskNumber := strconv.Itoa(control.TaskNumber)
		out += fmt.Sprintf("\n\nTask control context:\n- root_id: %s\n- task_number: %s\n- current_stage_index: %s\n- current_stage_name: %s\n\nBefore changing the task stage, inspect the current task state.\n\nmindfs %s -task %s\nmindfs %s -task %s -next\nmindfs %s -task %s -prev",
			control.RootID, taskNumber, control.CurrentStageIndex, control.CurrentStageName,
			control.RootID, taskNumber, control.RootID, taskNumber, control.RootID, taskNumber)
	}
	return out
}
