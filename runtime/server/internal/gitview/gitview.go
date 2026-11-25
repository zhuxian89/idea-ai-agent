package gitview

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log"
	"mindfs/server/internal/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type StatusItem struct {
	Path      string `json:"path"`
	OldPath   string `json:"old_path,omitempty"`
	Status    string `json:"status"`
	Staged    bool   `json:"staged,omitempty"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	IsDir     bool   `json:"is_dir,omitempty"`
}

type StatusResult struct {
	Available  bool         `json:"available"`
	Branch     string       `json:"branch,omitempty"`
	DirtyCount int          `json:"dirty_count"`
	Items      []StatusItem `json:"items"`
}

type BranchItem struct {
	Name    string `json:"name"`
	Current bool   `json:"current"`
}

type BranchListResult struct {
	Current  string       `json:"current,omitempty"`
	Branches []BranchItem `json:"branches"`
}

type WorktreeItem struct {
	Path    string `json:"path"`
	Branch  string `json:"branch,omitempty"`
	Head    string `json:"head,omitempty"`
	Current bool   `json:"current"`
}

type WorktreeListResult struct {
	Items []WorktreeItem `json:"items"`
}

type RepositoryInfo struct {
	Path string `json:"path"`
	Head string `json:"head,omitempty"`
}

type DiffResult struct {
	Path      string             `json:"path"`
	OldPath   string             `json:"old_path,omitempty"`
	Status    string             `json:"status"`
	Additions int                `json:"additions"`
	Deletions int                `json:"deletions"`
	Content   string             `json:"content"`
	FileMeta  []fs.FileMetaEntry `json:"file_meta,omitempty"`
}

type RelatedFileDiffResult struct {
	DiffResult
	BaseHead   string `json:"base_head,omitempty"`
	TargetHead string `json:"target_head,omitempty"`
	Source     string `json:"source,omitempty"`
}

type FileCompareSide struct {
	Present bool
	Binary  bool
	Data    []byte
}

type FileCompareResult struct {
	Path     string
	Head     FileCompareSide
	Worktree FileCompareSide
}

const maxFileCompareBytes = 2 << 20

type HistoryItem struct {
	Hash       string `json:"hash"`
	Message    string `json:"message"`
	CommitTime string `json:"commit_time"`
	Remote     bool   `json:"remote"`
}

type HistoryResult struct {
	Available     bool          `json:"available"`
	Items         []HistoryItem `json:"items"`
	HasMore       bool          `json:"has_more"`
	CommitMissing bool          `json:"commit_missing,omitempty"`
	RemoteHead    string        `json:"remote_head,omitempty"`
}

type CommitFilesResult struct {
	Commit string       `json:"commit"`
	Items  []StatusItem `json:"items"`
}

type ActionResult struct {
	Output string       `json:"output"`
	Status StatusResult `json:"status"`
}

type repoContext struct {
	repoRoot string
	rootPath string
	prefix   string
	branch   string
}

func InspectStatus(ctx context.Context, rootPath string) (StatusResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return StatusResult{}, err
		}
		if isNotRepoError(err) {
			return StatusResult{Available: false, Items: []StatusItem{}}, nil
		}
		return StatusResult{}, err
	}
	items, err := repo.statusItems(ctx)
	if err != nil {
		return StatusResult{}, err
	}
	return StatusResult{
		Available:  true,
		Branch:     repo.branch,
		DirtyCount: len(items),
		Items:      items,
	}, nil
}

func HasRepo(ctx context.Context, rootPath string) (bool, error) {
	_, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return false, err
		}
		if isNotRepoError(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func IsWorktree(rootPath string) (bool, error) {
	gitPath := filepath.Join(filepath.Clean(rootPath), ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return info.Mode().IsRegular(), nil
}

func IsInsideWorktree(ctx context.Context, path string) (bool, error) {
	repo, err := loadRepoContext(ctx, path)
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return false, err
		}
		if isNotRepoError(err) {
			return false, nil
		}
		return false, err
	}
	return IsWorktree(repo.repoRoot)
}

func ListBranches(ctx context.Context, rootPath string) (BranchListResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return BranchListResult{}, err
	}
	output, err := runGit(ctx, repo.repoRoot, "for-each-ref", "--format=%(refname:short)", "refs/heads")
	if err != nil {
		return BranchListResult{}, err
	}
	seen := map[string]struct{}{}
	branches := make([]BranchItem, 0)
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		name := strings.TrimSpace(scanner.Text())
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		branches = append(branches, BranchItem{Name: name, Current: name == repo.branch})
	}
	if err := scanner.Err(); err != nil {
		return BranchListResult{}, err
	}
	return BranchListResult{Current: repo.branch, Branches: branches}, nil
}

func CheckoutBranch(ctx context.Context, rootPath, branch string) error {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return err
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return errors.New("branch required")
	}
	if strings.ContainsAny(branch, "\x00\r\n") {
		return errors.New("invalid branch")
	}
	found := false
	branches, err := ListBranches(ctx, rootPath)
	if err != nil {
		return err
	}
	for _, item := range branches.Branches {
		if item.Name == branch {
			found = true
			break
		}
	}
	if !found {
		return errors.New("branch not found")
	}
	_, err = runGit(ctx, repo.repoRoot, "checkout", branch)
	return err
}

func Pull(ctx context.Context, rootPath string) (ActionResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return ActionResult{}, err
	}
	output, err := runGit(ctx, repo.repoRoot, "pull", "--ff-only")
	if err != nil {
		return ActionResult{}, err
	}
	status, err := InspectStatus(ctx, rootPath)
	if err != nil {
		return ActionResult{}, err
	}
	return ActionResult{Output: strings.TrimSpace(output), Status: status}, nil
}

func Push(ctx context.Context, rootPath string) (ActionResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return ActionResult{}, err
	}
	output, err := runGit(ctx, repo.repoRoot, "push")
	if err != nil {
		return ActionResult{}, err
	}
	status, err := InspectStatus(ctx, rootPath)
	if err != nil {
		return ActionResult{}, err
	}
	return ActionResult{Output: strings.TrimSpace(output), Status: status}, nil
}

func Commit(ctx context.Context, rootPath, message string) (ActionResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return ActionResult{}, err
	}
	message = strings.TrimSpace(message)
	if message == "" {
		return ActionResult{}, errors.New("commit message required")
	}
	if strings.ContainsAny(message, "\x00\r\n") {
		return ActionResult{}, errors.New("invalid commit message")
	}
	output, err := runGit(ctx, repo.repoRoot, "commit", "-am", message)
	if err != nil {
		return ActionResult{}, err
	}
	status, err := InspectStatus(ctx, rootPath)
	if err != nil {
		return ActionResult{}, err
	}
	return ActionResult{Output: strings.TrimSpace(output), Status: status}, nil
}

func StagePath(ctx context.Context, rootPath, relPath string) (ActionResult, error) {
	repo, repoPath, err := resolveActionPath(ctx, rootPath, relPath)
	if err != nil {
		return ActionResult{}, err
	}
	output, err := runGit(ctx, repo.repoRoot, "add", "--", repoPath)
	if err != nil {
		return ActionResult{}, err
	}
	status, err := InspectStatus(ctx, rootPath)
	if err != nil {
		return ActionResult{}, err
	}
	return ActionResult{Output: strings.TrimSpace(output), Status: status}, nil
}

func UnstagePath(ctx context.Context, rootPath, relPath string) (ActionResult, error) {
	repo, repoPath, err := resolveActionPath(ctx, rootPath, relPath)
	if err != nil {
		return ActionResult{}, err
	}
	output, err := runGit(ctx, repo.repoRoot, "restore", "--staged", "--", repoPath)
	if err != nil {
		return ActionResult{}, err
	}
	status, err := InspectStatus(ctx, rootPath)
	if err != nil {
		return ActionResult{}, err
	}
	return ActionResult{Output: strings.TrimSpace(output), Status: status}, nil
}

func DiscardPath(ctx context.Context, rootPath, relPath, statusCode string) (ActionResult, error) {
	repo, repoPath, err := resolveActionPath(ctx, rootPath, relPath)
	if err != nil {
		return ActionResult{}, err
	}
	var output string
	if strings.TrimSpace(statusCode) == "??" {
		output, err = runGit(ctx, repo.repoRoot, "clean", "-fd", "--", repoPath)
	} else {
		output, err = runGit(ctx, repo.repoRoot, "restore", "--staged", "--worktree", "--", repoPath)
	}
	if err != nil {
		return ActionResult{}, err
	}
	status, err := InspectStatus(ctx, rootPath)
	if err != nil {
		return ActionResult{}, err
	}
	return ActionResult{Output: strings.TrimSpace(output), Status: status}, nil
}

func resolveActionPath(ctx context.Context, rootPath, relPath string) (repoContext, string, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return repoContext{}, "", err
	}
	relPath = strings.TrimSpace(filepath.ToSlash(relPath))
	if relPath == "" {
		return repoContext{}, "", errors.New("path required")
	}
	if strings.ContainsAny(relPath, "\x00\r\n") {
		return repoContext{}, "", errors.New("invalid path")
	}
	cleanPath := filepath.ToSlash(filepath.Clean(relPath))
	if cleanPath == "." || strings.HasPrefix(cleanPath, "../") || cleanPath == ".." {
		return repoContext{}, "", errors.New("invalid path")
	}
	return repo, repo.toRepoPath(cleanPath), nil
}

func ListWorktrees(ctx context.Context, rootPath string) (WorktreeListResult, error) {
	if _, err := loadRepoContext(ctx, rootPath); err != nil {
		return WorktreeListResult{}, err
	}
	output, err := runGit(ctx, rootPath, "worktree", "list", "--porcelain")
	if err != nil {
		return WorktreeListResult{}, err
	}
	currentRoot, err := filepath.Abs(rootPath)
	if err != nil {
		currentRoot = rootPath
	}
	currentRoot = filepath.Clean(currentRoot)

	var items []WorktreeItem
	var item WorktreeItem
	flush := func() {
		if strings.TrimSpace(item.Path) == "" {
			item = WorktreeItem{}
			return
		}
		cleanPath := filepath.Clean(item.Path)
		item.Path = cleanPath
		item.Current = cleanPath == currentRoot
		items = append(items, item)
		item = WorktreeItem{}
	}
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			flush()
			continue
		}
		key, value, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		switch key {
		case "worktree":
			if strings.TrimSpace(item.Path) != "" {
				flush()
			}
			item.Path = value
		case "HEAD":
			item.Head = value
		case "branch":
			item.Branch = strings.TrimPrefix(value, "refs/heads/")
		}
	}
	if err := scanner.Err(); err != nil {
		return WorktreeListResult{}, err
	}
	flush()
	return WorktreeListResult{Items: items}, nil
}

func ResolveRepositoryForPath(ctx context.Context, filePath string) (RepositoryInfo, error) {
	dir := nearestExistingDir(filePath)
	if dir == "" {
		return RepositoryInfo{}, errors.New("path required")
	}
	repoRootOutput, err := runGit(ctx, dir, "rev-parse", "--show-toplevel")
	if err != nil {
		return RepositoryInfo{}, err
	}
	repoRoot := strings.TrimSpace(repoRootOutput)
	if repoRoot == "" {
		return RepositoryInfo{}, errors.New("empty git repo root")
	}
	if resolvedRepoRoot, err := filepath.EvalSymlinks(repoRoot); err == nil {
		repoRoot = filepath.Clean(resolvedRepoRoot)
	} else {
		repoRoot = filepath.Clean(repoRoot)
	}
	headOutput, err := runGit(ctx, repoRoot, "rev-parse", "HEAD")
	if err != nil {
		headOutput = ""
	}
	return RepositoryInfo{
		Path: repoRoot,
		Head: strings.TrimSpace(headOutput),
	}, nil
}

func nearestExistingDir(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	path = filepath.Clean(path)
	if info, err := os.Stat(path); err == nil {
		if info.IsDir() {
			return path
		}
		return filepath.Dir(path)
	}
	dir := filepath.Dir(path)
	for dir != "" && dir != "." && dir != string(filepath.Separator) {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
		next := filepath.Dir(dir)
		if next == dir {
			break
		}
		dir = next
	}
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		return dir
	}
	return ""
}

func AddWorktree(ctx context.Context, rootPath, targetPath, branchMode, branch string) error {
	if _, err := loadRepoContext(ctx, rootPath); err != nil {
		return err
	}
	args := []string{"worktree", "add"}
	if branchMode == "new" {
		if strings.TrimSpace(branch) == "" {
			return errors.New("branch required")
		}
		args = append(args, "-b", branch)
	} else if strings.TrimSpace(branch) == "" {
		return errors.New("branch required")
	}
	args = append(args, targetPath)
	if branchMode != "new" && strings.TrimSpace(branch) != "" {
		args = append(args, branch)
	}
	_, err := runGit(ctx, rootPath, args...)
	return err
}

func RemoveWorktree(ctx context.Context, rootPath string) error {
	isWorktree, err := IsWorktree(rootPath)
	if err != nil {
		return err
	}
	if !isWorktree {
		return errors.New("current root is not a git worktree")
	}
	commonDir, err := runGit(ctx, rootPath, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return err
	}
	commonDir = strings.TrimSpace(commonDir)
	if commonDir == "" {
		return errors.New("empty git common dir")
	}
	cleanRoot := filepath.Clean(rootPath)
	cmd := newGitCommand(ctx, "--git-dir", commonDir, "worktree", "remove", cleanRoot)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[git] command.error dir=%q args=%q err=%v output=%q", "", cmd.Args[1:], err, logSnippet(string(output)))
		return fmt.Errorf("git %s failed: %w: %s", strings.Join(cmd.Args[1:], " "), err, logSnippet(string(output)))
	}
	return nil
}

func ReadDiff(ctx context.Context, rootPath, relPath string) (DiffResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return DiffResult{}, err
	}
	items, err := repo.statusItems(ctx)
	if err != nil {
		return DiffResult{}, err
	}
	var matched *StatusItem
	for i := range items {
		if items[i].Path == relPath {
			matched = &items[i]
			break
		}
	}
	if matched == nil {
		return DiffResult{}, errors.New("git diff not found for path")
	}
	content, err := repo.diffContent(ctx, *matched)
	if err != nil {
		return DiffResult{}, err
	}
	return DiffResult{
		Path:      matched.Path,
		Status:    matched.Status,
		Additions: matched.Additions,
		Deletions: matched.Deletions,
		Content:   content,
	}, nil
}

func ListHistory(ctx context.Context, rootPath string, limit int, beforeCommit, afterCommit string) (HistoryResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return HistoryResult{}, err
		}
		if isNotRepoError(err) {
			return HistoryResult{Available: false, Items: []HistoryItem{}}, nil
		}
		return HistoryResult{}, err
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	beforeCommit = strings.TrimSpace(beforeCommit)
	afterCommit = strings.TrimSpace(afterCommit)
	if beforeCommit != "" && !repo.commitExists(ctx, beforeCommit) {
		return HistoryResult{Available: true, Items: []HistoryItem{}, CommitMissing: true, RemoteHead: repo.remoteHistoryHead(ctx)}, nil
	}
	if afterCommit != "" && !repo.commitExists(ctx, afterCommit) {
		return HistoryResult{Available: true, Items: []HistoryItem{}, CommitMissing: true, RemoteHead: repo.remoteHistoryHead(ctx)}, nil
	}
	remoteHead := repo.remoteHistoryHead(ctx)

	args := []string{"log", "--format=%H%x00%s%x00%cI%x00", fmt.Sprintf("--max-count=%d", limit+1)}
	if afterCommit != "" {
		args = append(args, afterCommit+"..HEAD")
	} else if beforeCommit != "" {
		parents, err := repo.commitParents(ctx, beforeCommit)
		if err != nil {
			return HistoryResult{}, err
		}
		if len(parents) == 0 {
			return HistoryResult{Available: true, Items: []HistoryItem{}, HasMore: false, RemoteHead: remoteHead}, nil
		}
		args = append(args, parents...)
	}
	if repo.prefix != "" {
		args = append(args, "--", repo.prefix)
	}
	output, err := runGit(ctx, repo.repoRoot, args...)
	if err != nil {
		return HistoryResult{}, err
	}
	items := parseHistoryItems(output)
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	repo.markRemoteHistoryItems(ctx, items)
	return HistoryResult{Available: true, Items: items, HasMore: hasMore, RemoteHead: remoteHead}, nil
}

func ListCommitFiles(ctx context.Context, rootPath, commit string) (CommitFilesResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return CommitFilesResult{}, err
	}
	commit = strings.TrimSpace(commit)
	if commit == "" {
		return CommitFilesResult{}, errors.New("commit required")
	}
	if !repo.commitExists(ctx, commit) {
		return CommitFilesResult{}, errors.New("commit not found")
	}
	statusItems, err := repo.commitNameStatus(ctx, commit)
	if err != nil {
		return CommitFilesResult{}, err
	}
	stats, err := repo.commitNumstat(ctx, commit)
	if err != nil {
		return CommitFilesResult{}, err
	}
	items := make([]StatusItem, 0, len(statusItems))
	for _, item := range statusItems {
		path := repo.fromRepoPath(item.Path)
		if path == "" {
			continue
		}
		oldPath := repo.fromRepoPath(item.OldPath)
		stat := stats[item.Path]
		items = append(items, StatusItem{
			Path:      strings.TrimSuffix(path, "/"),
			OldPath:   oldPath,
			Status:    item.Status,
			Additions: stat[0],
			Deletions: stat[1],
		})
	}
	return CommitFilesResult{Commit: commit, Items: items}, nil
}

func ReadCommitDiff(ctx context.Context, rootPath, commit, relPath string) (DiffResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return DiffResult{}, err
	}
	commit = strings.TrimSpace(commit)
	if commit == "" {
		return DiffResult{}, errors.New("commit required")
	}
	if !repo.commitExists(ctx, commit) {
		return DiffResult{}, errors.New("commit not found")
	}
	path := strings.TrimSpace(relPath)
	if path == "" {
		return DiffResult{}, errors.New("path required")
	}
	repoPath := repo.toRepoPath(path)
	files, err := repo.commitNameStatus(ctx, commit)
	if err != nil {
		return DiffResult{}, err
	}
	stats, err := repo.commitNumstat(ctx, commit)
	if err != nil {
		return DiffResult{}, err
	}
	var matched *porcelainItem
	for i := range files {
		if files[i].Path == repoPath {
			matched = &files[i]
			break
		}
	}
	if matched == nil {
		return DiffResult{}, errors.New("git commit diff not found for path")
	}
	contentBytes, err := runGitBytes(ctx, repo.repoRoot, "show", "--format=", "--no-ext-diff", "--find-renames", commit, "--", repoPath)
	if err != nil {
		return DiffResult{}, err
	}
	content := decodeGitDiffOutput(contentBytes, filepath.Ext(matched.Path))
	stat := stats[matched.Path]
	return DiffResult{
		Path:      path,
		OldPath:   repo.fromRepoPath(matched.OldPath),
		Status:    matched.Status,
		Additions: stat[0],
		Deletions: stat[1],
		Content:   content,
	}, nil
}

func ReadRelatedFileDiff(ctx context.Context, rootPath, baseHead, relPath string) (RelatedFileDiffResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return RelatedFileDiffResult{}, err
	}
	baseHead = strings.TrimSpace(baseHead)
	if baseHead == "" {
		diff, err := ReadDiff(ctx, rootPath, relPath)
		if err != nil {
			return RelatedFileDiffResult{}, err
		}
		return RelatedFileDiffResult{DiffResult: diff, Source: "worktree"}, nil
	}
	if !repo.commitExists(ctx, baseHead) {
		return RelatedFileDiffResult{}, errors.New("记录的提交不存在或不在当前分支历史中")
	}
	if !repo.commitInCurrentHistory(ctx, baseHead) {
		return RelatedFileDiffResult{}, errors.New("记录的提交不存在或不在当前分支历史中")
	}
	path := strings.TrimSpace(relPath)
	if path == "" {
		return RelatedFileDiffResult{}, errors.New("path required")
	}
	nextHead, err := repo.nextCommitAfter(ctx, baseHead)
	if err != nil {
		return RelatedFileDiffResult{}, err
	}
	if strings.TrimSpace(nextHead) == "" {
		diff, err := ReadDiff(ctx, rootPath, path)
		if err != nil {
			return RelatedFileDiffResult{}, err
		}
		return RelatedFileDiffResult{
			DiffResult: diff,
			BaseHead:   baseHead,
			Source:     "worktree",
		}, nil
	}
	diff, err := repo.diffBetweenCommits(ctx, baseHead, nextHead, path)
	if err != nil {
		return RelatedFileDiffResult{}, err
	}
	return RelatedFileDiffResult{
		DiffResult: diff,
		BaseHead:   baseHead,
		TargetHead: nextHead,
		Source:     "commit_range",
	}, nil
}
