package session

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
	configpkg "mindfs/server/internal/config"
	"mindfs/server/internal/fs"
)

const (
	sessionDBPath    = "sessions/session-list.db"
	sessionDBLinkExt = ".link"
	exchangeFileTpl  = "sessions/%s.jsonl"
	auxFileTpl       = "sessions/%s.aux.jsonl"
	selectSessionSQL = `
	SELECT key, type, parent_session_key, parent_tool_call_id, source, task_id, model, shell, plan_mode, name, related_files_json, related_worktree_json, last_context_window_total_tokens, last_context_window_model_context_window, pinned_at, created_at, updated_at, closed_at
	FROM sessions`
	deleteSessionSQL = `
DELETE FROM sessions
WHERE key = ?`
	deleteBindingsBySessionSQL = `
DELETE FROM session_agent_bindings
WHERE session_key = ?`
	upsertSessionMetaSQL = `
INSERT INTO sessions (
		key, type, parent_session_key, parent_tool_call_id, source, task_id, model, shell, plan_mode, name, related_files_json, related_worktree_json, last_context_window_total_tokens, last_context_window_model_context_window, pinned_at, created_at, updated_at, closed_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(key) DO UPDATE SET
	type = excluded.type,
	parent_session_key = excluded.parent_session_key,
	parent_tool_call_id = excluded.parent_tool_call_id,
	source = excluded.source,
	task_id = excluded.task_id,
	model = excluded.model,
	shell = excluded.shell,
	plan_mode = excluded.plan_mode,
	name = excluded.name,
	related_files_json = excluded.related_files_json,
	related_worktree_json = excluded.related_worktree_json,
	last_context_window_total_tokens = excluded.last_context_window_total_tokens,
	last_context_window_model_context_window = excluded.last_context_window_model_context_window,
	pinned_at = excluded.pinned_at,
	created_at = excluded.created_at,
	updated_at = excluded.updated_at,
	closed_at = excluded.closed_at`
	sessionTableSchema = `
CREATE TABLE IF NOT EXISTS sessions (
	key TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	parent_session_key TEXT NOT NULL DEFAULT '',
	parent_tool_call_id TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL DEFAULT '',
	task_id TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	shell TEXT NOT NULL DEFAULT '',
	plan_mode INTEGER NOT NULL DEFAULT 0,
	name TEXT NOT NULL,
	related_files_json TEXT NOT NULL,
	related_worktree_json TEXT NOT NULL DEFAULT '',
	last_context_window_total_tokens INTEGER NOT NULL DEFAULT 0,
	last_context_window_model_context_window INTEGER NOT NULL DEFAULT 0,
	pinned_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	closed_at TEXT
);`
	agentBindingTableSchema = `
CREATE TABLE IF NOT EXISTS session_agent_bindings (
	session_key TEXT NOT NULL,
	agent TEXT NOT NULL,
	agent_session_id TEXT NOT NULL,
	agent_ctx_seq INTEGER NOT NULL DEFAULT 0,
	external_source_path TEXT NOT NULL DEFAULT '',
	external_source_offset INTEGER NOT NULL DEFAULT 0,
	external_source_mtime_ns INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (session_key, agent)
);`
	upsertAgentBindingSQL = `
INSERT INTO session_agent_bindings (
	session_key, agent, agent_session_id, agent_ctx_seq
) VALUES (?, ?, ?, ?)
ON CONFLICT(session_key, agent) DO UPDATE SET
	agent_session_id = excluded.agent_session_id,
	agent_ctx_seq = excluded.agent_ctx_seq`
	selectAgentBindingSQL = `
SELECT session_key, agent, agent_session_id, agent_ctx_seq, external_source_path, external_source_offset, external_source_mtime_ns
FROM session_agent_bindings
WHERE session_key = ? AND agent = ?`
	selectAgentBindingsBySessionSQL = `
SELECT session_key, agent, agent_session_id, agent_ctx_seq, external_source_path, external_source_offset, external_source_mtime_ns
FROM session_agent_bindings
WHERE session_key = ?`
	selectBindingByAgentSessionSQL = `
SELECT session_key, agent, agent_session_id, agent_ctx_seq, external_source_path, external_source_offset, external_source_mtime_ns
FROM session_agent_bindings
WHERE agent = ? AND agent_session_id = ?
LIMIT 1`
)

var openSQLiteDB = func(path string) (*sql.DB, error) {
	return sql.Open("sqlite", path)
}

var mindFSConfigDir = configpkg.MindFSConfigDir

type Manager struct {
	root             fs.RootInfo
	mu               sync.Mutex
	db               *sql.DB
	sessions         map[string]*Session
	pendingToolCalls map[string]map[string]agenttypes.ToolCall
	now              func() time.Time
}

