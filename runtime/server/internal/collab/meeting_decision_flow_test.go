package collab

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// 端到端：三位成员走完提案和互评，覆盖这次改动涉及的几种表态，再走作者裁决。
// 议题：C1 全员同意（claude 的引文去掉了反引号）；D1 有人反对（另有一位引文对不上但同意）；C2 没有人反对但有成员漏答。
func TestMeetingDecisionFlowEndToEnd(t *testing.T) {
	runDecisionFlow(t, nil)
}

// 下一轮只讨论未对齐的议题：待确认的议题补上有效表态后变成共识，有人反对的议题仍然保留反对。
func TestMeetingNextRoundResolvesPendingItemsWithoutLosingObjections(t *testing.T) {
	var followUpPrompts []StageTurnRequest
	runDecisionFlow(t, func(ctx context.Context, service *Service, root, id string, runner *meetingTestRunner) {
		if _, err := service.MeetingAction(ctx, "root", id, MeetingActionInput{Round: 1, Action: "next"}); err != nil {
			t.Fatal(err)
		}
		second := waitForRunCondition(t, service, "root", id, func(d RunDetail) bool {
			return d.Run.Round == 2 && d.Run.CurrentStep == meetingAligned && d.Run.Status == RunStatusWaitingUser
		})
		runner.mu.Lock()
		for _, req := range runner.turns {
			if strings.Contains(req.Prompt, "只处理本轮清单中尚未对齐的条目") {
				followUpPrompts = append(followUpPrompts, req)
			}
		}
		runner.mu.Unlock()
		for _, req := range followUpPrompts {
			if strings.Contains(req.Prompt, "C1 ") && strings.Contains(req.Prompt, "第02轮/02-互评/00-条目.md") {
				// 条目清单只含未对齐的议题，已达成共识的 C1 不再重新讨论
				brief, err := ReadRunDoc(root, id, "第02轮/02-互评/00-条目.md")
				if err != nil || strings.Contains(brief, "## C1 ") || !strings.Contains(brief, "## D1 ") || !strings.Contains(brief, "## C2 ") {
					t.Fatalf("the follow-up brief must hold only open items: %v\n%s", err, brief)
				}
			}
		}
		items := second.Meeting.Rounds[1].Items
		byID := map[string]MeetingItem{}
		for _, item := range items {
			byID[item.ID] = item
		}
		stance := func(item MeetingItem, slot string) MeetingPosition {
			for _, pos := range item.Positions {
				if pos.SlotID == slot {
					return pos
				}
			}
			t.Fatalf("%s has no vote from %s", item.ID, slot)
			return MeetingPosition{}
		}
		if !byID["C1"].Aligned {
			t.Fatalf("a settled consensus must stay settled: %#v", byID["C1"])
		}
		if !byID["C2"].Aligned || stance(byID["C2"], "three").Stance != "agree" || meetingItemPending(byID["C2"]) {
			t.Fatalf("C2 must become a consensus once the silent member answers: %#v", byID["C2"])
		}
		d1 := byID["D1"]
		if d1.Aligned || meetingItemPending(d1) || stance(d1, "three").Stance != "disagree" {
			t.Fatalf("D1 must keep the objection (omitted in round 2 = previous vote kept): %#v", d1)
		}
		if two := stance(d1, "two"); two.Stance != "agree" || two.Issue != "" || two.Quote == "" {
			t.Fatalf("claude's corrected restatement must replace the flagged vote: %#v", two)
		}
		summary, err := ReadRunDoc(root, id, second.Meeting.Rounds[1].SummaryDoc)
		// D1：没有任何成员改变立场 → 僵持（原有规则），反对没有被抹掉；没人回应的待确认提案仍是待确认。
		if err != nil || !strings.Contains(summary, "## C2 补充限流（共识）") || !strings.Contains(summary, "## D1 统一入口（僵持）") ||
			!strings.Contains(summary, "## D2 待确认的提案（待确认）") || !strings.Contains(summary, "## D3 待确认的提案（待确认）") || !d1.Stalled {
			t.Fatalf("round 2 summary labels are wrong: %v\n%s", err, summary)
		}
	})
	// 后续轮每位成员都会被请求回应，但条目清单只含未对齐的议题（已在回调里核对）。
	if len(followUpPrompts) != 3 {
		t.Fatalf("every member answers the open items in the next round, got %d prompts", len(followUpPrompts))
	}
}

