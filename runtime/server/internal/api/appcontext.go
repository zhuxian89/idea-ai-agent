package api

import (
	"context"
	"errors"
	"log"
	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/barknotify"
	"mindfs/server/internal/collab"
	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/githubimport"
	"mindfs/server/internal/gitview"
	"mindfs/server/internal/kanban"
	"mindfs/server/internal/notifyscript"
	"mindfs/server/internal/preferences"
	"mindfs/server/internal/relay"
	"mindfs/server/internal/scheduled"
	"mindfs/server/internal/session"
	"mindfs/server/internal/update"
	"mindfs/server/internal/webpush"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type RootContext struct {
	Root    fs.RootInfo
	Session *session.Manager
	Collab  *collab.Store
	Watcher *fs.SharedFileWatcher
}

var ErrProjectLocked = errors.New("project registration is controlled by IDEA")

type AppContext struct {
	// Set by the IDE host before any session or scheduler starts.
	ProjectLocked bool
	Dirs          *fs.Registry
	Agents        *agent.Pool
	Prober        *agent.Prober
	Relay         *relay.Manager
	RelayTips     *relay.TipsService
	Update        *update.Service
	GitHub        *githubimport.Service
	E2EE          *e2ee.Manager
	WebPush       *webpush.Service
	Notify        *notifyscript.Service
	Bark          *barknotify.Service
	Prefs         *preferences.Store
	Scheduled     *scheduled.Service
	Kanban        *kanban.Service
	Collab        *collab.Service

	mu                       sync.RWMutex
	sessionWorktreeMu        sync.Mutex
	roots                    map[string]*RootContext // root id -> root context
	fileChangeListeners      []func(fs.FileChangeEvent)
	fileChangeBatchListeners []func(fs.FileChangeBatchEvent)
	relatedFileListeners     []func(fs.RelatedFileEvent)
	streamHub                *StreamHub
	candidateRegistry        *usecase.CandidateRegistry
	externalImporters        map[string]agenttypes.ExternalSessionImporter

	failureMu       sync.Mutex
	sessionFailures map[string]sessionFailure
}

func (s *AppContext) GetRootContext(rootID string) (*RootContext, error) {
	if rootID == "" {
		return nil, errors.New("root id required")
	}
	if s.Dirs == nil {
		return nil, errors.New("registry not configured")
	}
	root, ok := s.Dirs.Get(rootID)
	if !ok {
		return nil, errors.New("root not found")
	}
	if root.ID == "" {
		return nil, errors.New("invalid root")
	}
	exists, err := managedRootExists(root)
	if err != nil {
		return nil, err
	}
	if !exists {
		s.removeMissingRoot(root)
		return nil, errors.New("root not found")
	}

	s.mu.RLock()
	if ctx, ok := s.roots[root.ID]; ok {
		s.mu.RUnlock()
		return ctx, nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.roots == nil {
		s.roots = make(map[string]*RootContext)
	}
	if ctx, ok := s.roots[root.ID]; ok {
		return ctx, nil
	}
	ctx := &RootContext{Root: root}
	s.roots[root.ID] = ctx
	return ctx, nil
}

func (s *AppContext) GetRoot(rootID string) (fs.RootInfo, error) {
	rootCtx, err := s.GetRootContext(rootID)
	if err != nil {
		return fs.RootInfo{}, err
	}
	return rootCtx.Root, nil
}

func (s *AppContext) GetSessionManager(rootID string) (*session.Manager, error) {
	rootCtx, err := s.GetRootContext(rootID)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if rootCtx.Session != nil {
		return rootCtx.Session, nil
	}
	mgr := session.NewManager(rootCtx.Root)
	rootCtx.Session = mgr

	return mgr, nil
}

func (s *AppContext) GetKanbanService() (*kanban.Service, error) {
	if s == nil {
		return nil, errors.New("app context required")
	}
	s.mu.RLock()
	service := s.Kanban
	s.mu.RUnlock()
	if service == nil {
		return nil, errors.New("kanban service not configured")
	}
	return service, nil
}

func (s *AppContext) CreateTaskWorktree(ctx context.Context, rootID, name, branchMode, branch string) (kanban.WorktreeInfo, error) {
	root, err := s.GetRoot(rootID)
	if err != nil {
		return kanban.WorktreeInfo{}, err
	}
	branchMode = strings.TrimSpace(branchMode)
	if branchMode == "" {
		branchMode = "new"
	}
	parentPath := filepath.Join(root.RootPath, ".worktree")
	if err := os.MkdirAll(parentPath, 0o755); err != nil {
		return kanban.WorktreeInfo{}, err
	}
	if err := ensureTaskWorktreeExcluded(root.RootPath); err != nil {
		log.Printf("[kanban] worktree.exclude.error root=%s err=%v", root.RootPath, err)
	}
	uc := &usecase.Service{Registry: s}
	out, err := uc.CreateGitWorktree(ctx, usecase.CreateGitWorktreeInput{
		RootID:     rootID,
		ParentPath: parentPath,
		Name:       name,
		BranchMode: branchMode,
		Branch:     branch,
		Register:   false,
	})
	if err != nil {
		return kanban.WorktreeInfo{}, err
	}
	return kanban.WorktreeInfo{RootID: rootID, Path: out.Dir.RootPath}, nil
}

func (s *AppContext) RunAgentStage(ctx context.Context, exec kanban.AgentStageExecution) error {
	if strings.TrimSpace(exec.RootID) == "" {
		return errors.New("root_id required")
	}
	if strings.TrimSpace(exec.Run.SessionKey) == "" {
		return errors.New("session_key required")
	}
	if strings.TrimSpace(exec.Prompt) == "" {
		return errors.New("agent prompt required")
	}
	uc := &usecase.Service{Registry: s}
	sessionKey := strings.TrimSpace(exec.Run.SessionKey)
	sessionName := s.sessionTitle(exec.RootID, sessionKey)
	updateTracker := newTurnUpdateTracker()
	planMode := exec.Stage.PlanMode
	userTimestamp := time.Now().UTC()
	err := uc.SendMessage(ctx, usecase.SendMessageInput{
		RootID:          exec.RootID,
		RuntimeRootPath: exec.RuntimeRootPath,
		Key:             sessionKey,
		Agent:           exec.Stage.Agent,
		Model:           exec.Stage.Model,
		Mode:            exec.Stage.Mode,
		Effort:          exec.Stage.Effort,
		FastService:     normalizeFastServiceValue(exec.Stage.FastService),
		PlanMode:        &planMode,
		Content:         exec.Prompt,
		UserTimestamp:   userTimestamp,
		OnStart: func(start usecase.MessageStart) {
			s.BroadcastSessionUserMessageAt(exec.RootID, sessionKey, session.TypeChat, sessionName, exec.Stage.Agent, start.Model, start.Mode, start.Effort, start.FastService, planMode, exec.Prompt, userTimestamp, start.BaseExchangeSeq)
		},
		OnUpdate: func(update agenttypes.Event) {
			updateTracker.Begin()
			defer updateTracker.End()
			s.BroadcastSessionUpdate(exec.RootID, sessionKey, update)
		},
		OnAgentDefaultsChanged: func(agentName string) {
			s.BroadcastAgentStatusChanged(agentName)
		},
		OnSubSessionCreated: func(created *session.Session) {
			s.BroadcastSessionMetaUpdated(exec.RootID, created)
			if created != nil {
				s.SetSessionPendingReply(exec.RootID, created.Key, created.Name)
			}
		},
		OnSubSessionUpdate: func(sessionKey string, update agenttypes.Event) {
			updateTracker.Begin()
			defer updateTracker.End()
			s.BroadcastSessionUpdate(exec.RootID, sessionKey, update)
			if update.Type == agenttypes.EventTypeMessageDone {
				s.BroadcastSessionDone(exec.RootID, sessionKey, "")
			}
		},
	})
	if err != nil {
		s.BroadcastSessionError(exec.RootID, sessionKey, err.Error())
	}
	if ok := updateTracker.WaitIdle(ctx, sessionDoneSettleWindow, sessionDoneMaxWait); !ok {
		log.Printf("[kanban] session.done.wait_timeout root=%s session=%s task=%s", exec.RootID, sessionKey, exec.Task.ID)
	}
	s.BroadcastSessionDone(exec.RootID, sessionKey, "")
	return err
}

func (s *AppContext) TaskUpdated(rootID string, detail kanban.TaskDetail) {
	s.GetSessionStreamHub().BroadcastAll(WSResponse{
		Type: "task.updated",
		Payload: map[string]any{
			"root_id": rootID,
			"task":    detail.Task,
			"detail":  detail,
		},
	})
}

func (s *AppContext) GetFileWatcher(rootID string, manager *session.Manager) (*fs.SharedFileWatcher, error) {
	rootCtx, err := s.GetRootContext(rootID)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if rootCtx.Watcher != nil {
		return rootCtx.Watcher, nil
	}
	watcher, err := fs.NewSharedFileWatcher(rootCtx.Root, manager, resolveRelatedWorktree)
	if err != nil {
		return nil, err
	}
	watcher.SetOnFileChange(s.emitFileChange)
	watcher.SetOnFileChangeBatch(s.emitFileChangeBatch)
	watcher.SetOnRelatedFile(s.emitRelatedFile)
	rootCtx.Watcher = watcher
	return watcher, nil
}

func resolveRelatedWorktree(ctx context.Context, root fs.RootInfo, filePath string) (fs.RelatedWorktreeMatch, bool) {
	cleanPath := cleanToolFilePath(filePath)
	if cleanPath == "" {
		return fs.RelatedWorktreeMatch{}, false
	}
	if !filepath.IsAbs(cleanPath) {
		cleanPath = filepath.Join(root.RootPath, cleanPath)
	}
	cleanPath = filepath.Clean(cleanPath)
	worktrees, err := gitview.ListWorktrees(ctx, root.RootPath)
	if err != nil {
		return fs.RelatedWorktreeMatch{}, false
	}
	var best fs.RelatedWorktreeMatch
	bestPathLen := -1
	for _, item := range worktrees.Items {
		if !pathInsideDir(cleanPath, item.Path) {
			continue
		}
		candidate := fs.RelatedWorktreeMatch{
			Path:    item.Path,
			Branch:  item.Branch,
			Head:    item.Head,
			Current: item.Current,
		}
		pathLen := len(filepath.Clean(item.Path))
		if pathLen > bestPathLen {
			best = candidate
			bestPathLen = pathLen
		}
	}
	if bestPathLen >= 0 {
		return best, true
	}
	if repo, err := gitview.ResolveRepositoryForPath(ctx, cleanPath); err == nil && strings.TrimSpace(repo.Path) != "" {
		return fs.RelatedWorktreeMatch{
			Path:    filepath.Clean(repo.Path),
			Head:    strings.TrimSpace(repo.Head),
			Current: pathInsideDir(cleanPath, root.RootPath),
		}, true
	}
	return fs.RelatedWorktreeMatch{}, false
}

func (s *AppContext) GetAgentPool() *agent.Pool {
	return s.Agents
}

func (s *AppContext) GetPreferences() *preferences.Store {
	return s.Prefs
}

func (s *AppContext) GetExternalSessionImporter(agentName string) (agenttypes.ExternalSessionImporter, error) {
	if s.Agents == nil {
		return nil, errors.New("agent pool not configured")
	}
	trimmed := strings.TrimSpace(agentName)
	if trimmed == "" {
		return nil, errors.New("agent required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.externalImporters == nil {
		s.externalImporters = make(map[string]agenttypes.ExternalSessionImporter)
	}
	if importer, ok := s.externalImporters[trimmed]; ok && importer != nil {
		return importer, nil
	}
	def, ok := s.Agents.Config().GetAgent(trimmed)
	if !ok {
		return nil, errors.New("agent not configured: " + trimmed)
	}
	importer, err := agent.NewExternalSessionImporter(def)
	if err != nil {
		return nil, err
	}
	s.externalImporters[trimmed] = importer
	return importer, nil
}

func (s *AppContext) GetProber() *agent.Prober {
	return s.Prober
}

func (s *AppContext) GetDirRegistry() *fs.Registry {
	return s.Dirs
}

func (s *AppContext) GetRelayManager() *relay.Manager {
	return s.Relay
}

func (s *AppContext) GetRelayTipsService() *relay.TipsService {
	return s.RelayTips
}

func (s *AppContext) GetUpdateService() *update.Service {
	return s.Update
}

func (s *AppContext) GetWebPushService() *webpush.Service {
	return s.WebPush
}

func (s *AppContext) GetGitHubImportService() *githubimport.Service {
	return s.GitHub
}

func (s *AppContext) GetE2EEManager() *e2ee.Manager {
	return s.E2EE
}

func (s *AppContext) UpsertRoot(path string) (fs.RootInfo, error) {
	return s.UpsertRootWithMetaLocation(path, fs.MetaLocationProject)
}

func (s *AppContext) UpsertRootWithMetaLocation(path, metaLocation string) (fs.RootInfo, error) {
	if s.ProjectLocked {
		return fs.RootInfo{}, ErrProjectLocked
	}
	if s.Dirs == nil {
		return fs.RootInfo{}, errors.New("registry not configured")
	}
	dir, err := s.Dirs.UpsertWithMetaLocation(path, metaLocation)
	if err == nil && s.Scheduled != nil {
		if reloadErr := s.Scheduled.ReloadRoot(dir.ID); reloadErr != nil {
			log.Printf("[scheduled-agent] reload.error root=%s err=%v", dir.ID, reloadErr)
		}
	}
	return dir, err
}

func (s *AppContext) RemoveRoot(path string) (fs.RootInfo, error) {
	if s.ProjectLocked {
		return fs.RootInfo{}, ErrProjectLocked
	}
	if s.Dirs == nil {
		return fs.RootInfo{}, errors.New("registry not configured")
	}
	dir, err := s.Dirs.Remove(path)
	if err != nil {
		return fs.RootInfo{}, err
	}
	s.mu.Lock()
	rootCtx := s.roots[dir.ID]
	delete(s.roots, dir.ID)
	s.mu.Unlock()
	if rootCtx != nil && rootCtx.Watcher != nil {
		rootCtx.Watcher.Close()
	}
	if rootCtx != nil && rootCtx.Session != nil {
		_ = rootCtx.Session.Shutdown()
	}
	if s.Scheduled != nil {
		s.Scheduled.RemoveRoot(dir.ID)
	}
	return dir, nil
}

func (s *AppContext) ReleaseRootResources(rootID string) {
	rootID = strings.TrimSpace(rootID)
	if rootID == "" {
		return
	}
	s.mu.Lock()
	rootCtx := s.roots[rootID]
	delete(s.roots, rootID)
	s.mu.Unlock()
	if rootCtx == nil {
		return
	}
	if rootCtx.Watcher != nil {
		rootCtx.Watcher.Close()
	}
	if rootCtx.Session != nil {
		_ = rootCtx.Session.Shutdown()
	}
}

func (s *AppContext) RenameRoot(rootID, name, rootPath string) (fs.RootInfo, error) {
	if s.ProjectLocked {
		return fs.RootInfo{}, ErrProjectLocked
	}
	if s.Dirs == nil {
		return fs.RootInfo{}, errors.New("registry not configured")
	}
	dir, err := s.Dirs.Rename(rootID, name, rootPath)
	if err != nil {
		return fs.RootInfo{}, err
	}
	s.ReleaseRootResources(rootID)
	if s.Scheduled != nil {
		if reloadErr := s.Scheduled.ReloadRoot(dir.ID); reloadErr != nil {
			log.Printf("[scheduled-agent] reload.error root=%s err=%v", dir.ID, reloadErr)
		}
	}
	return dir, nil
}

func (s *AppContext) ListRoots() []fs.RootInfo {
	if s.Dirs == nil {
		return []fs.RootInfo{}
	}
	roots := s.Dirs.List()
	active := make([]fs.RootInfo, 0, len(roots))
	for _, root := range roots {
		exists, err := managedRootExists(root)
		if err != nil {
			log.Printf("[registry] stat.root.error root=%s path=%s err=%v", root.ID, root.RootPath, err)
			active = append(active, root)
			continue
		}
		if exists {
			active = append(active, root)
			continue
		}
		s.removeMissingRoot(root)
	}
	return active
}

func managedRootExists(root fs.RootInfo) (bool, error) {
	path := strings.TrimSpace(root.RootPath)
	if path == "" {
		return false, nil
	}
	info, err := os.Stat(filepath.Clean(path))
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return info.IsDir(), nil
}

func (s *AppContext) removeMissingRoot(root fs.RootInfo) {
	if s == nil || s.Dirs == nil {
		return
	}
	dir, err := s.RemoveRoot(root.RootPath)
	if err != nil {
		log.Printf("[registry] remove.missing_root.error root=%s path=%s err=%v", root.ID, root.RootPath, err)
		s.ReleaseRootResources(root.ID)
		return
	}
	log.Printf("[registry] remove.missing_root root=%s path=%s", dir.ID, dir.RootPath)
}

func (s *AppContext) AddFileChangeListener(listener func(fs.FileChangeEvent)) {
	if listener == nil {
		return
	}
	s.mu.Lock()
	s.fileChangeListeners = append(s.fileChangeListeners, listener)
	s.mu.Unlock()
}

func (s *AppContext) AddFileChangeBatchListener(listener func(fs.FileChangeBatchEvent)) {
	if listener == nil {
		return
	}
	s.mu.Lock()
	s.fileChangeBatchListeners = append(s.fileChangeBatchListeners, listener)
	s.mu.Unlock()
}

func (s *AppContext) AddRelatedFileListener(listener func(fs.RelatedFileEvent)) {
	if listener == nil {
		return
	}
	s.mu.Lock()
	s.relatedFileListeners = append(s.relatedFileListeners, listener)
	s.mu.Unlock()
}

func (s *AppContext) emitFileChange(change fs.FileChangeEvent) {
	s.mu.RLock()
	listeners := append([]func(fs.FileChangeEvent){}, s.fileChangeListeners...)
	s.mu.RUnlock()
	for _, listener := range listeners {
		listener(change)
	}
}

func (s *AppContext) emitFileChangeBatch(change fs.FileChangeBatchEvent) {
	s.mu.RLock()
	listeners := append([]func(fs.FileChangeBatchEvent){}, s.fileChangeBatchListeners...)
	s.mu.RUnlock()
	for _, listener := range listeners {
		listener(change)
	}
}

func (s *AppContext) emitRelatedFile(change fs.RelatedFileEvent) {
	s.mu.RLock()
	listeners := append([]func(fs.RelatedFileEvent){}, s.relatedFileListeners...)
	s.mu.RUnlock()
	for _, listener := range listeners {
		listener(change)
	}
}

func (s *AppContext) GetSessionStreamHub() *StreamHub {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.streamHub == nil {
		s.streamHub = NewStreamHub(s.E2EE)
	}
	return s.streamHub
}
