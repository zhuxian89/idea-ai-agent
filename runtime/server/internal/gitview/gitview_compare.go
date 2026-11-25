package gitview

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func ReadHeadWorktreeFileCompare(ctx context.Context, rootPath, relPath string) (FileCompareResult, error) {
	repo, err := loadRepoContext(ctx, rootPath)
	if err != nil {
		return FileCompareResult{}, err
	}
	path := strings.TrimSpace(relPath)
	if path == "" {
		return FileCompareResult{}, errors.New("path required")
	}
	items, err := repo.statusItems(ctx)
	if err != nil {
		return FileCompareResult{}, err
	}
	var matched *StatusItem
	for i := range items {
		if items[i].Path == path {
			matched = &items[i]
			break
		}
	}
	if matched == nil {
		return FileCompareResult{}, errors.New("git diff not found for path")
	}

	headPath := matched.Path
	if matched.OldPath != "" {
		headPath = matched.OldPath
	}
	headRepoPath := repo.toRepoPath(headPath)
	headTreeEntry, err := runGit(
		ctx,
		repo.repoRoot,
		"ls-tree",
		"HEAD",
		"--",
		headRepoPath,
	)
	if err != nil {
		return FileCompareResult{}, err
	}
	headPresent := strings.TrimSpace(headTreeEntry) != ""
	var head FileCompareSide
	if headPresent {
		headObject := "HEAD:" + headRepoPath
		data, err := runGitBytes(ctx, repo.repoRoot, "cat-file", "--filters", "--path="+headRepoPath, headObject)
		if err != nil {
			return FileCompareResult{}, err
		}
		head = fileCompareSide(data)
	}

	worktreePath := filepath.Join(repo.rootPath, filepath.FromSlash(path))
	worktree, err := readWorktreeFileCompareSide(worktreePath)
	if err != nil {
		return FileCompareResult{}, err
	}
	return FileCompareResult{Path: path, Head: head, Worktree: worktree}, nil
}

func readWorktreeFileCompareSide(path string) (FileCompareSide, error) {
	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return FileCompareSide{}, nil
		}
		return FileCompareSide{}, err
	}
	if info.IsDir() {
		return FileCompareSide{}, errors.New("path is a directory")
	}
	if info.Size() > maxFileCompareBytes {
		return FileCompareSide{}, errors.New("file is too large to compare")
	}
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return FileCompareSide{}, err
	}
	defer root.Close()
	file, err := root.Open(filepath.Base(path))
	if err != nil {
		return FileCompareSide{}, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxFileCompareBytes+1))
	if err != nil {
		return FileCompareSide{}, err
	}
	if len(data) > maxFileCompareBytes {
		return FileCompareSide{}, errors.New("file is too large to compare")
	}
	return fileCompareSide(data), nil
}

func fileCompareSide(data []byte) FileCompareSide {
	return FileCompareSide{Present: true, Binary: isBinaryData(data), Data: data}
}

func isBinaryData(data []byte) bool {
	return bytes.IndexByte(data, 0) >= 0
}

func loadRepoContext(ctx context.Context, rootPath string) (repoContext, error) {
	rootPath = filepath.Clean(rootPath)
	if resolvedRootPath, err := filepath.EvalSymlinks(rootPath); err == nil {
		rootPath = filepath.Clean(resolvedRootPath)
	}
	repoRootOutput, err := runGit(ctx, rootPath, "rev-parse", "--show-toplevel")
	if err != nil {
		return repoContext{}, err
	}
	repoRoot := strings.TrimSpace(repoRootOutput)
	if repoRoot == "" {
		return repoContext{}, errors.New("empty git repo root")
	}
	if resolvedRepoRoot, err := filepath.EvalSymlinks(repoRoot); err == nil {
		repoRoot = filepath.Clean(resolvedRepoRoot)
	}
	relPrefix, err := filepath.Rel(repoRoot, rootPath)
	if err != nil {
		return repoContext{}, err
	}
	prefix := filepath.ToSlash(relPrefix)
	if prefix == "." {
		prefix = ""
	}
	branchOutput, err := runGit(ctx, repoRoot, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		branchOutput = ""
	}
	return repoContext{
		repoRoot: repoRoot,
		rootPath: rootPath,
		prefix:   prefix,
		branch:   strings.TrimSpace(branchOutput),
	}, nil
}