type CreateInput struct {
	Key              string
	Type             string
	ParentSessionKey string
	ParentToolCallID string
	Source           string
	TaskID           string
	Agent            string
	Model            string
	Shell            string
	PlanMode         bool
	Name             string
}

type AgentBinding struct {
	SessionKey            string `json:"session_key"`
	Agent                 string `json:"agent"`
	AgentSessionID        string `json:"agent_session_id"`
	AgentCtxSeq           int    `json:"agent_ctx_seq"`
	ExternalSourcePath    string `json:"external_source_path,omitempty"`
	ExternalSourceOffset  int64  `json:"external_source_offset,omitempty"`
	ExternalSourceMtimeNS int64  `json:"external_source_mtime_ns,omitempty"`
}

func (b AgentBinding) ExternalCursor() agenttypes.ExternalSessionCursor {
	return agenttypes.ExternalSessionCursor{SourcePath: b.ExternalSourcePath, Offset: b.ExternalSourceOffset, ModTimeUnixNano: b.ExternalSourceMtimeNS}
}

type ListOptions struct {
	BeforeTime       time.Time
	AfterTime        time.Time
	ParentSessionKey string
	TopLevelOnly     bool
	Limit            int
}

func NewManager(root fs.RootInfo, opts ...Option) *Manager {
	m := &Manager{
		root:             root,
		sessions:         make(map[string]*Session),
		pendingToolCalls: make(map[string]map[string]agenttypes.ToolCall),
		now:              time.Now,
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

type Option func(*Manager)

func WithClock(now func() time.Time) Option {
	return func(m *Manager) {
		m.now = now
	}
}

func (m *Manager) Create(_ context.Context, input CreateInput) (*Session, error) {
	if strings.TrimSpace(input.Type) == "" {
		return nil, errors.New("session type required")
	}
	key := input.Key
	if key == "" {
		key = generateKey()
	}
	now := m.now().UTC()
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "New Session"
	}
	initialAgent := strings.TrimSpace(input.Agent)
	agentCtxSeq := map[string]int{}
	if initialAgent != "" {
		agentCtxSeq[initialAgent] = 0
	}
	session := &Session{
		Key:              key,
		Type:             input.Type,
		ParentSessionKey: strings.TrimSpace(input.ParentSessionKey),
		ParentToolCallID: strings.TrimSpace(input.ParentToolCallID),
		Source:           strings.TrimSpace(input.Source),
		TaskID:           strings.TrimSpace(input.TaskID),
		AgentCtxSeq:      agentCtxSeq,
		Model:            strings.TrimSpace(input.Model),
		Shell:            strings.TrimSpace(input.Shell),
		PlanMode:         input.PlanMode,
		Name:             name,
		Exchanges:        []Exchange{},
		RelatedFiles:     []RelatedFile{},
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.createSessionUnsafe(session); err != nil {
		return nil, err
	}
	m.sessions[session.Key] = session
	return session, nil
}

func (m *Manager) Get(_ context.Context, key string, afterSeq int) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.getSessionUnsafe(key, afterSeq)
}

func (m *Manager) GetExchangeAux(_ context.Context, key string, afterSeq int) (map[int][]ExchangeAux, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.loadExchangeAux(key, afterSeq)
}

func (m *Manager) Close(ctx context.Context, key string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.closeSessionUnsafe(key)
}

func (m *Manager) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.deleteSessionUnsafe(key)
}

func (m *Manager) Rename(_ context.Context, key, name string) (*Session, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, errors.New("session name required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	session, err := m.getSessionUnsafe(key, 0)
	if err != nil {
		return nil, err
	}
	if session.Name == trimmed {
		return session, nil
	}
	session.Name = trimmed
	session.UpdatedAt = m.now().UTC()
	if err := m.upsertSessionMetaUnsafe(session); err != nil {
		return nil, err
	}
	return session, nil
}

func (m *Manager) SetPinned(_ context.Context, key string, pinned bool) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, err := m.getSessionUnsafe(key, 0)
	if err != nil {
		return nil, err
	}
	if pinned {
		if session.PinnedAt != nil {
			return session, nil
		}
		now := m.now().UTC()
		session.PinnedAt = &now
	} else {
		if session.PinnedAt == nil {
			return session, nil
		}
		session.PinnedAt = nil
	}
	if err := m.upsertSessionMetaUnsafe(session); err != nil {
		return nil, err
	}
	return session, nil
}

