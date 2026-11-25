package gitview

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func (r repoContext) statusItems(ctx context.Context) ([]StatusItem, error) {
	args := []string{"status", "--porcelain=v1", "-z", "--untracked-files=normal"}
	if r.prefix != "" {
		args = append(args, "--", r.prefix)
	}
	output, err := runGit(ctx, r.repoRoot, args...)
	if err != nil {
		return nil, err
	}
	rawItems, err := parsePorcelainV1Z([]byte(output))
	if err != nil {
		return nil, err
	}

	// Batch fetch numstat for all tracked files in one call
	trackedItems := make([]porcelainItem, 0)
	for _, item := range rawItems {
		if item.Status != "??" {
			trackedItems = append(trackedItems, item)
		}
	}
	numstatCache := make(map[string][2]int) // repoPath -> [additions, deletions]
	if len(trackedItems) > 0 {
		numstatCache, err = r.batchNumstat(ctx, trackedItems)
		if err != nil {
			return nil, err
		}
	}

	items := make([]StatusItem, 0, len(rawItems))
	for _, item := range rawItems {
		path := r.fromRepoPath(item.Path)
		if path == "" {
			continue
		}
		path = strings.TrimSuffix(path, "/")
		if shouldIgnoreStatusPath(path) {
			continue
		}
		oldPath := r.fromRepoPath(item.OldPath)

		var additions, deletions int
		isDir := false
		if item.Status == "??" {
			target := filepath.Join(r.rootPath, filepath.FromSlash(path))
			if info, err := os.Stat(target); err == nil && info.IsDir() {
				isDir = true
			} else {
				lines, err := countFileLines(target)
				if err != nil {
					continue
				}
				additions = lines
			}
		} else {
			repoPath := r.toRepoPath(path)
			if stats, ok := numstatCache[repoPath]; ok {
				additions = stats[0]
				deletions = stats[1]
			}
		}

		items = append(items, StatusItem{
			Path:      path,
			OldPath:   oldPath,
			Status:    item.Status,
			Staged:    item.Staged,
			Additions: additions,
			Deletions: deletions,
			IsDir:     isDir,
		})
	}
	return items, nil
}

func shouldIgnoreStatusPath(path string) bool {
	for _, part := range strings.Split(filepath.ToSlash(filepath.Clean(path)), "/") {
		if part == ".mindfs" {
			return true
		}
	}
	return false
}

// batchNumstat fetches line stats for all items with one cached and one worktree git call.
func (r repoContext) batchNumstat(ctx context.Context, items []porcelainItem) (map[string][2]int, error) {
	result := make(map[string][2]int)
	if len(items) == 0 {
		return result, nil
	}

	cachedOutput, err := r.batchNumstatHelper(ctx, true, items)
	if err != nil {
		return nil, err
	}
	parseBatchNumstat(cachedOutput, result)

	workOutput, err := r.batchNumstatHelper(ctx, false, items)
	if err != nil {
		return nil, err
	}
	parseBatchNumstat(workOutput, result)

	return result, nil
}

func (r repoContext) batchNumstatHelper(ctx context.Context, cached bool, items []porcelainItem) (string, error) {
	args := []string{"diff", "--numstat"}
	if cached {
		args = append(args, "--cached")
	}
	args = append(args, "--")
	for _, item := range items {
		repoPath := r.toRepoPath(r.fromRepoPath(item.Path))
		args = append(args, repoPath)
	}
	return runGit(ctx, r.repoRoot, args...)
}

func parseBatchNumstat(output string, result map[string][2]int) {
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), "\t")
		if len(fields) < 3 {
			continue
		}
		var add, del int
		if fields[0] != "-" {
			fmt.Sscanf(fields[0], "%d", &add)
		}
		if fields[1] != "-" {
			fmt.Sscanf(fields[1], "%d", &del)
		}
		path := fields[2]
		stats := result[path]
		stats[0] += add
		stats[1] += del
		result[path] = stats
	}
}

