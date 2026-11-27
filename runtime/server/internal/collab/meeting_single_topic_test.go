package collab

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestSingleTopicMeetingFromTemplateToPlan(t *testing.T) {
	ctx, root := context.Background(), newTestGitRepo(t)
	store, _, _ := meetingTestStore(t)
	templates, err := NewTemplateStoreAt(filepath.Join(t.TempDir(), "templates.json"))
	if err != nil {
		t.Fatal(err)
	}
	tpl := Template{Name: "Bug 讨论", Mode: ModeGroup, Members: []MemberSlot{{SlotID: "one", Agent: "codex"}, {SlotID: "two", Agent: "claude"}}}
	saved, err := templates.Save(tpl)
	if err != nil || saved.TopicMode != TopicMulti {
		t.Fatalf("existing template default: %#v, %v", saved, err)
	}
	tpl.TopicMode = "other"
	if _, err := templates.Save(tpl); err == nil {
		t.Fatal("accepted unknown topic mode")
	}
	tpl.TopicMode = TopicSingle
	saved, err = templates.Save(tpl)
	if err != nil {
		t.Fatal(err)
	}
	runner := &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root}}
	runner.respond = func(_ context.Context, req StageTurnRequest) (string, error) {
		switch {
		case strings.Contains(req.Prompt, "独立提出一份候选方案"):
			opinion := map[string]string{"codex": "核对按钮事件", "claude": "核对请求重试"}[req.Agent]
			return fmt.Sprintf("%s\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[{\"id\":\"D1\",\"stance\":\"propose\",\"title\":%q,\"quote\":%q}]}\n```", opinion, opinion, opinion), nil
		case strings.Contains(req.Prompt, "本场只有一个议题"):
			return "沿用自己的方案。\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[]}\n```", nil
		case strings.Contains(req.Prompt, "围绕原问题交付一份解决方案"):
			return "核对请求重试并复现重复发送。", nil
		case strings.Contains(req.Prompt, "核对你的观点"):
			return "", fmt.Errorf("plan generation should only run lead model, unexpected confirmation prompt: %s", req.Prompt)
		case strings.Contains(req.Prompt, "回答作者点名的补充问题"):
			if !strings.Contains(req.Prompt, MeetingPlanDoc) {
				return "", fmt.Errorf("follow-up answer prompt missing plan doc: %s", req.Prompt)
			}
			return "补充解释：" + req.Agent + " 已核对正式计划。", nil
		}
		return "", fmt.Errorf("unexpected stage: %s", req.Prompt)
	}
	svc := NewService(templates, runner)
	svc.SetHomeDir(t.TempDir())
	created, err := svc.StartMeeting(ctx, StartMeetingInput{StartQuickRunInput: StartQuickRunInput{
		RootID: "root", TemplateID: saved.ID, TaskPrompt: "为什么重复发送消息？"}})
	if err != nil {
		t.Fatal(err)
	}
	wait := func(step string) RunDetail {
		return waitForRunCondition(t, svc, "root", created.Run.ID, func(d RunDetail) bool {
			return d.Run.CurrentStep == step && d.Run.Status == RunStatusWaitingUser
		})
	}
	detail := wait(meetingAligned)
	items := detail.Meeting.Rounds[0].Items
	if detail.Run.Snapshot.TopicMode != TopicSingle || len(items) != 1 || items[0].Title != detail.Run.Title ||
		len(items[0].Candidates) != 2 || items[0].Aligned || len(items[0].Positions) != 2 {
		t.Fatalf("different supported solutions must remain one disputed topic: %#v", items)
	}
	selected := items[0].Candidates[1]
	for i, vote := range items[0].Positions {
		if vote.Stance != "agree" || vote.VersionID != items[0].Candidates[i].VersionID {
			t.Fatalf("own candidate support: %#v", vote)
		}
	}
	_, err = svc.MeetingAction(ctx, "root", created.Run.ID, MeetingActionInput{Action: "next", Round: 1})
	if err != nil {
		t.Fatal(err)
	}
	second := wait(meetingAligned)
	latest := second.Meeting.Rounds[1].Items
	if len(latest) != 1 || !latest[0].Stalled || latest[0].Aligned || len(latest[0].Candidates) != 2 ||
		latest[0].Candidates[1].VersionID != selected.VersionID {
		t.Fatalf("second round must keep the same topic and candidates: %#v", latest)
	}
	_, err = svc.MeetingAction(ctx, "root", created.Run.ID, MeetingActionInput{Action: "plan", Round: 2, Decisions: []MeetingDecision{{
		ItemID: "D1", Choice: "adopt", SlotID: selected.SlotID, TurnID: selected.TurnID, VersionID: selected.VersionID,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	wait(meetingReady)
	plan, err := ReadRunDoc(root, created.Run.ID, MeetingPlanDoc)
	if err != nil || !strings.Contains(plan, "> 核对请求重试") || strings.Contains(plan, "> 核对按钮事件") {
		t.Fatalf("saved plan must include the chosen solution: %v\n%s", err, plan)
	}
	if _, err := svc.MeetingAction(ctx, "root", created.Run.ID, MeetingActionInput{
		Round: 2, Action: "message", Text: "正式计划里重试幂等键放在哪里？",
	}); err != nil {
		t.Fatalf("follow-up in ready stage failed: %v", err)
	}
	afterReadyFollowup := wait(meetingReady)
	lastReadyTurn := afterReadyFollowup.Meeting.Rounds[1].Turns[len(afterReadyFollowup.Meeting.Rounds[1].Turns)-1]
	if lastReadyTurn.Kind != meetingAnswer || lastReadyTurn.Status != StepStatusDone || lastReadyTurn.SlotID != "one" {
		t.Fatalf("ready follow-up should default to plan author: %#v", lastReadyTurn)
	}
	finished, err := svc.MeetingAction(ctx, "root", created.Run.ID, MeetingActionInput{Round: 2, Action: "finish"})
	if err != nil || finished.Run.Status != RunStatusCompleted || finished.Meeting.QuickRunID != "" {
		t.Fatalf("finish with a plan: %#v, %v", finished.Run, err)
	}
	if _, err := svc.MeetingAction(ctx, "root", created.Run.ID, MeetingActionInput{
		Round: 2, Action: "message", Text: "@成员2 再确认一下边界情况",
	}); err != nil {
		t.Fatalf("follow-up after finish failed: %v", err)
	}
	afterFinishFollowup := waitForRunCondition(t, svc, "root", created.Run.ID, func(d RunDetail) bool {
		turns := d.Meeting.Rounds[1].Turns
		last := turns[len(turns)-1]
		return d.Run.Status == RunStatusCompleted && last.Kind == meetingAnswer && last.Status == StepStatusDone && last.SlotID == "two"
	})
	if afterFinishFollowup.Run.CurrentStep != meetingReady || afterFinishFollowup.Run.CompletedAt == "" {
		t.Fatalf("completed meeting should stay completed after follow-up: %#v", afterFinishFollowup.Run)
	}
}

func TestSingleTopicMultipleProposalsFromOneMember(t *testing.T) {
	run := Run{Title: "为什么会重复发送？", Snapshot: TemplateSnapshot{TopicMode: TopicSingle, Members: []MemberSlot{{SlotID: "a"}, {SlotID: "b"}}}}
	round := MeetingRound{Turns: []MeetingTurn{
		{ID: "p1", Kind: meetingProposal, SlotID: "a", Status: StepStatusDone, Positions: []MeetingPosition{
			{TurnID: "p1", SlotID: "a", ID: "C", Stance: "propose", Title: "按钮事件"},
			{TurnID: "p1", SlotID: "a", ID: "D", Stance: "propose", Title: "重复订阅"},
		}},
		{ID: "p2", Kind: meetingProposal, SlotID: "b", Status: StepStatusDone, Positions: []MeetingPosition{
			{TurnID: "p2", SlotID: "b", ID: "D", Stance: "propose", Title: "请求重试"},
		}},
	}}
	items := meetingCandidates(run, round)
	if len(items) != 1 || len(items[0].Candidates) != 3 {
		t.Fatalf("expected three candidates under one topic: %#v", items)
	}
	for i, version := range []string{"S1-p1", "S2-p1", "S3-p2"} {
		if p := items[0].Candidates[i]; p.ID != "D1" || p.VersionID != version {
			t.Fatalf("unexpected candidate: %#v", p)
		}
	}
	reviews := MeetingRound{Number: 1, Turns: []MeetingTurn{
		{Kind: meetingReview, SlotID: "a", Status: StepStatusDone},
		{Kind: meetingReview, SlotID: "b", Status: StepStatusDone},
	}}
	result := alignSingleTopic(run, items[0], reviews)
	if result.Aligned || result.Positions[0].Stance != "unconfirmed" || result.Positions[1].VersionID != "S3-p2" {
		t.Fatalf("ambiguous own proposal cannot imply a choice: %#v", result.Positions)
	}
	reviews.Turns = []MeetingTurn{
		{ID: "r1", Kind: meetingReview, SlotID: "b", Status: StepStatusDone, Positions: []MeetingPosition{
			{ID: "D1", TurnID: "r1", SlotID: "b", Stance: "propose", VersionID: "S1-p1", Title: "修正按钮事件"},
		}},
		{Kind: meetingReview, SlotID: "a", Status: StepStatusDone},
	}
	if vote := alignSingleTopic(run, items[0], reviews).Positions[0]; vote.Stance != "unconfirmed" {
		t.Fatalf("an unseen revision cannot resolve an ambiguous blind vote: %#v", vote)
	}
}

func TestSingleTopicRevisionsAndVotes(t *testing.T) {
	run := Run{Snapshot: TemplateSnapshot{TopicMode: TopicSingle, Members: []MemberSlot{{SlotID: "a"}, {SlotID: "b"}}}}
	topic := MeetingItem{ID: "D1", Candidates: []MeetingPosition{
		{ID: "D1", SlotID: "a", TurnID: "p1", VersionID: "S1-p1", Stance: "propose", Quote: "第一种做法"},
		{ID: "D1", SlotID: "b", TurnID: "p2", VersionID: "S2-p2", Stance: "propose", Quote: "第二种做法"},
	}}
	review := func(id, slot, stance, version string) MeetingTurn {
		return MeetingTurn{ID: id, SlotID: slot, Kind: meetingReview, Status: StepStatusDone, Positions: []MeetingPosition{{
			ID: "D1", TurnID: id, SlotID: slot, Stance: stance, VersionID: version, Quote: "检查后的判断", Reason: "复现结果",
		}}}
	}
	revised := alignSingleTopic(run, topic, MeetingRound{Number: 1, Turns: []MeetingTurn{review("r1", "a", "agree", "S1-p1"), review("r2", "b", "propose", "S1-p1")}})
	if revised.Aligned || revised.Positions[0].Stance != "unconfirmed" || revised.Candidates[1].Quote != "第二种做法" ||
		revised.Candidates[0].VersionID != "S1-r2" || topic.Candidates[0].VersionID != "S1-p1" {
		t.Fatalf("a revision must replace just its target: %#v", revised)
	}
	old := MeetingDecision{ItemID: "D1", SlotID: "a", TurnID: "p1", VersionID: "S1-p1", Choice: "adopt"}
	if err := validateMeetingDecisions([]MeetingItem{revised}, []MeetingDecision{old}); err == nil {
		t.Fatal("adopted a superseded candidate")
	}
	agree := MeetingRound{Number: 2, Turns: []MeetingTurn{review("r3", "a", "agree", "s1-r2"), review("r4", "b", "agree", "S1-r2")}}
	result := alignSingleTopic(run, revised, agree)
	if !result.Aligned || result.Stalled || !strings.Contains(renderMeetingItems(run, MeetingRound{Items: []MeetingItem{result}}), "全体成员一致支持方案 1。") {
		t.Fatalf("all members backed the same version: %#v", result)
	}
	agree.Turns[0].Status = StepStatusFailed
	if alignSingleTopic(run, revised, agree).Aligned {
		t.Fatal("failed review counted towards consensus")
	}
	agree.Turns = agree.Turns[1:]
	if alignSingleTopic(run, revised, agree).Aligned {
		t.Fatal("absent member counted towards consensus")
	}
}

func TestMeetingOverrideAllAuthorDirection(t *testing.T) {
	ctx, root := context.Background(), newTestGitRepo(t)
	store, _, _ := meetingTestStore(t)
	run := Run{
		ID: "override-all", RootID: "root", Mode: ModeGroup, Round: 1,
		Title: "架构演进方案", TaskPrompt: "讨论架构演进方案",
		CurrentStep: meetingAligned, Status: RunStatusWaitingUser,
		Snapshot: TemplateSnapshot{
			Mode:              ModeGroup,
			FinalAuthorSlotID: "two",
			Members: []MemberSlot{
				{SlotID: "one", Agent: "codex"},
				{SlotID: "two", Agent: "claude"},
			},
		},
	}
	round := MeetingRound{
		RunID:      run.ID,
		Number:     1,
		SummaryDoc: "第01轮/03-共识与分歧.md",
		Items: []MeetingItem{
			{ID: "D1", Title: "存储选型", Aligned: false},
			{ID: "D2", Title: "接口兼容", Aligned: false},
		},
	}
	if _, err := WriteRunDoc(root, run.ID, MeetingTopicDoc, "# 会议议题\n\n讨论架构演进方案"); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteRunDoc(root, run.ID, round.SummaryDoc, "# 共识与分歧\n\n未达成一致。"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.createMeeting(ctx, run, round); err != nil {
		t.Fatal(err)
	}

	runner := &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root}}
	var planAgents []string
	var answerPrompt string
	runner.respond = func(_ context.Context, req StageTurnRequest) (string, error) {
		switch {
		case strings.Contains(req.Prompt, "作为主笔"):
			planAgents = append(planAgents, req.Agent)
			if !strings.Contains(req.Prompt, "作者已一键否决本轮所有共识与分歧议题") ||
				!strings.Contains(req.Prompt, DocRelPath(run.ID, "第01轮/作者裁决.md")) {
				return "", fmt.Errorf("override plan prompt missing author override instructions: %s", req.Prompt)
			}
			return "# 正式计划\n\n按作者指定方向改为插件化开关。", nil
		case strings.Contains(req.Prompt, "回答作者点名的补充问题"):
			answerPrompt = req.Prompt
			return "按作者方向补充迁移步骤。", nil
		default:
			return "", fmt.Errorf("unexpected turn during override plan: agent=%s prompt=%s", req.Agent, req.Prompt)
		}
	}
	svc := NewService(nil, runner)
	svc.SetHomeDir(t.TempDir())

	if _, err := svc.MeetingAction(ctx, run.RootID, run.ID, MeetingActionInput{
		Round: 1, Action: "plan", OverrideAll: true, Text: "   ",
	}); err == nil {
		t.Fatal("override_all without direction should be rejected")
	}

	direction := "放弃上述所有分歧方案，直接新增独立开关并在启动时读取配置。"
	if _, err := svc.MeetingAction(ctx, run.RootID, run.ID, MeetingActionInput{
		Round: 1, Action: "plan", OverrideAll: true, Text: direction,
	}); err != nil {
		t.Fatal(err)
	}
	ready := waitForRunCondition(t, svc, run.RootID, run.ID, func(d RunDetail) bool {
		return d.Run.CurrentStep == meetingReady && d.Run.Status == RunStatusWaitingUser
	})
	if len(planAgents) != 1 || planAgents[0] != "claude" {
		t.Fatalf("only lead model should write override plan, got %v", planAgents)
	}
	for _, turn := range ready.Meeting.Rounds[0].Turns {
		if turn.Kind == meetingConfirm {
			t.Fatalf("override plan must not schedule confirmation turns: %#v", turn)
		}
	}
	if ready.Meeting.Rounds[0].AuthorOverride != direction || len(ready.Meeting.Rounds[0].Decisions) != 0 {
		t.Fatalf("unexpected override state: %#v", ready.Meeting.Rounds[0])
	}
	overrideDoc, err := ReadRunDoc(root, run.ID, "第01轮/作者裁决.md")
	if err != nil || !strings.Contains(overrideDoc, "否决全部议题") || !strings.Contains(overrideDoc, direction) {
		t.Fatalf("override doc mismatch: %v\n%s", err, overrideDoc)
	}
	planDoc, err := ReadRunDoc(root, run.ID, MeetingPlanDoc)
	if err != nil || !strings.Contains(planDoc, "## 作者方向（已否决全部议题）") || !strings.Contains(planDoc, direction) ||
		!strings.Contains(planDoc, "按作者指定方向改为插件化开关") {
		t.Fatalf("plan doc mismatch: %v\n%s", err, planDoc)
	}

	if _, err := svc.MeetingAction(ctx, run.RootID, run.ID, MeetingActionInput{
		Round: 1, Action: "message", Text: "补充一下回滚策略",
	}); err != nil {
		t.Fatal(err)
	}
	waitForRunCondition(t, svc, run.RootID, run.ID, func(d RunDetail) bool {
		turns := d.Meeting.Rounds[0].Turns
		last := turns[len(turns)-1]
		return d.Run.Status == RunStatusWaitingUser && last.Kind == meetingAnswer && last.Status == StepStatusDone
	})
	if !strings.Contains(answerPrompt, DocRelPath(run.ID, "第01轮/作者裁决.md")) {
		t.Fatalf("follow-up answer should reference author override doc: %s", answerPrompt)
	}
}
