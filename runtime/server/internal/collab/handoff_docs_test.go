package collab

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"mindfs/server/internal/turndiff"
)

func TestHandoffDocsAndVerifyCitations(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "main.go"), []byte("package main\n\nfunc main() {\n\tprintln(1)\n}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := WriteRunDoc(root, "../escape", DocImpl, "bad"); err == nil {
		t.Fatal("expected traversal run id to fail")
	}
	rel, err := WriteRunDoc(root, "run-001", DocImpl, "# 实现说明")
	if err != nil {
		t.Fatal(err)
	}
	if rel != ".mindfs/runs/run-001/01-impl.md" {
		t.Fatalf("rel = %q", rel)
	}
	if _, err := WriteRunDoc(root, "run-001", DocReport, "# 最终报告"); err != nil {
		t.Fatal(err)
	}
	docs, err := ListRunDocs(root, "run-001")
	if err != nil || len(docs) != 2 {
		t.Fatalf("ListRunDocs = %v, err = %v", docs, err)
	}

	removed, err := CleanupRunDocs(root, "run-001", []string{DocReport})
	if err != nil || len(removed) != 1 || removed[0] != DocImpl {
		t.Fatalf("CleanupRunDocs(keep report) = %v, err = %v", removed, err)
	}
	if _, err := ReadRunDoc(root, "run-001", DocReport); err != nil {
		t.Fatalf("kept report should still exist: %v", err)
	}
	if _, err := CleanupRunDocs(root, "run-001", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, ".mindfs", "runs", "run-001")); !os.IsNotExist(err) {
		t.Fatalf("expected empty run dir removed, stat err = %v", err)
	}

	checked := VerifyCitations(root, []ReviewItem{
		{ItemID: "R1", FilePath: "src/main.go", LineStart: 3, LineEnd: 5},
		{ItemID: "R2", FilePath: "src/main.go", LineStart: 10},
		{ItemID: "R3", FilePath: "src/missing.go", LineStart: 1},
		{ItemID: "R4", FilePath: "../outside.go", LineStart: 1},
		{ItemID: "R5", FilePath: "src/main.go", LineStart: 0},
	})
	if !checked[0].CitationVerified {
		t.Fatalf("R1 expected verified, got note=%q", checked[0].CitationNote)
	}
	for i := 1; i < len(checked); i++ {
		if checked[i].CitationVerified || checked[i].CitationNote == "" {
			t.Fatalf("R%d expected unverified with note, got %#v", i+1, checked[i])
		}
	}

	// Symlink escaping root must not pass citation check.
	outside := filepath.Join(t.TempDir(), "outside.go")
	if err := os.WriteFile(outside, []byte("package outside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "src", "leak.go")); err == nil {
		symChecked := VerifyCitations(root, []ReviewItem{{ItemID: "RS", FilePath: "src/leak.go", LineStart: 1}})
		if symChecked[0].CitationVerified {
			t.Fatalf("expected symlink escaping root to be rejected, got %#v", symChecked[0])
		}
	}

	// Hidden .impl-diff.json metadata must not pollute ListRunDocs and must be cleaned up.
	if err := WriteImplDiffMeta(root, "run-meta", ImplDiffMeta{Observed: true, Diff: "+hello"}); err != nil {
		t.Fatal(err)
	}
	if docs, err := ListRunDocs(root, "run-meta"); err != nil || len(docs) != 0 {
		t.Fatalf("expected dotfile hidden from ListRunDocs, got %v err=%v", docs, err)
	}
	if meta, ok := ReadImplDiffMeta(root, "run-meta"); !ok || !meta.Observed || meta.Diff != "+hello" {
		t.Fatalf("ReadImplDiffMeta = %#v ok=%v", meta, ok)
	}
	if removedMeta, err := CleanupRunDocs(root, "run-meta", nil); err != nil || len(removedMeta) != 0 {
		t.Fatalf("CleanupRunDocs on meta-only dir = %v err=%v", removedMeta, err)
	}

	// Symlinked .mindfs/runs/<id> or symlinked doc inside runDir must never delete or overwrite outside files!
	externalDir := t.TempDir()
	victimFile := filepath.Join(externalDir, "keep-alive.txt")
	if err := os.WriteFile(victimFile, []byte("DO_NOT_DELETE"), 0o644); err != nil {
		t.Fatal(err)
	}
	runsBase := filepath.Join(root, ".mindfs", "runs")
	if err := os.MkdirAll(runsBase, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(externalDir, filepath.Join(runsBase, "run-escape")); err == nil {
		if _, err := WriteRunDoc(root, "run-escape", DocImpl, "overwrite"); err == nil {
			t.Fatal("expected WriteRunDoc on symlinked runDir to fail")
		}
		if _, err := ReadRunDoc(root, "run-escape", "keep-alive.txt"); err == nil {
			t.Fatal("expected ReadRunDoc on symlinked runDir to fail")
		}
		if _, err := CleanupRunDocs(root, "run-escape", nil); err == nil {
			t.Fatal("expected CleanupRunDocs on symlinked runDir to fail")
		}
		if data, err := os.ReadFile(victimFile); err != nil || string(data) != "DO_NOT_DELETE" {
			t.Fatalf("external victim file was touched: err=%v content=%q", err, string(data))
		}
	}
}

func TestReadOnlySnapshotExcludesRunDocsAndFlagsRealEdits(t *testing.T) {
	ctx := context.Background()
	repo := t.TempDir()
	runGit := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, string(out))
		}
	}
	runGit("init")
	runGit("config", "user.email", "test@example.com")
	runGit("config", "user.name", "Test")
	target := filepath.Join(repo, "app.go")
	if err := os.WriteFile(target, []byte("package app\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit("add", "app.go")
	runGit("commit", "-m", "init")

	snap1, err := turndiff.Capture(ctx, repo)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := WriteRunDoc(repo, "run-readonly", DocReview, "# 审核报告\n无问题"); err != nil {
		t.Fatal(err)
	}
	state1, paths1, _ := FinishReadOnlySnapshot(ctx, snap1, nil)
	if state1 != ReadOnlyClean || len(paths1) != 0 {
		t.Fatalf("handoff doc under .mindfs/runs triggered false diff: state=%s paths=%v", state1, paths1)
	}

	snap2, err := turndiff.Capture(ctx, repo)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("package app\n// mutated\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	state2, paths2, note2 := FinishReadOnlySnapshot(ctx, snap2, nil)
	if state2 != ReadOnlyModified || len(paths2) != 1 || paths2[0] != "app.go" || note2 == "" {
		t.Fatalf("expected ReadOnlyModified on app.go, got state=%s paths=%v note=%q", state2, paths2, note2)
	}

	state3, _, note3 := FinishReadOnlySnapshot(ctx, nil, errors.New("git unavailable"))
	if state3 != ReadOnlyUnobserved || note3 == "" {
		t.Fatalf("unobserved snapshot must not report clean: state=%s note=%q", state3, note3)
	}
}

func TestRemoveRunDirDeletesAllSubdirsAndRejectsSymlinks(t *testing.T) {
	root := t.TempDir()
	runID := "run-full-clean"
	if _, err := WriteRunDoc(root, runID, DocImpl, "# impl"); err != nil {
		t.Fatal(err)
	}
	if err := WriteImplDiffMeta(root, runID, ImplDiffMeta{Observed: true, Diff: "+x"}); err != nil {
		t.Fatal(err)
	}
	extraDir := filepath.Join(root, ".mindfs", "runs", runID, "extra-artifacts", "nested")
	if err := os.MkdirAll(extraDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(extraDir, "notes.txt"), []byte("extra"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Symlink inside runDir must be unlinked without touching its external target.
	externalDir := t.TempDir()
	victim := filepath.Join(externalDir, "keep.txt")
	if err := os.WriteFile(victim, []byte("SAFE"), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = os.Symlink(externalDir, filepath.Join(root, ".mindfs", "runs", runID, "ext-link"))

	if err := RemoveRunDir(root, runID); err != nil {
		t.Fatalf("RemoveRunDir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".mindfs", "runs", runID)); !os.IsNotExist(err) {
		t.Fatalf("expected run dir completely removed, stat err=%v", err)
	}
	if data, err := os.ReadFile(victim); err != nil || string(data) != "SAFE" {
		t.Fatalf("external victim file modified or deleted: err=%v data=%q", err, string(data))
	}

	// Symlinked .mindfs/runs/<id> itself must fail without touching outside files.
	if err := os.Symlink(externalDir, filepath.Join(root, ".mindfs", "runs", "run-symlink-escape")); err == nil {
		if err := RemoveRunDir(root, "run-symlink-escape"); err == nil {
			t.Fatal("expected RemoveRunDir on symlinked runDir to fail")
		}
		if data, err := os.ReadFile(victim); err != nil || string(data) != "SAFE" {
			t.Fatalf("external victim file touched via symlinked runDir: err=%v data=%q", err, string(data))
		}
	}
}
