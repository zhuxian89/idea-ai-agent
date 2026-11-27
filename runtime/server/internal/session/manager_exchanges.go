package session

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
)

func (m *Manager) GetFullToolCall(_ context.Context, key, callID string) (*agenttypes.ToolCall, error) {
	if strings.TrimSpace(key) == "" {
		return nil, errors.New("session key required")
	}
	callID = strings.TrimSpace(callID)
	if callID == "" {
		return nil, errors.New("tool call id required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if found, ok := m.pendingFullToolCallUnsafe(key, callID); ok {
		return found, nil
	}
	aux, err := m.loadExchangeAuxEntries(key, 0)
	if err != nil {
		return nil, err
	}
	var found *agenttypes.ToolCall
	for _, item := range aux {
		if item.ToolCall == nil || strings.TrimSpace(item.ToolCall.CallID) != callID {
			continue
		}
		next := *item.ToolCall
		if found == nil {
			found = &next
			continue
		}
		merged := mergeToolCall(*found, next)
		found = &merged
	}
	if found == nil {
		return nil, os.ErrNotExist
	}
	return found, nil
}

func (m *Manager) UpsertPendingExchangeAux(_ context.Context, sessionKey string, aux ExchangeAux) error {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return errors.New("session key required")
	}
	if aux.ToolCall == nil || strings.TrimSpace(aux.ToolCall.CallID) == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pendingToolCalls == nil {
		m.pendingToolCalls = make(map[string]map[string]agenttypes.ToolCall)
	}
	callID := strings.TrimSpace(aux.ToolCall.CallID)
	next := cloneToolCall(*aux.ToolCall)
	byCallID := m.pendingToolCalls[sessionKey]
	if byCallID == nil {
		byCallID = make(map[string]agenttypes.ToolCall)
		m.pendingToolCalls[sessionKey] = byCallID
	}
	if existing, ok := byCallID[callID]; ok {
		next = mergeToolCall(existing, next)
	}
	byCallID[callID] = next
	return nil
}

func (m *Manager) MarkPendingAskUserAnswered(ctx context.Context, sessionKey, callID string, answers map[string]string, answeredAt time.Time) error {
	return m.AcceptPendingAskUserAnswer(ctx, sessionKey, callID, answers, answeredAt, nil)
}

// AcceptPendingAskUserAnswer keeps runtime admission and the history update in
// order with turn completion. admit must be nonblocking and must not call Manager.
func (m *Manager) AcceptPendingAskUserAnswer(ctx context.Context, sessionKey, callID string, answers map[string]string, answeredAt time.Time, admit func() error) error {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return errors.New("session key required")
	}
	callID = strings.TrimSpace(callID)
	if callID == "" {
		return errors.New("tool call id required")
	}
	cleanAnswers := make(map[string]string, len(answers))
	for key, value := range answers {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key != "" && value != "" {
			cleanAnswers[key] = value
		}
	}
	if len(cleanAnswers) == 0 {
		return errors.New("answers required")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pendingToolCalls == nil || m.pendingToolCalls[sessionKey] == nil {
		return errors.New("pending tool call not found")
	}
	existing, ok := m.pendingToolCalls[sessionKey][callID]
	if !ok {
		return errors.New("pending tool call not found")
	}
	if existing.Kind != "" && existing.Kind != agenttypes.ToolKindAskUser {
		return errors.New("pending tool call is not ask_user")
	}
	if existing.Status == "complete" {
		return errors.New("question already answered")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if admit != nil {
		if err := admit(); err != nil {
			return err
		}
	}
	meta := make(map[string]any, len(existing.Meta)+2)
	for key, value := range existing.Meta {
		meta[key] = value
	}
	meta["answers"] = cleanAnswers
	if !answeredAt.IsZero() {
		meta["answeredAt"] = answeredAt.UTC().Format(time.RFC3339Nano)
	}
	existing.Kind = agenttypes.ToolKindAskUser
	existing.Status = "complete"
	existing.Meta = meta
	m.pendingToolCalls[sessionKey][callID] = existing
	return nil
}

func (m *Manager) HasPendingAskUserQuestions(_ context.Context, sessionKey string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, call := range m.pendingToolCalls[strings.TrimSpace(sessionKey)] {
		if call.Kind != agenttypes.ToolKindAskUser {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(call.Status)) {
		case "", "running", "pending", "in_progress":
			return true
		}
	}
	return false
}

func (m *Manager) ClearPendingExchangeAux(_ context.Context, sessionKey string) {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.pendingToolCalls, sessionKey)
}

type exchangeModelDisplayNameContextKey struct{}

func WithExchangeModelDisplayName(ctx context.Context, displayName string) context.Context {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" {
		return ctx
	}
	return context.WithValue(ctx, exchangeModelDisplayNameContextKey{}, displayName)
}

func exchangeModelDisplayNameFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	value, _ := ctx.Value(exchangeModelDisplayNameContextKey{}).(string)
	return strings.TrimSpace(value)
}

