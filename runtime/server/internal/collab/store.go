package collab

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	RunStatusRunning     = "running"
	RunStatusWaitingUser = "waiting_user"
	RunStatusCompleted   = "completed"
	RunStatusFailed      = "failed"
	RunStatusCanceled    = "canceled"

	StepImpl      = "impl"
	StepReview    = "review"
	StepResponse  = "response"
	StepDecisions = "decisions"
	StepFixTest   = "fix_test"
	StepDone      = "done"

	StepStatusPending     = "pending"
	StepStatusRunning     = "running"
	StepStatusWaitingUser = "waiting_user"
	StepStatusDone        = "done"
	StepStatusSkipped     = "skipped"
	StepStatusFailed      = "failed"

	PrimaryStatusAccepted = "accepted"
	PrimaryStatusDisputed = "disputed"

	DecisionAcceptReview = "accept_review"
	DecisionKeepPrimary  = "keep_primary"
	DecisionCustom       = "custom"

	TestStatusPassed  = "passed"
	TestStatusFailed  = "failed"
	TestStatusSkipped = "skipped"
)

type StepCard struct {
	ChangesSince  string   `json:"changes_since,omitempty"`
	PreviousItems []string `json:"previous_items,omitempty"`
	HighestItemID int      `json:"highest_item_id,omitempty"`
	AuthorNote    string   `json:"author_note,omitempty"`
	Key           string   `json:"key"`
	Title         string   `json:"title"`
	Role          string   `json:"role"`
	SlotID        string   `json:"slot_id,omitempty"`
	Agent         string   `json:"agent,omitempty"`
	Model         string   `json:"model,omitempty"`
	Effort        string   `json:"effort,omitempty"`
	ReadOnly      bool     `json:"read_only,omitempty"`
	SessionKey    string   `json:"session_key,omitempty"`
	DocPath       string   `json:"doc_path,omitempty"`
	Status        string   `json:"status"`
	Summary       string   `json:"summary,omitempty"`
	StartedAt     string   `json:"started_at,omitempty"`
	FinishedAt    string   `json:"finished_at,omitempty"`
}

type Run struct {
	Round              int              `json:"round"`
	ID                 string           `json:"id"`
	RootID             string           `json:"root_id"`
	Mode               string           `json:"mode"`
	Title              string           `json:"title"`
	TaskPrompt         string           `json:"task_prompt"`
	TemplateID         string           `json:"template_id,omitempty"`
	TemplateName       string           `json:"template_name,omitempty"`
	Snapshot           TemplateSnapshot `json:"snapshot"`
	Status             string           `json:"status"`
	CurrentStep        string           `json:"current_step"`
	Steps              []StepCard       `json:"steps"`
	ReadOnlyCheckState string           `json:"readonly_check_state,omitempty"`
	ReadOnlyCheckNote  string           `json:"readonly_check_note,omitempty"`
	TestStatus         string           `json:"test_status,omitempty"`
	TestCommand        string           `json:"test_command,omitempty"`
	TestSummary        string           `json:"test_summary,omitempty"`
	DocsCleaned        bool             `json:"docs_cleaned,omitempty"`
	ErrorMessage       string           `json:"error_message,omitempty"`
	CreatedAt          time.Time        `json:"created_at"`
	UpdatedAt          time.Time        `json:"updated_at"`
	CompletedAt        string           `json:"completed_at,omitempty"`
}

type RunDetail struct {
	Run            Run          `json:"run"`
	ReviewItems    []ReviewItem `json:"review_items"`
	Docs           []string     `json:"docs,omitempty"`
	ProgressAction string       `json:"progress_action,omitempty"`
}

const collabSelectRunColumns = `
	id, root_id, mode, title, task_prompt, template_id, template_name,
	template_snapshot_json, status, current_step, step_status_json,
	readonly_check_state, readonly_check_note, test_status, test_command, test_summary,
	docs_cleaned, error_message, created_at, updated_at, completed_at, review_round`

type Store struct {
	db  *sql.DB
	now func() time.Time
}

