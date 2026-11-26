package collab

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"

	_ "modernc.org/sqlite"
)

type fakeCollabRunner struct {
	mu             sync.Mutex
	store          *Store
	rootPath       string
	statuses       []agent.Status
	turns          []StageTurnRequest
	handler        func(callIndex int, req StageTurnRequest) (string, error)
	beforeRootPath func()
}

func (f *fakeCollabRunner) GetCollabStore(string) (*Store, error) { return f.store, nil }
func (f *fakeCollabRunner) RootPath(string) (string, error) {
	if f.beforeRootPath != nil {
		f.beforeRootPath()
	}
	return f.rootPath, nil
}
func (f *fakeCollabRunner) AgentStatuses() []agent.Status { return f.statuses }

func (f *fakeCollabRunner) EnsureStageSession(_ context.Context, req StageSessionRequest) (string, error) {
	return req.SessionKey, nil
}

func (f *fakeCollabRunner) RunStageTurn(_ context.Context, req StageTurnRequest) (StageTurnResult, error) {
	f.mu.Lock()
	idx := len(f.turns)
	f.turns = append(f.turns, req)
	fn := f.handler
	f.mu.Unlock()

	raw, err := fn(idx, req)
	if err != nil {
		return StageTurnResult{}, err
	}
	// A stage's normal prose must reach the author as it arrives; only the machine block stays hidden.
	var transcript strings.Builder
	body, control, hasBlock := strings.Cut(raw, "```mindfs-control")
	transcript.WriteString(req.StreamFilter.Push(body))
	if strings.Contains(body, "\n") && transcript.Len() == 0 {
		return StageTurnResult{}, errors.New("stage body was suppressed until completion")
	}
	if hasBlock {
		for _, part := range []string{"```mind", "fs-control", control} {
			transcript.WriteString(req.StreamFilter.Push(part))
		}
	}
	transcript.WriteString(req.StreamFilter.Flush())
	if transcript.String() != req.StreamFilter.VisibleText() || strings.Contains(transcript.String(), "```mindfs-control") {
		return StageTurnResult{}, errors.New("stage transcript differs from visible handoff")
	}
	suffix := req.StreamFilter.CompletionSuffix()
	if req.ReadOnly {
		if _, pErr := parseReviewControl(req.StreamFilter.Blocks()); pErr != nil {
			if suffix != "" {
				return StageTurnResult{}, fmt.Errorf("incomplete review emitted premature suffix: %q", suffix)
			}
			return StageTurnResult{}, nil
		}
	}
	if strings.TrimSpace(req.StreamFilter.VisibleText()) != "" {
		if !strings.Contains(suffix, "阶段交付路径：.mindfs/runs/") {
			return StageTurnResult{}, fmt.Errorf("missing delivery path suffix: %q", suffix)
		}
		if strings.Contains(req.StreamFilter.VisibleText(), "阶段交付路径：") {
			return StageTurnResult{}, errors.New("delivery path suffix leaked into VisibleText")
		}
	}
	return StageTurnResult{}, nil
}

func (f *fakeCollabRunner) CollabChangedFiles(context.Context, string, string, time.Time) (ChangeList, error) {
	return ChangeList{Paths: []string{"service.go"}}, nil
}

func (f *fakeCollabRunner) CancelStageTurn(context.Context, string, string) error { return nil }
func (f *fakeCollabRunner) DeleteStageSession(context.Context, string, string) error {
	return nil
}
func (f *fakeCollabRunner) RunUpdated(string, Run, int) {}

