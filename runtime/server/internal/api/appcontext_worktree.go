package api

import (
	"context"
	"errors"
	"fmt"
	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/gitview"
	"mindfs/server/internal/kanban"
	"mindfs/server/internal/session"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func (s *AppContext) CreateSessionWorktree(ctx context.Context, rootID, branchMode, branch string) (kanban.WorktreeInfo, error) {
	root, err := s.GetRoot(rootID)
	if err != nil {
		return kanban.WorktreeInfo{}, err
	}
	s.sessionWorktreeMu.Lock()
	defer s.sessionWorktreeMu.Unlock()

	names := make([]string, 0, 16)
	worktreeParent := filepath.Join(root.RootPath, ".worktree")
	if entries, readErr := os.ReadDir(worktreeParent); readErr == nil {
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
	} else if !os.IsNotExist(readErr) {
		return kanban.WorktreeInfo{}, readErr
	}
	branches, err := gitview.ListBranches(ctx, root.RootPath)
	if err != nil {
		return kanban.WorktreeInfo{}, err
	}
	for _, item := range branches.Branches {
		names = append(names, item.Name)
	}
	name := nextSessionWorktreeName(time.Now(), names)
	return s.CreateTaskWorktree(ctx, rootID, name, branchMode, branch)
}

func nextSessionWorktreeName(now time.Time, existingNames []string) string {
	prefix := "session-" + now.Format("0102") + "-"
	maxSequence := 0
	for _, name := range existingNames {
		name = strings.TrimSpace(name)
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		suffix := strings.TrimPrefix(name, prefix)
		sequence, err := strconv.Atoi(suffix)
		if err == nil && sequence > maxSequence {
			maxSequence = sequence
		}
	}
	return fmt.Sprintf("%s%02d", prefix, maxSequence+1)
}

func ensureTaskWorktreeExcluded(rootPath string) error {
	gitDir := filepath.Join(rootPath, ".git")
	if info, err := os.Stat(gitDir); err != nil || !info.IsDir() {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	gitInfoDir := filepath.Join(gitDir, "info")
	if err := os.MkdirAll(gitInfoDir, 0o755); err != nil {
		return err
	}
	excludePath := filepath.Join(gitInfoDir, "exclude")
	const entry = "/.worktree/"
	if data, err := os.ReadFile(excludePath); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.TrimSpace(line) == entry {
				return nil
			}
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	file, err := os.OpenFile(excludePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	if stat, err := file.Stat(); err == nil && stat.Size() > 0 {
		if _, err := file.WriteString("\n"); err != nil {
			return err
		}
	}
	_, err = file.WriteString(entry + "\n")
	return err
}

func (s *AppContext) EnsureAgentSession(ctx context.Context, exec kanban.AgentStageExecution) (string, error) {
	if strings.TrimSpace(exec.RootID) == "" {
		return "", errors.New("root_id required")
	}
	if strings.TrimSpace(exec.Run.SessionKey) != "" && exec.Stage.SessionReusePolicy != kanban.SessionReuseAlwaysNew {
		return strings.TrimSpace(exec.Run.SessionKey), nil
	}
	uc := &usecase.Service{Registry: s}
	switch strings.TrimSpace(exec.Stage.SessionReusePolicy) {
	case kanban.SessionReuseTaskMain, "":
		if strings.TrimSpace(exec.Task.MainSessionKey) != "" {
			return strings.TrimSpace(exec.Task.MainSessionKey), nil
		}
	case kanban.SessionReuseSameStage:
		if strings.TrimSpace(exec.Run.SessionKey) != "" {
			return strings.TrimSpace(exec.Run.SessionKey), nil
		}
	}
	name := strings.TrimSpace(exec.Task.TaskTemplateName)
	if exec.Task.TaskNumber > 0 {
		number := "#" + strconv.Itoa(exec.Task.TaskNumber)
		if name == "" {
			name = number
		} else {
			name = name + " / " + number
		}
	}
	if strings.TrimSpace(name) == "" {
		name = usecase.BuildFallbackSessionName(exec.Prompt)
	}
	created, err := uc.CreateSession(ctx, usecase.CreateSessionInput{
		RootID: exec.RootID,
		Input: session.CreateInput{
			Type:     session.TypeChat,
			Agent:    exec.Stage.Agent,
			Model:    exec.Stage.Model,
			PlanMode: exec.Stage.PlanMode,
			Name:     name,
			TaskID:   exec.Task.ID,
		},
	})
	if err != nil {
		return "", err
	}
	s.BroadcastSessionMetaUpdated(exec.RootID, created)
	return created.Key, nil
}

func cleanToolFilePath(path string) string {
	path = strings.TrimSpace(strings.SplitN(path, "#", 2)[0])
	if path == "" {
		return ""
	}
	return filepath.Clean(path)
}

func pathInsideDir(path, dir string) bool {
	path = filepath.Clean(path)
	dir = filepath.Clean(strings.TrimSpace(dir))
	if resolvedPath, err := filepath.EvalSymlinks(path); err == nil {
		path = filepath.Clean(resolvedPath)
	}
	if resolvedDir, err := filepath.EvalSymlinks(dir); err == nil {
		dir = filepath.Clean(resolvedDir)
	}
	if path == "" || dir == "" {
		return false
	}
	if path == dir {
		return true
	}
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		return false
	}
	return rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (s *AppContext) ReleaseFileWatcher(rootID, sessionKey string) {
	rootCtx, err := s.GetRootContext(rootID)
	if err != nil {
		return
	}

	s.mu.Lock()
	watcher := rootCtx.Watcher
	s.mu.Unlock()
	if watcher == nil {
		return
	}

	watcher.UnregisterSession(sessionKey)
	if watcher.SessionCount() > 0 {
		return
	}

	s.mu.Lock()
	if rootCtx.Watcher == watcher {
		rootCtx.Watcher = nil
	}
	s.mu.Unlock()
	watcher.Close()
}