type exchangeMemberSlotContextKey struct{}

func WithExchangeMemberSlot(ctx context.Context, slotID string) context.Context {
	if slotID == "" {
		return ctx
	}
	return context.WithValue(ctx, exchangeMemberSlotContextKey{}, slotID)
}

func exchangeMemberSlot(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	value, _ := ctx.Value(exchangeMemberSlotContextKey{}).(string)
	return value
}

func (m *Manager) AddExchangeForAgent(ctx context.Context, session *Session, role, content, agent, mode, effort, fastService string) error {
	return m.addExchangeForAgentAt(ctx, session, role, content, agent, mode, effort, fastService, time.Time{})
}

func (m *Manager) AddExchangeForAgentAt(ctx context.Context, session *Session, role, content, agent, mode, effort, fastService string, timestamp time.Time) error {
	return m.addExchangeForAgentAt(ctx, session, role, content, agent, mode, effort, fastService, timestamp)
}

func (m *Manager) addExchangeForAgentAt(ctx context.Context, session *Session, role, content, agent, mode, effort, fastService string, timestamp time.Time) error {
	if session == nil || strings.TrimSpace(session.Key) == "" {
		return errors.New("session required")
	}
	normalizedRole := strings.ToLower(strings.TrimSpace(role))
	if strings.TrimSpace(content) == "" && normalizedRole != "agent" && normalizedRole != "assistant" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	current, err := m.getSessionUnsafe(session.Key, 0)
	if err != nil {
		return err
	}
	session = current
	if session.ClosedAt != nil {
		session.ClosedAt = nil
	}
	resolvedAgent := strings.TrimSpace(agent)
	nextSeq := len(session.Exchanges) + 1
	ts := timestamp.UTC()
	if ts.IsZero() {
		ts = m.now().UTC()
	}
	record := Exchange{
		Seq:              nextSeq,
		Role:             role,
		MemberSlotID:     exchangeMemberSlot(ctx),
		Agent:            resolvedAgent,
		Model:            session.Model,
		ModelDisplayName: exchangeModelDisplayNameFromContext(ctx),
		Mode:             strings.TrimSpace(mode),
		Effort:           strings.TrimSpace(effort),
		ContextWindow:    cloneContextWindow(exchangeContextWindow(ctx)),
		FastService:      fastService,
		Content:          content,
		Timestamp:        ts,
	}
	if err := m.appendExchange(session.Key, record); err != nil {
		log.Printf("[session/store] append.error session=%s seq=%d role=%s agent=%s err=%v", session.Key, record.Seq, role, resolvedAgent, err)
		return err
	}
	session.Exchanges = append(session.Exchanges, record)
	session.UpdatedAt = record.Timestamp
	if resolvedAgent != "" {
		if session.AgentCtxSeq == nil {
			session.AgentCtxSeq = map[string]int{}
		}
		if _, ok := session.AgentCtxSeq[resolvedAgent]; !ok {
			session.AgentCtxSeq[resolvedAgent] = 0
		}
	}
	if err := m.upsertSessionMetaUnsafe(session); err != nil {
		return err
	}
	return nil
}

func (m *Manager) AddExchangeAux(_ context.Context, sessionKey string, aux ExchangeAux) error {
	if strings.TrimSpace(sessionKey) == "" {
		return errors.New("session key required")
	}
	if aux.Seq <= 0 {
		return errors.New("aux seq required")
	}
	if aux.ToolCall == nil && strings.TrimSpace(aux.Thought) == "" && aux.Todo == nil && aux.Plan == nil && aux.Compact == nil && aux.TurnDiff == nil {
		return errors.New("aux content required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.appendExchangeAux(sessionKey, aux)
}

func (m *Manager) loadExchanges(key string, afterSeq int) ([]Exchange, int, error) {
	path, err := m.exchangePath(key)
	if err != nil {
		return nil, 0, err
	}
	payload, err := m.root.ReadMetaFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Exchange{}, 0, nil
		}
		return nil, 0, err
	}
	exchanges := make([]Exchange, 0)
	total := 0
	scanner := jsonlScanner(payload)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry Exchange
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		if entry.Seq <= 0 {
			entry.Seq = total + 1
		}
		if entry.Seq > total {
			total = entry.Seq
		}
		if afterSeq > 0 && entry.Seq <= afterSeq {
			continue
		}
		exchanges = append(exchanges, entry)
	}
	if err := scanner.Err(); err != nil {
		return nil, 0, err
	}
	return exchanges, total, nil
}

func (m *Manager) appendExchange(key string, exchange Exchange) error {
	path, err := m.exchangePath(key)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(exchange)
	if err != nil {
		return err
	}
	file, err := m.root.OpenMetaFileAppend(path)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.Write(append(payload, '\n')); err != nil {
		return err
	}
	return nil
}

