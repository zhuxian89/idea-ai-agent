package collab

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMeetingRestatementRequiresSameStanceAndVersion(t *testing.T) {
	root := t.TempDir()
	round := MeetingRound{Number: 2, Items: []MeetingItem{{ID: "D1"}}}
	prior := MeetingPosition{ID: "D1", SlotID: "one", TurnID: "earlier", VersionID: "D1-v2", Stance: "disagree", Quote: "原异议", Reason: "原理由"}
	for _, tc := range []struct {
		name, version, stance, want string
	}{
		{"same version and stance", "d1-V2", "disagree", "disagree"},
		{"old version", "D1-v1", "disagree", "unconfirmed"},
		{"missing version", "", "disagree", "unconfirmed"},
		{"changed stance", "D1-v2", "agree", "unconfirmed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			turn := MeetingTurn{ID: "current", SlotID: "one", Kind: meetingReview, Status: StepStatusDone, Body: "本轮立场"}
			block := ControlBlock{Payload: []byte(fmt.Sprintf(`{"kind":"meeting-positions","items":[{"id":"D1","version_id":%q,"stance":%q,"quote":%q}]}`,
				tc.version, tc.stance, map[string]string{"disagree": turn.Body, "agree": "不匹配的引文"}[tc.stance]))}
			turn.Positions, _, turn.PositionIssue = parseMeetingPositions(root, round, turn, []ControlBlock{block})
			vote := meetingReviewPosition("D1", turn, prior)
			if vote.Stance != tc.want || vote.Issue == "" {
				t.Fatalf("expected %s with a warning, got %#v", tc.want, vote)
			}
			if vote.Stance == "disagree" && (vote.TurnID != prior.TurnID || vote.Quote != prior.Quote || vote.Reason != prior.Reason ||
				!strings.Contains(vote.Issue, "缺少异议理由")) {
				t.Fatalf("previous reasoning was not retained: %#v", vote)
			}
		})
	}
}

func TestMeetingUnknownReviewIDsAreNotOmissions(t *testing.T) {
	root := t.TempDir()
	run := Run{Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "one"}}}}
	prior := MeetingPosition{ID: "D1", SlotID: "one", VersionID: "D1-v2", Stance: "agree"}
	round := MeetingRound{Number: 2, Items: []MeetingItem{
		{ID: "D1", Proposal: &MeetingPosition{VersionID: "D1-v2"}, Revision: 2, Positions: []MeetingPosition{prior}},
		{ID: "D2", Proposal: &MeetingPosition{VersionID: "D2-v1"}, Revision: 1},
	}}
	turn := MeetingTurn{ID: "current", SlotID: "one", Kind: meetingReview, Status: StepStatusDone, Body: "认可 D2，修改 D1。"}
	block := ControlBlock{Payload: []byte(`{"kind":"meeting-positions","items":[{"id":"D01","stance":"disagree","quote":"修改 D1。","reason":"新证据"},{"id":"D2","version_id":"D2-v1","stance":"agree","quote":"认可 D2"}]}`)}
	turn.Positions, _, turn.PositionIssue = parseMeetingPositions(root, round, turn, []ControlBlock{block})
	round.Turns = []MeetingTurn{turn}
	round.Items = alignMeetingItems(run, round)
	if round.Items[0].Aligned || round.Items[0].Positions[0].Stance != "unconfirmed" || !round.Items[1].Aligned ||
		!strings.Contains(turn.PositionIssue, `"D01"`) || !strings.Contains(renderMeetingItems(run, round), `未识别的条目编号："D01"`) {
		t.Fatalf("unknown ID should be reported and only the explicit valid vote counted: %#v", round)
	}
}

