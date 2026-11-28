package collab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"mindfs/server/internal/turndiff"
)

const (
	DocImpl      = "01-impl.md"
	DocReview    = "02-review.md"
	DocResponse  = "03-response.md"
	DocDecisions = "04-decisions.md"
	DocReport    = "05-report.md"
)

var validRunIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
var validDocNamePattern = regexp.MustCompile(`^(第[0-9]{2,}轮/((01-独立提案|02-互评|04-补充答复|05-计划核对)/)?)?[\p{L}0-9][\p{L}0-9._-]{0,127}\.md$`)
var roundDirPattern = regexp.MustCompile(`^第[0-9]{2,}轮$`)

func ValidateRunID(runID string) error {
	trimmed := strings.TrimSpace(runID)
	if trimmed == "" || !validRunIDPattern.MatchString(trimmed) || strings.Contains(trimmed, "..") {
		return fmt.Errorf("invalid run id %q", runID)
	}
	return nil
}

func validateDocName(name string) error {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || !validDocNamePattern.MatchString(trimmed) || strings.Contains(trimmed, "..") {
		return fmt.Errorf("invalid doc name %q", name)
	}
	return nil
}

func RunRelDir(runID string) string {
	return filepath.ToSlash(filepath.Join(".mindfs", "runs", strings.TrimSpace(runID)))
}

func DocRelPath(runID, docName string) string {
	return filepath.ToSlash(filepath.Join(".mindfs", "runs", strings.TrimSpace(runID), strings.TrimSpace(docName)))
}

func RunAbsDir(rootPath, runID string) (string, error) {
	return ensureSafeRunDir(rootPath, runID, false, false)
}

func ensureSafeRunDir(rootPath, runID string, create bool, requireExist bool) (string, error) {
	trimmedRoot := strings.TrimSpace(rootPath)
	if trimmedRoot == "" {
		return "", errors.New("root path required")
	}
	if err := ValidateRunID(runID); err != nil {
		return "", err
	}
	rootAbs, err := filepath.Abs(trimmedRoot)
	if err != nil {
		return "", err
	}
	rootReal, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return "", err
	}

	segments := []string{".mindfs", "runs", strings.TrimSpace(runID)}
	cur := rootReal
	for _, seg := range segments {
		cur = filepath.Join(cur, seg)
		info, lstatErr := os.Lstat(cur)
		if lstatErr != nil {
			if os.IsNotExist(lstatErr) {
				if !create {
					if requireExist {
						return "", os.ErrNotExist
					}
					continue
				}
				if mkErr := os.Mkdir(cur, 0o755); mkErr != nil && !os.IsExist(mkErr) {
					return "", mkErr
				}
				info, lstatErr = os.Lstat(cur)
			}
			if lstatErr != nil {
				return "", lstatErr
			}
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("symlink is not allowed in collab run path: %s", cur)
		}
		if !info.IsDir() {
			return "", fmt.Errorf("collab run path segment is not a directory: %s", cur)
		}
	}

	if create || requireExist {
		realCur, evalErr := filepath.EvalSymlinks(cur)
		if evalErr != nil {
			return "", evalErr
		}
		rel, relErr := filepath.Rel(rootReal, realCur)
		if relErr != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return "", fmt.Errorf("run dir escapes project root: %q", runID)
		}
		return realCur, nil
	}

	rel, relErr := filepath.Rel(rootReal, cur)
	if relErr != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("run dir escapes project root: %q", runID)
	}
	return cur, nil
}

func rejectSymlinkTarget(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("symlink is not allowed for handoff doc: %s", filepath.Base(path))
	}
	return nil
}

// docDirectory accepts one optional round directory beneath the verified run.
func docDirectory(rootPath, runID, name string, create bool) (string, error) {
	dir, err := ensureSafeRunDir(rootPath, runID, create, true)
	if err != nil {
		return "", err
	}
	parts := strings.Split(name, "/")
	for _, sub := range parts[:len(parts)-1] {
		dir = filepath.Join(dir, sub)
		if create {
			if err := os.Mkdir(dir, 0755); err != nil && !os.IsExist(err) {
				return "", err
			}
		}
		info, err := os.Lstat(dir)
		if err != nil {
			return "", err
		}
		if !info.IsDir() {
			return "", fmt.Errorf("invalid handoff directory: %s", sub)
		}
	}
	return dir, nil
}

