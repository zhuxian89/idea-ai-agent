// Package turndiff observes workspace changes without modifying the repository
// or the agent's tools, prompts, permissions or protocol. Snapshots are bounded
// and best effort: failure only disables this display aid.
package turndiff

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	maxFileBytes       = 2 << 20
	maxSnapshotBytes   = 32 << 20
	maxPaths           = 20000
	maxDiffBytes       = 4 << 20
	observationTimeout = 10 * time.Second
)

type file struct {
	data    []byte
	mode    os.FileMode
	present bool
	known   bool
}

type Snapshot struct {
	root         string
	files        map[string]file
	indexObjects map[string]indexObject
	untracked    map[string]bool
	partial      bool
}

type Result struct {
	Diff    string
	Partial bool
	root    string
	covered map[string]bool
	changed map[string]ChangedFile
}

type indexObject struct {
	oid  string
	mode string
}

// Capture stores tracked clean files as Git index object IDs. Only dirty and
// untracked bytes are read up front, which keeps large Windows workspaces fast.
func Capture(parent context.Context, root string) (*Snapshot, error) {
	ctx, cancel := context.WithTimeout(parent, observationTimeout)
	defer cancel()
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	paths, err := listFiles(ctx, abs)
	if err != nil {
		return nil, err
	}
	indexObjects, err := listIndexObjects(ctx, abs)
	if err != nil {
		return nil, err
	}
	dirtyPaths, err := dirtyWorktreePaths(ctx, abs)
	if err != nil {
		return nil, err
	}
	selected := make(map[string]bool, len(dirtyPaths)+len(paths))
	for path := range indexObjects {
		if dirtyPaths[path] {
			selected[path] = true
		}
	}
	untracked := make(map[string]bool)
	for _, path := range paths {
		if _, tracked := indexObjects[path]; !tracked {
			selected[path] = true
			untracked[path] = true
		}
	}
	selectedPaths := make([]string, 0, len(selected))
	for path := range selected {
		selectedPaths = append(selectedPaths, path)
	}
	s, err := capturePaths(ctx, abs, selectedPaths)
	if err != nil {
		return nil, err
	}
	s.indexObjects = indexObjects
	s.untracked = untracked
	return s, nil
}