func NewStore(db *sql.DB) (*Store, error) {
	if db == nil {
		return nil, errors.New("collab sqlite db required")
	}
	store := &Store{db: db, now: time.Now}
	if err := store.Migrate(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) Migrate() error {
	if s == nil || s.db == nil {
		return errors.New("collab store not initialized")
	}
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS collab_runs (
	id TEXT PRIMARY KEY,
	root_id TEXT NOT NULL DEFAULT '',
	mode TEXT NOT NULL DEFAULT 'quick',
	title TEXT NOT NULL DEFAULT '',
	task_prompt TEXT NOT NULL DEFAULT '',
	template_id TEXT NOT NULL DEFAULT '',
	template_name TEXT NOT NULL DEFAULT '',
	template_snapshot_json TEXT NOT NULL DEFAULT '{}',
	status TEXT NOT NULL DEFAULT 'running',
	current_step TEXT NOT NULL DEFAULT 'impl',
	step_status_json TEXT NOT NULL DEFAULT '[]',
	readonly_check_state TEXT NOT NULL DEFAULT '',
	readonly_check_note TEXT NOT NULL DEFAULT '',
	test_status TEXT NOT NULL DEFAULT '',
	test_command TEXT NOT NULL DEFAULT '',
	test_summary TEXT NOT NULL DEFAULT '',
	docs_cleaned INTEGER NOT NULL DEFAULT 0,
	error_message TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS collab_review_items (
	run_id TEXT NOT NULL,
	item_id TEXT NOT NULL,
	ordinal INTEGER NOT NULL DEFAULT 0,
	dimension TEXT NOT NULL DEFAULT '',
	severity TEXT NOT NULL DEFAULT '',
	file_path TEXT NOT NULL DEFAULT '',
	line_start INTEGER NOT NULL DEFAULT 0,
	line_end INTEGER NOT NULL DEFAULT 0,
	citation_verified INTEGER NOT NULL DEFAULT 0,
	citation_note TEXT NOT NULL DEFAULT '',
	rule_ref TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	primary_status TEXT NOT NULL DEFAULT '',
	primary_note TEXT NOT NULL DEFAULT '',
	parse_fallback INTEGER NOT NULL DEFAULT 0,
	author_decision TEXT NOT NULL DEFAULT '',
	author_note TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL,
	PRIMARY KEY (run_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_runs_updated ON collab_runs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_runs_status ON collab_runs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_review_items_run ON collab_review_items(run_id, ordinal ASC);
`)
	if err != nil {
		return err
	}

	for _, stmt := range []string{
		`ALTER TABLE collab_runs ADD COLUMN review_round INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE collab_runs ADD COLUMN template_snapshot_json TEXT NOT NULL DEFAULT '{}'`,
		`ALTER TABLE collab_runs ADD COLUMN step_status_json TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE collab_runs ADD COLUMN readonly_check_state TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_runs ADD COLUMN readonly_check_note TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_runs ADD COLUMN test_status TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_runs ADD COLUMN test_command TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_runs ADD COLUMN test_summary TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_runs ADD COLUMN docs_cleaned INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE collab_runs ADD COLUMN error_message TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_runs ADD COLUMN completed_at TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_review_items ADD COLUMN citation_verified INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE collab_review_items ADD COLUMN citation_note TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_review_items ADD COLUMN rule_ref TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_review_items ADD COLUMN primary_status TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_review_items ADD COLUMN primary_note TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_review_items ADD COLUMN parse_fallback INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE collab_review_items ADD COLUMN author_decision TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE collab_review_items ADD COLUMN author_note TEXT NOT NULL DEFAULT ''`,
	} {
		if _, err := s.db.Exec(stmt); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
			return err
		}
	}
	return nil
}

func (s *Store) CreateRun(ctx context.Context, run Run) (Run, error) {
	now := s.now().UTC()
	if strings.TrimSpace(run.ID) == "" {
		run.ID = newCollabID("run")
	}
	if strings.TrimSpace(run.Mode) == "" {
		run.Mode = ModeQuick
	}
	if strings.TrimSpace(run.Status) == "" {
		run.Status = RunStatusRunning
	}
	if strings.TrimSpace(run.CurrentStep) == "" {
		run.CurrentStep = StepImpl
	}
	if run.CreatedAt.IsZero() {
		run.CreatedAt = now
	}
	if run.UpdatedAt.IsZero() {
		run.UpdatedAt = run.CreatedAt
	}
	if run.Steps == nil {
		run.Steps = []StepCard{}
	}
	snapshotJSON, err := json.Marshal(run.Snapshot)
	if err != nil {
		return Run{}, err
	}
	stepsJSON, err := json.Marshal(run.Steps)
	if err != nil {
		return Run{}, err
	}
	_, err = s.db.ExecContext(ctx, `
INSERT INTO collab_runs (
	id, root_id, mode, title, task_prompt, template_id, template_name,
	template_snapshot_json, status, current_step, step_status_json,
	readonly_check_state, readonly_check_note, test_status, test_command, test_summary,
	docs_cleaned, error_message, created_at, updated_at, completed_at, review_round
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID,
		strings.TrimSpace(run.RootID),
		strings.TrimSpace(run.Mode),
		strings.TrimSpace(run.Title),
		run.TaskPrompt,
		strings.TrimSpace(run.TemplateID),
		strings.TrimSpace(run.TemplateName),
		string(snapshotJSON),
		strings.TrimSpace(run.Status),
		strings.TrimSpace(run.CurrentStep),
		string(stepsJSON),
		strings.TrimSpace(run.ReadOnlyCheckState),
		strings.TrimSpace(run.ReadOnlyCheckNote),
		strings.TrimSpace(run.TestStatus),
		strings.TrimSpace(run.TestCommand),
		run.TestSummary,
		boolToInt(run.DocsCleaned),
		run.ErrorMessage,
		run.CreatedAt.UTC().Format(time.RFC3339Nano),
		run.UpdatedAt.UTC().Format(time.RFC3339Nano),
		strings.TrimSpace(run.CompletedAt), run.Round,
	)
	if err != nil {
		return Run{}, err
	}
	return run, nil
}

func (s *Store) UpdateRun(ctx context.Context, run Run) error {
	if strings.TrimSpace(run.ID) == "" {
		return errors.New("run id required")
	}
	if run.UpdatedAt.IsZero() {
		run.UpdatedAt = s.now().UTC()
	}
	if run.Steps == nil {
		run.Steps = []StepCard{}
	}
	snapshotJSON, err := json.Marshal(run.Snapshot)
	if err != nil {
		return err
	}
	stepsJSON, err := json.Marshal(run.Steps)
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, `
UPDATE collab_runs SET
	title = ?,
	task_prompt = ?,
	template_id = ?,
	template_name = ?,
	template_snapshot_json = ?,
	status = ?,
	current_step = ?,
	step_status_json = ?,
	readonly_check_state = ?,
	readonly_check_note = ?,
	test_status = ?,
	test_command = ?,
	test_summary = ?,
	docs_cleaned = ?,
	error_message = ?,
	updated_at = ?,
	completed_at = ?
WHERE id = ? AND review_round = ?`,
		strings.TrimSpace(run.Title),
		run.TaskPrompt,
		strings.TrimSpace(run.TemplateID),
		strings.TrimSpace(run.TemplateName),
		string(snapshotJSON),
		strings.TrimSpace(run.Status),
		strings.TrimSpace(run.CurrentStep),
		string(stepsJSON),
		strings.TrimSpace(run.ReadOnlyCheckState),
		strings.TrimSpace(run.ReadOnlyCheckNote),
		strings.TrimSpace(run.TestStatus),
		strings.TrimSpace(run.TestCommand),
		run.TestSummary,
		boolToInt(run.DocsCleaned),
		run.ErrorMessage,
		run.UpdatedAt.UTC().Format(time.RFC3339Nano),
		strings.TrimSpace(run.CompletedAt),
		strings.TrimSpace(run.ID), run.Round,
	)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrRunNotFound
	}
	return nil
}

var ErrRunNotFound = errors.New("collab run not found")

func (s *Store) GetRun(ctx context.Context, id string) (Run, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+collabSelectRunColumns+` FROM collab_runs WHERE id = ?`, strings.TrimSpace(id))
	run, err := scanRunRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Run{}, ErrRunNotFound
	}
	return run, err
}

