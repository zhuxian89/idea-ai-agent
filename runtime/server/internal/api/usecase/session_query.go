package usecase

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/session"
)

type ListSessionsInput struct {
	RootID          string
	BeforeTime      time.Time
	AfterTime       time.Time
	Limit           int
	TopLevelOnly    bool
	IncludeChildren bool
}

type ListSessionsOutput struct {
	Sessions       []*session.Session
	PinnedSessions []*session.Session
	PinnedKeys     []string
	TotalCount     int
}

type ListMultiRootSessionsInput struct {
	LimitPerRoot int
}

type SessionRootGroup struct {
	RootID            string
	RootName          string
	LatestSessionTime time.Time
	Sessions          []*session.Session
	PinnedSessions    []*session.Session
	PinnedKeys        []string
	TotalCount        int
}

type ListMultiRootSessionsOutput struct {
	Groups []SessionRootGroup
}

type ListChildSessionsInput struct {
	RootID           string
	ParentSessionKey string
	BeforeTime       time.Time
	Limit            int
}

type SearchSessionsInput struct {
	RootID    string
	Query     string
	Limit     int
	MultiRoot bool
}

type SearchSessionsOutput struct {
	Items []SessionSearchHit
}

type SessionSearchHit struct {
	RootID           string     `json:"root_id,omitempty"`
	Key              string     `json:"key"`
	Type             string     `json:"type"`
	ParentSessionKey string     `json:"parent_session_key,omitempty"`
	ParentToolCallID string     `json:"parent_tool_call_id,omitempty"`
	Agent            string     `json:"agent,omitempty"`
	Model            string     `json:"model,omitempty"`
	Shell            string     `json:"shell,omitempty"`
	Name             string     `json:"name"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	ClosedAt         *time.Time `json:"closed_at,omitempty"`
	MatchType        string     `json:"match_type"`
	MatchScore       int        `json:"match_score"`
	Seq              int        `json:"seq"`
	Snippet          string     `json:"snippet,omitempty"`
}

func (s *Service) ListSessions(ctx context.Context, in ListSessionsInput) (ListSessionsOutput, error) {
	if err := s.ensureRegistry(); err != nil {
		return ListSessionsOutput{}, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return ListSessionsOutput{}, err
	}
	items, err := manager.List(ctx, session.ListOptions{
		BeforeTime:   in.BeforeTime,
		AfterTime:    in.AfterTime,
		TopLevelOnly: in.TopLevelOnly,
		Limit:        in.Limit,
	})
	if err != nil {
		return ListSessionsOutput{}, err
	}
	totalCount, err := manager.Count(ctx, session.ListOptions{
		BeforeTime:   in.BeforeTime,
		AfterTime:    in.AfterTime,
		TopLevelOnly: in.TopLevelOnly,
	})
	if err != nil {
		return ListSessionsOutput{}, err
	}
	if in.IncludeChildren {
		items, err = appendChildSessions(ctx, manager, items)
		if err != nil {
			return ListSessionsOutput{}, err
		}
	}
	pinnedItems, err := manager.ListPinned(ctx, session.ListOptions{TopLevelOnly: in.TopLevelOnly})
	if err != nil {
		return ListSessionsOutput{}, err
	}
	pinnedKeys := pinnedSessionKeys(pinnedItems)
	allForShells := append(append([]*session.Session{}, items...), pinnedItems...)
	if err := fillCommandShells(ctx, manager, allForShells); err != nil {
		return ListSessionsOutput{}, err
	}
	return ListSessionsOutput{Sessions: items, PinnedSessions: pinnedItems, PinnedKeys: pinnedKeys, TotalCount: totalCount}, nil
}

func (s *Service) ListMultiRootSessions(ctx context.Context, in ListMultiRootSessionsInput) (ListMultiRootSessionsOutput, error) {
	if err := s.ensureRegistry(); err != nil {
		return ListMultiRootSessionsOutput{}, err
	}
	limit := in.LimitPerRoot
	if limit <= 0 {
		limit = 6
	}
	groups := make([]SessionRootGroup, 0)
	for _, root := range s.Registry.ListRoots() {
		manager, err := s.Registry.GetSessionManager(root.ID)
		if err != nil {
			return ListMultiRootSessionsOutput{}, err
		}
		totalCount, err := manager.Count(ctx, session.ListOptions{TopLevelOnly: true})
		if err != nil {
			return ListMultiRootSessionsOutput{}, err
		}
		if totalCount <= 0 {
			continue
		}
		items, err := manager.List(ctx, session.ListOptions{TopLevelOnly: true, Limit: limit})
		if err != nil {
			return ListMultiRootSessionsOutput{}, err
		}
		items, err = appendChildSessions(ctx, manager, items)
		if err != nil {
			return ListMultiRootSessionsOutput{}, err
		}
		pinnedItems, err := manager.ListPinned(ctx, session.ListOptions{TopLevelOnly: true})
		if err != nil {
			return ListMultiRootSessionsOutput{}, err
		}
		pinnedKeys := pinnedSessionKeys(pinnedItems)
		allForShells := append(append([]*session.Session{}, items...), pinnedItems...)
		if err := fillCommandShells(ctx, manager, allForShells); err != nil {
			return ListMultiRootSessionsOutput{}, err
		}
		latest := time.Time{}
		if len(items) > 0 && items[0] != nil {
			latest = items[0].UpdatedAt
		}
		groups = append(groups, SessionRootGroup{
			RootID:            root.ID,
			RootName:          root.Name,
			LatestSessionTime: latest,
			Sessions:          items,
			PinnedSessions:    pinnedItems,
			PinnedKeys:        pinnedKeys,
			TotalCount:        totalCount,
		})
	}
	sort.SliceStable(groups, func(i, j int) bool {
		return groups[i].LatestSessionTime.After(groups[j].LatestSessionTime)
	})
	return ListMultiRootSessionsOutput{Groups: groups}, nil
}

func pinnedSessionKeys(items []*session.Session) []string {
	keys := make([]string, 0, len(items))
	for _, item := range items {
		if item == nil || strings.TrimSpace(item.Key) == "" {
			continue
		}
		keys = append(keys, item.Key)
	}
	return keys
}

func (s *Service) ListChildSessions(ctx context.Context, in ListChildSessionsInput) (ListSessionsOutput, error) {
	if err := s.ensureRegistry(); err != nil {
		return ListSessionsOutput{}, err
	}
	parentKey := strings.TrimSpace(in.ParentSessionKey)
	if parentKey == "" {
		return ListSessionsOutput{}, errors.New("parent_session_key required")
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return ListSessionsOutput{}, err
	}
	items, err := manager.List(ctx, session.ListOptions{
		BeforeTime:       in.BeforeTime,
		ParentSessionKey: parentKey,
		Limit:            in.Limit,
	})
	if err != nil {
		return ListSessionsOutput{}, err
	}
	if err := fillCommandShells(ctx, manager, items); err != nil {
		return ListSessionsOutput{}, err
	}
	return ListSessionsOutput{Sessions: items}, nil
}

func fillCommandShells(ctx context.Context, manager *session.Manager, items []*session.Session) error {
	for _, item := range items {
		if item == nil || item.Type != session.TypeCommand {
			continue
		}
		aux, err := manager.GetExchangeAux(ctx, item.Key, 0)
		if err != nil {
			return err
		}
		item.Shell = session.InferCommandShellFromAux(aux)
	}
	return nil
}

func appendChildSessions(ctx context.Context, manager *session.Manager, parents []*session.Session) ([]*session.Session, error) {
	if len(parents) == 0 {
		return parents, nil
	}
	out := make([]*session.Session, 0, len(parents))
	for _, parent := range parents {
		if parent == nil {
			continue
		}
		out = append(out, parent)
		children, err := manager.List(ctx, session.ListOptions{ParentSessionKey: parent.Key})
		if err != nil {
			return nil, err
		}
		out = append(out, children...)
	}
	return out, nil
}

func (s *Service) SearchSessions(ctx context.Context, in SearchSessionsInput) (SearchSessionsOutput, error) {
	if err := s.ensureRegistry(); err != nil {
		return SearchSessionsOutput{}, err
	}
	if in.MultiRoot {
		return s.searchMultiRootSessions(ctx, in)
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return SearchSessionsOutput{}, err
	}
	items, err := manager.Search(ctx, session.SearchOptions{
		Query: in.Query,
		Limit: in.Limit,
	})
	if err != nil {
		return SearchSessionsOutput{}, err
	}
	return SearchSessionsOutput{Items: mapSessionSearchHits(in.RootID, items)}, nil
}

func (s *Service) searchMultiRootSessions(ctx context.Context, in SearchSessionsInput) (SearchSessionsOutput, error) {
	limit := normalizeSessionSearchLimit(in.Limit)
	items := make([]SessionSearchHit, 0, limit)
	for _, root := range s.Registry.ListRoots() {
		manager, err := s.Registry.GetSessionManager(root.ID)
		if err != nil {
			return SearchSessionsOutput{}, err
		}
		hits, err := manager.Search(ctx, session.SearchOptions{
			Query: in.Query,
			Limit: limit,
		})
		if err != nil {
			return SearchSessionsOutput{}, err
		}
		items = append(items, mapSessionSearchHits(root.ID, hits)...)
	}
	sortSessionSearchHits(items)
	if len(items) > limit {
		items = items[:limit]
	}
	return SearchSessionsOutput{Items: items}, nil
}

func mapSessionSearchHits(rootID string, hits []session.SearchHit) []SessionSearchHit {
	out := make([]SessionSearchHit, 0, len(hits))
	for _, hit := range hits {
		out = append(out, SessionSearchHit{
			RootID:           strings.TrimSpace(rootID),
			Key:              hit.Key,
			Type:             hit.Type,
			ParentSessionKey: hit.ParentSessionKey,
			ParentToolCallID: hit.ParentToolCallID,
			Agent:            hit.Agent,
			Model:            hit.Model,
			Shell:            hit.Shell,
			Name:             hit.Name,
			CreatedAt:        hit.CreatedAt,
			UpdatedAt:        hit.UpdatedAt,
			ClosedAt:         hit.ClosedAt,
			MatchType:        hit.MatchType,
			MatchScore:       hit.MatchScore,
			Seq:              hit.Seq,
			Snippet:          hit.Snippet,
		})
	}
	return out
}

func normalizeSessionSearchLimit(limit int) int {
	switch {
	case limit <= 0:
		return 20
	case limit > 50:
		return 50
	default:
		return limit
	}
}

func sortSessionSearchHits(items []SessionSearchHit) {
	sort.SliceStable(items, func(i, j int) bool {
		left := items[i]
		right := items[j]
		if left.MatchType != right.MatchType {
			return sessionSearchMatchTypeRank(left.MatchType) < sessionSearchMatchTypeRank(right.MatchType)
		}
		if left.MatchScore != right.MatchScore {
			return left.MatchScore > right.MatchScore
		}
		if !left.UpdatedAt.Equal(right.UpdatedAt) {
			return left.UpdatedAt.After(right.UpdatedAt)
		}
		if left.RootID != right.RootID {
			return left.RootID < right.RootID
		}
		return left.Key < right.Key
	})
}

func sessionSearchMatchTypeRank(matchType string) int {
	switch strings.TrimSpace(matchType) {
	case "name":
		return 0
	case "user":
		return 1
	case "reply":
		return 2
	default:
		return 3
	}
}

type GetSessionInput struct {
	RootID string
	Key    string
	Seq    int
}

func (s *Service) GetSession(ctx context.Context, in GetSessionInput) (*session.Session, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	return manager.Get(ctx, in.Key, in.Seq)
}

type GetSessionExchangeAuxInput struct {
	RootID string
	Key    string
	Seq    int
}

type SessionLogPath struct {
	Path           string
	AgentSessionID string
}

func (s *Service) GetSessionLogPath(ctx context.Context, in GetSessionInput) (SessionLogPath, error) {
	if err := s.ensureRegistry(); err != nil {
		return SessionLogPath{}, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return SessionLogPath{}, err
	}
	current, err := manager.Get(ctx, in.Key, 0)
	if err != nil {
		return SessionLogPath{}, err
	}
	path := manager.ExchangeLogAbsolutePath(in.Key)
	if path == "" {
		return SessionLogPath{}, errors.New("session log path unavailable")
	}
	out := SessionLogPath{Path: path}
	agentName := strings.TrimSpace(session.InferAgentFromSession(current))
	if agentName != "" {
		binding, err := manager.FindAgentBinding(ctx, in.Key, agentName)
		if err != nil {
			return SessionLogPath{}, fmt.Errorf("read session agent binding: %w", err)
		} else if binding != nil {
			out.AgentSessionID = strings.TrimSpace(binding.AgentSessionID)
		}
	}
	return out, nil
}

func (s *Service) GetSessionExchangeAux(ctx context.Context, in GetSessionExchangeAuxInput) (map[int][]session.ExchangeAux, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	return manager.GetExchangeAux(ctx, in.Key, in.Seq)
}

type GetSessionToolCallInput struct {
	RootID string
	Key    string
	CallID string
}

func (s *Service) GetSessionToolCall(ctx context.Context, in GetSessionToolCallInput) (*agenttypes.ToolCall, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	return manager.GetFullToolCall(ctx, in.Key, in.CallID)
}

type GetSessionContextWindowInput struct {
	RootID string
	Key    string
}

func (s *Service) GetSessionContextWindow(ctx context.Context, in GetSessionContextWindowInput) (agenttypes.ContextWindow, error) {
	if err := s.ensureRegistry(); err != nil {
		return agenttypes.ContextWindow{}, err
	}
	if strings.TrimSpace(in.Key) == "" {
		return agenttypes.ContextWindow{}, errors.New("session key required")
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return agenttypes.ContextWindow{}, err
	}
	current, err := manager.Get(ctx, in.Key, 0)
	if err != nil {
		return agenttypes.ContextWindow{}, err
	}
	pool := s.Registry.GetAgentPool()
	if pool == nil {
		return current.LastContextWindow, nil
	}
	agentName := strings.TrimSpace(session.InferAgentFromSession(current))
	if agentName == "" {
		return current.LastContextWindow, nil
	}
	sess, ok := pool.Get(agentPoolSessionKey(in.Key, agentName))
	if !ok || sess == nil {
		return current.LastContextWindow, nil
	}
	contextWindow, err := sess.ContextWindow(ctx)
	if err != nil {
		return agenttypes.ContextWindow{}, err
	}
	if contextWindow.TotalTokens <= 0 || contextWindow.ModelContextWindow <= 0 {
		return current.LastContextWindow, nil
	}
	return contextWindow, nil
}

type GetSessionRelatedFilesInput struct {
	RootID string
	Key    string
}

func (s *Service) GetSessionRelatedFiles(ctx context.Context, in GetSessionRelatedFilesInput) ([]session.RelatedFile, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	current, err := manager.Get(ctx, in.Key, 0)
	if err != nil {
		return nil, err
	}
	return normalizeSessionRelatedFiles(ctx, manager.Root(), current.RelatedFiles), nil
}

func normalizeSessionRelatedFiles(ctx context.Context, root fs.RootInfo, files []session.RelatedFile) []session.RelatedFile {
	next := append([]session.RelatedFile(nil), files...)
	rootPath := strings.TrimSpace(root.RootPath)
	if rootPath == "" {
		return next
	}
	for i := range next {
		file := &next[i]
		if !strings.HasPrefix(filepath.ToSlash(strings.TrimSpace(file.Path)), ".worktree/task-") {
			continue
		}
		repoPath := strings.TrimSpace(file.RepoPath)
		if repoPath != "" && !sameManagedDirPath(repoPath, rootPath) {
			continue
		}
		resolvedRepoPath, resolvedPath, resolvedHead, ok := resolveTaskWorktreeRelatedFile(ctx, rootPath, file.Path)
		if !ok {
			continue
		}
		file.RootID = strings.TrimSpace(file.RootID)
		file.RepoKind = "git"
		file.RepoPath = resolvedRepoPath
		file.RepoName = filepath.Base(resolvedRepoPath)
		file.Path = resolvedPath
		if file.Head == "" {
			file.Head = resolvedHead
		}
	}
	return next
}

type RemoveSessionRelatedFileInput struct {
	RootID   string
	Key      string
	Path     string
	Head     string
	RepoPath string
	RepoKind string
}

func (s *Service) RemoveSessionRelatedFile(ctx context.Context, in RemoveSessionRelatedFileInput) error {
	if err := s.ensureRegistry(); err != nil {
		return err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return err
	}
	if err := manager.RemoveRelatedFileAtHead(ctx, in.Key, in.Path, in.Head, in.RepoPath, in.RepoKind); err != nil {
		return err
	}
	root := manager.Root()
	if legacyPath, ok := legacyTaskWorktreeRelatedPath(root.RootPath, in.RepoPath, in.Path); ok {
		return manager.RemoveRelatedFileAtHead(ctx, in.Key, legacyPath, in.Head, root.RootPath, in.RepoKind)
	}
	return nil
}

func legacyTaskWorktreeRelatedPath(rootPath, repoPath, path string) (string, bool) {
	rootPath = strings.TrimSpace(rootPath)
	repoPath = strings.TrimSpace(repoPath)
	path = strings.TrimSpace(path)
	if rootPath == "" || repoPath == "" || path == "" || sameManagedDirPath(rootPath, repoPath) {
		return "", false
	}
	absPath := filepath.Clean(filepath.Join(repoPath, filepath.FromSlash(filepath.ToSlash(path))))
	rel, err := filepath.Rel(filepath.Clean(rootPath), absPath)
	if err != nil || rel == "." || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	if !strings.HasPrefix(rel, ".worktree/task-") {
		return "", false
	}
	return rel, true
}