func TestMeetingVersionVotesAndExactDecision(t *testing.T) {
	run := Run{Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "one"}, {SlotID: "two"}}}}
	original := MeetingTurn{ID: "original", SlotID: "one", Kind: meetingProposal, Status: StepStatusDone, Body: "原方案",
		Positions: []MeetingPosition{{ID: "D", SlotID: "one", TurnID: "original", Title: "方案", Stance: "propose", Quote: "原方案"}}}
	items := meetingCandidates(run, MeetingRound{Turns: []MeetingTurn{original, {Kind: meetingProposal, Status: StepStatusWaitingUser}}})
	if len(items) != 1 {
		t.Fatalf("未交付成员不应占用编号: %#v", items)
	}
	vote := func(turn, slot, version, stance, quote string) MeetingTurn {
		return MeetingTurn{ID: turn, SlotID: slot, Kind: meetingReview, Status: StepStatusDone,
			Positions: []MeetingPosition{{ID: "D1", TurnID: turn, SlotID: slot, VersionID: version, Stance: stance,
				Title: "方案", Quote: quote, Checked: "核查", Risk: "无", Reason: "有新证据"}}}
	}
	first := alignMeetingItems(run, MeetingRound{Items: items, Turns: []MeetingTurn{
		vote("r1", "one", "D1-v1", "agree", "同意原案"), vote("r2", "two", "", "propose", "首次修订"),
	}})[0]
	if first.Aligned || first.Stalled || first.Revision != 2 || first.Positions[0].Issue != "本轮未对该版本表态" ||
		first.Positions[1].Source != "submission" || first.Proposal.Quote != "首次修订" {
		t.Fatalf("修订应替换旧提案并重新计票: %#v", first)
	}
	sameRound := alignMeetingItems(run, MeetingRound{Items: items, Turns: []MeetingTurn{
		vote("r1", "one", "", "propose", "同轮修订甲"), vote("r2", "two", "", "propose", "同轮修订乙"),
	}})[0]
	if sameRound.Revision != 3 || sameRound.Proposal.Quote != "同轮修订乙" ||
		sameRound.Aligned || sameRound.Positions[0].Issue != "本轮未对该版本表态" {
		t.Fatalf("同轮连续修订只保留最后一版: %#v", sameRound)
	}

	second := alignMeetingItems(run, MeetingRound{Number: 2, Items: []MeetingItem{first}, Turns: []MeetingTurn{
		vote("r3", "one", "D1-v2", "disagree", "反对首次修订"), vote("r4", "two", "D1-v2", "propose", "再次修订"),
	}})[0]
	if second.Stalled || second.Revision != 3 || second.Proposal.Quote != "再次修订" {
		t.Fatalf("新版不能继承僵持: %#v", second)
	}
	decision := MeetingDecision{ItemID: "D1", Choice: "adopt", SlotID: "two", VersionID: "D1-v2", TurnID: "r2"}
	if err := validateMeetingDecisions([]MeetingItem{second}, []MeetingDecision{decision}); err == nil {
		t.Fatal("不能采纳已被替换的版本")
	}
	decision.VersionID, decision.TurnID = "D1-v3", "r4"
	if got := adoptedMeetingPosition(second, decision); got == nil || got.Quote != "再次修订" {
		t.Fatalf("应采纳当前版本: %#v", got)
	}
	stale := alignMeetingItems(run, MeetingRound{Number: 3, Items: []MeetingItem{second}, Turns: []MeetingTurn{
		vote("r5", "one", "D1-v2", "propose", "用过期版本提出修订"),
		{Kind: meetingReview, SlotID: "two", Status: StepStatusDone},
	}})[0]
	if stale.Proposal.VersionID != "D1-v3" || stale.Positions[0].Stance != "unconfirmed" || stale.Positions[1].TurnID != "r4" {
		t.Fatalf("过期修订不能覆盖当前版本，有效空交付沿用当前版立场: %#v", stale)
	}
	failed := alignMeetingItems(run, MeetingRound{Number: 3, Items: []MeetingItem{second}, Turns: []MeetingTurn{
		vote("r5", "one", "D1-v3", "agree", "我同意"),
		{Kind: meetingReview, SlotID: "two", Status: StepStatusDone, PositionIssue: "控制块无效"},
	}})[0]
	if failed.Aligned || failed.Positions[1].Stance != "unconfirmed" {
		t.Fatalf("无效控制块不能沿用上一轮表态形成共识: %#v", failed)
	}
	unpublished := alignMeetingItems(run, MeetingRound{Number: 3, Items: []MeetingItem{second}, Turns: []MeetingTurn{
		vote("r5", "one", "D1-v3", "propose", "第三轮修订"), vote("r6", "two", "D1-v4", "agree", "抢先支持修订"),
	}})[0]
	if unpublished.Aligned || unpublished.Proposal.VersionID != "D1-v4" || unpublished.Positions[1].Stance != "unconfirmed" {
		t.Fatalf("其他成员从下一轮起为本轮修订表态: %#v", unpublished)
	}

	one := vote("r5", "one", "d1-v3", "disagree", "保持异议")
	two := vote("r6", "two", "D1-V3", "agree", "维持修订")
	third := alignMeetingItems(run, MeetingRound{Items: []MeetingItem{second}, Turns: []MeetingTurn{one, two}})[0]
	if third.Stalled || third.Positions[0].Stance != "disagree" || third.Positions[1].Stance != "agree" ||
		third.Positions[0].VersionID != "D1-v3" || third.Positions[1].VersionID != "D1-v3" {
		t.Fatalf("大小写不同的版本号应记录到实际版本，立场变化应解除僵持: %#v", third)
	}
	fourth := alignMeetingItems(run, MeetingRound{Items: []MeetingItem{third}, Turns: []MeetingTurn{one, two}})[0]
	if !fourth.Stalled {
		t.Fatal("同版立场和证据连续两轮不变，应提示僵持")
	}
	two.Positions[0].Citations = []ReviewItem{{FilePath: "service.go", LineStart: 1, LineEnd: 1, CitationVerified: true}}
	if got := alignMeetingItems(run, MeetingRound{Items: []MeetingItem{third}, Turns: []MeetingTurn{one, two}})[0]; got.Stalled {
		t.Fatal("任一成员提供新核验出处应解除僵持")
	}
	one.Positions[0].Reason, one.Positions[0].Stance = "", "agree"
	if got := alignMeetingItems(run, MeetingRound{Items: []MeetingItem{third}, Turns: []MeetingTurn{one, two}})[0]; got.Aligned || got.Positions[0].Issue != "改口缺少理由" {
		t.Fatalf("应说明改口缺少理由: %#v", got)
	}
	one.Positions[0].Reason = "核对补充证据后同意"
	if got := alignMeetingItems(run, MeetingRound{Items: []MeetingItem{third}, Turns: []MeetingTurn{one, two}})[0]; !got.Aligned {
		t.Fatalf("全部明确同意同一版本，应达成共识: %#v", got)
	}
}