func WriteRunDoc(rootPath, runID, docName, content string) (string, error) {
	if err := validateDocName(docName); err != nil {
		return "", err
	}
	runDir, err := docDirectory(rootPath, runID, docName, true)
	if err != nil {
		return "", err
	}
	target := filepath.Join(runDir, filepath.Base(docName))
	if err := rejectSymlinkTarget(target); err != nil {
		return "", err
	}
	tmp := target + ".tmp"
	if err := rejectSymlinkTarget(tmp); err != nil {
		return "", err
	}
	payload := strings.TrimRight(content, "\n") + "\n"
	if err := os.WriteFile(tmp, []byte(payload), 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(target)
		if retryErr := os.Rename(tmp, target); retryErr != nil {
			_ = os.Remove(tmp)
			return "", err
		}
	}
	return DocRelPath(runID, docName), nil
}

func ReadRunDoc(rootPath, runID, docName string) (string, error) {
	if err := validateDocName(docName); err != nil {
		return "", err
	}
	runDir, err := docDirectory(rootPath, runID, docName, false)
	if err != nil {
		return "", err
	}
	target := filepath.Join(runDir, filepath.Base(docName))
	info, err := os.Lstat(target)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", fmt.Errorf("invalid handoff doc file: %s", docName)
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func ListRunDocs(rootPath, runID string) ([]string, error) {
	runDir, err := ensureSafeRunDir(rootPath, runID, false, true)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	names := []string{}
	err = walkRunFiles(runDir, "", func(name string, e os.DirEntry) error {
		if e.Type().IsRegular() && validateDocName(name) == nil {
			names = append(names, name)
		}
		return nil
	})
	sort.Strings(names)
	return names, err
}

// Only numbered round directories belong to the handoff tree.
func walkRunFiles(root, rel string, visit func(string, os.DirEntry) error) error {
	entries, err := os.ReadDir(filepath.Join(root, rel))
	if err != nil {
		return err
	}
	for _, e := range entries {
		name := filepath.ToSlash(filepath.Join(rel, e.Name()))
		if e.IsDir() {
			if !isHandoffDirectory(rel, e.Name()) {
				continue
			}
			if err := walkRunFiles(root, name, visit); err != nil {
				return err
			}
		}
		if err := visit(name, e); err != nil {
			return err
		}
	}
	return nil
}

func isHandoffDirectory(parent, name string) bool {
	if parent == "" {
		return roundDirPattern.MatchString(name)
	}
	if roundDirPattern.MatchString(parent) {
		switch name {
		case "01-独立提案", "02-互评", "04-补充答复", "05-计划核对":
			return true
		}
	}
	return false
}

type ImplDiffMeta struct {
	Observed bool   `json:"observed"`
	Partial  bool   `json:"partial,omitempty"`
	Diff     string `json:"diff,omitempty"`
}

const implDiffMetaFile = ".impl-diff.json"

func WriteImplDiffMeta(rootPath, runID string, meta ImplDiffMeta) error {
	runDir, err := ensureSafeRunDir(rootPath, runID, true, true)
	if err != nil {
		return err
	}
	target := filepath.Join(runDir, implDiffMetaFile)
	if err := rejectSymlinkTarget(target); err != nil {
		return err
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	return os.WriteFile(target, raw, 0o600)
}

func ReadImplDiffMeta(rootPath, runID string) (ImplDiffMeta, bool) {
	runDir, err := ensureSafeRunDir(rootPath, runID, false, true)
	if err != nil {
		return ImplDiffMeta{}, false
	}
	target := filepath.Join(runDir, implDiffMetaFile)
	info, err := os.Lstat(target)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return ImplDiffMeta{}, false
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		return ImplDiffMeta{}, false
	}
	var meta ImplDiffMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return ImplDiffMeta{}, false
	}
	return meta, true
}

