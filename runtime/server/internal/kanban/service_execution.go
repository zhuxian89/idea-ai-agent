package kanban

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func (s *Service) ensureTaskWorktree(ctx context.Context, store *TaskStore, task Task) (Task, error) {
	if !task.CreateWorktree || strings.TrimSpace(task.WorktreePath) != "" {
		return task, nil
	}
	if s.Runner == nil {
		return task, errors.New("task runner not configured")
	}
	name := renderWorktreeName("", task)
	branchMode, branch := normalizeTaskWorktreeBranch(task.WorktreeBranchMode, task.WorktreeBranch)
	wt, err := s.Runner.CreateTaskWorktree(ctx, task.RootID, name, branchMode, branch)
	if err != nil {
		return task, err
	}
	now := time.Now().UTC()
	task.WorktreeRootID = wt.RootID
	task.WorktreePath = wt.Path
	task.AuxFlags.SessionError = ""
	task.UpdatedAt = now
	if err := store.UpdateTask(ctx, task); err != nil {
		return task, err
	}
	return task, nil
}

func renderWorktreeName(tpl string, task Task) string {
	name := strings.TrimSpace(tpl)
	if name == "" {
		name = "task-{task_number}"
	}
	replacements := map[string]string{
		"task_id":       task.ID,
		"task_number":   strconv.Itoa(task.TaskNumber),
		"root_id":       task.RootID,
		"template_name": task.TaskTemplateName,
	}
	for key, value := range replacements {
		name = strings.ReplaceAll(name, "{"+key+"}", value)
	}
	name = strings.TrimSpace(name)
	if name == "" || name == "task-0" {
		name = filepath.Base(task.ID)
	}
	return name
}

func normalizeTaskWorktreeBranch(mode, branch string) (string, string) {
	mode = strings.TrimSpace(mode)
	branch = strings.TrimSpace(branch)
	if mode != "existing" {
		return "new", ""
	}
	if branch == "" {
		return "new", ""
	}
	return "existing", branch
}

func (s *Service) executeTask(ctx context.Context, rootID, taskID string) error {
	store, task, tmpl, err := s.loadForMove(ctx, rootID, taskID)
	if err != nil {
		return err
	}
	for {
		if task.Status == StatusPaused || task.Status == StatusQueued || isTerminalStatus(task.Status) {
			return nil
		}
		if task.CurrentStageIndex < 0 || task.CurrentStageIndex >= len(tmpl.Stages) {
			return s.finishTask(ctx, store, task, StatusSuccess, "completed", "")
		}
		stage := tmpl.Stages[task.CurrentStageIndex].Snapshot
		run, err := store.LatestStageRun(ctx, task.ID, task.CurrentStageIndex)
		if err != nil {
			return err
		}
		if stage.Role == RoleUser {
			if run.Status == StageStatusApproved || run.Status == StageStatusSuccess {
				if task.CurrentStageIndex == len(tmpl.Stages)-1 {
					return s.finishTask(ctx, store, task, StatusSuccess, "completed", "")
				}
				detail, err := s.moveTo(ctx, store, task, tmpl, task.CurrentStageIndex+1, "auto_advanced", "", "")
				if err != nil {
					return err
				}
				task = detail.Task
				continue
			}
			return s.waitForUser(ctx, store, task, run, "user_input_required")
		}
		if stage.Role != RoleAgent {
			return s.failTask(ctx, store, task, run.ID, fmt.Errorf("unsupported stage role %q", stage.Role))
		}
		if run.Status == StageStatusSuccess {
			if stage.AutoAdvance {
				if task.CurrentStageIndex == len(tmpl.Stages)-1 {
					return s.finishTask(ctx, store, task, StatusSuccess, "completed", "")
				}
				detail, err := s.moveTo(ctx, store, task, tmpl, task.CurrentStageIndex+1, "auto_advanced", "", "")
				if err != nil {
					return err
				}
				task = detail.Task
				continue
			}
			return s.waitForUser(ctx, store, task, run, "agent_stage_done")
		}
		if run.Status == StageStatusWaitingUser {
			return nil
		}
		if err := s.runAgentStage(ctx, store, task, tmpl, stage, run); err != nil {
			if errors.Is(err, errStopTaskExecution) {
				return nil
			}
			return err
		}
		task, err = store.GetTask(ctx, task.ID)
		if err != nil {
			return err
		}
	}
}