func (r repoContext) diffContent(ctx context.Context, item StatusItem) (string, error) {
	repoPath := r.toRepoPath(item.Path)
	if item.Status == "??" {
		target := filepath.Join(r.rootPath, filepath.FromSlash(item.Path))
		return diffAgainstEmptyFile(ctx, r.repoRoot, target)
	}
	parts := make([]string, 0, 2)
	cachedBytes, err := runGitBytes(ctx, r.repoRoot, "diff", "--no-ext-diff", "--cached", "--", repoPath)
	if err != nil {
		return "", err
	}
	cached := decodeGitDiffOutput(cachedBytes, filepath.Ext(item.Path))
	if strings.TrimSpace(cached) != "" {
		parts = append(parts, strings.TrimRight(cached, "\n"))
	}
	workingTreeBytes, err := runGitBytes(ctx, r.repoRoot, "diff", "--no-ext-diff", "--", repoPath)
	if err != nil {
		return "", err
	}
	workingTree := decodeGitDiffOutput(workingTreeBytes, filepath.Ext(item.Path))
	if strings.TrimSpace(workingTree) != "" {
		parts = append(parts, strings.TrimRight(workingTree, "\n"))
	}
	return strings.Join(parts, "\n\n"), nil
}

func (r repoContext) commitExists(ctx context.Context, commit string) bool {
	if strings.TrimSpace(commit) == "" {
		return false
	}
	_, err := runGit(ctx, r.repoRoot, "cat-file", "-e", commit+"^{commit}")
	return err == nil
}

func (r repoContext) commitInCurrentHistory(ctx context.Context, commit string) bool {
	if strings.TrimSpace(commit) == "" {
		return false
	}
	_, err := runGit(ctx, r.repoRoot, "merge-base", "--is-ancestor", commit, "HEAD")
	return err == nil
}

func (r repoContext) nextCommitAfter(ctx context.Context, commit string) (string, error) {
	output, err := runGit(ctx, r.repoRoot, "rev-list", "--reverse", "--ancestry-path", commit+"..HEAD")
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(output, "\n") {
		value := strings.TrimSpace(line)
		if value != "" {
			return value, nil
		}
	}
	return "", nil
}

func (r repoContext) diffBetweenCommits(ctx context.Context, base, target, relPath string) (DiffResult, error) {
	path := strings.TrimSpace(relPath)
	if path == "" {
		return DiffResult{}, errors.New("path required")
	}
	repoPath := r.toRepoPath(path)
	files, err := r.nameStatusBetween(ctx, base, target)
	if err != nil {
		return DiffResult{}, err
	}
	stats, err := r.numstatBetween(ctx, base, target)
	if err != nil {
		return DiffResult{}, err
	}
	var matched *porcelainItem
	for i := range files {
		if files[i].Path == repoPath || files[i].OldPath == repoPath {
			matched = &files[i]
			break
		}
	}
	if matched == nil {
		return DiffResult{}, errors.New("git related file diff not found for path")
	}
	contentBytes, err := runGitBytes(ctx, r.repoRoot, "diff", "--no-ext-diff", "--find-renames", base, target, "--", repoPath)
	if err != nil {
		return DiffResult{}, err
	}
	content := decodeGitDiffOutput(contentBytes, filepath.Ext(matched.Path))
	stat := stats[matched.Path]
	return DiffResult{
		Path:      r.fromRepoPath(matched.Path),
		OldPath:   r.fromRepoPath(matched.OldPath),
		Status:    matched.Status,
		Additions: stat[0],
		Deletions: stat[1],
		Content:   content,
	}, nil
}

func (r repoContext) commitParents(ctx context.Context, commit string) ([]string, error) {
	output, err := runGit(ctx, r.repoRoot, "rev-list", "--parents", "-n", "1", commit)
	if err != nil {
		return nil, err
	}
	fields := strings.Fields(output)
	if len(fields) <= 1 {
		return []string{}, nil
	}
	return fields[1:], nil
}

