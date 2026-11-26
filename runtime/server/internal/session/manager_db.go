package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	agenttypes "mindfs/server/internal/agent/types"

	_ "modernc.org/sqlite"
)

func (m *Manager) List(_ context.Context, opts ListOptions) ([]*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.listSessionsUnsafe(opts)
}

func (m *Manager) ListPinned(_ context.Context, opts ListOptions) ([]*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.listPinnedSessionsUnsafe(opts)
}

func (m *Manager) Count(_ context.Context, opts ListOptions) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.countSessionsUnsafe(opts)
}

func (m *Manager) ListMetas(_ context.Context) ([]*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.listSessionMetasUnsafe()
}

func (m *Manager) createSessionUnsafe(session *Session) error {
	if session == nil {
		return errors.New("session required")
	}
	if _, ok := m.sessions[session.Key]; ok {
		return fmt.Errorf("session already exists: %s", session.Key)
	}
	if _, err := m.getSessionMetaUnsafe(session.Key); err == nil {
		return fmt.Errorf("session already exists: %s", session.Key)
	} else if !errors.Is(err, ErrSessionNotFound) {
		return err
	}
	if err := m.upsertSessionMetaUnsafe(session); err != nil {
		return err
	}
	path, err := m.exchangePath(session.Key)
	if err != nil {
		return err
	}
	_, statErr := m.root.ReadMetaFile(path)
	if statErr == nil {
		return nil
	}
	if !errors.Is(statErr, os.ErrNotExist) {
		return statErr
	}
	return m.root.WriteMetaFile(path, []byte{})
}

func (m *Manager) getSessionUnsafe(key string, afterSeq int) (*Session, error) {
	if afterSeq <= 0 {
		if cached, ok := m.sessions[key]; ok && cached != nil {
			return cached, nil
		}
	}
	loaded, err := m.loadSessionUnsafe(key, afterSeq)
	if err != nil {
		return nil, err
	}
	if afterSeq <= 0 {
		m.sessions[key] = loaded
	}
	return loaded, nil
}

func (m *Manager) getSessionMetaUnsafe(key string) (*Session, error) {
	if strings.TrimSpace(key) == "" {
		return nil, errors.New("session key required")
	}
	db, err := m.ensureSessionMetaDBUnsafe()
	if err != nil {
		return nil, err
	}
	row := db.QueryRow(selectSessionSQL+`
WHERE key = ?`, key)
	session, err := scanSessionMetaRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	return session, nil
}