func (s *Service) runAgentStage(ctx context.Context, store *TaskStore, task Task, tmpl TaskTemplate, stage StageTemplate, run StageRun) error {
	if s.Runner == nil {
		return errors.New("task runner not configured")
	}
	if strings.TrimSpace(stage.Agent) == "" {
		return s.failTask(ctx, store, task, run.ID, errors.New("agent stage requires agent"))
	}
	now := time.Now().UTC()
	values := s.promptValues(ctx, store, task, tmpl, stage, run)
	prompt := BuildAgentPrompt(stage.PromptTemplate, values, TaskControlPromptContext{
		RootID:            task.RootID,
		TaskNumber:        task.TaskNumber,
		CurrentStageIndex: strconv.Itoa(task.CurrentStageIndex),
		CurrentStageName:  stage.Name,
		Enabled:           stage.AgentCanControlStage,
	})
	runtimeRootPath := strings.TrimSpace(task.WorktreePath)
	sessionKey, err := s.Runner.EnsureAgentSession(ctx, AgentStageExecution{
		RootID:          task.RootID,
		RuntimeRootPath: runtimeRootPath,
		Task:            task,
		Stage:           stage,
		Run:             run,
		Prompt:          prompt,
	})
	if err != nil {
		return s.failTask(ctx, store, task, run.ID, err)
	}
	if (strings.TrimSpace(stage.SessionReusePolicy) == "" || stage.SessionReusePolicy == SessionReuseTaskMain) && strings.TrimSpace(task.MainSessionKey) == "" {
		task.MainSessionKey = sessionKey
	}
	run.Status = StageStatusRunning
	run.SessionKey = sessionKey
	run.RenderedPrompt = prompt
	run.StartedAt = now.Format(time.RFC3339Nano)
	task.Status = StatusRunning
	task.AuxFlags = TaskAuxFlags{}
	task.UpdatedAt = now
	if err := store.UpdateTaskAndStageRun(ctx, task, run, TaskEvent{
		ID:         newID("event"),
		TaskID:     task.ID,
		StageRunID: run.ID,
		Type:       "stage_started",
		Payload:    eventPayload(map[string]any{"stage_index": run.StageIndex}),
		CreatedAt:  now,
	}); err != nil {
		return err
	}
	if detail, err := store.GetDetail(ctx, task.ID); err == nil {
		s.Runner.TaskUpdated(task.RootID, detail)
	}
	if err := s.Runner.RunAgentStage(ctx, AgentStageExecution{
		RootID:          task.RootID,
		RuntimeRootPath: runtimeRootPath,
		Task:            task,
		Stage:           stage,
		Run:             run,
		Prompt:          prompt,
	}); err != nil {
		log.Printf("[kanban] agent_stage.session_error root=%s task=%s run=%s err=%v", task.RootID, task.ID, run.ID, err)
		message := strings.TrimSpace(err.Error())
		task.AuxFlags.SessionError = message
		task.UpdatedAt = time.Now().UTC()
		if updateErr := store.UpdateTask(ctx, task); updateErr != nil {
			return updateErr
		}
		_ = store.AddEvent(ctx, TaskEvent{
			ID:         newID("event"),
			TaskID:     task.ID,
			StageRunID: run.ID,
			Type:       "agent_session_error",
			Payload:    eventPayload(map[string]any{"message": message}),
			CreatedAt:  time.Now().UTC(),
		})
		if detail, detailErr := store.GetDetail(ctx, task.ID); detailErr == nil {
			s.Runner.TaskUpdated(task.RootID, detail)
		}
		return errStopTaskExecution
	}
	task, err = store.GetTask(ctx, task.ID)
	if err != nil {
		return err
	}
	run, err = store.LatestStageRun(ctx, task.ID, task.CurrentStageIndex)
	if err != nil {
		return err
	}
	if run.Status == StageStatusWaitingUser || task.Status == StatusWaitingUser || task.Status == StatusPaused || isTerminalStatus(task.Status) {
		return nil
	}
	now = time.Now().UTC()
	run.Status = StageStatusSuccess
	run.FinishedAt = now.Format(time.RFC3339Nano)
	task.UpdatedAt = now
	if err := store.UpdateTaskAndStageRun(ctx, task, run, TaskEvent{
		ID:         newID("event"),
		TaskID:     task.ID,
		StageRunID: run.ID,
		Type:       "stage_succeeded",
		Payload:    eventPayload(map[string]any{"stage_index": run.StageIndex}),
		CreatedAt:  now,
	}); err != nil {
		return err
	}
	if detail, err := store.GetDetail(ctx, task.ID); err == nil {
		s.Runner.TaskUpdated(task.RootID, detail)
	}
	return nil
}

