package collab

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"mindfs/server/internal/fs"
	"mindfs/server/internal/session"

	_ "modernc.org/sqlite"
)

func TestCollabStoreLegacySessionDBAndColumnMigration(t *testing.T) {
	t.Setenv("IDE_AGENT_DATA_DIR", t.TempDir())

	t.Run("upgrade legacy session-list.db without collab tables", func(t *testing.T) {
		rootDir := t.TempDir()
		root := fs.NewRootInfo("root-legacy", "legacy", rootDir)
		metaDir, err := root.EnsureMetaDir()
		if err != nil {
			t.Fatal(err)
		}
		dbPath := filepath.Join(metaDir, "sessions", "session-list.db")
		if err := filepathDirEnsure(dbPath); err != nil {
			t.Fatal(err)
		}

		// Simulate an older published session-list.db with existing sessions and bindings only.
		rawDB, err := sql.Open("sqlite", dbPath)
		if err != nil {
			t.Fatal(err)
		}
		_, err = rawDB.Exec(`
CREATE TABLE sessions (
	key TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	name TEXT NOT NULL,
	related_files_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	closed_at TEXT
);
CREATE TABLE session_agent_bindings (
	session_key TEXT NOT NULL,
	agent TEXT NOT NULL,
	agent_session_id TEXT NOT NULL,
	agent_ctx_seq INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (session_key, agent)
);
INSERT INTO sessions (key, type, name, related_files_json, created_at, updated_at)
VALUES ('legacy-chat-1', 'chat', '旧版会话保留', '[]', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
INSERT INTO session_agent_bindings (session_key, agent, agent_session_id, agent_ctx_seq)
VALUES ('legacy-chat-1', 'claude', 'claude-native-123', 4);
`)
		if err != nil {
			rawDB.Close()
			t.Fatal(err)
		}
		if err := rawDB.Close(); err != nil {
			t.Fatal(err)
		}

		mgr := session.NewManager(root)
		defer func() { _ = mgr.Shutdown() }()

		metaDB, err := mgr.MetaDB()
		if err != nil {
			t.Fatal(err)
		}
		store, err := NewStore(metaDB)
		if err != nil {
			t.Fatal(err)
		}
		// Repeated Migrate must be idempotent.
		if err := store.Migrate(); err != nil {
			t.Fatal(err)
		}

		ctx := context.Background()
		existingChat, err := mgr.Get(ctx, "legacy-chat-1", 0)
		if err != nil || existingChat.Name != "旧版会话保留" {
			t.Fatalf("legacy session lost or altered: %#v, err=%v", existingChat, err)
		}
		binding, err := mgr.FindAgentBinding(ctx, "legacy-chat-1", "claude")
		if err != nil || binding == nil || binding.AgentSessionID != "claude-native-123" || binding.AgentCtxSeq != 4 {
			t.Fatalf("legacy agent binding lost or altered: %#v, err=%v", binding, err)
		}

		created, err := store.CreateRun(ctx, Run{
			ID:         "run-legacy-1",
			RootID:     root.ID,
			Mode:       ModeQuick,
			Title:      "测试升级后新建协作运行",
			TaskPrompt: "修复并发锁",
			Status:     RunStatusWaitingUser,
		})
		if err != nil {
			t.Fatal(err)
		}
		if waiting, err := store.CountWaitingRuns(ctx); err != nil || waiting != 1 {
			t.Fatalf("CountWaitingRuns = %d, err = %v", waiting, err)
		}
		if got, err := store.GetRun(ctx, created.ID); err != nil || got.Title != created.Title {
			t.Fatalf("GetRun = %#v, err = %v", got, err)
		}
	})

	t.Run("upgrade older collab tables missing columns idempotently", func(t *testing.T) {
		dbPath := filepath.Join(t.TempDir(), "collab-upgrade.db")
		db, err := sql.Open("sqlite", dbPath)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		db.SetMaxOpenConns(1)

		store, err := NewStore(db)
		if err != nil {
			t.Fatal(err)
		}
		ctx := context.Background()
		now := time.Now().UTC()
		_, err = store.CreateRun(ctx, Run{
			ID:          "old-run",
			RootID:      "r1",
			Mode:        ModeQuick,
			Title:       "Keep Run",
			TaskPrompt:  "Keep Prompt",
			Status:      RunStatusRunning,
			CurrentStep: StepReview,
			CreatedAt:   now,
			UpdatedAt:   now,
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := store.ReplaceReviewItems(ctx, "old-run", []ReviewItem{{
			ItemID:      "R1",
			Ordinal:     1,
			Dimension:   "standard",
			Severity:    "medium",
			FilePath:    "main.go",
			LineStart:   10,
			Title:       "Keep Review Item",
			Description: "Desc",
		}}); err != nil {
			t.Fatal(err)
		}

		// Only this temporary fixture is altered; never open a user database.
		for _, stmt := range []string{
			`ALTER TABLE collab_runs ADD COLUMN legacy_extra TEXT NOT NULL DEFAULT 'preserved'`,
			`ALTER TABLE collab_runs DROP COLUMN test_status`,
			`ALTER TABLE collab_runs DROP COLUMN docs_cleaned`,
			`ALTER TABLE collab_runs DROP COLUMN review_round`,
			`ALTER TABLE collab_review_items DROP COLUMN parse_fallback`,
			`ALTER TABLE collab_review_items DROP COLUMN author_decision`,
		} {
			if _, err := db.Exec(stmt); err != nil {
				t.Fatal(err)
			}
		}

		for attempt := 0; attempt < 2; attempt++ {
			store, err = NewStore(db)
			if err != nil {
				t.Fatalf("attempt %d NewStore migrate failed: %v", attempt, err)
			}
			got, err := store.GetRun(ctx, "old-run")
			if err != nil || got.Round != 0 || got.Title != "Keep Run" || got.TaskPrompt != "Keep Prompt" {
				t.Fatalf("attempt %d GetRun = %#v, err = %v", attempt, got, err)
			}
			items, err := store.ListReviewItems(ctx, "old-run")
			if err != nil || len(items) != 1 || items[0].Title != "Keep Review Item" {
				t.Fatalf("attempt %d ListReviewItems = %#v, err = %v", attempt, items, err)
			}
			var extra string
			if err := db.QueryRow(`SELECT legacy_extra FROM collab_runs WHERE id = 'old-run'`).Scan(&extra); err != nil || extra != "preserved" {
				t.Fatalf("attempt %d legacy_extra = %q, err = %v", attempt, extra, err)
			}
		}

		got, err := store.GetRun(ctx, "old-run")
		if err != nil {
			t.Fatal(err)
		}
		got.Status = RunStatusCompleted
		got.TestStatus = TestStatusPassed
		got.DocsCleaned = true
		if err := store.UpdateRun(ctx, got); err != nil {
			t.Fatal(err)
		}
		updated, err := store.GetRun(ctx, "old-run")
		if err != nil || updated.TestStatus != TestStatusPassed || !updated.DocsCleaned {
			t.Fatalf("updated run = %#v, err = %v", updated, err)
		}
	})
}

func filepathDirEnsure(filePath string) error {
	return os.MkdirAll(filepath.Dir(filePath), 0o755)
}