func listFiles(ctx context.Context, root string) ([]string, error) {
	// ls-files works in linked worktrees and subdirectories without touching
	// the real index. Optional locks, external diff drivers and pagers are off.
	out, err := gitOutput(ctx, root, 4<<20, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ".")
	if err != nil {
		return nil, err
	}
	unique := map[string]bool{}
	for _, name := range strings.Split(string(out), "\x00") {
		if name == "" || !filepath.IsLocal(filepath.FromSlash(name)) {
			continue
		}
		if excluded(name) {
			continue
		}
		unique[name] = true
		if len(unique) > maxPaths {
			return nil, errors.New("workspace file limit exceeded")
		}
	}
	paths := make([]string, 0, len(unique))
	for path := range unique {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths, nil
}

func excluded(path string) bool {
	for _, part := range strings.Split(path, "/") {
		if part == ".git" || part == ".mindfs" {
			return true
		}
	}
	return false
}

func capturePaths(ctx context.Context, root string, paths []string) (*Snapshot, error) {
	dir, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	s := &Snapshot{root: root, files: map[string]file{}}
	remaining := int64(maxSnapshotBytes)
	for _, path := range paths {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		value := readFile(dir, filepath.FromSlash(path), remaining)
		s.files[path] = value
		if !value.known {
			s.partial = true
		}
		remaining -= int64(len(value.data))
	}
	return s, nil
}

func listIndexObjects(ctx context.Context, root string) (map[string]indexObject, error) {
	out, err := gitOutput(ctx, root, 16<<20, "ls-files", "-s", "-z", "--cached", "--", ".")
	if err != nil {
		return nil, err
	}
	objects := make(map[string]indexObject)
	for _, record := range strings.Split(string(out), "\x00") {
		if record == "" {
			continue
		}
		metadata, path, hasPath := strings.Cut(record, "\t")
		if !hasPath {
			return nil, fmt.Errorf("invalid index record %q", record)
		}
		fields := strings.Fields(metadata)
		if len(fields) != 3 || !isValidObjectID(fields[1]) {
			return nil, fmt.Errorf("invalid index metadata %q", metadata)
		}
		if excluded(path) || !filepath.IsLocal(filepath.FromSlash(path)) {
			continue
		}
		objects[path] = indexObject{mode: fields[0], oid: fields[1]}
	}
	if len(objects) > maxPaths {
		return nil, errors.New("workspace file limit exceeded")
	}
	return objects, nil
}

func isValidObjectID(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}

func dirtyWorktreePaths(ctx context.Context, root string) (map[string]bool, error) {
	out, err := gitOutput(ctx, root, 8<<20, "diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--no-color", "--", ".")
	if err != nil {
		return nil, err
	}
	paths := make(map[string]bool)
	for _, path := range strings.Split(string(out), "\x00") {
		if path == "" || excluded(path) || !filepath.IsLocal(filepath.FromSlash(path)) {
			continue
		}
		paths[path] = true
	}
	return paths, nil
}

func readFile(root *os.Root, path string, remaining int64) file {
	info, err := root.Lstat(path)
	if os.IsNotExist(err) {
		return file{known: true}
	}
	// Do not dereference symlinks, devices, directories or oversized files.
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxFileBytes || info.Size() > remaining {
		return file{}
	}
	f, err := root.Open(path)
	if err != nil {
		return file{}
	}
	defer f.Close()
	limit := min(int64(maxFileBytes), remaining)
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	after, statErr := f.Stat()
	if err != nil || statErr != nil || int64(len(data)) > limit || !os.SameFile(info, after) || info.Size() != after.Size() || !info.ModTime().Equal(after.ModTime()) {
		return file{}
	}
	return file{data: data, mode: info.Mode().Perm(), present: true, known: true}
}

// Finish observes the same workspace after the turn. Previously known paths
// are compared even if the turn committed them or changed ignore rules.
func (s *Snapshot) Finish(parent context.Context) (*Result, error) {
	ctx, cancel := context.WithTimeout(parent, observationTimeout)
	defer cancel()
	paths, err := listFiles(ctx, s.root)
	if err != nil {
		return nil, err
	}
	indexObjects, err := listIndexObjects(ctx, s.root)
	if err != nil {
		return nil, err
	}
	dirtyPaths, err := dirtyWorktreePaths(ctx, s.root)
	if err != nil {
		return nil, err
	}
	beforePaths := make(map[string]bool, len(s.indexObjects)+len(s.files))
	for path := range s.indexObjects {
		beforePaths[path] = true
	}
	for path := range s.files {
		beforePaths[path] = true
	}
	afterPaths := make(map[string]bool, len(paths))
	for _, path := range paths {
		afterPaths[path] = true
	}
	candidates := make(map[string]bool)
	comparable := make(map[string]bool, len(beforePaths)+len(afterPaths))
	for path := range beforePaths {
		if _, captured := s.files[path]; captured || !afterPaths[path] || dirtyPaths[path] {
			candidates[path] = true
		}
	}
	for path := range afterPaths {
		beforeObject, trackedBefore := s.indexObjects[path]
		afterObject, trackedAfter := indexObjects[path]
		if !beforePaths[path] || s.untracked[path] || dirtyPaths[path] || (trackedAfter && !trackedBefore) ||
			(trackedBefore && trackedAfter && (beforeObject.oid != afterObject.oid || beforeObject.mode != afterObject.mode)) {
			candidates[path] = true
		}
		if trackedBefore && trackedAfter && beforeObject.oid == afterObject.oid && beforeObject.mode == afterObject.mode && !dirtyPaths[path] {
			comparable[path] = true
		}
	}
	result := &Result{root: s.root, Partial: s.partial, covered: comparable, changed: map[string]ChangedFile{}}
	changed := make([]string, 0, len(candidates))
	var retained int64
	for path := range candidates {
		before, err := s.baselineFile(ctx, path)
		if err != nil || !before.known {
			s.partial = true
			continue
		}
		next := readFileAt(s.root, path)
		if !next.known {
			s.partial = true
			continue
		}
		if before.present != next.present || !bytes.Equal(before.data, next.data) || executable(before.mode) != executable(next.mode) {
			size := int64(len(before.data) + len(next.data))
			if retained+size > maxArtifactBytes {
				s.partial = true
				continue
			}
			retained += size
			comparable[path] = true
			changed = append(changed, path)
			result.changed[path] = ChangedFile{
				Path:   path,
				Before: FileState{Present: before.present, Binary: isBinaryBytes(before.data), Mode: uint32(before.mode.Perm()), Bytes: before.data},
				After:  FileState{Present: next.present, Binary: isBinaryBytes(next.data), Mode: uint32(next.mode.Perm()), Bytes: next.data},
			}
		}
	}
	result.Partial = s.partial
	sort.Strings(changed)
	if len(changed) == 0 {
		return result, nil
	}
	// Only changed files are copied into a private temporary directory; git
	// compares those copies, never writes to the project or its Git metadata.
	tmp, err := os.MkdirTemp("", "idea-agent-turn-diff-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	for _, side := range []string{"before", "after"} {
		if err := os.Mkdir(filepath.Join(tmp, side), 0700); err != nil {
			return nil, err
		}
	}
	for _, path := range changed {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		changedFile := result.changed[path]
		sides := map[string]file{
			"before": {data: changedFile.Before.Bytes, mode: os.FileMode(changedFile.Before.Mode), present: changedFile.Before.Present},
			"after":  {data: changedFile.After.Bytes, mode: os.FileMode(changedFile.After.Mode), present: changedFile.After.Present},
		}
		for side, value := range sides {
			if !value.present {
				continue
			}
			name := filepath.Join(tmp, side, filepath.FromSlash(path))
			if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
				return nil, err
			}
			mode := os.FileMode(0600)
			if executable(value.mode) {
				mode = 0700
			}
			if err := os.WriteFile(name, value.data, mode); err != nil {
				return nil, err
			}
		}
	}
	out, err := gitOutput(ctx, tmp, maxDiffBytes, "-c", "core.quotePath=true", "-c", "core.autocrlf=false", "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--", "before", "after")
	var exit *exec.ExitError
	if err != nil && !(errors.As(err, &exit) && exit.ExitCode() == 1) {
		return nil, err
	}
	result.Diff = cleanDiffPaths(string(out))
	return result, nil
}