func runDecisionFlow(t *testing.T, followUp func(context.Context, *Service, string, string, *meetingTestRunner)) {
	root, ctx := newTestGitRepo(t), context.Background()
	store, _, _ := meetingTestStore(t)
	members := []MemberSlot{{SlotID: "one", Agent: "codex"}, {SlotID: "two", Agent: "claude"}, {SlotID: "three", Agent: "antigravity"}}
	runner := &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root}}
	runner.respond = func(ctx context.Context, req StageTurnRequest) (string, error) {
		switch {
		case strings.Contains(req.Prompt, "独立阅读议题"):
			if req.Agent != "codex" {
				return "我没有新的提案。\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[]}\n```", nil
			}
			body := "采用指数退避。\n\n统一入口。\n\n补充限流。"
			items := `{"id":"C","title":"指数退避","stance":"propose","quote":"采用指数退避。"},` +
				`{"id":"D","title":"统一入口","stance":"propose","quote":"统一入口。"},` +
				`{"id":"C","title":"补充限流","stance":"propose","quote":"补充限流。"}`
			return body + "\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[" + items + "]}\n```", nil
		case strings.Contains(req.Prompt, "逐条回应") && strings.Contains(req.Prompt, "只处理本轮清单中尚未对齐的条目"):
			switch req.Agent {
			case "claude": // 改正引文：这次逐字引用
				body := "D1：入口统一没问题。"
				items := `{"id":"D1","version_id":"D1-v1","stance":"agree","quote":"入口统一没问题"}`
				return body + "\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[" + items + "]}\n```", nil
			case "antigravity": // 补上漏答的 C2，不再提 D1（沿用上一轮的反对）
				body := "C2：限流可以补，同意。"
				items := `{"id":"C2","version_id":"C2-v1","stance":"agree","quote":"限流可以补，同意"}`
				return body + "\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[" + items + "]}\n```", nil
			}
			return "无补充。\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[]}\n```", nil
		case strings.Contains(req.Prompt, "逐条回应"):
			switch req.Agent {
			case "claude":
				body := "C1：`retry.go:20` 的上限可行，同意。\n\nD1：入口统一没问题。\n\nC2：限流可以补。"
				items := `{"id":"C1","version_id":"C1-v1","stance":"agree","quote":"retry.go:20 的上限可行，同意"},` + // 去掉了反引号
					`{"id":"D1","version_id":"D1-v1","stance":"agree","quote":"这句话根本不在正文里"},` + // 真的对不上
					`{"id":"C2","version_id":"C2-v1","stance":"agree","quote":"限流可以补"}`
				return body + "\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[" + items + "]}\n```", nil
			case "antigravity":
				body := "C1 同意，理由充分。\n\nD1 有异议：入口会拖慢启动。"
				items := `{"id":"C1","version_id":"C1-v1","stance":"agree","quote":"C1 同意，理由充分"},` +
					`{"id":"D1","version_id":"D1-v1","stance":"disagree","quote":"入口会拖慢启动","reason":"启动延迟"}` // 漏答 C2
				return body + "\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[" + items + "]}\n```", nil
			}
			return "我是提案人，没有补充。\n\n```mindfs-control\n{\"kind\":\"meeting-positions\",\"items\":[]}\n```", nil
		case strings.Contains(req.Prompt, "作为主笔"):
			return "# 结论方案\n\n按作者裁决执行。", nil
		default:
			return "", fmt.Errorf("unexpected stage: %.80s", req.Prompt)
		}
	}
	service := NewService(nil, runner)
	service.SetHomeDir(t.TempDir())
	created, err := service.StartMeeting(ctx, StartMeetingInput{StartQuickRunInput: StartQuickRunInput{
		RootID: "root", TaskPrompt: "讨论改动。", Members: members}, FinalAuthorSlotID: "one", MaxRounds: 3})
	if err != nil {
		t.Fatal(err)
	}
	id := created.Run.ID
	first := waitForRunCondition(t, service, "root", id, func(d RunDetail) bool {
		return d.Run.CurrentStep == meetingAligned && d.Run.Status == RunStatusWaitingUser
	})
	items := first.Meeting.Rounds[0].Items
	// 没有给出有效提案的成员，正文会被收成「待确认的提案」（D2、D3），不丢他的内容；它们同样要作者表态。
	if len(items) != 5 || items[3].ID != "D2" || items[4].ID != "D3" {
		t.Fatalf("expected C1, D1, C2 plus the two unconfirmed proposals D2, D3: %#v", items)
	}
	c1, d1, c2 := items[0], items[1], items[2]
	vote := func(item MeetingItem, slot string) MeetingPosition {
		for _, pos := range item.Positions {
			if pos.SlotID == slot {
				return pos
			}
		}
		t.Fatalf("%s has no vote from %s: %#v", item.ID, slot, item.Positions)
		return MeetingPosition{}
	}

	// C1：claude 去掉反引号的引文算逐字引用，三票同意 → 共识，不再占用作者的裁决。
	if !c1.Aligned || vote(c1, "two").Stance != "agree" || vote(c1, "two").Issue != "" ||
		vote(c1, "two").Quote != "`retry.go:20` 的上限可行，同意" {
		t.Fatalf("C1 must be a consensus with claude's vote intact: %#v", c1)
	}
	// D1：引文真的对不上的同意仍然计入并提醒；有人反对，所以是分歧而不是待确认。
	two := vote(d1, "two")
	if d1.Aligned || meetingItemPending(d1) || two.Stance != "agree" || two.Issue != "引文与正文不匹配" ||
		two.Quote != "" || two.RejectedQuote != "这句话根本不在正文里" || vote(d1, "three").Stance != "disagree" {
		t.Fatalf("D1 must stay a dispute with claude's agree kept and flagged: %#v", d1)
	}
	// C2：没有人反对，只有一位漏答 → 待确认，不是分歧，也不是共识。
	if c2.Aligned || !meetingItemPending(c2) || vote(c2, "three").Stance != "unconfirmed" || vote(c2, "two").Stance != "agree" {
		t.Fatalf("C2 must be pending: %#v", c2)
	}
	summary, err := ReadRunDoc(root, id, first.Meeting.Rounds[0].SummaryDoc)
	if err != nil || !strings.Contains(summary, "## C1 指数退避（共识）") || !strings.Contains(summary, "## D1 统一入口（分歧待讨论）") ||
		!strings.Contains(summary, "## C2 补充限流（待确认）") || !strings.Contains(summary, "未采纳的引文（正文中找不到）：`这句话根本不在正文里`") {
		t.Fatalf("summary document labels are wrong: %v\n%s", err, summary)
	}

	if followUp != nil {
		followUp(ctx, service, root, id, runner)
		return
	}
	act := func(decisions []MeetingDecision) error {
		_, err := service.MeetingAction(ctx, "root", id, MeetingActionInput{Round: 1, Action: "plan", Decisions: decisions})
		return err
	}
	rest := []MeetingDecision{{ItemID: "D2", Choice: "defer"}, {ItemID: "D3", Choice: "defer"}}
	with := func(decisions ...MeetingDecision) []MeetingDecision { return append(decisions, rest...) }
	adopt := func(item MeetingItem, slot string) MeetingDecision {
		return MeetingDecision{ItemID: item.ID, Choice: "adopt", SlotID: slot, TurnID: item.Proposal.TurnID, VersionID: item.Proposal.VersionID}
	}
	// 裁决校验：下面每一种都必须被拒绝，并且不能让会议往下走。
	for name, decisions := range map[string][]MeetingDecision{
		"nothing decided":            nil,
		"only some open items":       {adopt(d1, "one"), adopt(c2, "one")},
		"aligned item is not open":   with(adopt(d1, "one"), adopt(c2, "one"), MeetingDecision{ItemID: "C1", Choice: "defer"}),
		"adopt a vote without text":  with(MeetingDecision{ItemID: "D1", Choice: "adopt", SlotID: "two"}, adopt(c2, "one")),
		"adopt a missing member":     with(MeetingDecision{ItemID: "D1", Choice: "adopt", SlotID: "nobody", TurnID: d1.Proposal.TurnID, VersionID: d1.Proposal.VersionID}, adopt(c2, "one")),
		"adopt with a stale version": with(MeetingDecision{ItemID: "D1", Choice: "adopt", SlotID: "one", TurnID: d1.Proposal.TurnID, VersionID: "D1-v9"}, adopt(c2, "one")),
		"duplicate decision":         with(adopt(d1, "one"), adopt(d1, "one"), adopt(c2, "one")),
		"custom without a note":      with(adopt(d1, "one"), MeetingDecision{ItemID: "C2", Choice: "custom", Note: "  "}),
		"unknown choice":             with(adopt(d1, "one"), MeetingDecision{ItemID: "C2", Choice: "maybe"}),
	} {
		if err := act(decisions); err == nil {
			t.Fatalf("%s: the invalid decision set was accepted", name)
		}
		if detail, _ := service.GetRunDetail(ctx, "root", id); detail.Run.CurrentStep != meetingAligned {
			t.Fatalf("%s: a rejected decision changed the meeting state to %s", name, detail.Run.CurrentStep)
		}
	}
	// 正确的裁决：D1 采纳成员 1 的方案，C2（待确认）和两个待确认的提案也要作者表态。
	if err := act(with(adopt(d1, "one"), adopt(c2, "one"))); err != nil {
		t.Fatalf("a complete valid decision set was rejected: %v", err)
	}
	ready := waitForRunCondition(t, service, "root", id, func(d RunDetail) bool {
		return d.Run.CurrentStep == meetingReady && d.Run.Status == RunStatusWaitingUser
	})
	doc, err := ReadRunDoc(root, id, "第01轮/作者裁决.md")
	if err != nil || !strings.Contains(doc, "## D1 统一入口") || !strings.Contains(doc, "## C2 补充限流") ||
		!strings.Contains(doc, "## D2 ") || !strings.Contains(doc, "## D3 ") || strings.Contains(doc, "## C1 ") || strings.Count(doc, "采纳 成员1 · codex。") != 2 || !strings.Contains(doc, "> 统一入口。") {
		t.Fatalf("the decision document must hold the open items and not the consensus one: %v\n%s", err, doc)
	}
	if got := ready.Meeting.Rounds[0].Decisions; len(got) != 4 {
		t.Fatalf("decisions were not persisted: %#v", got)
	}
	// 第二次提交（重复点击、两个页面）不能再次启动计划。
	if err := act(with(adopt(d1, "one"), adopt(c2, "one"))); err == nil {
		t.Fatal("a second plan submission after the plan was written must be rejected")
	}
}
