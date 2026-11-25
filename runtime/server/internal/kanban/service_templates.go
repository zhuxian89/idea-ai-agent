package kanban

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"
)

func (s *Service) SaveStageTemplate(ctx context.Context, in StageTemplate) (StageTemplate, error) {
	if s == nil || s.Templates == nil {
		return StageTemplate{}, errors.New("template store not configured")
	}
	return s.Templates.SaveStageTemplate(in)
}

func (s *Service) DeleteStageTemplate(ctx context.Context, id string) error {
	if s == nil || s.Templates == nil {
		return errors.New("template store not configured")
	}
	return s.Templates.DeleteStageTemplate(id)
}

func (s *Service) ListTaskTemplates(ctx context.Context) ([]TaskTemplate, error) {
	if s == nil || s.Templates == nil {
		return nil, errors.New("template store not configured")
	}
	return s.Templates.ListTaskTemplates()
}

func (s *Service) SaveTaskTemplate(ctx context.Context, in TaskTemplate) (TaskTemplate, error) {
	if s == nil || s.Templates == nil {
		return TaskTemplate{}, errors.New("template store not configured")
	}
	if err := s.ensureTaskTemplateEditable(ctx, in); err != nil {
		return TaskTemplate{}, err
	}
	return s.Templates.SaveTaskTemplate(in)
}

func (s *Service) DeleteTaskTemplate(ctx context.Context, id string) error {
	if s == nil || s.Templates == nil {
		return errors.New("template store not configured")
	}
	count, err := s.countUnfinishedTasksByTemplate(ctx, strings.TrimSpace(id))
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("该模板存在在途任务，删除前请先完成、取消或删除相关任务")
	}
	return s.Templates.DeleteTaskTemplate(id)
}

func (s *Service) ensureTaskTemplateEditable(ctx context.Context, in TaskTemplate) error {
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return nil
	}
	existing, err := s.Templates.GetTaskTemplate(id)
	if err != nil {
		return nil
	}
	if taskTemplateOnlyConcurrencyChanged(existing, in) {
		return nil
	}
	count, err := s.countUnfinishedTasksByTemplate(ctx, id)
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("该模板存在在途任务，编辑前请先完成、取消或删除相关任务")
	}
	return nil
}

func taskTemplateOnlyConcurrencyChanged(existing, next TaskTemplate) bool {
	left := comparableTaskTemplate(existing)
	right := comparableTaskTemplate(next)
	left.MaxConcurrency = 0
	right.MaxConcurrency = 0
	return reflect.DeepEqual(left, right)
}

func comparableTaskTemplate(in TaskTemplate) TaskTemplate {
	in = normalizeTaskTemplate(in)
	in.CreatedAt = time.Time{}
	in.UpdatedAt = time.Time{}
	sort.SliceStable(in.Stages, func(i, j int) bool { return in.Stages[i].Position < in.Stages[j].Position })
	for i := range in.Stages {
		in.Stages[i].Position = i
		in.Stages[i].Snapshot = normalizeStageTemplate(in.Stages[i].Snapshot)
		in.Stages[i].Snapshot.CreatedAt = time.Time{}
		in.Stages[i].Snapshot.UpdatedAt = time.Time{}
	}
	return in
}

func (s *Service) countUnfinishedTasksByTemplate(ctx context.Context, templateID string) (int, error) {
	if s == nil || s.Roots == nil {
		return 0, nil
	}
	total := 0
	for _, root := range s.Roots.ListRoots() {
		if strings.TrimSpace(root.ID) == "" {
			continue
		}
		store, err := s.taskStore(root.ID)
		if err != nil {
			return 0, err
		}
		count, err := store.CountUnfinishedTasksByTemplate(ctx, templateID)
		if err != nil {
			return 0, err
		}
		total += count
	}
	return total, nil
}

func (s *Service) CreateTask(ctx context.Context, in CreateTaskInput) (TaskDetail, error) {
	rootID := strings.TrimSpace(in.RootID)
	if rootID == "" {
		return TaskDetail{}, errors.New("root_id required")
	}
	store, err := s.taskStore(rootID)
	if err != nil {
		return TaskDetail{}, err
	}
	tmpl, err := s.Templates.GetTaskTemplate(in.TaskTemplateID)
	if err != nil {
		return TaskDetail{}, err
	}
	if len(tmpl.Stages) == 0 || tmpl.Stages[0].Snapshot.Role != RoleUser {
		return TaskDetail{}, errors.New("task template first stage must be user")
	}
	now := time.Now().UTC()
	branchMode, branch := normalizeTaskWorktreeBranch(in.WorktreeBranchMode, in.WorktreeBranch)
	taskID := newID("task")
	first := tmpl.Stages[0].Snapshot
	status := StatusWaitingUser
	if first.AutoAdvance {
		status = StatusQueued
	}
	task := Task{
		ID:                 taskID,
		RootID:             rootID,
		TaskTemplateID:     tmpl.ID,
		TaskTemplateName:   tmpl.Name,
		CreateWorktree:     in.CreateWorktree,
		WorktreeBranchMode: branchMode,
		WorktreeBranch:     branch,
		CurrentStageIndex:  0,
		Status:             status,
		Labels:             []string{},
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	run := StageRun{
		ID:         newID("run"),
		TaskID:     taskID,
		StageIndex: 0,
		StageName:  first.Name,
		Role:       RoleUser,
		Status:     StageStatusWaitingUser,
		Input:      strings.TrimSpace(in.Input),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if first.AutoAdvance {
		run.Status = StageStatusApproved
		run.FinishedAt = now.Format(time.RFC3339Nano)
	}
	event := TaskEvent{
		ID:         newID("event"),
		TaskID:     taskID,
		StageRunID: run.ID,
		Type:       "task_created",
		Payload:    eventPayload(map[string]any{"input": run.Input, "auto_advance": first.AutoAdvance}),
		CreatedAt:  now,
	}
	if _, err := store.CreateTask(ctx, task, run, event); err != nil {
		return TaskDetail{}, err
	}
	detail, err := store.GetDetail(ctx, taskID)
	if err == nil && first.AutoAdvance {
		s.Schedule(rootID)
	}
	return detail, err
}
