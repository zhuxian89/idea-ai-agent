package collab

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
)

func newUpdateMembersTestService(t *testing.T, runner *fakeCollabRunner) *Service {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "session-list.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(1)
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	runner.store = store
	svc := NewService(nil, runner)
	svc.SetHomeDir(t.TempDir())
	return svc
}

func TestQuickRunUpdateInactiveSlotWhileRunning(t *testing.T) {
	repo := newTestGitRepo(t)
	implStarted := make(chan struct{}, 1)
	releaseImpl := make(chan struct{})

	runner := &fakeCollabRunner{
		rootPath: repo,
		statuses: []agent.Status{
			{Name: "codex", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "gpt-5.3-codex"}, {ID: "gpt-5.4"}}},
			{Name: "claude", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "claude-opus-4-6"}, {ID: "claude-sonnet-4-6"}}},
		},
	}
	runner.handler = func(callIndex int, req StageTurnRequest) (string, error) {
		switch callIndex {
		case 0: // impl (primary)
			select {
			case implStarted <- struct{}{}:
			default:
			}
			<-releaseImpl
			return "初次实现完成。", nil
		case 1: // review (reviewer - should use updated agent/model!)
			return "审核通过。\n\n```mindfs-control\n{\"kind\":\"review\",\"summary\":\"无问题\",\"items\":[]}\n```", nil
		case 2: // fix_test (primary)
			return "测试通过。\n\n```mindfs-control\n{\"kind\":\"report\",\"test_status\":\"passed\",\"test_command\":\"go test ./...\",\"test_summary\":\"全部通过\"}\n```", nil
		default:
			return "", errors.New("unexpected turn")
		}
	}

	svc := newUpdateMembersTestService(t, runner)
	created, err := svc.StartQuickRun(context.Background(), StartQuickRunInput{
		RootID:     "root-1",
		TaskPrompt: "实现功能",
		Members: []MemberSlot{
			{SlotID: "primary", Role: RolePrimary, Agent: "codex", Model: "gpt-5.3-codex", Effort: "high"},
			{SlotID: "reviewer", Role: RoleReviewer, Agent: "claude", Model: "claude-opus-4-6", Effort: "high"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	select {
	case <-implStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for impl turn to start")
	}

	// Update reviewer (inactive slot) while impl is still running.
	updated, err := svc.UpdateRunMembers(context.Background(), UpdateRunMembersInput{
		RootID: "root-1",
		RunID:  created.Run.ID,
		Members: []MemberSlot{
			{SlotID: "reviewer", Role: RoleReviewer, Agent: "codex", Model: "gpt-5.4", Effort: "xhigh"},
		},
	})
	if err != nil {
		t.Fatalf("UpdateRunMembers: %v", err)
	}
	_, rev := extractQuickMembers(updated.Run.Snapshot.Members)
	if rev.Agent != "codex" || rev.Model != "gpt-5.4" || rev.Effort != "xhigh" {
		t.Fatalf("updated reviewer snapshot = %+v", rev)
	}
	if revStep := findStep(&updated.Run, StepReview); revStep == nil || revStep.Agent != "codex" || revStep.Model != "gpt-5.4" {
		t.Fatalf("updated pending review step = %+v", revStep)
	}

	// Release impl -> should finish uninterrupted and hand off to review with NEW reviewer!
	close(releaseImpl)
	done := waitForRunCondition(t, svc, "root-1", created.Run.ID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusCompleted
	})

	runner.mu.Lock()
	turns := append([]StageTurnRequest(nil), runner.turns...)
	runner.mu.Unlock()
	if len(turns) != 3 {
		t.Fatalf("turns count = %d, want 3 (impl was not interrupted)", len(turns))
	}
	if turns[0].Agent != "codex" || turns[0].Model != "gpt-5.3-codex" {
		t.Fatalf("impl turn = %+v", turns[0])
	}
	if turns[1].Agent != "codex" || turns[1].Model != "gpt-5.4" || turns[1].Effort != "xhigh" {
		t.Fatalf("review turn = %+v, want codex/gpt-5.4/xhigh", turns[1])
	}
	if implStep := findStep(&done.Run, StepImpl); implStep == nil || implStep.Model != "gpt-5.3-codex" {
		t.Fatalf("completed impl step should retain original model: %+v", implStep)
	}
}

type resolvedModelCollabRunner struct {
	*fakeCollabRunner
	resolveModel func(callIndex int, req StageTurnRequest) string
}

func (r *resolvedModelCollabRunner) RunStageTurn(ctx context.Context, req StageTurnRequest) (StageTurnResult, error) {
	r.mu.Lock()
	idx := len(r.turns)
	r.mu.Unlock()
	res, err := r.fakeCollabRunner.RunStageTurn(ctx, req)
	if err != nil {
		return res, err
	}
	if r.resolveModel != nil {
		res.ResolvedModel = r.resolveModel(idx, req)
	}
	return res, nil
}

func TestQuickRunUpdateInactiveSlotToDefaultModelSameAgent(t *testing.T) {
	repo := newTestGitRepo(t)
	implStarted := make(chan struct{}, 1)
	releaseImpl := make(chan struct{})

	base := &fakeCollabRunner{
		rootPath: repo,
		statuses: []agent.Status{
			{Name: "codex", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "gpt-5.3-codex"}, {ID: "gpt-5.4"}}},
		},
	}
	base.handler = func(callIndex int, req StageTurnRequest) (string, error) {
		switch callIndex {
		case 0: // impl (primary)
			select {
			case implStarted <- struct{}{}:
			default:
			}
			<-releaseImpl
			return "初次实现完成。", nil
		case 1: // review (reviewer - must keep empty Model for same agent)
			return "审核通过。\n\n```mindfs-control\n{\"kind\":\"review\",\"summary\":\"无问题\",\"items\":[]}\n```", nil
		case 2: // fix_test (primary)
			return "测试通过。\n\n```mindfs-control\n{\"kind\":\"report\",\"test_status\":\"passed\",\"test_command\":\"go test ./...\",\"test_summary\":\"全部通过\"}\n```", nil
		default:
			return "", errors.New("unexpected turn")
		}
	}
	runner := &resolvedModelCollabRunner{
		fakeCollabRunner: base,
		resolveModel: func(callIndex int, req StageTurnRequest) string {
			if callIndex == 0 {
				return "gpt-5.3-codex"
			}
			return req.Model
		},
	}

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
	base.store = store
	svc := NewService(nil, runner)
	svc.SetHomeDir(t.TempDir())

	created, err := svc.StartQuickRun(context.Background(), StartQuickRunInput{
		RootID:     "root-1",
		TaskPrompt: "同一 Agent 切回默认模型",
		Members: []MemberSlot{
			{SlotID: "primary", Role: RolePrimary, Agent: "codex", Model: ""},
			{SlotID: "reviewer", Role: RoleReviewer, Agent: "codex", Model: "gpt-5.3-codex"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	select {
	case <-implStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for impl turn to start")
	}

	// Keep the same agent ("codex") for reviewer, but switch from explicit model to Agent default ("").
	updated, err := svc.UpdateRunMembers(context.Background(), UpdateRunMembersInput{
		RootID: "root-1",
		RunID:  created.Run.ID,
		Members: []MemberSlot{
			{SlotID: "reviewer", Role: RoleReviewer, Agent: "codex", Model: ""},
		},
	})
	if err != nil {
		t.Fatalf("UpdateRunMembers: %v", err)
	}
	_, rev := extractQuickMembers(updated.Run.Snapshot.Members)
	if rev.Agent != "codex" || rev.Model != "" {
		t.Fatalf("updated reviewer snapshot = %+v, want codex/\"\"", rev)
	}

	close(releaseImpl)
	done := waitForRunCondition(t, svc, "root-1", created.Run.ID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusCompleted
	})

	base.mu.Lock()
	turns := append([]StageTurnRequest(nil), base.turns...)
	base.mu.Unlock()
	if len(turns) != 3 {
		t.Fatalf("turns count = %d, want 3", len(turns))
	}
	if turns[1].Agent != "codex" || turns[1].Model != "" {
		t.Fatalf("review turn = %+v, want Agent=codex and Model=\"\"", turns[1])
	}
	primary, finalRev := extractQuickMembers(done.Run.Snapshot.Members)
	if finalRev.Agent != "codex" || finalRev.Model != "" {
		t.Fatalf("final reviewer snapshot = %+v, want codex/\"\"", finalRev)
	}
	if primary.Model != "gpt-5.3-codex" {
		t.Fatalf("final primary snapshot = %+v, want resolved model gpt-5.3-codex backfilled", primary)
	}
}

type cancelableCollabRunner struct {
	*fakeCollabRunner
	cancelMu   sync.Mutex
	turnCancel map[string]context.CancelFunc
	onTurn     func(ctx context.Context, callIndex int, req StageTurnRequest) (string, error)
}

func (r *cancelableCollabRunner) RunStageTurn(ctx context.Context, req StageTurnRequest) (StageTurnResult, error) {
	if req.OnRegistered != nil {
		if err := req.OnRegistered(); err != nil {
			return StageTurnResult{}, err
		}
	}
	turnCtx, cancel := context.WithCancel(ctx)
	r.cancelMu.Lock()
	if r.turnCancel == nil {
		r.turnCancel = make(map[string]context.CancelFunc)
	}
	r.turnCancel[req.SessionKey] = cancel
	r.cancelMu.Unlock()
	defer func() {
		cancel()
		r.cancelMu.Lock()
		delete(r.turnCancel, req.SessionKey)
		r.cancelMu.Unlock()
	}()

	r.mu.Lock()
	idx := len(r.turns)
	r.turns = append(r.turns, req)
	r.mu.Unlock()

	raw, err := r.onTurn(turnCtx, idx, req)
	if err != nil {
		return StageTurnResult{}, err
	}
	if req.StreamFilter != nil {
		delta := req.StreamFilter.Push(raw)
		if req.OnText != nil && delta != "" {
			req.OnText(delta)
		}
		tail := req.StreamFilter.Flush()
		if req.OnText != nil && tail != "" {
			req.OnText(tail)
		}
	}
	return StageTurnResult{ResolvedModel: req.Model}, nil
}

func (r *cancelableCollabRunner) CancelStageTurn(_ context.Context, _, sessionKey string) error {
	r.cancelMu.Lock()
	cancel := r.turnCancel[sessionKey]
	r.cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func TestQuickRunUpdateActiveSlotWhileRunningRestartsStep(t *testing.T) {
	repo := newTestGitRepo(t)
	firstStarted := make(chan struct{}, 1)

	base := &fakeCollabRunner{
		rootPath: repo,
		statuses: []agent.Status{
			{Name: "codex", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "gpt-5.3-codex"}, {ID: "gpt-5.4"}}},
			{Name: "claude", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "claude-opus-4-6"}}},
		},
	}
	runner := &cancelableCollabRunner{fakeCollabRunner: base}
	runner.onTurn = func(ctx context.Context, _ int, req StageTurnRequest) (string, error) {
		if req.Model == "gpt-5.3-codex" {
			select {
			case firstStarted <- struct{}{}:
			default:
			}
			<-ctx.Done()
			return "", ctx.Err()
		}
		if req.ReadOnly {
			return "审核通过。\n\n```mindfs-control\n{\"kind\":\"review\",\"summary\":\"无问题\",\"items\":[]}\n```", nil
		}
		if strings.Contains(req.Prompt, "05-交付要求.md") {
			return "测试通过。\n\n```mindfs-control\n{\"kind\":\"report\",\"test_status\":\"passed\",\"test_command\":\"go test ./...\",\"test_summary\":\"全部通过\"}\n```", nil
		}
		return "使用新模型完成实现。", nil
	}

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
	base.store = store
	svc := NewService(nil, runner)
	svc.SetHomeDir(t.TempDir())

	created, err := svc.StartQuickRun(context.Background(), StartQuickRunInput{
		RootID:     "root-1",
		TaskPrompt: "实现功能",
		Members: []MemberSlot{
			{SlotID: "primary", Role: RolePrimary, Agent: "codex", Model: "gpt-5.3-codex", Effort: "high"},
			{SlotID: "reviewer", Role: RoleReviewer, Agent: "claude", Model: "claude-opus-4-6", Effort: "high"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	select {
	case <-firstStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for first impl turn")
	}

	// Switch active primary model while impl is running -> cancels old turn & restarts impl with gpt-5.4!
	if _, err := svc.UpdateRunMembers(context.Background(), UpdateRunMembersInput{
		RootID: "root-1",
		RunID:  created.Run.ID,
		Members: []MemberSlot{
			{SlotID: "primary", Role: RolePrimary, Agent: "codex", Model: "gpt-5.4", Effort: "xhigh"},
		},
	}); err != nil {
		t.Fatalf("UpdateRunMembers active slot: %v", err)
	}

	done := waitForRunCondition(t, svc, "root-1", created.Run.ID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusCompleted
	})

	runner.mu.Lock()
	turns := append([]StageTurnRequest(nil), runner.turns...)
	runner.mu.Unlock()
	if len(turns) != 4 {
		t.Fatalf("turns count = %d, want 4 (canceled impl + restarted impl + review + fix_test)", len(turns))
	}
	if turns[1].Agent != "codex" || turns[1].Model != "gpt-5.4" || turns[1].Effort != "xhigh" {
		t.Fatalf("restarted impl turn = %+v", turns[1])
	}
	if implStep := findStep(&done.Run, StepImpl); implStep == nil || implStep.Model != "gpt-5.4" {
		t.Fatalf("done impl step = %+v", implStep)
	}
}

type slowCancelCollabRunner struct {
	*cancelableCollabRunner
	cancelCalled chan struct{}
}

func (r *slowCancelCollabRunner) CancelStageTurn(ctx context.Context, rootID, sessionKey string) error {
	select {
	case r.cancelCalled <- struct{}{}:
	default:
	}
	return r.cancelableCollabRunner.CancelStageTurn(ctx, rootID, sessionKey)
}

func TestQuickRunUpdateActiveSlotCanceledRequestKeepsUpdateAndPauses(t *testing.T) {
	repo := newTestGitRepo(t)
	firstStarted := make(chan struct{}, 1)
	releaseOldTurn := make(chan struct{})
	cancelCalled := make(chan struct{}, 1)

	base := &fakeCollabRunner{
		rootPath: repo,
		statuses: []agent.Status{
			{Name: "codex", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "gpt-5.3-codex"}, {ID: "gpt-5.4"}}},
			{Name: "claude", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "claude-opus-4-6"}}},
		},
	}
	cancelable := &cancelableCollabRunner{fakeCollabRunner: base}
	runner := &slowCancelCollabRunner{
		cancelableCollabRunner: cancelable,
		cancelCalled:           cancelCalled,
	}
	cancelable.onTurn = func(ctx context.Context, _ int, req StageTurnRequest) (string, error) {
		if req.Model == "gpt-5.3-codex" {
			select {
			case firstStarted <- struct{}{}:
			default:
			}
			// Simulate an underlying CLI turn that takes time to unwind after cancel.
			<-releaseOldTurn
			return "", context.Canceled
		}
		if req.ReadOnly {
			return "审核通过。\n\n```mindfs-control\n{\"kind\":\"review\",\"summary\":\"无问题\",\"items\":[]}\n```", nil
		}
		if strings.Contains(req.Prompt, "05-交付要求.md") {
			return "测试通过。\n\n```mindfs-control\n{\"kind\":\"report\",\"test_status\":\"passed\",\"test_command\":\"go test ./...\",\"test_summary\":\"全部通过\"}\n```", nil
		}
		return "使用新模型完成实现。", nil
	}

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
	base.store = store
	svc := NewService(nil, runner)
	svc.SetHomeDir(t.TempDir())

	created, err := svc.StartQuickRun(context.Background(), StartQuickRunInput{
		RootID:     "root-1",
		TaskPrompt: "等待旧回合退出期间请求取消",
		Members: []MemberSlot{
			{SlotID: "primary", Role: RolePrimary, Agent: "codex", Model: "gpt-5.3-codex", Effort: "high"},
			{SlotID: "reviewer", Role: RoleReviewer, Agent: "claude", Model: "claude-opus-4-6", Effort: "high"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	select {
	case <-firstStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for first impl turn")
	}

	reqCtx, cancelReq := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		_, updateErr := svc.UpdateRunMembers(reqCtx, UpdateRunMembersInput{
			RootID: "root-1",
			RunID:  created.Run.ID,
			Members: []MemberSlot{
				{SlotID: "primary", Role: RolePrimary, Agent: "codex", Model: "gpt-5.4", Effort: "xhigh"},
			},
		})
		errCh <- updateErr
	}()

	select {
	case <-cancelCalled:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for CancelStageTurn")
	}
	// Cancel caller HTTP request while UpdateRunMembers is waiting on prevDone.
	cancelReq()

	select {
	case updateErr := <-errCh:
		if !errors.Is(updateErr, context.Canceled) {
			t.Fatalf("UpdateRunMembers err = %v, want context.Canceled", updateErr)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for UpdateRunMembers to return")
	}

	// New model must already be persisted and run must be paused (not stuck in running).
	paused, err := svc.GetRunDetail(context.Background(), "root-1", created.Run.ID)
	if err != nil {
		t.Fatal(err)
	}
	primary, _ := extractQuickMembers(paused.Run.Snapshot.Members)
	if primary.Agent != "codex" || primary.Model != "gpt-5.4" || primary.Effort != "xhigh" {
		t.Fatalf("persisted primary after canceled request = %+v, want codex/gpt-5.4/xhigh", primary)
	}
	if paused.Run.Status != RunStatusWaitingUser {
		t.Fatalf("run status after canceled request = %q, want %q", paused.Run.Status, RunStatusWaitingUser)
	}
	if implStep := findStep(&paused.Run, StepImpl); implStep == nil || implStep.Model != "gpt-5.4" || implStep.Status != StepStatusWaitingUser {
		t.Fatalf("impl step after canceled request = %+v", implStep)
	}

	// Release old worker and verify ContinueRun resumes cleanly with the new model.
	close(releaseOldTurn)
	if _, err := svc.ContinueRun(context.Background(), "root-1", created.Run.ID); err != nil {
		t.Fatalf("ContinueRun: %v", err)
	}
	done := waitForRunCondition(t, svc, "root-1", created.Run.ID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusCompleted
	})
	if implStep := findStep(&done.Run, StepImpl); implStep == nil || implStep.Model != "gpt-5.4" {
		t.Fatalf("completed impl step = %+v, want gpt-5.4", implStep)
	}
}

func TestQuickRunUpdateFailedResumeAndNextReview(t *testing.T) {
	repo := newTestGitRepo(t)
	runner := &fakeCollabRunner{
		rootPath: repo,
		statuses: []agent.Status{
			{Name: "codex", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "gpt-5.3-codex"}, {ID: "gpt-5.4"}}},
			{Name: "claude", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "claude-sonnet-4-6"}}},
		},
	}
	runner.handler = func(_ int, req StageTurnRequest) (string, error) {
		if req.Model == "claude-broken" {
			return "", errors.New("model claude-broken unavailable")
		}
		if req.ReadOnly {
			return "审核通过。\n\n```mindfs-control\n{\"kind\":\"review\",\"summary\":\"无问题\",\"items\":[]}\n```", nil
		}
		if strings.Contains(req.Prompt, "05-交付要求.md") {
			return "测试通过。\n\n```mindfs-control\n{\"kind\":\"report\",\"test_status\":\"passed\",\"test_command\":\"go test ./...\",\"test_summary\":\"全部通过\"}\n```", nil
		}
		return "初次实现完成。", nil
	}

	svc := newUpdateMembersTestService(t, runner)
	// Bypass initial status validation by inserting statuses after StartQuickRun.
	origStatuses := runner.statuses
	runner.statuses = nil
	created, err := svc.StartQuickRun(context.Background(), StartQuickRunInput{
		RootID:     "root-1",
		TaskPrompt: "实现功能",
		Members: []MemberSlot{
			{SlotID: "primary", Role: RolePrimary, Agent: "codex", Model: "gpt-5.3-codex"},
			{SlotID: "reviewer", Role: RoleReviewer, Agent: "claude", Model: "claude-broken"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	failed := waitForRunCondition(t, svc, "root-1", created.Run.ID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusFailed && d.Run.CurrentStep == StepReview
	})
	if !strings.Contains(failed.Run.ErrorMessage, "claude-broken") {
		t.Fatalf("unexpected error: %q", failed.Run.ErrorMessage)
	}

	// Now restore statuses: switching to another unavailable model must fail validation.
	runner.statuses = origStatuses
	if _, err := svc.UpdateRunMembers(context.Background(), UpdateRunMembersInput{
		RootID: "root-1",
		RunID:  created.Run.ID,
		Members: []MemberSlot{
			{SlotID: "reviewer", Role: RoleReviewer, Agent: "claude", Model: "claude-nonexistent"},
		},
	}); err == nil {
		t.Fatal("expected unavailable model validation error")
	}

	// Switch reviewer to working claude-sonnet-4-6 and resume in one call.
	if _, err := svc.UpdateRunMembers(context.Background(), UpdateRunMembersInput{
		RootID: "root-1",
		RunID:  created.Run.ID,
		Members: []MemberSlot{
			{SlotID: "reviewer", Role: RoleReviewer, Agent: "claude", Model: "claude-sonnet-4-6"},
		},
		Resume: true,
	}); err != nil {
		t.Fatalf("UpdateRunMembers + Resume: %v", err)
	}

	completed := waitForRunCondition(t, svc, "root-1", created.Run.ID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusCompleted && d.Run.Round == 1
	})
	if revStep := findStep(&completed.Run, StepReview); revStep == nil || revStep.Model != "claude-sonnet-4-6" {
		t.Fatalf("round 1 review step = %+v", revStep)
	}

	// After completion, change reviewer to codex/gpt-5.4 before NextReview.
	if _, err := svc.UpdateRunMembers(context.Background(), UpdateRunMembersInput{
		RootID: "root-1",
		RunID:  created.Run.ID,
		Members: []MemberSlot{
			{SlotID: "reviewer", Role: RoleReviewer, Agent: "codex", Model: "gpt-5.4"},
		},
	}); err != nil {
		t.Fatalf("UpdateRunMembers completed: %v", err)
	}
	if _, err := svc.NextReview(context.Background(), "root-1", created.Run.ID, 1, "复核一下"); err != nil {
		t.Fatalf("NextReview: %v", err)
	}
	round2 := waitForRunCondition(t, svc, "root-1", created.Run.ID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusCompleted && d.Run.Round == 2
	})
	if revStep := findStep(&round2.Run, StepReview); revStep == nil || revStep.Agent != "codex" || revStep.Model != "gpt-5.4" {
		t.Fatalf("round 2 review step should use updated model: %+v", revStep)
	}
	if implStep := findStep(&round2.Run, StepImpl); implStep == nil || implStep.Model != "gpt-5.3-codex" {
		t.Fatalf("round 1 impl step should keep original model: %+v", implStep)
	}
}