func (s *Service) promptValues(ctx context.Context, store *TaskStore, task Task, tmpl TaskTemplate, stage StageTemplate, run StageRun) map[string]string {
	previousInput := strings.TrimSpace(run.Input)
	if previousInput == "" && run.StageIndex > 0 {
		if previous, err := store.LatestStageRun(ctx, task.ID, run.StageIndex-1); err == nil {
			previousInput = previous.Input
		}
	}
	initialInput := previousInput
	if first, err := store.LatestStageRun(ctx, task.ID, 0); err == nil {
		initialInput = first.Input
	}
	return map[string]string{
		"previous_input":     previousInput,
		"task_initial_input": initialInput,
		"task_number":        strconv.Itoa(task.TaskNumber),
	}
}

func (s *Service) waitForUser(ctx context.Context, store *TaskStore, task Task, run StageRun, reason string) error {
	if task.Status == StatusWaitingUser && run.Status == StageStatusWaitingUser {
		return nil
	}
	now := time.Now().UTC()
	task.Status = StatusWaitingUser
	task.UpdatedAt = now
	if run.Status != StageStatusApproved && run.Status != StageStatusSuccess {
		run.Status = StageStatusWaitingUser
	}
	event := TaskEvent{
		ID:         newID("event"),
		TaskID:     task.ID,
		StageRunID: run.ID,
		Type:       "waiting_user",
		Payload:    eventPayload(map[string]any{"reason": reason}),
		CreatedAt:  now,
	}
	if err := store.UpdateTaskAndStageRun(ctx, task, run, event); err != nil {
		return err
	}
	if detail, err := store.GetDetail(ctx, task.ID); err == nil && s.Runner != nil {
		s.Runner.TaskUpdated(task.RootID, detail)
	}
	return nil
}

func (s *Service) finishTask(ctx context.Context, store *TaskStore, task Task, status, eventType, reason string) error {
	now := time.Now().UTC()
	task.Status = status
	task.SchedulerAdmitted = false
	task.UpdatedAt = now
	task.CompletedAt = now.Format(time.RFC3339Nano)
	if err := store.UpdateTask(ctx, task); err != nil {
		return err
	}
	_ = store.AddEvent(ctx, TaskEvent{
		ID:        newID("event"),
		TaskID:    task.ID,
		Type:      eventType,
		Payload:   eventPayload(map[string]any{"reason": strings.TrimSpace(reason)}),
		CreatedAt: now,
	})
	if detail, err := store.GetDetail(ctx, task.ID); err == nil && s.Runner != nil {
		s.Runner.TaskUpdated(task.RootID, detail)
	}
	return nil
}

func (s *Service) failTask(ctx context.Context, store *TaskStore, task Task, runID string, err error) error {
	reason := ""
	if err != nil {
		reason = err.Error()
	}
	if updateErr := s.recordTaskError(ctx, store, task, runID, reason); updateErr != nil {
		return updateErr
	}
	return err
}

func (s *Service) recordTaskError(ctx context.Context, store *TaskStore, task Task, runID, message string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		return nil
	}
	current, err := store.GetTask(ctx, task.ID)
	if err != nil {
		return err
	}
	current.AuxFlags.SessionError = message
	current.UpdatedAt = time.Now().UTC()
	if err := store.UpdateTask(ctx, current); err != nil {
		return err
	}
	_ = store.AddEvent(ctx, TaskEvent{
		ID:         newID("event"),
		TaskID:     current.ID,
		StageRunID: strings.TrimSpace(runID),
		Type:       "task_error",
		Payload:    eventPayload(map[string]any{"message": message}),
		CreatedAt:  time.Now().UTC(),
	})
	if detail, err := store.GetDetail(ctx, current.ID); err == nil && s.Runner != nil {
		s.Runner.TaskUpdated(current.RootID, detail)
	}
	return nil
}
