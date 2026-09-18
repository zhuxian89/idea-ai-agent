package turndiff

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
	return string(out)
}

func write(t *testing.T, root, path, content string) {
	t.Helper()
	name := filepath.Join(root, filepath.FromSlash(path))
	if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func repo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	root := t.TempDir()
	git(t, root, "init", "-q")
	git(t, root, "config", "user.name", "Test")
	git(t, root, "config", "user.email", "test@example.invalid")
	write(t, root, "Main.java", "old\n")
	write(t, root, ".gitignore", "ignored/\n")
	git(t, root, "add", ".")
	git(t, root, "commit", "-qm", "baseline")
	return root
}

func capture(t *testing.T, root string) *Snapshot {
	t.Helper()
	s, err := Capture(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func finish(t *testing.T, s *Snapshot) *Result {
	t.Helper()
	r, err := s.Finish(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestDiskBaselineExcludesOldDirtyAndStagedEditsWithoutWritingGit(t *testing.T) {
	root := repo(t)
	write(t, root, "Main.java", "staged\n")
	git(t, root, "add", "Main.java")
	write(t, root, "Main.java", "already dirty\n")
	write(t, root, "unchanged-untracked.txt", "unrelated\n")
	indexPath := filepath.Join(root, ".git", "index")
	index, _ := os.ReadFile(indexPath)
	head := git(t, root, "rev-parse", "HEAD")
	s := capture(t, root)
	write(t, root, "Main.java", "this turn\n") // Models exec_command -> patch executor.
	write(t, root, "new file 中文.txt", "created\n")
	write(t, root, "ignored/output.txt", "build result\n")
	write(t, root, ".mindfs/sessions/log.jsonl", "session write\n")
	r := finish(t, s)
	for _, want := range []string{"-already dirty", "+this turn", "+created", "new file mode"} {
		if !strings.Contains(r.Diff, want) {
			t.Fatalf("missing %q:\n%s", want, r.Diff)
		}
	}
	for _, unwanted := range []string{"-old", "-staged", "unrelated", "output.txt", ".mindfs", "a/before/", "b/after/"} {
		if strings.Contains(r.Diff, unwanted) {
			t.Fatalf("unexpected %q:\n%s", unwanted, r.Diff)
		}
	}
	indexAfter, _ := os.ReadFile(indexPath)
	if !bytes.Equal(index, indexAfter) || head != git(t, root, "rev-parse", "HEAD") {
		t.Fatal("observer changed repository metadata")
	}
	if r.Partial {
		t.Fatal("unexpected partial snapshot")
	}
}

func TestDirtyFileRestoredToIndexRemainsVisible(t *testing.T) {
	root := repo(t)
	write(t, root, "Main.java", "pre-existing dirty\n")
	s := capture(t, root)
	write(t, root, "Main.java", "old\n")
	r := finish(t, s)
	if !strings.Contains(r.Diff, "-pre-existing dirty") || !strings.Contains(r.Diff, "+old") {
		t.Fatalf("missing restoration diff:\n%s", r.Diff)
	}
	if len(r.ChangedFiles()) != 1 {
		t.Fatalf("changed files = %#v", r.ChangedFiles())
	}
}

func TestFinishReportsPartialWhenTurnCreatesOversizeFile(t *testing.T) {
	root := repo(t)
	s := capture(t, root)
	write(t, root, "Main.java", strings.Repeat("x", maxFileBytes+1))
	r := finish(t, s)
	if !r.Partial || r.Diff != "" {
		t.Fatalf("partial=%v diff=%s", r.Partial, r.Diff)
	}
}

func TestCommittedDeletedRenamedBinaryAndCRLFChanges(t *testing.T) {
	root := repo(t)
	write(t, root, "删除.txt", "gone\n")
	write(t, root, "rename me.txt", "move\n")
	write(t, root, "image.bin", "\x00old")
	write(t, root, "crlf.txt", "one\r\ntwo\r\n")
	s := capture(t, root)
	if err := os.Remove(filepath.Join(root, "删除.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(root, "rename me.txt"), filepath.Join(root, "renamed.txt")); err != nil {
		t.Fatal(err)
	}
	write(t, root, "image.bin", "\x00new")
	write(t, root, "crlf.txt", "one\r\nchanged\r\n")
	write(t, root, "Main.java", "committed during turn\n")
	git(t, root, "add", ".")
	git(t, root, "commit", "-qm", "during turn")
	r := finish(t, s)
	for _, want := range []string{"deleted file mode", "new file mode", "Binary files a/image.bin and b/image.bin differ", "+committed during turn", "+changed"} {
		if !strings.Contains(r.Diff, want) {
			t.Fatalf("missing %q:\n%s", want, r.Diff)
		}
	}
}

func TestMixedNativeAndShellEditsMergeWithoutDuplicationOrLosingNativeFallback(t *testing.T) {
	root := repo(t)
	s := capture(t, root)
	write(t, root, "Main.java", "native edit\nshell edit\n")
	native := "diff --git a/Main.java b/Main.java\n--- a/Main.java\n+++ b/Main.java\n@@ -1 +1 @@\n-old\n+native edit\n"
	outside := "diff --git a/outside.txt b/outside.txt\n--- a/outside.txt\n+++ b/outside.txt\n@@ -1 +1 @@\n-one\n+two\n"
	merged := finish(t, s).Merge(native + outside)
	if strings.Count(merged, "diff --git a/Main.java") != 1 || !strings.Contains(merged, "+shell edit") || !strings.Contains(merged, outside) {
		t.Fatal(merged)
	}
	write(t, root, "Main.java", "old\n")
	if got := finish(t, s).Merge(native); got != "" {
		t.Fatalf("reverted edit retained: %s", got)
	}
}

func TestSnapshotSkipsOversizeAndSymlinksWithoutFalseNewOrDeletedFiles(t *testing.T) {
	root := repo(t)
	write(t, root, "large.txt", strings.Repeat("x", maxFileBytes+1))
	outside := t.TempDir()
	write(t, outside, "secret", "outside\n")
	if err := os.Symlink(filepath.Join(outside, "secret"), filepath.Join(root, "link")); err != nil {
		t.Log("symlink unavailable:", err)
	}
	s := capture(t, root)
	write(t, root, "large.txt", "now small\n")
	write(t, root, "Main.java", strings.Repeat("x", maxFileBytes+1))
	r := finish(t, s)
	if !r.Partial || r.Diff != "" {
		t.Fatalf("partial=%v diff=%s", r.Partial, r.Diff)
	}
	native := "diff --git a/Main.java b/Main.java\n--- a/Main.java\n+++ b/Main.java\n@@ -1 +1 @@\n-old\n+new\n"
	if got := r.Merge(native); got != native {
		t.Fatal("lost native fallback")
	}
}

func TestSnapshotsAreTurnScopedAndWorktreeScoped(t *testing.T) {
	root := repo(t)
	worktree := filepath.Join(t.TempDir(), "linked worktree")
	git(t, root, "worktree", "add", "-qb", "test-turn", worktree)
	s := capture(t, worktree)
	write(t, root, "Main.java", "other worktree\n")
	write(t, worktree, "Main.java", "first turn\n")
	if diff := finish(t, s).Diff; !strings.Contains(diff, "+first turn") || strings.Contains(diff, "other worktree") {
		t.Fatal(diff)
	}
	next := capture(t, worktree)
	if diff := finish(t, next).Diff; diff != "" {
		t.Fatalf("previous turn leaked: %s", diff)
	}
	write(t, worktree, "Main.java", "second turn\n")
	if diff := finish(t, next).Diff; !strings.Contains(diff, "-first turn") || strings.Contains(diff, "-old") {
		t.Fatal(diff)
	}
}

func TestUnavailableSnapshotAndCanceledCapture(t *testing.T) {
	if _, err := Capture(context.Background(), t.TempDir()); err == nil {
		t.Fatal("non-git directory should be unavailable")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Capture(ctx, repo(t)); err == nil {
		t.Fatal("canceled snapshot must stop")
	}
}

func TestMergeQuotedBinaryAndRenamedNativePaths(t *testing.T) {
	r := &Result{covered: map[string]bool{"中文 file": true, "old.txt": true, "new.txt": true}}
	for _, patch := range []string{
		"diff --git \"a/\\344\\270\\255\\346\\226\\207 file\" \"b/\\344\\270\\255\\346\\226\\207 file\"\nBinary files differ\n",
		"diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n",
	} {
		if got := r.Merge(patch); got != "" {
			t.Fatal(got)
		}
	}
}

func TestTemporaryPathsDoNotRewriteRealPathOrPatchContent(t *testing.T) {
	root := repo(t)
	for _, path := range []string{"after/中文 file.txt", "before/has b/after/name.txt", "before/image and name.bin"} {
		write(t, root, path, "old\n")
	}
	s := capture(t, root)
	write(t, root, "after/中文 file.txt", "+++ b/after/keep-this-content\n")
	write(t, root, "before/has b/after/name.txt", "new\n")
	write(t, root, "before/image and name.bin", "\x00new")
	r := finish(t, s)
	paths := map[string]bool{}
	for _, section := range sections(r.Diff) {
		for _, path := range sectionPaths(section) {
			paths[path] = true
		}
	}
	for _, path := range []string{"after/中文 file.txt", "before/has b/after/name.txt", "before/image and name.bin"} {
		if !paths[path] {
			t.Fatalf("lost path %q:\n%s", path, r.Diff)
		}
	}
	if !strings.Contains(r.Diff, "++++ b/after/keep-this-content") {
		t.Fatal("changed patch body")
	}
}

func TestGitOutputLimitAndSnapshotReadBudget(t *testing.T) {
	root := repo(t)
	if _, err := gitOutput(context.Background(), root, 1, "ls-files", "-z"); err == nil {
		t.Fatal("output limit was bypassed")
	}
	dir, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	if got := readFile(dir, "Main.java", 1); got.known || len(got.data) > 0 {
		t.Fatal("read exceeded remaining snapshot budget")
	}
}

func TestWorktreeDisplayPathsMergeAndOpenRelativeToManagedProject(t *testing.T) {
	root := repo(t)
	s := capture(t, root)
	write(t, root, "Main.java", "new\n")
	write(t, root, "中文.txt", "created\n")
	r := finish(t, s)
	r.MapPaths(func(path string) string { return ".worktree/task 1/" + path })
	paths := map[string]bool{}
	for _, section := range sections(r.Diff) {
		for _, path := range sectionPaths(section) {
			paths[path] = true
		}
	}
	for _, path := range []string{".worktree/task 1/Main.java", ".worktree/task 1/中文.txt"} {
		if !paths[path] {
			t.Fatalf("missing rebased path %q: %s", path, r.Diff)
		}
	}
	native := "diff --git a/.worktree/task 1/Main.java b/.worktree/task 1/Main.java\n--- a/.worktree/task 1/Main.java\n+++ b/.worktree/task 1/Main.java\n@@ -1 +1 @@\n-old\n+native\n"
	if got := r.Merge(native); strings.Count(got, "diff --git") != 2 || strings.Contains(got, "+native") {
		t.Fatal(got)
	}
}