func TestMeetingProposalRecoveryAndPositionIssues(t *testing.T) {
	root, ctx := newTestGitRepo(t), context.Background()
	store, _, _ := meetingTestStore(t)
	run := Run{ID: "partial-delivery", RootID: "root", Mode: ModeGroup, Round: 1,
		CurrentStep: meetingProposal, Status: RunStatusWaitingUser,
		Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "one", Agent: "codex"}, {SlotID: "two", Agent: "claude"}}}}
	round := MeetingRound{RunID: run.ID, Number: 1}
	round.addMembers(run, meetingProposal)
	if _, err := store.createMeeting(ctx, run, round); err != nil {
		t.Fatal(err)
	}
	runner := &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root}}
	svc := NewService(nil, runner)
	svc.SetHomeDir(t.TempDir())
	next := MeetingActionInput{Round: 1, Action: "next"}
	if _, err := svc.MeetingAction(ctx, run.RootID, run.ID, next); err == nil {
		t.Fatal("零交付时必须拒绝推进")
	}
	if _, err := WriteRunDoc(root, run.ID, round.Turns[1].Doc, "恢复的原文\n\n```mindfs-control\n{bad}\n```"); err != nil {
		t.Fatal(err)
	}
	runner.respond = func(_ context.Context, req StageTurnRequest) (string, error) {
		if !strings.Contains(req.Prompt, "你自己提出的条目已默认同意") || !strings.Contains(req.Prompt, `"stance":"agree"`) ||
			strings.Contains(req.Prompt, DocRelPath(run.ID, round.Turns[0].Doc)) ||
			!strings.Contains(req.Prompt, DocRelPath(run.ID, round.Turns[1].Doc)) {
			return "", fmt.Errorf("错误的互评材料: %s", req.Prompt)
		}
		if req.Agent == "codex" {
			return "保留意见\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[{\"id\":\"D1\",\"stance\":\"agree\",\"quote\":\"保留意见\"}]}\n```", nil
		}
		if strings.Contains(req.Prompt, DocRelPath(run.ID, "第01轮/02-互评/成员1.md")) {
			return "", errors.New("第 1 轮互评不应收到前序成员的互评")
		}
		return "没有控制块的正文。", nil
	}
	if _, err := svc.MeetingAction(ctx, run.RootID, run.ID, next); err != nil {
		t.Fatal(err)
	}
	done := waitForRunCondition(t, svc, run.RootID, run.ID, func(d RunDetail) bool {
		return d.Run.CurrentStep == meetingAligned && d.Run.Status == RunStatusWaitingUser
	})
	current := done.Meeting.Rounds[0]
	if len(done.Meeting.Rounds) != 1 || len(current.Items) != 1 || current.Items[0].Proposal.Issue != "控制块无效" {
		t.Fatalf("部分交付的首轮互评: %#v", done.Meeting)
	}
	summary, err := ReadRunDoc(root, run.ID, current.SummaryDoc)
	for _, want := range []string{"恢复的原文", "成员1 · codex · 提案未交付", "控制块缺失", "控制块无效", "出处待补"} {
		if err != nil || !strings.Contains(summary, want) {
			t.Fatalf("交接稿缺 %q: %v\n%s", want, err, summary)
		}
	}
}