func (s *Snapshot) baselineFile(ctx context.Context, path string) (file, error) {
	if value, exists := s.files[path]; exists {
		return value, nil
	}
	if _, tracked := s.indexObjects[path]; !tracked {
		return file{known: true}, nil
	}
	object, exists := s.indexObjects[path]
	if !exists {
		return file{}, errors.New("baseline object unavailable")
	}
	out, err := gitOutput(ctx, s.root, maxFileBytes+1, "cat-file", "--filters", "--path", path, object.oid)
	if err != nil {
		return file{}, err
	}
	if len(out) > maxFileBytes {
		return file{}, errors.New("baseline object exceeds size limit")
	}
	return file{data: out, mode: modeFromFileMode(object.mode), present: true, known: true}, nil
}

func readFileAt(root string, path string) file {
	dir, err := os.OpenRoot(root)
	if err != nil {
		return file{}
	}
	defer dir.Close()
	return readFile(dir, filepath.FromSlash(path), maxFileBytes)
}

func modeFromFileMode(mode string) os.FileMode {
	if mode == "100755" {
		return 0o755
	}
	return 0o644
}

func executable(mode os.FileMode) bool { return mode&0111 != 0 }

// A bounded writer prevents a huge listing/patch from allocating without limit.
type limitedOutput struct {
	buffer bytes.Buffer
	limit  int
	err    error
}

func (b *limitedOutput) Bytes() []byte { return b.buffer.Bytes() }

func (b *limitedOutput) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.buffer.Len() {
		b.err = errors.New("workspace diff output limit exceeded")
		return 0, b.err
	}
	return b.buffer.Write(p)
}

func gitOutput(ctx context.Context, dir string, limit int, args ...string) ([]byte, error) {
	// This read-only observer must work on IDE-managed and shared Windows
	// workspaces even when Git marks their ownership as unusual.
	commandArgs := append([]string{"-c", "safe.directory=" + filepath.ToSlash(dir)}, args...)
	cmd := exec.CommandContext(ctx, "git", commandArgs...)
	configureCommand(cmd)
	cmd.Dir = dir
	// Do not inherit an alternate index/worktree from the host process.
	for _, env := range os.Environ() {
		key, _, _ := strings.Cut(env, "=")
		if !strings.HasPrefix(strings.ToUpper(key), "GIT_") {
			cmd.Env = append(cmd.Env, env)
		}
	}
	cmd.Env = append(cmd.Env, "GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0")
	out := &limitedOutput{limit: limit}
	cmd.Stdout = out
	cmd.WaitDelay = 100 * time.Millisecond
	err := cmd.Run()
	if out.err != nil {
		return nil, out.err
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return out.Bytes(), fmt.Errorf("observe workspace: %w", err)
	}
	return out.Bytes(), nil
}