func TestMeetingUpdateActiveMemberDuringParallelProposal(t *testing.T) {
	root, ctx := newTestGitRepo(t), context.Background()
	store, _, _ := meetingTestStore(t)

	m1Started := make(chan struct{}, 1)
	m2OldStarted := make(chan struct{}, 1)
	releaseM1 := make(chan struct{})

	base := &fakeCollabRunner{
		store:    store,
		rootPath: root,
		statuses: []agent.Status{
			{Name: "codex", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "gpt-5.3-codex"}, {ID: "gpt-5.4"}}},
			{Name: "claude", Installed: true, Available: true, Models: []agenttypes.ModelInfo{{ID: "claude-opus-4-6"}}},
		},
	}
	runner := &cancelableCollabRunner{fakeCollabRunner: base}
	runner.onTurn = func(turnCtx context.Context, _ int, req StageTurnRequest) (string, error) {
		switch {
		case strings.Contains(req.Prompt, "独立阅读议题"):
			if req.MemberSlotID == "member-1" {
				select {
				case m1Started <- struct{}{}:
				default:
				}
				select {
				case <-releaseM1:
				case <-turnCtx.Done():
					return "", turnCtx.Err()
				}
				return "成员1独立提案。\n\n```mindfs-control\n" +
					`{"kind":"meeting-positions","items":[{"id":"C","title":"方案一","stance":"propose","quote":"成员1独立提案。","citations":[{"file_path":"service.go","line_start":1}]}]}` +
					"\n```", nil
			}
			if req.MemberSlotID == "member-2" && req.Agent == "claude" {
				select {
				case m2OldStarted <- struct{}{}:
				default:
				}
				<-turnCtx.Done()
				return "", turnCtx.Err()
			}
			// Restarted member-2 with codex/gpt-5.4!
			return "成员2切换新模型后的提案。\n\n```mindfs-control\n" +
				`{"kind":"meeting-positions","items":[{"id":"C","title":"方案二","stance":"propose","quote":"成员2切换新模型后的提案。","citations":[{"file_path":"service.go","line_start":1}]}]}` +
				"\n```", nil
		case strings.Contains(req.Prompt, "逐条回应"):
			return "同意两项方案。\n\n```mindfs-control\n" +
				`{"kind":"meeting-positions","items":[` +
				`{"id":"C1","version_id":"C1-v1","stance":"agree","quote":"同意两项方案。","checked":"已核对","risk":"无","citations":[{"file_path":"service.go","line_start":1}]},` +
				`{"id":"C2","version_id":"C2-v1","stance":"agree","quote":"同意两项方案。","checked":"已核对","risk":"无","citations":[{"file_path":"service.go","line_start":1}]}` +
				"]}\n```", nil
		default:
			return "", errors.New("unexpected meeting prompt")
		}
	}

	svc := NewService(nil, runner)
	svc.SetHomeDir(t.TempDir())
	created, err := svc.StartMeeting(ctx, StartMeetingInput{
		StartQuickRunInput: StartQuickRunInput{
			RootID:     "root-m",
			TaskPrompt: "讨论并行提案中切换模型",
			Members: []MemberSlot{
				{SlotID: "member-1", Role: RoleMember, Agent: "codex", Model: "gpt-5.3-codex"},
				{SlotID: "member-2", Role: RoleMember, Agent: "claude", Model: "claude-opus-4-6"},
			},
		},
		FinalAuthorSlotID: "member-1",
		MaxRounds:         3,
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, ch := range []chan struct{}{m1Started, m2OldStarted} {
		select {
		case <-ch:
		case <-time.After(3 * time.Second):
			t.Fatal("timed out waiting for parallel proposals to start")
		}
	}

	// Replace ONLY member-2 while both member-1 and member-2 are running in parallel!
	updated, err := svc.UpdateRunMembers(ctx, UpdateRunMembersInput{
		RootID: "root-m",
		RunID:  created.Run.ID,
		Members: []MemberSlot{
			{SlotID: "member-2", Role: RoleMember, Agent: "codex", Model: "gpt-5.4", Effort: "high"},
		},
	})
	if err != nil {
		t.Fatalf("UpdateRunMembers meeting active: %v", err)
	}
	if updated.Run.Snapshot.Members[1].Agent != "codex" || updated.Run.Snapshot.Members[1].Model != "gpt-5.4" {
		t.Fatalf("snapshot member-2 = %+v", updated.Run.Snapshot.Members[1])
	}

	// Release member-1 (must NOT have been canceled!).
	close(releaseM1)
	aligned := waitForRunCondition(t, svc, "root-m", created.Run.ID, func(d RunDetail) bool {
		return d.Run.CurrentStep == meetingAligned && d.Run.Status == RunStatusWaitingUser
	})

	// Verify member-1 ran proposal ONCE (uninterrupted), member-2 ran old (canceled) + new proposal, and both ran review with updated config!
	runner.mu.Lock()
	turns := append([]StageTurnRequest(nil), runner.turns...)
	runner.mu.Unlock()
	m1Proposals := 0
	m2NewReviews := 0
	for _, turn := range turns {
		if turn.MemberSlotID == "member-1" && strings.Contains(turn.Prompt, "独立阅读议题") {
			m1Proposals++
		}
		if turn.MemberSlotID == "member-2" && strings.Contains(turn.Prompt, "逐条回应") && turn.Agent == "codex" && turn.Model == "gpt-5.4" {
			m2NewReviews++
		}
	}
	if m1Proposals != 1 {
		t.Fatalf("member-1 proposal count = %d, want 1 (uninterrupted)", m1Proposals)
	}
	if m2NewReviews != 1 {
		t.Fatalf("member-2 review with new model count = %d, want 1", m2NewReviews)
	}

	// Verify DB persisted the updated snapshot and completed turns recorded their executed agent/model.
	reloaded, err := svc.GetRunDetail(ctx, "root-m", created.Run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Run.Snapshot.Members[1].Agent != "codex" || reloaded.Run.Snapshot.Members[1].Model != "gpt-5.4" {
		t.Fatalf("reloaded snapshot lost member-2 update: %+v", reloaded.Run.Snapshot.Members)
	}
	round1 := aligned.Meeting.Rounds[0]
	for _, turn := range round1.Turns {
		if turn.SlotID == "member-2" && turn.Status == StepStatusDone {
			if turn.Agent != "codex" || turn.Model != "gpt-5.4" {
				t.Fatalf("completed member-2 turn = %+v, want codex/gpt-5.4", turn)
			}
		}
	}
}

func TestMeetingUpdateFailedMemberAndResume(t *testing.T) {
	root, ctx := newTestGitRepo(t), context.Background()
	store, _, _ := meetingTestStore(t)

	runner := &meetingTestRunner{
		fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root},
	}
	runner.respond = func(_ context.Context, req StageTurnRequest) (string, error) {
		if req.Model == "claude-broken" {
			return "", errors.New("quota exceeded for claude-broken")
		}
		if strings.Contains(req.Prompt, "独立阅读议题") {
			return "独立提案正文。\n\n```mindfs-control\n" +
				`{"kind":"meeting-positions","items":[{"id":"C","title":"统一方案","stance":"propose","quote":"独立提案正文。","citations":[{"file_path":"service.go","line_start":1}]}]}` +
				"\n```", nil
		}
		return "同意。\n\n```mindfs-control\n" +
			`{"kind":"meeting-positions","items":[{"id":"C1","version_id":"C1-v1","stance":"agree","quote":"同意。","checked":"已查","risk":"无","citations":[{"file_path":"service.go","line_start":1}]}]}` +
			"\n```", nil
	}

	svc := NewService(nil, runner)
	svc.SetHomeDir(t.TempDir())
	created, err := svc.StartMeeting(ctx, StartMeetingInput{
		StartQuickRunInput: StartQuickRunInput{
			RootID:     "root-m2",
			TaskPrompt: "失败后切换模型继续",
			Members: []MemberSlot{
				{SlotID: "member-1", Role: RoleMember, Agent: "codex", Model: "gpt-5.3-codex"},
				{SlotID: "member-2", Role: RoleMember, Agent: "claude", Model: "claude-broken"},
			},
		},
		FinalAuthorSlotID: "member-1",
	})
	if err != nil {
		t.Fatal(err)
	}

	waiting := waitForRunCondition(t, svc, "root-m2", created.Run.ID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusWaitingUser && strings.Contains(d.Run.ErrorMessage, "claude-broken")
	})
	if waiting.Run.CurrentStep != meetingProposal {
		t.Fatalf("expected waiting in proposal, got %s", waiting.Run.CurrentStep)
	}

	// Fix member-2 model and resume.
	if _, err := svc.UpdateRunMembers(ctx, UpdateRunMembersInput{
		RootID: "root-m2",
		RunID:  created.Run.ID,
		Members: []MemberSlot{
			{SlotID: "member-2", Role: RoleMember, Agent: "codex", Model: "gpt-5.4"},
		},
		Resume: true,
	}); err != nil {
		t.Fatalf("UpdateRunMembers meeting resume: %v", err)
	}

	aligned := waitForRunCondition(t, svc, "root-m2", created.Run.ID, func(d RunDetail) bool {
		return d.Run.CurrentStep == meetingAligned && d.Run.Status == RunStatusWaitingUser
	})
	if aligned.Run.Snapshot.Members[1].Agent != "codex" || aligned.Run.Snapshot.Members[1].Model != "gpt-5.4" {
		t.Fatalf("snapshot = %+v", aligned.Run.Snapshot.Members)
	}
}
