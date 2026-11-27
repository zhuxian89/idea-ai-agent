package collab

import (
	"context"
	"strings"
	"testing"
)

func TestAlignMeetingItemsAuthorImplicitlyAgrees(t *testing.T) {
	run := Run{Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "a"}, {SlotID: "b"}}}}
	build := func(issue, stance string) MeetingItem {
		proposal := &MeetingPosition{ID: "D1", SlotID: "a", Stance: "propose", Quote: "方案", Issue: issue, VersionID: "D1-v1"}
		round := MeetingRound{
			Items: []MeetingItem{{ID: "D1", Proposal: proposal, Revision: 1}},
			Turns: []MeetingTurn{
				{ID: "r1", Kind: meetingReview, SlotID: "a", Status: StepStatusDone},
				{ID: "r2", Kind: meetingReview, SlotID: "b", Status: StepStatusDone, Positions: []MeetingPosition{
					{ID: "D1", SlotID: "b", Stance: stance, VersionID: "D1-v1", Quote: "原话", Reason: "理由"}}},
			},
		}
		return alignMeetingItems(run, round)[0]
	}
	if item := build("", "agree"); !item.Aligned || item.Positions[0].Stance != "agree" || item.Positions[0].Source != "author" {
		t.Fatalf("提案人未自动同意自己的版本: %#v", item)
	}
	if item := build("", "disagree"); item.Aligned || item.Positions[0].Stance != "agree" {
		t.Fatalf("他人反对时不应对齐，提案人仍自动同意: %#v", item)
	}
	if item := build("引文与正文不匹配", "agree"); item.Aligned || item.Positions[0].Source == "author" {
		t.Fatalf("有问题的提案不应自动同意: %#v", item)
	}
}

func TestMeetingFinishKeepsPlanWithoutImplementation(t *testing.T) {
	root, ctx := newTestGitRepo(t), context.Background()
	store, _, _ := meetingTestStore(t)
	run := Run{ID: "finish-only", RootID: "root", Mode: ModeGroup, Round: 1, CurrentStep: meetingProposal, Status: RunStatusWaitingUser,
		Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "one", Agent: "codex"}, {SlotID: "two", Agent: "claude"}}}}
	round := MeetingRound{RunID: run.ID, Number: 1}
	round.addMembers(run, meetingProposal)
	if _, err := store.createMeeting(ctx, run, round); err != nil {
		t.Fatal(err)
	}
	svc := NewService(nil, &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root}})
	if _, err := svc.MeetingAction(ctx, run.RootID, run.ID, MeetingActionInput{Round: 1, Action: "finish"}); err == nil {
		t.Fatal("没有正式计划时不应允许结束会议")
	}
	run.CurrentStep = meetingReady
	round.Turns = append(round.Turns, MeetingTurn{ID: "p1", Kind: meetingPlan, SlotID: "one", Status: StepStatusDone, Doc: MeetingPlanDoc})
	if err := store.saveMeeting(ctx, run, round); err != nil {
		t.Fatal(err)
	}
	done, err := svc.MeetingAction(ctx, run.RootID, run.ID, MeetingActionInput{Round: 1, Action: "finish"})
	if err != nil || done.Run.Status != RunStatusCompleted || done.Run.CompletedAt == "" || done.Meeting.QuickRunID != "" {
		t.Fatalf("结束会议: %#v %v", done.Run, err)
	}
	if _, err := svc.MeetingAction(ctx, run.RootID, run.ID, MeetingActionInput{Round: 1, Action: "implement", PlanID: "p1"}); err == nil {
		t.Fatal("已结束的会议不应再开始实现")
	}
}

func TestMeetingConsensusGoesStraightToPlan(t *testing.T) {
	root, ctx := newTestGitRepo(t), context.Background()
	store, _, _ := meetingTestStore(t)
	run := Run{ID: "consensus", RootID: "root", Mode: ModeGroup, Round: 1, CurrentStep: meetingAligned, Status: RunStatusWaitingUser,
		Snapshot: TemplateSnapshot{FinalAuthorSlotID: "one", Members: []MemberSlot{
			{SlotID: "one", Agent: "codex"}, {SlotID: "two", Agent: "claude"},
		}}}
	round := MeetingRound{RunID: run.ID, Number: 1, Items: []MeetingItem{{ID: "C1", Title: "保留入口", Aligned: true}}}
	round.SummaryDoc = round.doc(meetingSummaryDoc)
	if _, err := WriteRunDoc(root, run.ID, round.SummaryDoc, renderMeetingItems(run, round)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.createMeeting(ctx, run, round); err != nil {
		t.Fatal(err)
	}
	runner := &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root},
		respond: func(_ context.Context, req StageTurnRequest) (string, error) {
			if strings.Contains(req.Prompt, "作为主笔") {
				return "按共识保留入口。", nil
			}
			return "表述准确。\n\n```mindfs-control\n{\"kind\":\"meeting-confirmation\",\"confirmed\":true}\n```", nil
		}}
	svc := NewService(nil, runner)
	svc.SetHomeDir(t.TempDir())
	_, err := svc.MeetingAction(ctx, run.RootID, run.ID, MeetingActionInput{Round: 1, Action: "next"})
	if err == nil || !strings.Contains(err.Error(), "可以生成正式计划") {
		t.Fatalf("达成共识后仍可开始下一轮: %v", err)
	}
	detail, err := svc.GetRunDetail(ctx, run.RootID, run.ID)
	if err != nil || detail.Run.Round != 1 || detail.Run.CurrentStep != meetingAligned || len(detail.Meeting.Rounds) != 1 {
		t.Fatalf("拒绝后应保留已达成的共识: %+v %v", detail.Run, err)
	}
	if _, err := svc.MeetingAction(ctx, run.RootID, run.ID, MeetingActionInput{Round: 1, Action: "plan"}); err != nil {
		t.Fatal(err)
	}
	waitForRunCondition(t, svc, run.RootID, run.ID, func(d RunDetail) bool {
		return d.Run.CurrentStep == meetingReady && d.Run.Status == RunStatusWaitingUser
	})
	plan, err := ReadRunDoc(root, run.ID, MeetingPlanDoc)
	if err != nil || !strings.Contains(plan, "按共识保留入口。") {
		t.Fatalf("已对齐的会议应直接生成计划: %v\n%s", err, plan)
	}
}

