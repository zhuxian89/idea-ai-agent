package api

import (
	"context"
	"path/filepath"
	"testing"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/kanban"
	"mindfs/server/internal/session"
)

func TestApprovalTerminalEventsUpdateTaskWaitingWithoutHidingOtherQuestions(t *testing.T) {
	ctx := context.Background()
	registry := fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json"))
	root, err := registry.Upsert(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &AppContext{Dirs: registry}
	templates := kanban.NewTemplateStoreAt(t.TempDir())
	tmpl, err := templates.SaveTaskTemplate(kanban.TaskTemplate{
		ID: "approval-test", Name: "Approval test", MaxConcurrency: 1,
		Stages: []kanban.TaskTemplateStage{{ID: "first", Snapshot: kanban.StageTemplate{ID: "user", Name: "Input", Role: kanban.RoleUser}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	app.Kanban = kanban.NewService(templates, app)
	task, err := app.Kanban.CreateTask(ctx, kanban.CreateTaskInput{RootID: root.ID, TaskTemplateID: tmpl.ID, Input: "test"})
	if err != nil {
		t.Fatal(err)
	}
	manager, err := app.GetSessionManager(root.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Shutdown() })
	sess, err := manager.Create(ctx, session.CreateInput{Type: session.TypeChat, TaskID: task.Task.ID, Agent: "claude"})
	if err != nil {
		t.Fatal(err)
	}

	emit := func(t *testing.T, id, status string, eventType agenttypes.EventType) {
		t.Helper()
		call := agenttypes.ToolCall{CallID: id, Kind: agenttypes.ToolKindAskUser, Status: status}
		if err := manager.UpsertPendingExchangeAux(ctx, sess.Key, session.ExchangeAux{ToolCall: &call}); err != nil {
			t.Fatal(err)
		}
		app.updateTaskAuxFlagsFromEvent(root.ID, sess.Key, &StreamEvent{Type: string(eventType), Data: call})
	}
	assertWaiting := func(t *testing.T, want bool) {
		t.Helper()
		detail, err := app.Kanban.GetTask(ctx, root.ID, task.Task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Task.AuxFlags.AskUserWaiting != want {
			t.Fatalf("ask_user_waiting = %v, want %v", detail.Task.AuxFlags.AskUserWaiting, want)
		}
	}
	for _, terminal := range []string{"complete", "failed", "canceled", "cancelled"} {
		t.Run(terminal, func(t *testing.T) {
			emit(t, "approval-one", "running", agenttypes.EventTypeToolCall)
			emit(t, "approval-two", "running", agenttypes.EventTypeToolCall)
			assertWaiting(t, true)
			emit(t, "approval-one", terminal, agenttypes.EventTypeToolUpdate)
			assertWaiting(t, true)
			emit(t, "approval-two", terminal, agenttypes.EventTypeToolUpdate)
			assertWaiting(t, false)
		})
	}
}