func (m *Manager) UpdateModel(_ context.Context, session *Session, model string) error {
	if session == nil || strings.TrimSpace(session.Key) == "" {
		return errors.New("session required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	current, err := m.getSessionUnsafe(session.Key, 0)
	if err != nil {
		return err
	}
	model = strings.TrimSpace(model)
	if current.Model == model {
		return nil
	}
	current.Model = model
	current.UpdatedAt = m.now().UTC()
	return m.upsertSessionMetaUnsafe(current)
}

func (m *Manager) UpdateShell(_ context.Context, session *Session, shell string) error {
	if session == nil || strings.TrimSpace(session.Key) == "" {
		return errors.New("session required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	current, err := m.getSessionUnsafe(session.Key, 0)
	if err != nil {
		return err
	}
	shell = strings.TrimSpace(shell)
	if current.Shell == shell {
		return nil
	}
	current.Shell = shell
	current.UpdatedAt = m.now().UTC()
	session.Shell = shell
	session.UpdatedAt = current.UpdatedAt
	return m.upsertSessionMetaUnsafe(current)
}

func (m *Manager) UpdatePlanMode(_ context.Context, session *Session, enabled bool) error {
	if session == nil || strings.TrimSpace(session.Key) == "" {
		return errors.New("session required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	current, err := m.getSessionUnsafe(session.Key, 0)
	if err != nil {
		return err
	}
	if current.PlanMode == enabled {
		session.PlanMode = enabled
		return nil
	}
	current.PlanMode = enabled
	current.UpdatedAt = m.now().UTC()
	session.PlanMode = enabled
	session.UpdatedAt = current.UpdatedAt
	return m.upsertSessionMetaUnsafe(current)
}

func (m *Manager) UpdateLastContextWindow(_ context.Context, session *Session, contextWindow agenttypes.ContextWindow) error {
	if session == nil || strings.TrimSpace(session.Key) == "" {
		return errors.New("session required")
	}
	if !validContextWindow(contextWindow) {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	current, err := m.getSessionUnsafe(session.Key, 0)
	if err != nil {
		return err
	}
	if current.LastContextWindow == contextWindow {
		session.LastContextWindow = contextWindow
		return nil
	}
	current.LastContextWindow = contextWindow
	session.LastContextWindow = contextWindow
	return m.upsertSessionMetaUnsafe(current)
}

func (m *Manager) closeSessionUnsafe(key string) (*Session, error) {
	session, err := m.getSessionUnsafe(key, 0)
	if err != nil {
		return nil, err
	}
	if session.ClosedAt != nil {
		return session, nil
	}
	now := m.now().UTC()
	session.ClosedAt = &now
	if err := m.upsertSessionMetaUnsafe(session); err != nil {
		return nil, err
	}
	return session, nil
}

func (m *Manager) deleteSessionUnsafe(key string) error {
	if strings.TrimSpace(key) == "" {
		return errors.New("session key required")
	}
	db, err := m.ensureSessionMetaDBUnsafe()
	if err != nil {
		return err
	}
	result, err := db.Exec(deleteSessionSQL, key)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errSessionNotFound
	}
	if _, err := db.Exec(deleteBindingsBySessionSQL, key); err != nil {
		return err
	}
	delete(m.sessions, key)
	path, err := m.exchangePath(key)
	if err != nil {
		return err
	}
	metaDir, err := m.root.EnsureMetaDir()
	if err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(metaDir, filepath.FromSlash(path))); err != nil && !os.IsNotExist(err) {
		return err
	}
	auxPath, err := m.auxPath(key)
	if err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(metaDir, filepath.FromSlash(auxPath))); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (m *Manager) Shutdown() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.db == nil {
		return nil
	}
	db := m.db
	m.db = nil
	return db.Close()
}

func (m *Manager) MetaDir() string {
	return m.root.MetaDir()
}

func (m *Manager) Root() fs.RootInfo {
	return m.root
}

func (m *Manager) ExchangeLogPath(key string) string {
	path, err := m.exchangePath(key)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(filepath.Join(".mindfs", path))
}

func (m *Manager) ExchangeLogAbsolutePath(key string) string {
	path, err := m.exchangePath(key)
	if err != nil {
		return ""
	}
	metaDir := m.root.MetaDir()
	if metaDir == "" {
		return ""
	}
	return filepath.Join(metaDir, filepath.FromSlash(path))
}

var errSessionNotFound = errors.New("session not found")

func generateKey() string {
	now := time.Now().UTC().Unix()
	buf := make([]byte, 6)
	_, err := rand.Read(buf)
	if err != nil {
		return fmt.Sprintf("%d", now)
	}
	return fmt.Sprintf("%d-%s", now, hex.EncodeToString(buf))
}