func newTestGitRepo(t *testing.T) string {
	t.Helper()
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
	if err := os.WriteFile(filepath.Join(repo, "AGENTS.md"), []byte("# 项目规范\n禁止过度防御。\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "service.go"), []byte("package demo\n\nfunc Run() int {\n\treturn 1\n}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit("add", ".")
	runGit("commit", "-m", "init")
	return repo
}

func waitForRunCondition(t *testing.T, svc *Service, rootID, runID string, pred func(RunDetail) bool) RunDetail {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		detail, err := svc.GetRunDetail(context.Background(), rootID, runID)
		if err == nil && pred(detail) {
			return detail
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for run %s; latest=%#v err=%v", runID, detail.Run, err)
		}
		time.Sleep(15 * time.Millisecond)
	}
}

func TestQuickModeEndToEndCompletenessDisputesAndNoAutoLoopOnTestFail(t *testing.T) {
	repo := newTestGitRepo(t)
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "session-list.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	tplStore, err := NewTemplateStoreAt(filepath.Join(t.TempDir(), "collab-templates.json"))
	if err != nil {
		t.Fatal(err)
	}

	var concurrentDecisions atomic.Bool
	ready, release := make(chan struct{}, 2), make(chan struct{})
	runner := &fakeCollabRunner{
		store:    store,
		rootPath: repo,
		beforeRootPath: func() {
			if concurrentDecisions.Load() {
				ready <- struct{}{}
				<-release
			}
		},
		statuses: []agent.Status{
			{Name: "claude", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "claude-opus-4-6"}}},
			{Name: "codex", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "gpt-5.4"}}, Modes: []agenttypes.ModeInfo{{ID: "full-access"}}},
		},
	}

	runner.handler = func(callIndex int, req StageTurnRequest) (string, error) {
		wantPermission := "full-access"
		if req.ReadOnly {
			wantPermission = ""
		}
		if req.PermissionMode != wantPermission {
			t.Errorf("stage %s permission = %q, want %q", req.SessionKey, req.PermissionMode, wantPermission)
		}
		if !strings.Contains(req.Prompt, ".mindfs/runs/") || len([]rune(req.Prompt)) > 220 || strings.Contains(req.Prompt, "mindfs-control") || strings.Contains(req.Prompt, "diff --git") {
			t.Errorf("invalid handoff message: %q", req.Prompt)
		}
		pathParts := strings.Split(req.Prompt, "`")
		if len(pathParts) != 3 {
			return "", fmt.Errorf("no document path in message")
		}
		if _, err := os.ReadFile(filepath.Join(repo, pathParts[1])); err != nil {
			return "", err
		}

		switch callIndex {
		case 0: // Step 1: Primary implements
			if req.ReadOnly {
				t.Errorf("Step 1 should not be ReadOnly")
			}
			_ = os.WriteFile(filepath.Join(repo, "service.go"), []byte("package demo\n\nfunc Run() int {\n\treturn 42\n}\n"), 0o644)
			return "# 实现说明\n\n已将返回值更新为 42。", nil
		case 1: // Step 2: Read-Only Reviewer
			if !req.ReadOnly {
				t.Errorf("Step 2 Reviewer must be ReadOnly")
			}
			return strings.Join([]string{
				"# 审核意见",
				"发现 3 处需要确认的问题。",
				"```mindfs-control",
				`{
					"kind": "review",
					"summary": "发现 3 处意见",
					"items": [
						{"item_id": "R1", "dimension": "functional", "severity": "high", "file_path": "service.go", "line_start": 3, "line_end": 5, "title": "边界返回检查", "description": "需确认 42 常量逻辑"},
						{"item_id": "R2", "dimension": "standard", "severity": "medium", "file_path": "service.go", "line_start": 4, "rule_ref": "AGENTS.md 禁止过度防御", "title": "避免冗余判空", "description": "此处无需额外包装"},
						{"item_id": "R3", "dimension": "functional", "severity": "low", "file_path": "service.go", "line_start": 999, "title": "虚构行号测试", "description": "行号越界应被后台标出"}
					]
				}`,
				"```",
			}, "\n"), nil
		case 2: // Step 3 (first attempt): omits R3 -> must block!
			return strings.Join([]string{
				"# 逐条回应（漏了 R3）",
				"```mindfs-control",
				`{
					"kind": "response",
					"responses": [
						{"item_id": "R1", "status": "accepted", "note": "已在 service.go:4 核对并补充注释"},
						{"item_id": "R2", "status": "disputed", "note": "当前没有任何冗余判空，保持原状更简洁"}
					]
				}`,
				"```",
			}, "\n"), nil
		case 3: // Step 3 (continuation): covers R1, R2, R3 (R3 accepted without note -> forced to disputed!)
			return strings.Join([]string{
				"# 逐条回应（完整）",
				"```mindfs-control",
				`{
					"kind": "response",
					"responses": [
						{"item_id": "R1", "status": "accepted", "note": "已在 service.go:4 补充说明"},
						{"item_id": "R2", "status": "disputed", "note": "当前无冗余判空，交由作者决定"},
						{"item_id": "R3", "status": "accepted", "note": ""}
					]
				}`,
				"```",
			}, "\n"), nil
		case 4: // Step 5: Final fix + tests (reports failed test -> must NOT auto-loop!)
			return strings.Join([]string{
				"# 最终测试报告",
				"运行单元测试发现 1 处既有断言待作者确认。",
				"```mindfs-control",
				`{
					"kind": "report",
					"test_status": "failed",
					"test_command": "go test ./...\nnode --test tests/collab-quick-mode.test.mjs",
					"test_summary": "1 个断言失败：want 1 got 42"
				}`,
				"```",
			}, "\n"), nil
		case 5:
			if !req.ReadOnly || !strings.Contains(req.SessionKey, "-r2-review") {
				return "", fmt.Errorf("wrong round 2 reviewer")
			}
			return "核对完成，前三项已解决。\n```mindfs-control\n" + `{"kind":"review","resolved":["R1","R2","R3"],"items":[]}` + "\n```", nil
		case 6:
			return "第二轮验收完成。执行 `go test ./...`。\n```mindfs-control\n" + `{"kind":"report","test_status":"passed","test_command":"go test ./...","test_summary":"通过"}` + "\n```", nil

		default:
			t.Fatalf("unexpected extra turn %d", callIndex)
			return "", nil
		}
	}

	svc := NewService(tplStore, runner)
	svc.SetHomeDir(t.TempDir())

	// Unavailable model must be rejected up front without silent substitution.
	_, badErr := svc.StartQuickRun(context.Background(), StartQuickRunInput{
		RootID:     "r1",
		TaskPrompt: "修改返回值",
		Members: []MemberSlot{
			{Role: RolePrimary, Agent: "claude", Model: "claude-opus-4-6"},
			{Role: RoleReviewer, Agent: "codex", Model: "non-existent-model"},
		},
	})
	if badErr == nil || !strings.Contains(badErr.Error(), "non-existent-model") {
		t.Fatalf("expected unavailable model rejection, got %v", badErr)
	}

	started, err := svc.StartQuickRun(context.Background(), StartQuickRunInput{
		RootID:     "r1",
		TaskPrompt: "修改 Run() 返回值为 42",
		Members: []MemberSlot{
			{Role: RolePrimary, Agent: "codex", Model: "gpt-5.4", Effort: "high", PermissionMode: "full-access"},
			{Role: RoleReviewer, Agent: "claude", Model: "claude-opus-4-6", Effort: "xhigh", PermissionMode: "bypassPermissions"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	runID := started.Run.ID

	// Should pause at StepResponse because R3 was omitted!
	pausedIncomplete := waitForRunCondition(t, svc, "r1", runID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusWaitingUser && d.Run.CurrentStep == StepResponse
	})
	if !strings.Contains(pausedIncomplete.Run.Steps[2].Summary, "R3") {
		t.Fatalf("expected missing R3 summary, got %q", pausedIncomplete.Run.Steps[2].Summary)
	}
	// Verify R1 Verified=true and R3 Verified=false!
	if !pausedIncomplete.ReviewItems[0].CitationVerified || pausedIncomplete.ReviewItems[2].CitationVerified {
		t.Fatalf("citation verification mismatch: %#v", pausedIncomplete.ReviewItems)
	}
	if pausedIncomplete.Run.ReadOnlyCheckState != string(ReadOnlyClean) {
		t.Fatalf("ReadOnlyCheckState = %q, want clean", pausedIncomplete.Run.ReadOnlyCheckState)
	}

	// Continue Step 3 -> covers all items, R2 & R3 become disputed -> pauses at StepDecisions!
	if _, err := svc.ContinueRun(context.Background(), "r1", runID); err != nil {
		t.Fatal(err)
	}
	waitingDecisions := waitForRunCondition(t, svc, "r1", runID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusWaitingUser && d.Run.CurrentStep == StepDecisions
	})
	checked, err := svc.ContinueRun(context.Background(), "r1", runID)
	if err != nil || checked.ProgressAction != "waiting_for_decisions" || checked.Run.CurrentStep != StepDecisions {
		t.Fatalf("progress check bypassed author decisions: %s %s %v", checked.ProgressAction, checked.Run.CurrentStep, err)
	}
	if waitingDecisions.ReviewItems[0].PrimaryStatus != PrimaryStatusAccepted {
		t.Fatalf("R1 expected accepted: %#v", waitingDecisions.ReviewItems[0])
	}
	if waitingDecisions.ReviewItems[1].PrimaryStatus != PrimaryStatusDisputed {
		t.Fatalf("R2 expected disputed: %#v", waitingDecisions.ReviewItems[1])
	}
	if waitingDecisions.ReviewItems[2].PrimaryStatus != PrimaryStatusDisputed || !waitingDecisions.ReviewItems[2].ParseFallback {
		t.Fatalf("R3 empty accepted note must fallback to disputed: %#v", waitingDecisions.ReviewItems[2])
	}

	// Partial decision submission (missing R3) must fail.
	if _, err := svc.SubmitDecisions(context.Background(), SubmitDecisionsInput{
		RootID:    "r1",
		RunID:     runID,
		Decisions: []ItemDecision{{ItemID: "R2", Decision: DecisionKeepPrimary}},
	}); err == nil {
		t.Fatal("expected partial decision submission to fail")
	}

	submission := SubmitDecisionsInput{
		RootID: "r1",
		RunID:  runID,
		Decisions: []ItemDecision{
			{ItemID: "R2", Decision: DecisionKeepPrimary},
			{ItemID: "R3", Decision: DecisionCustom, Note: "第一次裁决"},
		},
	}
	decisionDoc := waitingDecisions.Run.doc(DocDecisions)
	decisionTmp := filepath.Join(repo, DocRelPath(runID, decisionDoc)+".tmp")
	if err := os.Mkdir(decisionTmp, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitDecisions(context.Background(), submission); err == nil {
		t.Fatal("expected decision document write to fail")
	}
	afterFailure, err := svc.GetRunDetail(context.Background(), "r1", runID)
	if err != nil || afterFailure.Run.CurrentStep != StepDecisions || afterFailure.ReviewItems[2].AuthorDecision != "" {
		t.Fatalf("failed document write persisted decisions: %#v, err=%v", afterFailure, err)
	}
	if err := os.Remove(decisionTmp); err != nil {
		t.Fatal(err)
	}

	// Both requests read the same waiting state before either can submit.
	type result struct {
		note string
		err  error
	}
	results := make(chan result, 2)
	concurrentDecisions.Store(true)
	for _, note := range []string{"浏览器甲的裁决", "浏览器乙的裁决"} {
		go func() {
			in := submission
			in.Decisions = append([]ItemDecision(nil), submission.Decisions...)
			in.Decisions[1].Note = note
			_, err := svc.SubmitDecisions(context.Background(), in)
			results <- result{note, err}
		}()
	}
	for range 2 {
		select {
		case <-ready:
		case <-time.After(3 * time.Second):
			close(release)
			t.Fatal("both decision requests did not reach submission")
		}
	}
	concurrentDecisions.Store(false)
	close(release)
	var winner string
	for range 2 {
		if got := <-results; got.err == nil {
			if winner != "" {
				t.Fatal("both decision requests succeeded")
			}
			winner = got.note
		}
	}

	completed := waitForRunCondition(t, svc, "r1", runID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusCompleted
	})
	if completed.Run.TestStatus != TestStatusFailed {
		t.Fatalf("TestStatus = %q, want failed", completed.Run.TestStatus)
	}
	report, err := ReadRunDoc(repo, runID, completed.Run.doc(DocReport))
	commands := "## 测试命令\n\n    go test ./...\n    node --test tests/collab-quick-mode.test.mjs"
	if err != nil || !strings.Contains(report, commands) || strings.Contains(report, ControlBlockFenceTag) {
		t.Fatalf("report must include the recorded commands without the control block: %q, err=%v", report, err)
	}
	decisionBody, err := ReadRunDoc(repo, runID, decisionDoc)
	if err != nil || winner == "" || completed.ReviewItems[2].AuthorNote != winner || !strings.Contains(decisionBody, winner) {
		t.Fatalf("persisted decisions do not match winner %q: doc=%q, items=%+v, err=%v", winner, decisionBody, completed.ReviewItems, err)
	}
	if len(completed.Docs) < 5 {
		t.Fatalf("expected all 5 handoff docs on disk, got %v", completed.Docs)
	}
	runner.mu.Lock()
	totalTurns := len(runner.turns)
	runner.mu.Unlock()
	if totalTurns != 5 {
		t.Fatalf("expected exactly 5 turns (no auto-rework loop), got %d", totalTurns)
	}

	reviewPath := "第01轮/02-审核意见.md"
	original, err := ReadRunDoc(repo, runID, reviewPath)
	if err != nil || !strings.Contains(original, "需确认 42 常量逻辑") {
		t.Fatalf("review missing evidence %v", err)
	}
	authorNote := "请额外检查 Run() 是否有冗余常量\n[file: .mindfs/attachments/evidence.png]"
	noteTmp := filepath.Join(repo, DocRelPath(runID, "第02轮/00-作者补充意见.md")+".tmp")
	if err := os.MkdirAll(noteTmp, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.NextReview(context.Background(), "r1", runID, 1, authorNote); err == nil {
		t.Fatal("expected author note write to fail")
	}
	previous, err := svc.GetRunDetail(context.Background(), "r1", runID)
	if err != nil || previous.Run.Round != 1 || previous.Run.Status != RunStatusCompleted || len(previous.ReviewItems) != 3 {
		t.Fatalf("failed author note write changed the previous round: %#v, err=%v", previous, err)
	}
	if err := os.Remove(noteTmp); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.NextReview(context.Background(), "r1", runID, 1, authorNote); err != nil {
		t.Fatal(err)
	}
	completed = waitForRunCondition(t, svc, "r1", runID, func(d RunDetail) bool { return d.Run.Round == 2 && d.Run.Status == RunStatusCompleted })
	report, err = ReadRunDoc(repo, runID, completed.Run.doc(DocReport))
	if err != nil || strings.Count(report, "go test ./...") != 1 {
		t.Fatalf("report must not repeat a command already in the body: %q, err=%v", report, err)
	}
	if _, err := svc.NextReview(context.Background(), "r1", runID, 1, ""); err == nil {
		t.Fatal("stale round accepted")
	}
	preserved, err := ReadRunDoc(repo, runID, reviewPath)
	if err != nil || preserved != original {
		t.Fatal("first review overwritten")
	}
	for file, want := range map[string]string{
		"第02轮/00-作者补充意见.md": authorNote,
		"第02轮/本轮改动清单.md":    "service.go",
		"第02轮/02-审核依据.md":   "第02轮/00-作者补充意见.md",
		"第02轮/05-交付要求.md":   "第02轮/00-作者补充意见.md",
		"第02轮/05-改动结果.md":   "第二轮验收完成",
	} {
		text, err := ReadRunDoc(repo, runID, file)
		if err != nil || !strings.Contains(text, want) {
			t.Fatalf("%s missing %s: %v", file, want, err)
		}
		if file == "第02轮/02-审核依据.md" && !strings.Contains(text, "打开其中列出的附件") {
			t.Fatal("review instructions do not reference the author's attachments")
		}
	}
	// Clean up process docs.
	cleanedDetail, removed, err := svc.CleanupDocs(context.Background(), "r1", runID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != len(completed.Docs) || !cleanedDetail.Run.DocsCleaned {
		t.Fatalf("CleanupDocs removed=%v cleaned=%v", removed, cleanedDetail.Run.DocsCleaned)
	}
}

func TestReconcilePrimaryResponsesUnparseableDefaultsToDisputed(t *testing.T) {
	items := []ReviewItem{
		{ItemID: "R1", Title: "问题一"},
		{ItemID: "R2", Title: "问题二"},
	}
	updated, _, missing := ReconcilePrimaryResponses(items, nil)
	if len(missing) != 0 {
		t.Fatalf("missing = %v, want fallback to disputed instead of missing", missing)
	}
	for _, it := range updated {
		if it.PrimaryStatus != PrimaryStatusDisputed || !it.ParseFallback {
			t.Fatalf("expected disputed fallback, got %#v", it)
		}
	}
}

func TestRecoverInterruptedRunsR10IDsAndIncrementalResponses(t *testing.T) {
	ctx := context.Background()
	tmp := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(tmp, "collab.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}

	// 1. Persisted "running" run from prior process is recovered to waiting_user.
	stuck, err := store.CreateRun(ctx, Run{
		ID:          "run-stuck",
		RootID:      "r1",
		Mode:        ModeQuick,
		Title:       "中断恢复验证",
		TaskPrompt:  "测试重启恢复",
		Status:      RunStatusRunning,
		CurrentStep: StepReview,
		Steps: []StepCard{
			{Key: StepImpl, Title: "实现", Status: StepStatusDone},
			{Key: StepReview, Title: "审核", Status: StepStatusRunning},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecoverInterruptedRuns(ctx); err != nil {
		t.Fatal(err)
	}
	recovered, err := store.GetRun(ctx, stuck.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Status != RunStatusWaitingUser || recovered.Steps[1].Status != StepStatusWaitingUser {
		t.Fatalf("expected waiting_user after recovery, got run=%s step=%s", recovered.Status, recovered.Steps[1].Status)
	}

	// 2. ReplaceReviewItems with >9 unnamed items generates R10..R12, never ASCII punctuation.
	unnamed := make([]ReviewItem, 12)
	for i := range unnamed {
		unnamed[i] = ReviewItem{Title: "条目"}
	}
	if err := store.ReplaceReviewItems(ctx, stuck.ID, unnamed); err != nil {
		t.Fatal(err)
	}
	savedItems, err := store.ListReviewItems(ctx, stuck.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(savedItems) != 12 || savedItems[9].ItemID != "R10" || savedItems[11].ItemID != "R12" {
		t.Fatalf("unexpected generated item IDs: [9]=%q [11]=%q", savedItems[9].ItemID, savedItems[11].ItemID)
	}

	// 3. Incremental Step 3 response merge preserves Turn 1 answers when Turn 2 supplies missing items.
	twoItems := []ReviewItem{
		{ItemID: "R1", Title: "问题一"},
		{ItemID: "R2", Title: "问题二"},
	}
	f1 := NewControlStreamFilter()
	f1.Push("```mindfs-control\n{\"kind\":\"response\",\"responses\":[{\"item_id\":\"R1\",\"status\":\"accepted\",\"note\":\"已在 main.go:10 修复\"}]}\n```\n")
	f1.Flush()
	partial, _, missing := ReconcilePrimaryResponses(twoItems, f1.Blocks())
	if len(missing) != 1 || missing[0] != "R2" || partial[0].PrimaryStatus != PrimaryStatusAccepted {
		t.Fatalf("expected R2 missing and R1 preserved, got missing=%v partial=%#v", missing, partial)
	}

	f2 := NewControlStreamFilter()
	f2.Push("```mindfs-control\n{\"kind\":\"response\",\"responses\":[{\"item_id\":\"R2\",\"status\":\"disputed\",\"note\":\"需作者确认兼容性\"}]}\n```\n")
	f2.Flush()
	merged, _, missing2 := ReconcilePrimaryResponses(partial, f2.Blocks())
	if len(missing2) != 0 || merged[0].PrimaryStatus != PrimaryStatusAccepted || merged[1].PrimaryStatus != PrimaryStatusDisputed {
		t.Fatalf("expected full merge without missing, got missing=%v merged=%#v", missing2, merged)
	}
}

func TestPauseThenImmediateContinueNeverDropsContinuation(t *testing.T) {
	ctx := context.Background()
	tmp := t.TempDir()
	repo := newTestGitRepo(t)
	db, err := sql.Open("sqlite", filepath.Join(tmp, "pause.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	tplStore, err := NewTemplateStoreAt(filepath.Join(tmp, "templates.json"))
	if err != nil {
		t.Fatal(err)
	}

	reviewEntered := make(chan struct{})
	releaseReview := make(chan struct{})

	runner := &fakeCollabRunner{
		store:    store,
		rootPath: repo,
		statuses: []agent.Status{
			{Name: "codex", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "gpt-5.3-codex"}}},
			{Name: "claude", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "claude-opus-4-6"}}},
		},
		handler: func(callIndex int, req StageTurnRequest) (string, error) {
			switch callIndex {
			case 0:
				return "# 实现交付\n已完成实现。", nil
			case 1:
				close(reviewEntered)
				<-releaseReview
				return "", context.Canceled
			case 2:
				return "# 审核无问题\n```mindfs-control\n{\"kind\":\"review\",\"summary\":\"无问题\",\"items\":[]}\n```\n", nil
			case 3:
				return "# 报告\n```mindfs-control\n{\"kind\":\"report\",\"test_status\":\"passed\",\"test_command\":\"go test ./...\",\"test_summary\":\"全部通过\"}\n```\n", nil
			default:
				return "", fmt.Errorf("unexpected turn %d in %s", callIndex, req.SessionKey)
			}
		},
	}

	svc := NewService(tplStore, runner)
	svc.SetHomeDir(tmp)

	started, err := svc.StartQuickRun(ctx, StartQuickRunInput{
		RootID:     "r1",
		TaskPrompt: "验证暂停后立即继续不丢请求",
		Members: []MemberSlot{
			{Role: RolePrimary, Agent: "codex", Model: "gpt-5.3-codex"},
			{Role: RoleReviewer, Agent: "claude", Model: "claude-opus-4-6"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	runID := started.Run.ID

	<-reviewEntered

	checked, err := svc.ContinueRun(ctx, "r1", runID)
	if err != nil || checked.ProgressAction != "running" || checked.Run.CurrentStep != StepReview {
		t.Fatalf("live review check = %s %s %v", checked.ProgressAction, checked.Run.CurrentStep, err)
	}

	// Pause and resume while the first review is still unwinding.
	paused, err := svc.PauseRun(ctx, "r1", runID)
	if err != nil {
		t.Fatal(err)
	}
	if paused.Run.Status != RunStatusWaitingUser {
		t.Fatalf("PauseRun status = %q, want waiting_user", paused.Run.Status)
	}
	if paused.Run.ReadOnlyCheckState != string(ReadOnlyUnobserved) {
		t.Fatalf("paused review check = %q, want unobserved", paused.Run.ReadOnlyCheckState)
	}

	// Immediately Continue BEFORE Turn 1 exits!
	cont, err := svc.ContinueRun(ctx, "r1", runID)
	if err != nil {
		t.Fatal(err)
	}
	if cont.Run.Status != RunStatusRunning {
		t.Fatalf("ContinueRun status = %q, want running", cont.Run.Status)
	}
	if cont.ProgressAction != "resumed" || cont.Run.CurrentStep != StepReview {
		t.Fatalf("resume selected %s %s", cont.ProgressAction, cont.Run.CurrentStep)
	}
	repeated, err := svc.ContinueRun(ctx, "r1", runID)
	if err != nil || repeated.ProgressAction != "running" {
		t.Fatalf("repeated check = %s %v", repeated.ProgressAction, err)
	}

	close(releaseReview)

	done := waitForRunCondition(t, svc, "r1", runID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusCompleted
	})
	if done.Run.TestStatus != TestStatusPassed {
		t.Fatalf("TestStatus = %q, want passed", done.Run.TestStatus)
	}
	if done.Run.ReadOnlyCheckState != string(ReadOnlyUnobserved) {
		t.Fatalf("resumed review check = %q, want unobserved", done.Run.ReadOnlyCheckState)
	}
	checked, err = svc.ContinueRun(ctx, "r1", runID)
	if err != nil || checked.ProgressAction != "unchanged" || checked.Run.CurrentStep != StepDone {
		t.Fatalf("completed run check = %s %s %v", checked.ProgressAction, checked.Run.CurrentStep, err)
	}
}

func TestProgressResumesSavedNextStageWithoutRunningImplementationAgain(t *testing.T) {
	ctx := context.Background()
	repo := newTestGitRepo(t)
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "progress.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	runner := &fakeCollabRunner{store: store, rootPath: repo, handler: func(_ int, req StageTurnRequest) (string, error) {
		return "", fmt.Errorf("test stopped after observing %s", req.SessionKey)
	}}
	svc := NewService(nil, runner)
	run, err := store.CreateRun(ctx, Run{
		ID: "run-progress-next", Round: 1, RootID: "r1", Mode: ModeQuick, Title: "progress",
		Status: RunStatusWaitingUser, CurrentStep: StepReview,
		Steps: []StepCard{{Key: StepImpl, Status: StepStatusDone}, {Key: StepReview, Status: StepStatusWaitingUser, Title: "Review", ReadOnly: true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := svc.ContinueRun(ctx, "r1", run.ID)
	if err != nil || result.ProgressAction != "resumed" {
		t.Fatalf("check = %s %v", result.ProgressAction, err)
	}
	waitForRunCondition(t, svc, "r1", run.ID, func(d RunDetail) bool { return d.Run.Status == RunStatusFailed })
	runner.mu.Lock()
	defer runner.mu.Unlock()
	if len(runner.turns) != 1 || !runner.turns[0].ReadOnly || !strings.HasSuffix(runner.turns[0].SessionKey, "-review") {
		t.Fatalf("unexpected turns after check: %+v", runner.turns)
	}
}

func TestSubmitDecisionsKeepsFinalWorkerStartedByProgressCheck(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	repo := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(repo, "session-list.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	const runID = "run-decisions-progress"
	run, err := store.CreateRun(ctx, Run{
		ID: runID, Round: 1, RootID: "r1", Mode: ModeQuick, Title: "decisions",
		Status: RunStatusWaitingUser, CurrentStep: StepDecisions,
		Steps: []StepCard{
			{Key: StepResponse, Status: StepStatusDone},
			{Key: StepDecisions, Status: StepStatusWaitingUser},
			{Key: StepFixTest, Status: StepStatusPending, DocPath: DocRelPath(runID, "第01轮/05-改动结果.md")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ReplaceReviewItems(ctx, run.ID, []ReviewItem{{ItemID: "R1", PrimaryStatus: PrimaryStatusDisputed}}); err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	finish := make(chan struct{})
	finishTurn := sync.OnceFunc(func() { close(finish) })
	defer finishTurn()
	runner := &fakeCollabRunner{store: store, rootPath: repo, handler: func(i int, _ StageTurnRequest) (string, error) {
		if i == 0 {
			close(started)
			<-finish
		}
		return "裁决已执行。\n```mindfs-control\n" + `{"kind":"report","test_status":"passed"}` + "\n```", nil
	}}
	var svc *Service
	svc = NewService(nil, &notifyingCollabRunner{
		fakeCollabRunner: runner,
		onUpdate: func(updated Run) {
			if updated.CurrentStep != StepFixTest || findStep(&updated, StepFixTest).Status != StepStatusPending {
				return
			}
			// A second browser checks progress as soon as the decision update arrives.
			checked, err := svc.ContinueRun(ctx, run.RootID, run.ID)
			if err != nil || checked.ProgressAction != "resumed" {
				t.Fatalf("progress check = %q, err=%v", checked.ProgressAction, err)
			}
			select {
			case <-started:
			case <-ctx.Done():
				t.Fatal("progress check did not start the final turn")
			}
		},
	})
	if _, err := svc.SubmitDecisions(ctx, SubmitDecisionsInput{
		RootID: run.RootID, RunID: run.ID, Decisions: []ItemDecision{{ItemID: "R1", Decision: DecisionAcceptReview}},
	}); err != nil {
		t.Fatal(err)
	}
	svc.mu.Lock()
	worker := svc.workers[workerKey(run.RootID, run.ID)]
	svc.mu.Unlock()
	finishTurn()
	select {
	case <-worker.done:
	case <-ctx.Done():
		t.Fatal("final worker did not finish")
	}
	detail, err := svc.GetRunDetail(ctx, run.RootID, run.ID)
	if err != nil || detail.Run.Status != RunStatusCompleted {
		t.Fatalf("run status = %s, err=%v", detail.Run.Status, err)
	}
	runner.mu.Lock()
	defer runner.mu.Unlock()
	if len(runner.turns) != 1 {
		t.Fatalf("final turns = %d, want 1", len(runner.turns))
	}
}

func TestDBWriteFailureStopsStageWithoutReexecutingModel(t *testing.T) {
	ctx := context.Background()
	tmp := t.TempDir()
	dbPath := filepath.Join(tmp, "failwrite.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	tplStore, err := NewTemplateStoreAt(filepath.Join(tmp, "templates.json"))
	if err != nil {
		t.Fatal(err)
	}

	var implCalls int
	var updatesMu sync.Mutex
	var lastBroadcast Run

	runner := &fakeCollabRunner{
		store:    store,
		rootPath: tmp,
		statuses: []agent.Status{
			{Name: "codex", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "gpt-5.3-codex"}}},
			{Name: "claude", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "claude-opus-4-6"}}},
		},
		handler: func(_ int, _ StageTurnRequest) (string, error) {
			implCalls++
			// Break DB writes right before StepImpl tries to persist stage transition to StepReview!
			_, _ = db.Exec(`PRAGMA query_only = ON`)
			return "# 实现说明\n只应执行一次", nil
		},
	}
	origSvc := NewService(tplStore, &notifyingCollabRunner{
		fakeCollabRunner: runner,
		onUpdate: func(r Run) {
			updatesMu.Lock()
			lastBroadcast = r
			updatesMu.Unlock()
		},
	})
	origSvc.SetHomeDir(tmp)

	if _, err := origSvc.StartQuickRun(ctx, StartQuickRunInput{
		RootID:     "r1",
		TaskPrompt: "验证写库失败不重复调主模型",
		Members: []MemberSlot{
			{Role: RolePrimary, Agent: "codex", Model: "gpt-5.3-codex"},
			{Role: RoleReviewer, Agent: "claude", Model: "claude-opus-4-6"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		updatesMu.Lock()
		st := lastBroadcast.Status
		updatesMu.Unlock()
		if st == RunStatusFailed {
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if implCalls != 1 {
		t.Fatalf("implCalls = %d, want exactly 1 (must not re-execute StepImpl on DB error)", implCalls)
	}
	updatesMu.Lock()
	defer updatesMu.Unlock()
	if lastBroadcast.Status != RunStatusFailed || !strings.Contains(lastBroadcast.ErrorMessage, "保存阶段状态失败") {
		t.Fatalf("expected failed broadcast with DB error, got status=%q err=%q", lastBroadcast.Status, lastBroadcast.ErrorMessage)
	}
}

func TestParseReviewControlRequiresExplicitItemsArrayAndResponseDocMerges(t *testing.T) {
	// Omitting "items" or sending null must fail parseReviewControl (not silently pass as 0 items).
	for _, bad := range []string{
		"```mindfs-control\n{\"kind\":\"review\",\"summary\":\"有两处问题\"}\n```\n",
		"```mindfs-control\n{\"kind\":\"review\",\"summary\":\"有两处问题\",\"items\":null}\n```\n",
	} {
		f := NewControlStreamFilter()
		f.Push(bad)
		f.Flush()
		if _, err := parseReviewControl(f.Blocks()); err == nil {
			t.Fatalf("expected missing/null items to fail parseReviewControl for: %s", bad)
		}
	}

	// Explicit empty items: [] must succeed with 0 items.
	fOK := NewControlStreamFilter()
	fOK.Push("```mindfs-control\n{\"kind\":\"review\",\"summary\":\"无问题\",\"items\":[]}\n```\n")
	fOK.Flush()
	parsed, err := parseReviewControl(fOK.Blocks())
	if err != nil || len(parsed.Items) != 0 {
		t.Fatalf("expected explicit items:[] to pass with 0 items, got err=%v items=%v", err, parsed.Items)
	}
	review := NewControlStreamFilter()
	review.Push("```mindfs-control\n" + `{"kind":"review","items":[{"item_id":"R1","title":"Review title","author_note":"reserved","parse_fallback":true,"citation_verified":true}]}` + "\n```\n")
	review.Flush()
	parsed, err = parseReviewControl(review.Blocks())
	if err != nil || len(parsed.Items) != 1 || parsed.Items[0] != (ReviewItem{ItemID: "R1", Ordinal: 1, Dimension: "functional", Severity: "medium", Title: "Review title"}) {
		t.Fatalf("unexpected review fields: %+v, err=%v", parsed.Items, err)
	}

	// Response doc continuation must keep Turn 1 prose when Turn 2 only supplements missing items.
	reconciled := []ReviewItem{
		{ItemID: "R1", PrimaryStatus: PrimaryStatusAccepted, PrimaryNote: "已改 file1.go:10"},
		{ItemID: "R2", PrimaryStatus: PrimaryStatusDisputed, PrimaryNote: "请作者拍板"},
	}
	doc := buildResponseDocContent("# 第一轮回应\n已处理 R1。", "# 第一轮回应\n已处理 R1。", "补充 R2 说明。", true, reconciled, true)
	for _, want := range []string{"已处理 R1。", "补充 R2 说明。", "**R1**", "**R2**"} {
		if !strings.Contains(doc, want) {
			t.Fatalf("merged 03-response.md missing %q:\n%s", want, doc)
		}
	}

	// Single-pass response that already covers R1 and R2 without fallback must NOT duplicate notes at bottom.
	singleDoc := buildResponseDocContent("", "", "# 逐条回应\n## R1\n已改 file1.go:10\n## R2\n请作者拍板", false, reconciled, true)
	if strings.Contains(singleDoc, "结构化回应汇总") || strings.Count(singleDoc, "已改 file1.go:10") != 1 {
		t.Fatalf("single-pass 03-response.md duplicated notes:\n%s", singleDoc)
	}

	// Review doc whose prose already covers R1 must NOT duplicate R1's full description in verification footer.
	reviewDoc := renderReviewDocWithCitations("# 审核意见\n## R1 · 标题\n这里是长段问题分析正文。", []ReviewItem{
		{ItemID: "R1", FilePath: "a.go", LineStart: 10, CitationVerified: true, Title: "标题", Description: "这里是长段问题分析正文。"},
	}, ReadOnlyClean, "")
	if strings.Count(reviewDoc, "这里是长段问题分析正文。") != 1 {
		t.Fatalf("02-review.md duplicated item description:\n%s", reviewDoc)
	}

	// Control format specs must never wrap ```mindfs-control inside outer ````markdown fences.
	for _, spec := range []string{reviewControlFormatSpec(), responseControlFormatSpec(), reportControlFormatSpec()} {
		if strings.Contains(spec, "````") {
			t.Fatalf("control format spec must not contain outer 4-backtick fence:\n%s", spec)
		}
	}
}

func TestResponseDocStripsControlsFromFiles(t *testing.T) {
	body := "# 逐条回应\n已在 service.go:10 处理 R1。"
	control := "\n\n```mindfs-control\n{\"kind\":\"response\",\"summary\":\"internal-only\"}\n```"
	reconciled := []ReviewItem{{ItemID: "R1", PrimaryStatus: PrimaryStatusAccepted}}

	fresh := buildResponseDocContent("", body+control, "会话里的短提示", false, reconciled, true)
	if fresh != body+"\n" {
		t.Fatalf("agent-written response should only contain prose: %q", fresh)
	}
	resumed := buildResponseDocContent(body+control, body+control, "补充 R2 的说明。", true, reconciled, true)
	if !strings.Contains(resumed, body) || !strings.Contains(resumed, "补充 R2 的说明。") ||
		strings.Contains(resumed, ControlBlockFenceTag) || strings.Contains(resumed, "internal-only") {
		t.Fatalf("resumed response leaked a control block or lost prose: %q", resumed)
	}
}

func TestContinueRunFlowControlReviewProsePreservationAndCleanFirstResponse(t *testing.T) {
	ctx := context.Background()
	repo := newTestGitRepo(t)
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "flow.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	tplStore, err := NewTemplateStoreAt(filepath.Join(t.TempDir(), "templates.json"))
	if err != nil {
		t.Fatal(err)
	}

	runner := &fakeCollabRunner{
		store:    store,
		rootPath: repo,
		statuses: []agent.Status{
			{Name: "codex", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "gpt-5.3-codex"}}},
			{Name: "claude", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "claude-opus-4-6"}}},
		},
	}
	runner.handler = func(callIndex int, _ StageTurnRequest) (string, error) {
		switch callIndex {
		case 0: // Step 1:Impl
			return "# 实现说明\n已完成。", nil
		case 1: // Step 2 (first try): outputs full prose but forgets mindfs-control -> pauses at StepReview!
			if err := os.WriteFile(filepath.Join(repo, "review-snapshot-target.txt"), []byte("changed during review\n"), 0o644); err != nil {
				return "", err
			}
			return "# 审核意见\n\n## R1 · 需要补充说明\n详细审核正文不能在续跑时丢失。", nil
		case 2: // Step 2 (ContinueRun): outputs ONLY the missing mindfs-control block!
			return "```mindfs-control\n{\"kind\":\"review\",\"summary\":\"1处意见\",\"items\":[{\"item_id\":\"R1\",\"file_path\":\"service.go\",\"line_start\":3,\"title\":\"需要补充说明\",\"description\":\"详细审核正文\"}]}\n```\n", nil
		case 3: // Step 3 (first try): gets interrupted/canceled BEFORE recording any item response!
			return "", context.Canceled
		case 4: // Step 3 (ContinueRun when 0 items were responded): 03-回应要求.md must NOT falsely say "继续补齐"!
			reqDoc, readErr := ReadRunDoc(repo, runner.turns[4].SessionKey[len("collab-"):len(runner.turns[4].SessionKey)-len("-response")], "第01轮/03-回应要求.md")
			if readErr != nil {
				return "", readErr
			}
			if strings.Contains(reqDoc, "继续补齐") {
				return "", fmt.Errorf("fresh Step 3 falsely wrote 继续补齐:\n%s", reqDoc)
			}
			return "# 逐条回应\n\n## R1\n已在 service.go:3 处理。\n```mindfs-control\n{\"kind\":\"response\",\"responses\":[{\"item_id\":\"R1\",\"status\":\"accepted\",\"note\":\"已在 service.go:3 处理\"}]}\n```\n", nil
		case 5: // Step 5
			return "# 改动结果\n测试通过。\n```mindfs-control\n{\"kind\":\"report\",\"test_status\":\"passed\",\"test_command\":\"go test ./...\",\"test_summary\":\"通过\"}\n```\n", nil
		default:
			return "", fmt.Errorf("unexpected turn %d", callIndex)
		}
	}

	svc := NewService(tplStore, runner)
	svc.SetHomeDir(t.TempDir())
	started, err := svc.StartQuickRun(ctx, StartQuickRunInput{
		RootID:     "r1",
		TaskPrompt: "验证审核续跑保留正文与首次回应不误标继续补齐",
		Members: []MemberSlot{
			{Role: RolePrimary, Agent: "codex", Model: "gpt-5.3-codex"},
			{Role: RoleReviewer, Agent: "claude", Model: "claude-opus-4-6"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	runID := started.Run.ID

	// Pauses at StepReview because Turn 1 had no control block.
	paused := waitForRunCondition(t, svc, "r1", runID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusWaitingUser && d.Run.CurrentStep == StepReview
	})
	if paused.Run.ReadOnlyCheckState != string(ReadOnlyModified) {
		t.Fatalf("interrupted review check = %q, want modified", paused.Run.ReadOnlyCheckState)
	}
	if _, err := svc.ContinueRun(ctx, "r1", runID); err != nil {
		t.Fatal(err)
	}

	// Advances to StepResponse, then pauses because Turn 3 returned context.Canceled!
	waitForRunCondition(t, svc, "r1", runID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusWaitingUser && d.Run.CurrentStep == StepResponse
	})
	reviewSaved, err := ReadRunDoc(repo, runID, "第01轮/02-审核意见.md")
	if err != nil || !strings.Contains(reviewSaved, "详细审核正文不能在续跑时丢失。") {
		t.Fatalf("Step 2 continuation lost prior review prose: err=%v doc=\n%s", err, reviewSaved)
	}
	if !strings.Contains(reviewSaved, "审核期间检测到工作区文件变更：review-snapshot-target.txt") {
		t.Fatalf("continuation lost earlier workspace change: %s", reviewSaved)
	}

	// Continue StepResponse -> verifies no false "继续补齐" and finishes Step 5!
	if _, err := svc.ContinueRun(ctx, "r1", runID); err != nil {
		t.Fatal(err)
	}
	waitForRunCondition(t, svc, "r1", runID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusCompleted
	})
	respSaved, err := ReadRunDoc(repo, runID, "第01轮/03-逐条回应.md")
	if err != nil || strings.Contains(respSaved, "结构化回应汇总") {
		t.Fatalf("clean first Step 3 after pause should not append duplicate merge summary: err=%v doc=\n%s", err, respSaved)
	}
}

func TestDeriveRunTitleStripsAttachmentTokens(t *testing.T) {
	cases := []struct {
		name   string
		prompt string
		want   string
	}{
		{
			name:   "text with attachment token",
			prompt: "修复登录按钮对齐问题\n[file: .mindfs/attachments/mockup.png]",
			want:   "修复登录按钮对齐问题",
		},
		{
			name:   "single attachment only",
			prompt: "[file: .mindfs/attachments/screenshot.png]",
			want:   "附件：screenshot.png",
		},
		{
			name:   "multiple attachments only",
			prompt: "[file: .mindfs/attachments/ui-1.png]\n[file: .mindfs/attachments/spec.pdf]",
			want:   "附件：ui-1.png 等 2 个文件",
		},
		{
			name:   "attachment filename with brackets",
			prompt: "[file: .mindfs/attachments/截图[1].png]",
			want:   "附件：截图[1].png",
		},
		{
			name:   "attachment filename with unbalanced right bracket",
			prompt: "[file: .mindfs/attachments/a]b.png]",
			want:   "附件：a]b.png",
		},
		{
			name:   "text with bracketed attachment token",
			prompt: "请看 [file: .mindfs/attachments/截图[1].png] 并修复样式",
			want:   "请看 并修复样式",
		},
		{
			name:   "token followed by prose with brackets",
			prompt: "[file: .mindfs/attachments/a.png] 请参考注释 [1]",
			want:   "请参考注释 [1]",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := deriveRunTitle(tc.prompt); got != tc.want {
				t.Fatalf("deriveRunTitle(%q) = %q, want %q", tc.prompt, got, tc.want)
			}
		})
	}
}

func TestRecordStepResolvedModelPreservesExplicitAndBackfillsEmpty(t *testing.T) {
	run := Run{
		Snapshot: TemplateSnapshot{
			Members: []MemberSlot{
				{SlotID: "primary", Role: RolePrimary, Agent: "codex", Model: ""},
				{SlotID: "reviewer", Role: RoleReviewer, Agent: "claude", Model: "claude-opus-4-6"},
			},
		},
		Steps: []StepCard{
			{Key: StepImpl, Role: RolePrimary, SlotID: "primary", Agent: "codex", Model: ""},
			{Key: StepReview, Role: RoleReviewer, SlotID: "reviewer", Agent: "claude", Model: "claude-opus-4-6"},
		},
	}
	recordStepResolvedModel(&run, &run.Steps[0], "gpt-5.3-codex")
	if run.Steps[0].Model != "gpt-5.3-codex" {
		t.Fatalf("step[0].Model = %q, want gpt-5.3-codex", run.Steps[0].Model)
	}
	if run.Snapshot.Members[0].Model != "gpt-5.3-codex" {
		t.Fatalf("snapshot primary model = %q, want gpt-5.3-codex", run.Snapshot.Members[0].Model)
	}
	// Explicit model must never be overwritten.
	recordStepResolvedModel(&run, &run.Steps[1], "claude-sonnet-4-6")
	if run.Steps[1].Model != "claude-opus-4-6" || run.Snapshot.Members[1].Model != "claude-opus-4-6" {
		t.Fatalf("explicit model was overwritten: step=%q snap=%q", run.Steps[1].Model, run.Snapshot.Members[1].Model)
	}
}

type notifyingCollabRunner struct {
	*fakeCollabRunner
	onUpdate func(Run)
}

func (n *notifyingCollabRunner) RunUpdated(_ string, run Run, _ int) {
	if n.onUpdate != nil {
		n.onUpdate(run)
	}
}