func TestMeetingPlanDisputeRevisionAndHandoff(t *testing.T) {
	root, ctx := newTestGitRepo(t), context.Background()
	store, _, _ := meetingTestStore(t)
	run := Run{ID: "plan-versions", RootID: "root", Mode: ModeGroup, Round: 1, CurrentStep: meetingAligned, Status: RunStatusWaitingUser,
		Snapshot: TemplateSnapshot{FinalAuthorSlotID: "two", Members: []MemberSlot{
			{SlotID: "one", Agent: "claude"}, {SlotID: "two", Agent: "codex", PermissionMode: "read-only"},
		}}}
	round := MeetingRound{RunID: run.ID, Number: 1}
	if _, err := store.createMeeting(ctx, run, round); err != nil {
		t.Fatal(err)
	}
	runner := &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root}}
	var drafted, checked int
	runner.respond = func(_ context.Context, req StageTurnRequest) (string, error) {
		switch {
		case strings.Contains(req.Prompt, "作为主笔"):
			drafted++
			if req.Agent != "codex" {
				return "", fmt.Errorf("计划阶段只能由主笔参与，收到 %s", req.Agent)
			}
			if !strings.Contains(req.Prompt, "发言从实际观点或核对结果开始") {
				return "", errors.New("计划提示缺少撰写要求")
			}
			if drafted > 1 && (!strings.Contains(req.Prompt, "作者退回-") || !strings.Contains(req.Prompt, "05-计划核对/")) {
				return "", errors.New("新版主笔缺少作者理由或上版核对")
			}
			return fmt.Sprintf("# 正式计划\n\n第 %d 稿正文。", drafted), nil
		case strings.Contains(req.Prompt, "核对你的观点"):
			checked++
			return "", errors.New("正式计划只应由主模型参与，不应触发其他成员核对")
		default:
			return "", errors.New("测试只检查快速模式的任务文件")
		}
	}
	svc := NewService(nil, runner)
	svc.SetHomeDir(t.TempDir())
	act := func(action, planID, reason string) (RunDetail, error) {
		return svc.MeetingAction(ctx, run.RootID, run.ID, MeetingActionInput{Round: 1, Action: action, PlanID: planID, Text: reason})
	}
	waitPlan := func() MeetingRound {
		return waitForRunCondition(t, svc, run.RootID, run.ID, func(d RunDetail) bool {
			return d.Run.CurrentStep == meetingReady && d.Run.Status == RunStatusWaitingUser
		}).Meeting.Rounds[0]
	}
	seedLegacyDispute := func(plan *MeetingTurn) {
		storedRun, err := store.GetRun(ctx, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		detail, err := store.readMeeting(ctx, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		currentRound := detail.Rounds[0]
		confirmDoc := fmt.Sprintf("第01轮/05-计划核对/%s-成员1.md", plan.ID)
		if _, err := WriteRunDoc(root, run.ID, confirmDoc, "有明确异议。"); err != nil {
			t.Fatal(err)
		}
		confirmed := false
		currentRound.Turns = append(currentRound.Turns, MeetingTurn{
			ID:        fmt.Sprintf("m-01-confirm-%d", len(currentRound.Turns)+1),
			Kind:      meetingConfirm,
			SlotID:    "one",
			PlanID:    plan.ID,
			Status:    StepStatusDone,
			Doc:       confirmDoc,
			Confirmed: &confirmed,
		})
		if err := store.saveMeeting(ctx, storedRun, currentRound); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := act("plan", "", ""); err != nil {
		t.Fatal(err)
	}
	first := currentMeetingPlan(waitPlan())
	if drafted != 1 || checked != 0 {
		t.Fatalf("生成正式计划应仅主模型参与: drafted=%d checked=%d", drafted, checked)
	}
	seedLegacyDispute(first)
	if _, err := act("implement", first.ID, ""); err == nil {
		t.Fatal("明确异议不得绕过")
	}
	if _, err := act("revise_plan", first.ID, "修正第一稿"); err != nil {
		t.Fatal(err)
	}
	second := currentMeetingPlan(waitPlan())
	seedLegacyDispute(second)
	if _, err := act("revise_plan", second.ID, "修正第二稿"); err != nil {
		t.Fatal(err)
	}
	third := currentMeetingPlan(waitPlan())
	seedLegacyDispute(third)
	if checked != 0 {
		t.Fatalf("主笔修订也不应触发其他成员核对: checked=%d", checked)
	}
	if _, err := act("implement", second.ID, "过期请求"); err == nil {
		t.Fatal("旧稿请求不能开始当前计划")
	}
	completed, err := act("implement", third.ID, "作者接受剩余风险")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = svc.PauseRun(ctx, run.RootID, completed.Meeting.QuickRunID) })
	resolutions := completed.Meeting.Rounds[0].PlanResolutions
	if len(resolutions) != 3 || resolutions[2].PlanID != third.ID || resolutions[2].Reason != "作者接受剩余风险" {
		t.Fatalf("缺少按版本保留的处理记录: %#v", resolutions)
	}
	for i, plan := range []*MeetingTurn{first, second, third} {
		doc, err := ReadRunDoc(root, run.ID, plan.Doc)
		if err != nil || !strings.Contains(doc, fmt.Sprintf("第 %d 稿正文。", i+1)) {
			t.Fatalf("版本文档 %s: %v %q", plan.Doc, err, doc)
		}
	}
	quick, err := store.GetRun(ctx, completed.Meeting.QuickRunID)
	if err != nil || !strings.Contains(quick.TaskPrompt, "第 3 稿正文") || !strings.Contains(quick.TaskPrompt, DocRelPath(run.ID, third.Doc)) ||
		quick.Snapshot.Members[0].PermissionMode != "read-only" {
		t.Fatalf("快速模式应使用选中版本和显式权限: %v %#v", err, quick)
	}
}