// CleanupRunDocs deletes process handoff docs under .mindfs/runs/<runID> while
// keeping any filenames listed in keepDocs. Removes the run directory if empty.
func CleanupRunDocs(rootPath, runID string, keepDocs []string) ([]string, error) {
	runDir, err := ensureSafeRunDir(rootPath, runID, false, true)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	keep := make(map[string]bool, len(keepDocs))
	for _, name := range keepDocs {
		keep[name] = true
	}
	removed := []string{}
	err = walkRunFiles(runDir, "", func(name string, e os.DirEntry) error {
		if keep[name] {
			return nil
		}
		target := filepath.Join(runDir, filepath.FromSlash(name))
		if e.IsDir() {
			return removeEmptyDirectory(target)
		}
		if err := os.Remove(target); err != nil {
			return err
		}
		if e.Type().IsRegular() && validateDocName(name) == nil {
			removed = append(removed, name)
		}
		return nil
	})
	if err == nil {
		err = removeEmptyDirectory(runDir)
	}
	sort.Strings(removed)
	return removed, err
}

// RemoveRunDir safely deletes the entire .mindfs/runs/<runID> directory tree,
// including all round subdirectories, metadata dotfiles, and any extra files
// placed inside the run directory. It rejects symlinked run path segments and
// unlinks symlinks inside the run directory without traversing their targets.
func RemoveRunDir(rootPath, runID string) error {
	runDir, err := ensureSafeRunDir(rootPath, runID, false, true)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return removeDirTreeNoFollow(runDir)
}

func removeDirTreeNoFollow(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		target := filepath.Join(dir, entry.Name())
		info, lstatErr := os.Lstat(target)
		if lstatErr != nil {
			if os.IsNotExist(lstatErr) {
				continue
			}
			return lstatErr
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
				return err
			}
			continue
		}
		if err := removeDirTreeNoFollow(target); err != nil {
			return err
		}
	}
	if err := os.Remove(dir); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func removeEmptyDirectory(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) > 0 {
		return err
	}
	return os.Remove(dir)
}

type ReviewItem struct {
	ItemID           string `json:"item_id"`
	Ordinal          int    `json:"ordinal"`
	Dimension        string `json:"dimension"`
	Severity         string `json:"severity"`
	FilePath         string `json:"file_path"`
	LineStart        int    `json:"line_start"`
	LineEnd          int    `json:"line_end,omitempty"`
	CitationVerified bool   `json:"citation_verified"`
	CitationNote     string `json:"citation_note,omitempty"`
	RuleRef          string `json:"rule_ref,omitempty"`
	Title            string `json:"title"`
	Description      string `json:"description"`
	PrimaryStatus    string `json:"primary_status,omitempty"`
	PrimaryNote      string `json:"primary_note,omitempty"`
	ParseFallback    bool   `json:"parse_fallback,omitempty"`
	AuthorDecision   string `json:"author_decision,omitempty"`
	AuthorNote       string `json:"author_note,omitempty"`
	UpdatedAt        string `json:"updated_at,omitempty"`
}

