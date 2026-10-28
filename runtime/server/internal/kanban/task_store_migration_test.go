package kanban

import (
	"context"
	"testing"
	"time"

	"mindfs/server/internal/fs"
)

func TestTaskStoreSnapshotMigration(t *testing.T) {
	for _, missing := range []bool{true, false} {
		name := "existing snapshot"
		if missing {
			name = "legacy missing snapshot"
		}
		t.Run(name, func(t *testing.T) {
			root := fs.NewRootInfo("root", "test", t.TempDir())
			store, err := NewTaskStore(root)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { store.Close() }()
			ctx := context.Background()
			now := time.Now().UTC()
			task := Task{ID: "old", RootID: root.ID, TaskTemplateID: "template", TaskTemplateName: "Keep me", Status: "pending", Labels: []string{"keep"}, CreatedAt: now, UpdatedAt: now}
			run := StageRun{ID: "run", TaskID: task.ID, StageName: "Stage", Role: RoleUser, Status: "pending", Input: "Keep input", CreatedAt: now, UpdatedAt: now}
			event := TaskEvent{ID: "event", TaskID: task.ID, StageRunID: run.ID, Type: "created", Payload: `{"keep":true}`, CreatedAt: now}
			created, err := store.CreateTask(ctx, task, run, event)
			if err != nil {
				t.Fatal(err)
			}
			for _, query := range []string{
				`ALTER TABLE tasks ADD COLUMN legacy_extra TEXT NOT NULL DEFAULT 'preserved'`,
				`UPDATE tasks SET template_snapshot_json = '{"existing":true}'`,
			} {
				if _, err := store.db.Exec(query); err != nil {
					t.Fatal(err)
				}
			}
			// Only this temporary fixture is altered; never open a project database.
			if missing {
				if _, err := store.db.Exec(`ALTER TABLE tasks DROP COLUMN template_snapshot_json`); err != nil {
					t.Fatal(err)
				}
			}
			for attempt := 0; attempt < 2; attempt++ {
				if err := store.Close(); err != nil {
					t.Fatal(err)
				}
				store, err = NewTaskStore(root)
				if err != nil {
					t.Fatal(err)
				}
				details, err := store.ListTaskDetails(ctx, ListTasksOptions{})
				if err != nil {
					t.Fatal(err)
				}
				if len(details) != 1 {
					t.Fatalf("details = %#v", details)
				}
				detail := details[0]
				if detail.Task.ID != task.ID || detail.Task.TaskNumber != created.TaskNumber || detail.Task.TaskTemplateName != task.TaskTemplateName || len(detail.Task.Labels) != 1 || detail.Task.Labels[0] != "keep" {
					t.Fatalf("task changed: %#v", detail.Task)
				}
				if len(detail.StageRuns) != 1 || detail.StageRuns[0].Input != run.Input || len(detail.Events) != 1 || detail.Events[0].Payload != event.Payload {
					t.Fatalf("related records changed: %#v", detail)
				}
				var snapshot, extra string
				if err := store.db.QueryRow(`SELECT template_snapshot_json, legacy_extra FROM tasks WHERE id = 'old'`).Scan(&snapshot, &extra); err != nil {
					t.Fatal(err)
				}
				want := `{"existing":true}`
				if missing {
					want = ""
				}
				if snapshot != want || extra != "preserved" {
					t.Fatalf("snapshot=%q extra=%q", snapshot, extra)
				}
			}
			if err := store.UpdateTaskStatus(ctx, task.ID, "completed", nil, true); err != nil {
				t.Fatal(err)
			}
			updated, err := store.GetTask(ctx, task.ID)
			if err != nil || updated.Status != "completed" {
				t.Fatalf("update: %#v %v", updated, err)
			}
			task.ID, run.ID, run.TaskID, event.ID, event.TaskID, event.StageRunID = "new", "new-run", "new", "new-event", "new", "new-run"
			next, err := store.CreateTask(ctx, task, run, event)
			if err != nil {
				t.Fatal(err)
			}
			if next.TaskNumber != created.TaskNumber+1 {
				t.Fatalf("next number = %d", next.TaskNumber)
			}
		})
	}
}