func (s *Store) ListRuns(ctx context.Context, mode string, limit int) ([]Run, error) {
	query := `SELECT ` + collabSelectRunColumns + ` FROM collab_runs`
	args := make([]any, 0, 2)
	if trimmed := strings.TrimSpace(mode); trimmed != "" {
		query += ` WHERE mode = ?`
		args = append(args, trimmed)
	}
	query += ` ORDER BY updated_at DESC`
	if limit > 0 {
		query += ` LIMIT ?`
		args = append(args, limit)
	}
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Run, 0)
	for rows.Next() {
		item, err := scanRunRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) CountWaitingRuns(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM collab_runs WHERE status = ?`, RunStatusWaitingUser).Scan(&count)
	return count, err
}

// RecoverInterruptedRuns marks any persisted "running" runs as "waiting_user"
// on startup so runs interrupted by a backend restart can be resumed or deleted.
func (s *Store) RecoverInterruptedRuns(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `SELECT `+collabSelectRunColumns+` FROM collab_runs WHERE status = ?`, RunStatusRunning)
	if err != nil {
		return err
	}
	var interrupted []Run
	for rows.Next() {
		item, scanErr := scanRunRow(rows)
		if scanErr != nil {
			_ = rows.Close()
			return scanErr
		}
		interrupted = append(interrupted, item)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	now := s.now().UTC()
	for _, run := range interrupted {
		for i := range run.Steps {
			if run.Steps[i].Status == StepStatusRunning || run.Steps[i].Key == run.CurrentStep {
				if run.Steps[i].Status == StepStatusRunning || run.Steps[i].Status == StepStatusPending {
					run.Steps[i].Status = StepStatusWaitingUser
					run.Steps[i].Summary = "后台重启中断，点击继续恢复执行"
				}
			}
		}
		run.Status = RunStatusWaitingUser
		run.UpdatedAt = now
		if err := s.UpdateRun(ctx, run); err != nil && !errors.Is(err, ErrRunNotFound) {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteRun(ctx context.Context, id string) error {
	trimmed := strings.TrimSpace(id)
	if trimmed == "" {
		return errors.New("run id required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM collab_review_items WHERE run_id = ?`, trimmed); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM collab_runs WHERE id = ?`, trimmed)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrRunNotFound
	}
	return tx.Commit()
}

func (s *Store) ReplaceReviewItems(ctx context.Context, runID string, items []ReviewItem) error {
	trimmed := strings.TrimSpace(runID)
	if trimmed == "" {
		return errors.New("run id required")
	}
	nowStr := s.now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM collab_review_items WHERE run_id = ?`, trimmed); err != nil {
		return err
	}
	for i, item := range items {
		itemID := strings.TrimSpace(item.ItemID)
		if itemID == "" {
			itemID = fmt.Sprintf("R%d", i+1)
		}
		ordinal := item.Ordinal
		if ordinal <= 0 {
			ordinal = i + 1
		}
		updatedAt := strings.TrimSpace(item.UpdatedAt)
		if updatedAt == "" {
			updatedAt = nowStr
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO collab_review_items (
	run_id, item_id, ordinal, dimension, severity, file_path, line_start, line_end,
	citation_verified, citation_note, rule_ref, title, description,
	primary_status, primary_note, parse_fallback, author_decision, author_note, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			trimmed,
			itemID,
			ordinal,
			strings.TrimSpace(item.Dimension),
			strings.TrimSpace(item.Severity),
			strings.TrimSpace(item.FilePath),
			item.LineStart,
			item.LineEnd,
			boolToInt(item.CitationVerified),
			strings.TrimSpace(item.CitationNote),
			strings.TrimSpace(item.RuleRef),
			strings.TrimSpace(item.Title),
			item.Description,
			strings.TrimSpace(item.PrimaryStatus),
			item.PrimaryNote,
			boolToInt(item.ParseFallback),
			strings.TrimSpace(item.AuthorDecision),
			item.AuthorNote,
			updatedAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListReviewItems(ctx context.Context, runID string) ([]ReviewItem, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT item_id, ordinal, dimension, severity, file_path, line_start, line_end,
	citation_verified, citation_note, rule_ref, title, description,
	primary_status, primary_note, parse_fallback, author_decision, author_note, updated_at
FROM collab_review_items
WHERE run_id = ?
ORDER BY ordinal ASC, item_id ASC`, strings.TrimSpace(runID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ReviewItem, 0)
	for rows.Next() {
		var (
			item        ReviewItem
			verifiedInt int
			fallbackInt int
		)
		if err := rows.Scan(
			&item.ItemID,
			&item.Ordinal,
			&item.Dimension,
			&item.Severity,
			&item.FilePath,
			&item.LineStart,
			&item.LineEnd,
			&verifiedInt,
			&item.CitationNote,
			&item.RuleRef,
			&item.Title,
			&item.Description,
			&item.PrimaryStatus,
			&item.PrimaryNote,
			&fallbackInt,
			&item.AuthorDecision,
			&item.AuthorNote,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		item.CitationVerified = verifiedInt != 0
		item.ParseFallback = fallbackInt != 0
		items = append(items, item)
	}
	return items, rows.Err()
}

type scanner interface {
	Scan(dest ...any) error
}

func scanRunRow(row scanner) (Run, error) {
	var (
		run          Run
		snapshotJSON string
		stepsJSON    string
		docsCleaned  int
		createdRaw   string
		updatedRaw   string
	)
	if err := row.Scan(
		&run.ID,
		&run.RootID,
		&run.Mode,
		&run.Title,
		&run.TaskPrompt,
		&run.TemplateID,
		&run.TemplateName,
		&snapshotJSON,
		&run.Status,
		&run.CurrentStep,
		&stepsJSON,
		&run.ReadOnlyCheckState,
		&run.ReadOnlyCheckNote,
		&run.TestStatus,
		&run.TestCommand,
		&run.TestSummary,
		&docsCleaned,
		&run.ErrorMessage,
		&createdRaw,
		&updatedRaw,
		&run.CompletedAt, &run.Round,
	); err != nil {
		return Run{}, err
	}
	run.DocsCleaned = docsCleaned != 0
	if strings.TrimSpace(snapshotJSON) != "" {
		_ = json.Unmarshal([]byte(snapshotJSON), &run.Snapshot)
	}
	if strings.TrimSpace(stepsJSON) != "" {
		_ = json.Unmarshal([]byte(stepsJSON), &run.Steps)
	}
	if run.Steps == nil {
		run.Steps = []StepCard{}
	}
	if t, err := time.Parse(time.RFC3339Nano, createdRaw); err == nil {
		run.CreatedAt = t
	}
	if t, err := time.Parse(time.RFC3339Nano, updatedRaw); err == nil {
		run.UpdatedAt = t
	}
	return run, nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