func (m *Manager) loadExchangeAux(key string, afterSeq int) (map[int][]ExchangeAux, error) {
	entries, err := m.loadExchangeAuxEntries(key, afterSeq)
	if err != nil {
		return nil, err
	}
	items := make(map[int][]ExchangeAux)
	for _, entry := range entries {
		compacted, ok := CompactExchangeAux(entry)
		if !ok {
			continue
		}
		items[compacted.Seq] = append(items[compacted.Seq], compacted)
	}
	return items, nil
}

func (m *Manager) loadExchangeAuxEntries(key string, afterSeq int) ([]ExchangeAux, error) {
	path, err := m.auxPath(key)
	if err != nil {
		return nil, err
	}
	payload, err := m.root.ReadMetaFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []ExchangeAux{}, nil
		}
		return nil, err
	}
	items := make([]ExchangeAux, 0)
	scanner := jsonlScanner(payload)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry ExchangeAux
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		if entry.Seq <= 0 {
			continue
		}
		if afterSeq > 0 && entry.Seq <= afterSeq {
			continue
		}
		items = append(items, entry)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func mergeToolCall(base, next agenttypes.ToolCall) agenttypes.ToolCall {
	merged := base
	merged.Activity = agenttypes.MergeActivityFacts(base.Activity, next.Activity)
	if strings.TrimSpace(next.CallID) != "" {
		merged.CallID = next.CallID
	}
	if strings.TrimSpace(next.Title) != "" {
		merged.Title = next.Title
	}
	if strings.TrimSpace(next.Status) != "" {
		merged.Status = agenttypes.MergeToolStatus(base.Status, next.Status)
	}
	if next.Kind != "" {
		merged.Kind = next.Kind
	}
	if len(next.Content) > 0 {
		merged.Content = append([]agenttypes.ToolCallContentItem(nil), next.Content...)
	}
	if len(next.Locations) > 0 {
		merged.Locations = append([]agenttypes.ToolCallLocation(nil), next.Locations...)
	}
	if strings.TrimSpace(next.RawType) != "" {
		merged.RawType = next.RawType
	}
	if len(base.Meta) > 0 || len(next.Meta) > 0 {
		merged.Meta = make(map[string]any, len(base.Meta)+len(next.Meta))
		for key, value := range base.Meta {
			merged.Meta[key] = value
		}
		for key, value := range next.Meta {
			merged.Meta[key] = value
		}
	}
	return merged
}

func (m *Manager) pendingFullToolCallUnsafe(sessionKey, callID string) (*agenttypes.ToolCall, bool) {
	if m.pendingToolCalls == nil {
		return nil, false
	}
	toolCall, ok := m.pendingToolCalls[sessionKey][callID]
	if !ok {
		return nil, false
	}
	out := cloneToolCall(toolCall)
	return &out, true
}

func cloneToolCall(toolCall agenttypes.ToolCall) agenttypes.ToolCall {
	out := toolCall
	out.Activity = agenttypes.CloneActivityFacts(toolCall.Activity)
	out.Content = append([]agenttypes.ToolCallContentItem(nil), toolCall.Content...)
	out.Locations = append([]agenttypes.ToolCallLocation(nil), toolCall.Locations...)
	if len(toolCall.Meta) > 0 {
		out.Meta = make(map[string]any, len(toolCall.Meta))
		for key, value := range toolCall.Meta {
			out.Meta[key] = value
		}
	}
	return out
}

func jsonlScanner(payload []byte) *bufio.Scanner {
	scanner := bufio.NewScanner(strings.NewReader(string(payload)))
	maxTokenSize := len(payload) + 1
	if maxTokenSize < 64*1024 {
		maxTokenSize = 64 * 1024
	}
	scanner.Buffer(make([]byte, 0, 64*1024), maxTokenSize)
	return scanner
}

func (m *Manager) appendExchangeAux(key string, aux ExchangeAux) error {
	path, err := m.auxPath(key)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(aux)
	if err != nil {
		return err
	}
	file, err := m.root.OpenMetaFileAppend(path)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.Write(append(payload, '\n')); err != nil {
		return err
	}
	return nil
}

func (m *Manager) exchangePath(key string) (string, error) {
	if strings.TrimSpace(m.root.MetaDir()) == "" {
		return "", errors.New("managed dir required")
	}
	if key == "" {
		return "", errors.New("session key required")
	}
	if strings.Contains(key, "..") || strings.ContainsRune(key, filepath.Separator) || strings.Contains(key, "/") {
		return "", fmt.Errorf("invalid session key: %s", key)
	}
	return filepath.ToSlash(fmt.Sprintf(exchangeFileTpl, key)), nil
}

func (m *Manager) auxPath(key string) (string, error) {
	if strings.TrimSpace(m.root.MetaDir()) == "" {
		return "", errors.New("managed dir required")
	}
	if key == "" {
		return "", errors.New("session key required")
	}
	if strings.Contains(key, "..") || strings.ContainsRune(key, filepath.Separator) || strings.Contains(key, "/") {
		return "", fmt.Errorf("invalid session key: %s", key)
	}
	return filepath.ToSlash(fmt.Sprintf(auxFileTpl, key)), nil
}