func TestMeetingFirstRoundReviewIsSealedAndLaterRoundsShare(t *testing.T) {
	run := Run{ID: "r", Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "a"}, {SlotID: "b"}}}}
	build := func(number int) (MeetingRound, MeetingTurn) {
		self := MeetingTurn{ID: "r-b", Kind: meetingReview, SlotID: "b", Doc: "互评/b.md"}
		return MeetingRound{Number: number, Turns: []MeetingTurn{
			{ID: "p-a", Kind: meetingProposal, SlotID: "a", Status: StepStatusDone, Doc: "提案/a.md"},
			{ID: "r-a", Kind: meetingReview, SlotID: "a", Status: StepStatusDone, Doc: "互评/a.md"},
			self,
		}}, self
	}
	round, self := build(1)
	prompt := meetingPrompt(run, round, self, "")
	if !strings.Contains(prompt, "提案/a.md") || strings.Contains(prompt, "互评/a.md") {
		t.Fatalf("第 1 轮互评应只给提案、不给他人互评:\n%s", prompt)
	}
	audit := newMeetingReadAudit(t.TempDir(), run, round, self)
	if len(audit.candidates) != 1 || !strings.HasSuffix(audit.candidates[0], "互评/a.md") {
		t.Fatalf("第 1 轮互评应检测是否读过他人互评: %v", audit.candidates)
	}
	round, self = build(2)
	prompt = meetingPrompt(run, round, self, "")
	if !strings.Contains(prompt, "互评/a.md") {
		t.Fatalf("第 2 轮起互评需要看到他人意见:\n%s", prompt)
	}
	if !strings.Contains(prompt, "只处理本轮清单中尚未对齐的条目。逐条回应需要更新的条目") ||
		!strings.Contains(prompt, "id 和 version_id 从本轮条目清单中逐字复制") ||
		!strings.Contains(prompt, `"version_id":"<清单版本号>"`) || strings.Contains(prompt, `"D1-v1"`) ||
		strings.Contains(prompt, "你自己提出的条目已默认同意") {
		t.Fatalf("后续互评应按轮初清单填写有更新的条目:\n%s", prompt)
	}
	if audit := newMeetingReadAudit(t.TempDir(), run, round, self); len(audit.candidates) != 0 {
		t.Fatalf("第 2 轮不应限制读取: %v", audit.candidates)
	}
	run.Snapshot.TopicMode = TopicSingle
	const ownCandidate = "支持自己提交的唯一有效方案时可提交空 items"
	if prompt := meetingPrompt(run, round, self, ""); strings.Contains(prompt, ownCandidate) ||
		!strings.Contains(prompt, "维持对同一版本的有效立场时省略该条") {
		t.Fatalf("单议题后续互评省略时应维持有效立场:\n%s", prompt)
	}
	round, self = build(1)
	if prompt := meetingPrompt(run, round, self, ""); !strings.Contains(prompt, ownCandidate) {
		t.Fatalf("单议题首轮互评应说明如何支持自己的方案:\n%s", prompt)
	}
}

func TestMeetingPositionsAreClippedAfterQuoteCheck(t *testing.T) {
	long := strings.Repeat("长", 500)
	body := "同意\n" + long
	block := ControlBlock{Payload: []byte(`{"kind":"meeting-positions","items":[{"id":"D1","stance":"agree","quote":"` + long +
		`","checked":"` + long + `","risk":"无","citations":[]}]}`)}
	got, _, issue := parseMeetingPositions(t.TempDir(), MeetingRound{}, MeetingTurn{ID: "t", SlotID: "a", Body: body}, []ControlBlock{block})
	if issue != "" || len(got) != 1 || got[0].Issue != "" || got[0].Stance != "agree" {
		t.Fatalf("长引文应先通过原文校验: %#v %q", got, issue)
	}
	if n := len([]rune(got[0].Quote)); n > meetingStanceQuoteLimit+1 || !strings.HasSuffix(got[0].Quote, "…") ||
		len([]rune(got[0].Checked)) > meetingNoteLimit+1 {
		t.Fatalf("保存的立场字段应被截断: quote=%d checked=%d", n, len([]rune(got[0].Checked)))
	}
}

func TestRenderMeetingItemsShowsOnlyLatestVersion(t *testing.T) {
	run := Run{ID: "r", Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "a"}, {SlotID: "b"}}}}
	item := MeetingItem{ID: "D1", Title: "条目", Revision: 2,
		Proposal:  &MeetingPosition{SlotID: "b", Stance: "propose", Quote: "新方案", VersionID: "D1-v2"},
		Positions: []MeetingPosition{{SlotID: "a", Stance: "agree", Quote: "认可新方案", VersionID: "D1-v2"}}}
	out := renderMeetingItems(run, MeetingRound{Items: []MeetingItem{item}})
	if !strings.Contains(out, "新方案") || !strings.Contains(out, "认可新方案") || strings.Contains(out, "旧方案") || strings.Contains(out, "### D1-v1") {
		t.Fatalf("交接文件应只显示最新版本:\n%s", out)
	}
}