func (r repoContext) markRemoteHistoryItems(ctx context.Context, items []HistoryItem) {
	for i := range items {
		output, err := runGit(ctx, r.repoRoot, "branch", "-r", "--contains", items[i].Hash, "--format=%(refname:short)")
		if err != nil {
			continue
		}
		items[i].Remote = strings.TrimSpace(output) != ""
	}
}

func (r repoContext) remoteHistoryHead(ctx context.Context) string {
	upstream, err := runGit(ctx, r.repoRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
	if err != nil {
		return ""
	}
	upstream = strings.TrimSpace(upstream)
	if upstream == "" {
		return ""
	}
	mergeBase, err := runGit(ctx, r.repoRoot, "merge-base", "HEAD", upstream)
	if err != nil {
		return ""
	}
	mergeBase = strings.TrimSpace(mergeBase)
	if mergeBase == "" {
		return ""
	}
	if r.prefix == "" {
		return mergeBase
	}
	output, err := runGit(ctx, r.repoRoot, "log", "--format=%H", "--max-count=1", mergeBase, "--", r.prefix)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(output)
}

func (r repoContext) commitNameStatus(ctx context.Context, commit string) ([]porcelainItem, error) {
	output, err := runGit(ctx, r.repoRoot, "diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", "-M", commit)
	if err != nil {
		return nil, err
	}
	return parseNameStatusZ(output), nil
}

func (r repoContext) nameStatusBetween(ctx context.Context, base, target string) ([]porcelainItem, error) {
	output, err := runGit(ctx, r.repoRoot, "diff", "--name-status", "-z", "-M", base, target)
	if err != nil {
		return nil, err
	}
	return parseNameStatusZ(output), nil
}

func parseNameStatusZ(output string) []porcelainItem {
	parts := strings.Split(output, "\x00")
	items := make([]porcelainItem, 0)
	for i := 0; i < len(parts); {
		status := strings.TrimSpace(parts[i])
		i++
		if status == "" {
			continue
		}
		code := status
		if len(code) > 1 {
			code = code[:1]
		}
		normalized := "M"
		switch code {
		case "A":
			normalized = "A"
		case "D":
			normalized = "D"
		case "R", "C":
			normalized = "R"
		}
		if normalized == "R" {
			if i+1 >= len(parts) {
				break
			}
			oldPath := strings.TrimSpace(parts[i])
			newPath := strings.TrimSpace(parts[i+1])
			i += 2
			if newPath != "" {
				items = append(items, porcelainItem{Path: newPath, OldPath: oldPath, Status: normalized})
			}
			continue
		}
		if i >= len(parts) {
			break
		}
		path := strings.TrimSpace(parts[i])
		i++
		if path != "" {
			items = append(items, porcelainItem{Path: path, Status: normalized})
		}
	}
	return items
}

func (r repoContext) commitNumstat(ctx context.Context, commit string) (map[string][2]int, error) {
	output, err := runGit(ctx, r.repoRoot, "diff-tree", "--root", "--no-commit-id", "--numstat", "-r", "-M", commit)
	if err != nil {
		return nil, err
	}
	return parseNumstat(output)
}

func (r repoContext) numstatBetween(ctx context.Context, base, target string) (map[string][2]int, error) {
	output, err := runGit(ctx, r.repoRoot, "diff", "--numstat", "-M", base, target)
	if err != nil {
		return nil, err
	}
	return parseNumstat(output)
}

func parseNumstat(output string) (map[string][2]int, error) {
	result := make(map[string][2]int)
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), "\t")
		if len(fields) < 3 {
			continue
		}
		var add, del int
		if fields[0] != "-" {
			fmt.Sscanf(fields[0], "%d", &add)
		}
		if fields[1] != "-" {
			fmt.Sscanf(fields[1], "%d", &del)
		}
		path := fields[len(fields)-1]
		result[path] = [2]int{add, del}
	}
	return result, scanner.Err()
}