func VerifyCitations(rootPath string, items []ReviewItem) []ReviewItem {
	out := make([]ReviewItem, len(items))
	copy(out, items)
	rootAbs, err := filepath.Abs(strings.TrimSpace(rootPath))
	if err != nil || strings.TrimSpace(rootPath) == "" {
		for i := range out {
			out[i].CitationVerified = false
			out[i].CitationNote = "项目根目录不可用，无法核验出处"
		}
		return out
	}

	rootReal := rootAbs
	if resolved, evalErr := filepath.EvalSymlinks(rootAbs); evalErr == nil {
		rootReal = resolved
	}

	lineCountCache := make(map[string]int)
	for i := range out {
		item := &out[i]
		relSlash := strings.TrimSpace(filepath.ToSlash(item.FilePath))
		relSlash = strings.TrimPrefix(relSlash, "./")
		item.FilePath = relSlash
		if relSlash == "" || item.LineStart <= 0 {
			item.CitationVerified = false
			item.CitationNote = "缺少具体文件或起始行号"
			continue
		}
		if filepath.IsAbs(filepath.FromSlash(relSlash)) || !filepath.IsLocal(filepath.FromSlash(relSlash)) {
			item.CitationVerified = false
			item.CitationNote = "出处路径不在项目目录内"
			continue
		}
		target := filepath.Join(rootAbs, filepath.FromSlash(relSlash))
		totalLines, cached := lineCountCache[relSlash]
		if !cached {
			targetReal, evalErr := filepath.EvalSymlinks(target)
			if evalErr != nil {
				item.CitationVerified = false
				item.CitationNote = fmt.Sprintf("文件不存在：%s", relSlash)
				continue
			}
			relCheck, relErr := filepath.Rel(rootReal, targetReal)
			if relErr != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(filepath.Separator)) {
				item.CitationVerified = false
				item.CitationNote = "出处路径超出项目目录范围"
				continue
			}
			info, statErr := os.Stat(targetReal)
			if statErr != nil || !info.Mode().IsRegular() {
				item.CitationVerified = false
				item.CitationNote = fmt.Sprintf("文件不存在：%s", relSlash)
				continue
			}
			data, readErr := os.ReadFile(targetReal)
			if readErr != nil {
				item.CitationVerified = false
				item.CitationNote = fmt.Sprintf("无法读取文件：%s", relSlash)
				continue
			}
			totalLines = countFileLines(data)
			lineCountCache[relSlash] = totalLines
		}
		if item.LineEnd > 0 && item.LineEnd < item.LineStart {
			item.CitationVerified = false
			item.CitationNote = fmt.Sprintf("结束行号 %d 小于起始行号 %d", item.LineEnd, item.LineStart)
			continue
		}
		maxLine := item.LineStart
		if item.LineEnd > maxLine {
			maxLine = item.LineEnd
		}
		if maxLine > totalLines {
			item.CitationVerified = false
			item.CitationNote = fmt.Sprintf("行号超出范围（文件共 %d 行）", totalLines)
			continue
		}
		item.CitationVerified = true
		item.CitationNote = ""
	}
	return out
}

func countFileLines(data []byte) int {
	if len(data) == 0 {
		return 0
	}
	lines := bytes.Count(data, []byte{'\n'})
	if data[len(data)-1] != '\n' {
		lines++
	}
	return lines
}

type ReadOnlyCheckState string

const (
	ReadOnlyClean      ReadOnlyCheckState = "clean"
	ReadOnlyModified   ReadOnlyCheckState = "modified"
	ReadOnlyUnobserved ReadOnlyCheckState = "unobserved"
)

// FinishReadOnlySnapshot compares before/after workspace snapshots and strictly
// distinguishes clean, modified, and unobserved ("没观察到不能当没改动").
func FinishReadOnlySnapshot(ctx context.Context, snap *turndiff.Snapshot, captureErr error) (ReadOnlyCheckState, []string, string) {
	if captureErr != nil || snap == nil {
		note := "未能建立审核前工作区快照，无法确认只读期间无文件改动"
		if captureErr != nil {
			note += "（" + captureErr.Error() + "）"
		}
		return ReadOnlyUnobserved, nil, note
	}
	res, err := snap.Finish(ctx)
	if err != nil || res == nil {
		note := "未能完成审核后工作区对比，无法确认只读期间无文件改动"
		if err != nil {
			note += "（" + err.Error() + "）"
		}
		return ReadOnlyUnobserved, nil, note
	}
	changed := res.ChangedFiles()
	if len(changed) > 0 {
		paths := make([]string, 0, len(changed))
		for _, item := range changed {
			paths = append(paths, item.Path)
		}
		sort.Strings(paths)
		return ReadOnlyModified, paths, fmt.Sprintf("审核期间检测到工作区文件变更：%s（可能来自审核进程或并发手动编辑）", strings.Join(paths, ", "))
	}
	if res.Partial {
		return ReadOnlyUnobserved, nil, "工作区存在大文件或跳过的路径，仅完成部分快照对比"
	}
	return ReadOnlyClean, nil, ""
}