type interruptMeetingRunner struct {
	*meetingTestRunner
	mu             sync.Mutex
	contexts       map[string]context.Context
	interrupts     chan string
	beforeRegister func(StageTurnRequest)
}

func (r *interruptMeetingRunner) RunStageTurn(ctx context.Context, req StageTurnRequest) (StageTurnResult, error) {
	r.beforeRegister(req)
	return r.meetingTestRunner.RunStageTurn(ctx, req)
}

func (r *interruptMeetingRunner) CancelStageTurn(_ context.Context, _, session string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.interrupts <- session
	if ctx := r.contexts[session]; ctx == nil || ctx.Err() != nil {
		return errors.New("外层上下文已取消")
	}
	return nil
}

func TestMeetingPauseInterruptsActiveParallelTurns(t *testing.T) {
	root := newTestGitRepo(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	store, _, _ := meetingTestStore(t)
	started := make(chan StageTurnRequest, 2)
	partialBoundary, lastBoundary := make(chan struct{}, 1), make(chan struct{}, 1)
	registerPending, allowRegister := make(chan struct{}), make(chan struct{})
	var pendingOnce sync.Once
	runner := &interruptMeetingRunner{meetingTestRunner: &meetingTestRunner{
		fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root},
	}, contexts: make(map[string]context.Context), interrupts: make(chan string, 4)}
	runner.beforeRegister = func(req StageTurnRequest) {
		if req.MemberSlotID == "four" {
			pendingOnce.Do(func() {
				close(registerPending)
				select {
				case <-allowRegister:
				case <-ctx.Done():
				}
			})
		}
	}
	runner.respond = func(turnCtx context.Context, req StageTurnRequest) (string, error) {
		if !strings.Contains(req.Prompt, "独立阅读议题") {
			return "无义务给出结构化表态。", nil
		}
		if req.MemberSlotID == "three" {
			return "暂停前已交付的正文。", nil
		}
		if req.MemberSlotID == "four" {
			return "登记后交付的正文。", nil
		}
		runner.mu.Lock()
		_, retried := runner.contexts[req.SessionKey]
		runner.contexts[req.SessionKey] = turnCtx
		runner.mu.Unlock()
		if retried {
			return "继续后交付正文。", nil
		}
		started <- req
		if req.MemberSlotID == "one" {
			select {
			case <-partialBoundary:
			case <-ctx.Done():
				return "", ctx.Err()
			}
			return "暂停时的半截正文。", nil
		}
		select {
		case <-lastBoundary:
			return "", context.Canceled
		case <-turnCtx.Done():
			return "", turnCtx.Err()
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	svc := NewService(nil, runner)
	home := t.TempDir()
	svc.SetHomeDir(home)
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), []byte("# Project rules"), 0600); err != nil {
		t.Fatal(err)
	}
	skill := filepath.Join(root, "SKILL.md")
	if err := os.WriteFile(skill, []byte("---\nname: project-review\ndescription: review rules\n---\n# Only index the path"), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := svc.StartMeeting(ctx, StartMeetingInput{StartQuickRunInput: StartQuickRunInput{RootID: "root", TaskPrompt: "测试并行暂停", SkillPaths: []string{skill},
		Members: []MemberSlot{{SlotID: "one", Agent: "codex"}, {SlotID: "two", Agent: "claude"}, {SlotID: "three", Agent: "codex"}, {SlotID: "four", Agent: "claude"}}}})
	if err != nil {
		t.Fatal(err)
	}
	sessions := make(map[string]string)
	for range 2 {
		select {
		case req := <-started:
			sessions[req.SessionKey] = req.MemberSlotID
		case <-ctx.Done():
			t.Fatal("并行会话没有启动")
		}
	}
	beforePause := waitForRunCondition(t, svc, "root", result.Run.ID, func(d RunDetail) bool {
		return d.Meeting.Rounds[0].Turns[2].Status == StepStatusDone
	})
	select {
	case <-registerPending:
	case <-ctx.Done():
		t.Fatal("未登记的发言没有到达运行层")
	}
	paused := make(chan error, 1)
	go func() {
		detail, err := svc.PauseRun(ctx, "root", result.Run.ID)
		if err == nil && detail.Run.Status != RunStatusWaitingUser {
			err = fmt.Errorf("暂停后的状态应等待作者: %s", detail.Run.Status)
		}
		paused <- err
	}()
	var lastSession string
	for range 2 {
		select {
		case session := <-runner.interrupts:
			if sessions[session] == "" {
				t.Fatalf("中断了错误的会话: %s", session)
			}
			if sessions[session] == "two" {
				lastSession = session
			}
			delete(sessions, session)
		case <-ctx.Done():
			t.Fatal("两个活跃会话应在上下文取消前收到中断")
		}
	}
	close(allowRegister)
	partialBoundary <- struct{}{}
	partial := waitForRunCondition(t, svc, "root", result.Run.ID, func(d RunDetail) bool {
		turn := d.Meeting.Rounds[0].Turns[0]
		return turn.Status != StepStatusRunning && turn.Body == "暂停时的半截正文。"
	})
	turn := partial.Meeting.Rounds[0].Turns[0]
	if turn.Status != StepStatusWaitingUser {
		t.Fatalf("暂停时返回的半截正文不能成为交付: %#v", turn)
	}
	if _, err := ReadRunDoc(root, result.Run.ID, turn.Doc); !os.IsNotExist(err) {
		t.Fatalf("半截正文不应生成交付文件: %v", err)
	}
	current, err := svc.ContinueRun(ctx, "root", result.Run.ID)
	if err != nil || !current.Meeting.Rounds[0].Turns[1].At.Equal(beforePause.Meeting.Rounds[0].Turns[1].At) {
		t.Fatalf("原生回合结束前不能复用会话: %v %#v", err, current.Meeting)
	}
	runner.mu.Lock()
	lastCtx := runner.contexts[lastSession]
	runner.mu.Unlock()
	if lastCtx.Err() != nil {
		t.Fatalf("原生回合边界前取消了上下文: %v", lastCtx.Err())
	}
	select {
	case err := <-paused:
		t.Fatalf("仍有原生回合时提前结束暂停: %v", err)
	default:
	}
	lastBoundary <- struct{}{}
	select {
	case err := <-paused:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("原生回合结束后没有完成暂停")
	}
	select {
	case session := <-runner.interrupts:
		t.Fatalf("未登记的发言不能收到原生中断: %s", session)
	default:
	}
	pauseDetail, err := svc.GetRunDetail(ctx, "root", result.Run.ID)
	if err != nil {
		t.Fatal(err)
	}
	pending := pauseDetail.Meeting.Rounds[0].Turns[3]
	if pending.Status != StepStatusWaitingUser || pending.Body != "" {
		t.Fatalf("暂停时未登记的发言不能启动: %#v", pending)
	}
	if _, err := svc.ContinueRun(ctx, "root", result.Run.ID); err != nil {
		t.Fatal(err)
	}
	done := waitForRunCondition(t, svc, "root", result.Run.ID, func(d RunDetail) bool { return d.Run.CurrentStep == meetingAligned })
	turns := done.Meeting.Rounds[0].Turns
	if turns[0].Body != "继续后交付正文。" || turns[1].Body != "继续后交付正文。" || turns[2].Body != "暂停前已交付的正文。" ||
		!turns[2].At.Equal(beforePause.Meeting.Rounds[0].Turns[2].At) || turns[3].Body != "登记后交付的正文。" {
		t.Fatalf("应只在原会话补跑未交付成员: %#v", turns[:4])
	}
	runner.fakeCollabRunner.mu.Lock()
	defer runner.fakeCollabRunner.mu.Unlock()
	for _, req := range runner.turns[:3] {
		if !strings.Contains(req.Prompt, ".mindfs/runs/") || !strings.Contains(req.Prompt, `"stance":"propose"`) || !strings.Contains(req.Prompt, "`AGENTS.md`") || !strings.Contains(req.Prompt, skill) ||
			!strings.Contains(req.Prompt, "project-review") || strings.Contains(req.Prompt, "Only index the path") || !strings.Contains(req.Prompt, "发言从实际观点或核对结果开始") {
			t.Fatalf("提案提示缺少撰写要求、搜索、示例或规范索引: %s", req.Prompt)
		}
	}
}