func (m *Manager) listSessionMetasUnsafe() ([]*Session, error) {
	db, err := m.ensureSessionMetaDBUnsafe()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(selectSessionSQL + `
ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	items := make([]*Session, 0)
	for rows.Next() {
		item, err := scanSessionMetaRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for _, item := range items {
		bindings, err := m.listAgentBindingsUnsafe(item.Key)
		if err != nil {
			return nil, err
		}
		for _, binding := range bindings {
			if strings.TrimSpace(binding.Agent) == "" {
				continue
			}
			item.AgentCtxSeq[binding.Agent] = binding.AgentCtxSeq
		}
	}
	return items, nil
}

func (m *Manager) listSessionsUnsafe(opts ListOptions) ([]*Session, error) {
	db, err := m.ensureSessionMetaDBUnsafe()
	if err != nil {
		return nil, err
	}
	query := `
SELECT key FROM sessions`
	where, args := sessionListWhere(opts)
	if len(where) > 0 {
		query += `
WHERE ` + strings.Join(where, " AND ")
	}
	query += `
ORDER BY updated_at DESC`
	if opts.Limit > 0 {
		query += `
LIMIT ?`
		args = append(args, opts.Limit)
	}
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0)
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items := make([]*Session, 0, len(keys))
	for _, key := range keys {
		session, err := m.getSessionUnsafe(key, 0)
		if err != nil {
			return nil, err
		}
		items = append(items, session)
	}
	return items, nil
}

func (m *Manager) listPinnedSessionsUnsafe(opts ListOptions) ([]*Session, error) {
	db, err := m.ensureSessionMetaDBUnsafe()
	if err != nil {
		return nil, err
	}
	query := `
SELECT key FROM sessions`
	where, args := sessionListWhere(ListOptions{
		ParentSessionKey: opts.ParentSessionKey,
		TopLevelOnly:     opts.TopLevelOnly,
		IncludeCollab:    opts.IncludeCollab,
	})
	where = append(where, "pinned_at IS NOT NULL AND pinned_at != ''")
	if len(where) > 0 {
		query += `
WHERE ` + strings.Join(where, " AND ")
	}
	query += `
ORDER BY pinned_at DESC, updated_at DESC`
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0)
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return nil, err
		}
		keys = append(keys, key)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items := make([]*Session, 0, len(keys))
	for _, key := range keys {
		session, err := m.getSessionUnsafe(key, 0)
		if err != nil {
			return nil, err
		}
		items = append(items, session)
	}
	return items, nil
}

func (m *Manager) countSessionsUnsafe(opts ListOptions) (int, error) {
	db, err := m.ensureSessionMetaDBUnsafe()
	if err != nil {
		return 0, err
	}
	query := `
SELECT COUNT(*) FROM sessions`
	where, args := sessionListWhere(opts)
	if len(where) > 0 {
		query += `
WHERE ` + strings.Join(where, " AND ")
	}
	var count int
	if err := db.QueryRow(query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func sessionListWhere(opts ListOptions) ([]string, []any) {
	args := make([]any, 0, 2)
	where := make([]string, 0, 3)
	if parentKey := strings.TrimSpace(opts.ParentSessionKey); parentKey != "" {
		where = append(where, "parent_session_key = ?")
		args = append(args, parentKey)
	} else {
		if opts.TopLevelOnly {
			where = append(where, "parent_session_key = ''")
		}
		if !opts.IncludeCollab {
			where = append(where, "source NOT IN ('collab_stage', 'collab_review')")
		}
	}
	if !opts.BeforeTime.IsZero() {
		where = append(where, "updated_at < ?")
		args = append(args, opts.BeforeTime.UTC().Format(time.RFC3339Nano))
	} else if !opts.AfterTime.IsZero() {
		where = append(where, "updated_at > ?")
		args = append(args, opts.AfterTime.UTC().Format(time.RFC3339Nano))
	}
	return where, args
}

func (m *Manager) loadSessionUnsafe(key string, afterSeq int) (*Session, error) {
	meta, err := m.getSessionMetaUnsafe(key)
	if err != nil {
		return nil, err
	}
	bindings, err := m.listAgentBindingsUnsafe(key)
	if err != nil {
		return nil, err
	}
	if meta.AgentCtxSeq == nil {
		meta.AgentCtxSeq = map[string]int{}
	}
	for _, binding := range bindings {
		if strings.TrimSpace(binding.Agent) == "" {
			continue
		}
		meta.AgentCtxSeq[binding.Agent] = binding.AgentCtxSeq
	}
	exchanges, _, err := m.loadExchanges(key, afterSeq)
	if err != nil {
		return nil, err
	}
	meta.Exchanges = exchanges
	return meta, nil
}

func (m *Manager) upsertSessionMetaUnsafe(session *Session) error {
	db, err := m.ensureSessionMetaDBUnsafe()
	if err != nil {
		return err
	}
	if session == nil {
		return errors.New("session required")
	}
	normalizeSessionMeta(session)
	args, err := sessionMetaUpsertArgs(session)
	if err != nil {
		return err
	}
	_, err = db.Exec(upsertSessionMetaSQL, args...)
	if err != nil {
		return err
	}
	return nil
}

func (m *Manager) ensureSessionMetaDBUnsafe() (*sql.DB, error) {
	if m.db != nil {
		return m.db, nil
	}
	metaDir, err := m.root.EnsureMetaDir()
	if err != nil {
		return nil, err
	}
	legacyDBFile := filepath.Join(metaDir, filepath.FromSlash(sessionDBPath))
	linkFile := legacyDBFile + sessionDBLinkExt
	if linkedDBFile, ok, err := readSessionDBLink(linkFile); err != nil {
		return nil, err
	} else if ok {
		db, err := openSessionMetaDB(linkedDBFile)
		if err != nil {
			return nil, err
		}
		m.db = db
		return m.db, nil
	}

	db, err := openSessionMetaDB(legacyDBFile)
	if err == nil {
		m.db = db
		return m.db, nil
	}
	legacyErr := err

	fallbackDBFile, err := userDataSessionDBFile(m.root.ID)
	if err != nil {
		return nil, fmt.Errorf("open legacy session db: %w; resolve fallback session db: %w", legacyErr, err)
	}
	db, err = openSessionMetaDB(fallbackDBFile)
	if err != nil {
		return nil, fmt.Errorf("open legacy session db: %w; open fallback session db: %w", legacyErr, err)
	}
	if err := writeSessionDBLink(linkFile, fallbackDBFile); err != nil {
		db.Close()
		return nil, fmt.Errorf("open legacy session db: %w; write session db link: %w", legacyErr, err)
	}
	log.Printf("[session/store] sqlite fallback root=%s legacy=%s fallback=%s err=%v", m.root.ID, legacyDBFile, fallbackDBFile, legacyErr)
	m.db = db
	return m.db, nil
}

func openSessionMetaDB(dbFile string) (db *sql.DB, err error) {
	defer func() {
		if r := recover(); r != nil {
			if db != nil {
				db.Close()
			}
			err = fmt.Errorf("sqlite init panic for %s: %v", dbFile, r)
		}
	}()
	if err := os.MkdirAll(filepath.Dir(dbFile), 0o755); err != nil {
		return nil, err
	}
	db, err = openSQLiteDB(dbFile)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(sessionTableSchema); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(agentBindingTableSchema); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(`ALTER TABLE sessions ADD COLUMN model TEXT NOT NULL DEFAULT ''`); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(`ALTER TABLE sessions ADD COLUMN shell TEXT NOT NULL DEFAULT ''`); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(`ALTER TABLE sessions ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0`); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
		db.Close()
		return nil, err
	}
	for _, stmt := range []string{
		`ALTER TABLE sessions ADD COLUMN parent_session_key TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN parent_tool_call_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN task_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN related_worktree_json TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN last_context_window_total_tokens INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE sessions ADD COLUMN last_context_window_model_context_window INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE sessions ADD COLUMN pinned_at TEXT`,
		`ALTER TABLE session_agent_bindings ADD COLUMN external_source_path TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE session_agent_bindings ADD COLUMN external_source_offset INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE session_agent_bindings ADD COLUMN external_source_mtime_ns INTEGER NOT NULL DEFAULT 0`,
	} {
		if _, err := db.Exec(stmt); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
			db.Close()
			return nil, err
		}
	}
	return db, nil
}

func readSessionDBLink(linkFile string) (string, bool, error) {
	payload, err := os.ReadFile(linkFile)
	if err != nil {
		if os.IsNotExist(err) {
			return "", false, nil
		}
		return "", false, err
	}
	dbFile := strings.TrimSpace(string(payload))
	if dbFile == "" {
		return "", false, fmt.Errorf("empty session db link: %s", linkFile)
	}
	if !filepath.IsAbs(dbFile) {
		return "", false, fmt.Errorf("session db link must be absolute: %s", linkFile)
	}
	return dbFile, true, nil
}

func writeSessionDBLink(linkFile, dbFile string) error {
	if strings.TrimSpace(dbFile) == "" {
		return errors.New("session db link target required")
	}
	if !filepath.IsAbs(dbFile) {
		return errors.New("session db link target must be absolute")
	}
	if err := os.MkdirAll(filepath.Dir(linkFile), 0o755); err != nil {
		return err
	}
	return os.WriteFile(linkFile, []byte(dbFile+"\n"), 0o644)
}

func userDataSessionDBFile(rootID string) (string, error) {
	configDir, err := mindFSConfigDir()
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(rootID)
	if id == "" {
		id = "default"
	}
	return filepath.Join(configDir, url.PathEscape(id), "session-list.db"), nil
}

func sessionMetaUpsertArgs(session *Session) ([]any, error) {
	if session == nil {
		return nil, errors.New("session required")
	}
	relatedFilesJSON, err := json.Marshal(session.RelatedFiles)
	if err != nil {
		return nil, err
	}
	relatedWorktreeJSON := ""
	if session.RelatedWorktree != nil && strings.TrimSpace(session.RelatedWorktree.Path) != "" {
		payload, err := json.Marshal(session.RelatedWorktree)
		if err != nil {
			return nil, err
		}
		relatedWorktreeJSON = string(payload)
	}
	var closedAt any
	if session.ClosedAt != nil {
		closedAt = session.ClosedAt.UTC().Format(time.RFC3339Nano)
	}
	var pinnedAt any
	if session.PinnedAt != nil {
		pinnedAt = session.PinnedAt.UTC().Format(time.RFC3339Nano)
	}
	return []any{
		session.Key,
		session.Type,
		session.ParentSessionKey,
		session.ParentToolCallID,
		session.Source,
		session.TaskID,
		session.Model,
		session.Shell,
		boolToSQLiteInt(session.PlanMode),
		session.Name,
		string(relatedFilesJSON),
		relatedWorktreeJSON,
		session.LastContextWindow.TotalTokens,
		session.LastContextWindow.ModelContextWindow,
		pinnedAt,
		session.CreatedAt.UTC().Format(time.RFC3339Nano),
		session.UpdatedAt.UTC().Format(time.RFC3339Nano),
		closedAt,
	}, nil
}

func validContextWindow(contextWindow agenttypes.ContextWindow) bool {
	return contextWindow.TotalTokens > 0 && contextWindow.ModelContextWindow > 0
}

func boolToSQLiteInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSessionMetaRow(scanner rowScanner) (*Session, error) {
	var (
		key                 string
		typ                 string
		parentSessionKey    string
		parentToolCallID    string
		source              string
		taskID              string
		model               string
		shell               string
		planMode            int
		name                string
		relatedFilesJSON    string
		relatedWorktreeJSON string
		contextTotalTokens  int
		contextModelWindow  int
		pinnedAtRaw         sql.NullString
		createdAtRaw        string
		updatedAtRaw        string
		closedAtRaw         sql.NullString
	)
	if err := scanner.Scan(
		&key,
		&typ,
		&parentSessionKey,
		&parentToolCallID,
		&source,
		&taskID,
		&model,
		&shell,
		&planMode,
		&name,
		&relatedFilesJSON,
		&relatedWorktreeJSON,
		&contextTotalTokens,
		&contextModelWindow,
		&pinnedAtRaw,
		&createdAtRaw,
		&updatedAtRaw,
		&closedAtRaw,
	); err != nil {
		return nil, err
	}
	session := &Session{
		Key:              key,
		Type:             typ,
		ParentSessionKey: parentSessionKey,
		ParentToolCallID: parentToolCallID,
		Source:           source,
		TaskID:           taskID,
		Model:            model,
		Shell:            shell,
		PlanMode:         planMode != 0,
		Name:             name,
		Exchanges:        []Exchange{},
		RelatedFiles:     []RelatedFile{},
		LastContextWindow: agenttypes.ContextWindow{
			TotalTokens:        contextTotalTokens,
			ModelContextWindow: contextModelWindow,
		},
	}
	if strings.TrimSpace(relatedFilesJSON) != "" {
		if err := json.Unmarshal([]byte(relatedFilesJSON), &session.RelatedFiles); err != nil {
			session.RelatedFiles = []RelatedFile{}
		}
	}
	if strings.TrimSpace(relatedWorktreeJSON) != "" {
		var relatedWorktree RelatedWorktree
		if err := json.Unmarshal([]byte(relatedWorktreeJSON), &relatedWorktree); err == nil && strings.TrimSpace(relatedWorktree.Path) != "" {
			session.RelatedWorktree = &relatedWorktree
		}
	}
	createdAt, err := time.Parse(time.RFC3339Nano, createdAtRaw)
	if err != nil {
		createdAt = time.Time{}
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, updatedAtRaw)
	if err != nil {
		updatedAt = createdAt
	}
	session.CreatedAt = createdAt
	session.UpdatedAt = updatedAt
	if pinnedAtRaw.Valid && strings.TrimSpace(pinnedAtRaw.String) != "" {
		pinnedAt, err := time.Parse(time.RFC3339Nano, pinnedAtRaw.String)
		if err == nil {
			session.PinnedAt = &pinnedAt
		}
	}
	if closedAtRaw.Valid && strings.TrimSpace(closedAtRaw.String) != "" {
		closedAt, err := time.Parse(time.RFC3339Nano, closedAtRaw.String)
		if err == nil {
			session.ClosedAt = &closedAt
		}
	}
	normalizeSessionMeta(session)
	return session, nil
}

func normalizeSessionMeta(s *Session) {
	if s.AgentCtxSeq == nil {
		s.AgentCtxSeq = map[string]int{}
	}
	if s.RelatedFiles == nil {
		s.RelatedFiles = []RelatedFile{}
	}
	for i := range s.RelatedFiles {
		s.RelatedFiles[i].RootID = strings.TrimSpace(s.RelatedFiles[i].RootID)
		s.RelatedFiles[i].RepoPath = strings.TrimSpace(s.RelatedFiles[i].RepoPath)
		s.RelatedFiles[i].RepoName = strings.TrimSpace(s.RelatedFiles[i].RepoName)
		s.RelatedFiles[i].RepoKind = strings.TrimSpace(s.RelatedFiles[i].RepoKind)
		s.RelatedFiles[i].Path = strings.TrimSpace(s.RelatedFiles[i].Path)
		s.RelatedFiles[i].Head = strings.TrimSpace(s.RelatedFiles[i].Head)
		s.RelatedFiles[i].Relation = strings.TrimSpace(s.RelatedFiles[i].Relation)
	}
	if s.RelatedWorktree != nil {
		s.RelatedWorktree.RootID = strings.TrimSpace(s.RelatedWorktree.RootID)
		s.RelatedWorktree.Path = strings.TrimSpace(s.RelatedWorktree.Path)
		s.RelatedWorktree.Branch = strings.TrimSpace(s.RelatedWorktree.Branch)
		s.RelatedWorktree.Head = strings.TrimSpace(s.RelatedWorktree.Head)
		if s.RelatedWorktree.Path == "" {
			s.RelatedWorktree = nil
		}
	}
	if s.Exchanges == nil {
		s.Exchanges = []Exchange{}
	}
	s.ParentSessionKey = strings.TrimSpace(s.ParentSessionKey)
	s.ParentToolCallID = strings.TrimSpace(s.ParentToolCallID)
	s.Source = strings.TrimSpace(s.Source)
}