func (r repoContext) toRepoPath(rootRelativePath string) string {
	if r.prefix == "" {
		return filepath.ToSlash(rootRelativePath)
	}
	if rootRelativePath == "" || rootRelativePath == "." {
		return r.prefix
	}
	return filepath.ToSlash(pathJoinSlash(r.prefix, rootRelativePath))
}

func (r repoContext) fromRepoPath(repoRelativePath string) string {
	value := filepath.ToSlash(strings.TrimSpace(repoRelativePath))
	if value == "" {
		return ""
	}
	if r.prefix == "" {
		return value
	}
	if value == r.prefix {
		return "."
	}
	prefix := r.prefix + "/"
	if !strings.HasPrefix(value, prefix) {
		return ""
	}
	return strings.TrimPrefix(value, prefix)
}

func parseHistoryItems(output string) []HistoryItem {
	parts := strings.Split(output, "\x00")
	items := make([]HistoryItem, 0, len(parts)/3)
	for i := 0; i+2 < len(parts); i += 3 {
		hash := strings.TrimSpace(parts[i])
		if hash == "" {
			continue
		}
		items = append(items, HistoryItem{
			Hash:       hash,
			Message:    strings.TrimSpace(parts[i+1]),
			CommitTime: strings.TrimSpace(parts[i+2]),
		})
	}
	return items
}

type porcelainItem struct {
	Path    string
	OldPath string
	Status  string
	Staged  bool
}

func parsePorcelainV1Z(data []byte) ([]porcelainItem, error) {
	items := make([]porcelainItem, 0)
	index := 0
	for index < len(data) {
		if index+3 > len(data) {
			return nil, errors.New("invalid git status payload")
		}
		x := data[index]
		y := data[index+1]
		index += 3
		next := bytes.IndexByte(data[index:], 0)
		if next < 0 {
			return nil, errors.New("invalid git status path")
		}
		path := string(data[index : index+next])
		index += next + 1
		item := porcelainItem{Path: path, Status: normalizeStatus(x, y), Staged: x != ' ' && x != '?'}
		if x == 'R' || y == 'R' || x == 'C' || y == 'C' {
			oldNext := bytes.IndexByte(data[index:], 0)
			if oldNext < 0 {
				return nil, errors.New("invalid git status rename path")
			}
			item.OldPath = string(data[index : index+oldNext])
			index += oldNext + 1
		}
		items = append(items, item)
	}
	return items, nil
}

func normalizeStatus(x, y byte) string {
	switch {
	case x == '?' && y == '?':
		return "??"
	case x == 'R' || y == 'R' || x == 'C' || y == 'C':
		return "R"
	case x == 'D' || y == 'D':
		return "D"
	case x == 'A' || y == 'A':
		return "A"
	default:
		return "M"
	}
}

func diffAgainstEmptyFile(ctx context.Context, repoRoot, targetPath string) (string, error) {
	tmpFile, err := os.CreateTemp("", "mindfs-git-empty-*")
	if err != nil {
		return "", err
	}
	tmpName := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpName)
	cmd := newGitCommand(ctx, "-C", repoRoot, "diff", "--no-index", "--no-ext-diff", "--", tmpName, targetPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		// git diff --no-index returns exit code 1 when differences exist.
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return decodeGitDiffOutput(out, filepath.Ext(targetPath)), nil
		}
		return "", formatGitError(err, out)
	}
	return decodeGitDiffOutput(out, filepath.Ext(targetPath)), nil
}

func countFileLines(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	if len(data) == 0 {
		return 0, nil
	}
	count := bytes.Count(data, []byte{'\n'})
	if data[len(data)-1] != '\n' {
		count += 1
	}
	return count, nil
}
