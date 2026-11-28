package collab

import (
	"encoding/json"
	"strings"
	"testing"
)

// Claude copies a sentence but drops the Markdown marks around inline code; the sentence itself is unchanged.
// The strings below are taken from a real meeting turn (round 2, member 2, 2026-11-28).
const quoteBody = "`remoteUi.ts:9-12` 和 `remoteDevice.ts:34-54` 显示，`data-remote-ui` 与 `data-device` 只在 `isRemoteWebUi`（非 IDEA、非原生壳）时才写入，所以 `html[data-device=\"phone\"]` 本身已把 IDEA 排除在外。\n" +
	"- 它只在 `stableLayout` 时启用。手机端为 `false`，走的是 `fit-content`，无子面板时宽度为 `0`（`:660-:664`），本来就没有空栏。\n" +
	"**必须**限定在手机作用域，其余不变。"

func TestLocateMeetingQuoteAcceptsOnlyMarkdownDifferences(t *testing.T) {
	cases := []struct {
		name, quote, want string
	}{
		{"verbatim", "本来就没有空栏", "本来就没有空栏"},
		{"backticks dropped, span returned with balanced marks",
			"data-remote-ui 与 data-device 只在 isRemoteWebUi（非 IDEA、非原生壳）时才写入",
			"`data-remote-ui` 与 `data-device` 只在 `isRemoteWebUi`（非 IDEA、非原生壳）时才写入"},
		{"quote ends inside inline code", "手机端为 false", "手机端为 `false`"},
		{"quote starts inside inline code", "fit-content，无子面板时宽度为 0", "`fit-content`，无子面板时宽度为 `0`"},
		{"bold dropped", "必须限定在手机作用域", "**必须**限定在手机作用域"},
	}
	for _, tc := range cases {
		got, ok := locateMeetingQuote(quoteBody, tc.quote)
		if !ok || got != tc.want {
			t.Fatalf("%s: got %q ok=%v, want %q", tc.name, got, ok, tc.want)
		}
		if !strings.Contains(quoteBody, got) {
			t.Fatalf("%s: returned span %q is not verbatim in the body", tc.name, got)
		}
	}
}

func TestLocateMeetingQuoteStillRejectsRealDifferences(t *testing.T) {
	for name, quote := range map[string]string{
		"reworded":           "手机端为 true，走的是 fit-content",
		"missing word":       "手机端为 false，走的是 contain",
		"not in the body":    "这句话根本不在正文里",
		"only marks":         "``**``",
		"empty":              "",
		"ellipsis":           "手机端为 false……本来就没有空栏",
		"whitespace changed": "手机端为  false",
	} {
		if got, ok := locateMeetingQuote(quoteBody, quote); ok {
			t.Fatalf("%s: %q must not match, got %q", name, quote, got)
		}
	}
}

func TestParseMeetingPositionsKeepsVoteWhenQuoteIsOff(t *testing.T) {
	payload, err := json.Marshal(map[string]any{"kind": "meeting-positions", "items": []map[string]any{
		{"id": "C1", "version_id": "C1-v4", "stance": "agree", "quote": "data-remote-ui 与 data-device 只在 isRemoteWebUi（非 IDEA、非原生壳）时才写入"},
		{"id": "C2", "version_id": "C2-v2", "stance": "agree", "quote": "手机端为 true"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	round := MeetingRound{Items: []MeetingItem{{ID: "C1"}, {ID: "C2"}}}
	turn := MeetingTurn{Kind: meetingReview, SlotID: "member-2", Body: quoteBody}
	positions, _, issue := parseMeetingPositions("", round, turn, []ControlBlock{{Payload: payload}})
	if issue != "" || len(positions) != 2 {
		t.Fatalf("unexpected parse result: issue=%q positions=%d", issue, len(positions))
	}
	if got := positions[0]; got.Stance != "agree" || got.Issue != "" ||
		got.Quote != "`data-remote-ui` 与 `data-device` 只在 `isRemoteWebUi`（非 IDEA、非原生壳）时才写入" {
		t.Fatalf("markdown-only difference must keep the vote and store the body's text: %+v", got)
	}
	// 引文真的对不上：立场写在正文里，仍然计入，只是引文不采纳、并留下被拒绝的引文供排查。
	if got := positions[1]; got.Stance != "agree" || got.Issue != "引文与正文不匹配" || got.Quote != "" || got.RejectedQuote != "手机端为 true" {
		t.Fatalf("a real mismatch keeps the vote with a reminder and records the rejected quote: %+v", got)
	}
}

func TestQuoteProblemsOnlyKeepReviewVotesNotProposalsOrUnreasonedObjections(t *testing.T) {
	parse := func(kind, stance, quote, reason string) MeetingPosition {
		payload, _ := json.Marshal(map[string]any{"kind": "meeting-positions", "items": []map[string]any{
			{"id": "C1", "title": "标题", "version_id": "C1-v1", "stance": stance, "quote": quote, "reason": reason}}})
		round := MeetingRound{Items: []MeetingItem{{ID: "C1"}}}
		turn := MeetingTurn{Kind: kind, SlotID: "one", Body: "手机端为 false。"}
		positions, _, _ := parseMeetingPositions("", round, turn, []ControlBlock{{Payload: payload}})
		return positions[0]
	}
	if got := parse(meetingReview, "agree", "", ""); got.Stance != "agree" || got.Issue != "缺少逐字引文" {
		t.Fatalf("a review agree without any quote keeps its vote: %+v", got)
	}
	if got := parse(meetingReview, "disagree", "改写了", "理由"); got.Stance != "disagree" || got.Issue != "引文与正文不匹配" {
		t.Fatalf("a review objection with a reason keeps its vote when only the quote is off: %+v", got)
	}
	if got := parse(meetingReview, "disagree", "改写了", ""); got.Stance != "unconfirmed" || got.Issue != "缺少异议理由" || got.ReportedStance != "disagree" {
		t.Fatalf("an objection without a reason is still not counted: %+v", got)
	}
	if got := parse(meetingProposal, "propose", "改写了", ""); got.Stance != "unconfirmed" || got.Issue != "引文与正文不匹配" || got.RejectedQuote != "改写了" {
		t.Fatalf("a proposal carries its text in the quote, so it must still match: %+v", got)
	}
}

func TestMeetingItemPendingIsNotADispute(t *testing.T) {
	agree := MeetingPosition{SlotID: "one", Stance: "agree"}
	unconfirmed := MeetingPosition{SlotID: "two", Stance: "unconfirmed", Issue: "成员未交付互评"}
	disagree := MeetingPosition{SlotID: "three", Stance: "disagree"}
	cases := []struct {
		name string
		item MeetingItem
		want bool
	}{
		{"agreeing members plus one without a valid vote", MeetingItem{Positions: []MeetingPosition{agree, unconfirmed}}, true},
		{"someone objects", MeetingItem{Positions: []MeetingPosition{agree, unconfirmed, disagree}}, false},
		{"everyone agrees", MeetingItem{Aligned: true, Positions: []MeetingPosition{agree, agree}}, false},
		{"stalemate stays a stalemate", MeetingItem{Stalled: true, Positions: []MeetingPosition{unconfirmed}}, false},
		{"nobody has a vote at all", MeetingItem{Positions: []MeetingPosition{{Stance: "agree"}, {Stance: "agree"}}}, false},
	}
	for _, tc := range cases {
		if got := meetingItemPending(tc.item); got != tc.want {
			t.Fatalf("%s: pending=%v, want %v", tc.name, got, tc.want)
		}
	}
	run := Run{Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "one", Agent: "codex"}, {SlotID: "two", Agent: "claude"}}}}
	round := MeetingRound{Items: []MeetingItem{{ID: "D1", Title: "统一入口", Positions: []MeetingPosition{agree, unconfirmed}}}}
	doc := renderMeetingItems(run, round)
	if !strings.Contains(doc, "## D1 统一入口（待确认）") || strings.Contains(doc, "分歧待讨论") {
		t.Fatalf("the summary document must label a vote-less item 待确认, not 分歧: %s", doc)
	}
	// 仍然没有「全员同意」：后台继续追问没有表态的成员，下一轮只问他们。
	if round.Items[0].Aligned {
		t.Fatal("a pending item is not aligned")
	}
}

// 独立审查发现：忽略星号会把代码里的乘号、指针当成排版，`2*3` 被当成 `23`。只有反引号和成对的 ** 才是排版。
func TestLocateMeetingQuoteKeepsLiteralAsterisks(t *testing.T) {
	for name, tc := range map[string]struct{ body, quote string }{
		"multiplication": {"计算公式是 `2*3`。", "计算公式是 23。"},
		"pointer":        {"指针写作 `*p`。", "指针写作 p。"},
		"glob":           {"匹配 `src/*.go` 文件", "匹配 src/.go 文件"},
	} {
		if got, ok := locateMeetingQuote(tc.body, tc.quote); ok {
			t.Fatalf("%s: %q must not match %q, got %q", name, tc.quote, tc.body, got)
		}
	}
	for name, tc := range map[string]struct{ body, quote, want string }{
		"bold":            {"**必须**限定在手机", "必须限定在手机", "**必须**限定在手机"},
		"code with star":  {"公式 `2*3` 成立", "公式 2*3 成立", "公式 `2*3` 成立"},
		"pointer in code": {"指针 `*p` 有效", "指针 *p 有效", "指针 `*p` 有效"},
	} {
		if got, ok := locateMeetingQuote(tc.body, tc.quote); !ok || got != tc.want {
			t.Fatalf("%s: got %q ok=%v, want %q", name, got, ok, tc.want)
		}
	}
}

// 单议题是在多个候选方案里选，不是补齐一张票：后台文档和页面都不能把它标成「待确认」。
func TestSingleTopicItemIsNeverPending(t *testing.T) {
	item := MeetingItem{Candidates: []MeetingPosition{{Stance: "propose"}},
		Positions: []MeetingPosition{{Stance: "agree"}, {Stance: "agree"}, {Stance: "unconfirmed"}}}
	if meetingItemPending(item) {
		t.Fatal("a single-topic item with candidates must keep the original judgement")
	}
}

// 上一轮的表态自己带着引文问题时：成员本轮沉默，提醒不能被清掉；本轮重新提交，新的理由和出处不能被旧票顶替。
func TestFlaggedPriorVoteKeepsItsReminderAndYieldsToNewEvidence(t *testing.T) {
	prior := MeetingPosition{ID: "D1", SlotID: "one", VersionID: "D1-v1", Stance: "disagree", Reason: "旧理由",
		Issue: "引文与正文不匹配", RejectedQuote: "改写了"}
	silent := MeetingTurn{ID: "t2", SlotID: "one", Kind: meetingReview, Status: StepStatusDone, Body: "无补充。"}
	if got := meetingReviewPosition("D1", silent, prior); got.Issue != "引文与正文不匹配" || got.RejectedQuote != "改写了" || got.Stance != "disagree" {
		t.Fatalf("silence must keep the unresolved quote reminder: %+v", got)
	}
	restated := MeetingTurn{ID: "t3", SlotID: "one", Kind: meetingReview, Status: StepStatusDone, Body: "仍然反对，新理由。",
		Positions: []MeetingPosition{{ID: "D1", SlotID: "one", VersionID: "D1-v1", Stance: "disagree", Reason: "新理由",
			Issue: "引文与正文不匹配", ReportedStance: "disagree", RejectedQuote: "又改写了"}}}
	if got := meetingReviewPosition("D1", restated, prior); got.Reason != "新理由" || got.RejectedQuote != "又改写了" {
		t.Fatalf("a restatement with new reasoning must not be replaced by the flagged prior vote: %+v", got)
	}
	verified := MeetingPosition{ID: "D1", SlotID: "one", VersionID: "D1-v1", Stance: "disagree", Quote: "原异议", Reason: "原理由"}
	if got := meetingReviewPosition("D1", restated, verified); got.Quote != "原异议" || got.Reason != "原理由" || !strings.Contains(got.Issue, "本轮重述未通过校验") {
		t.Fatalf("a verified prior vote must still be kept when the restatement is flawed: %+v", got)
	}
}

// 旧格式（没有版本和发言编号）：弹窗显示的那一段原话，就是写进裁决的那一段，而不是同一成员的另一段。
func TestLegacyAdoptionPicksTheQuoteTheModalShows(t *testing.T) {
	item := MeetingItem{ID: "D1", Proposal: &MeetingPosition{SlotID: "one", Stance: "propose", Quote: "保留旧入口"},
		Positions: []MeetingPosition{{SlotID: "one", Stance: "disagree", Quote: "删除旧入口", Reason: "r"}}}
	got := adoptedMeetingPosition(item, MeetingDecision{ItemID: "D1", Choice: "adopt", SlotID: "one"})
	if got == nil || got.Quote != "保留旧入口" {
		t.Fatalf("the proposal is what the modal lists first for this member: %+v", got)
	}
	noProposal := MeetingItem{ID: "D1", Positions: []MeetingPosition{{SlotID: "one", Stance: "agree"}, {SlotID: "one", Stance: "disagree", Quote: "删除旧入口", Reason: "r"}}}
	if got := adoptedMeetingPosition(noProposal, MeetingDecision{ItemID: "D1", Choice: "adopt", SlotID: "one"}); got == nil || got.Quote != "删除旧入口" {
		t.Fatalf("without a proposal the first position with text is used: %+v", got)
	}
}

// 成员中途换了 Agent：历史原话署名给当时写它的 Agent，作者裁决文档、共识与分歧文档都不能署给新 Agent。
func TestDecisionDocsAttributeQuotesToTheAgentThatWroteThem(t *testing.T) {
	run := Run{Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "one", Agent: "claude"}}}} // 现在是 claude
	proposal := MeetingPosition{ID: "D1", SlotID: "one", TurnID: "m-01-001", VersionID: "D1-v1", Stance: "propose", Quote: "统一入口。", Agent: "codex"}
	round := MeetingRound{Items: []MeetingItem{{ID: "D1", Title: "统一入口", Proposal: &proposal, Positions: []MeetingPosition{proposal}}},
		Decisions: []MeetingDecision{{ItemID: "D1", Choice: "adopt", SlotID: "one", TurnID: "m-01-001", VersionID: "D1-v1"}}}
	decisions := renderMeetingDecisions(run, round)
	summary := renderMeetingItems(run, round)
	for name, doc := range map[string]string{"decisions": decisions, "summary": summary} {
		if !strings.Contains(doc, "成员1 · codex") || strings.Contains(doc, "成员1 · claude") {
			t.Fatalf("%s must credit the agent that wrote the quote, not the slot's current agent:\n%s", name, doc)
		}
	}
	if !strings.Contains(decisions, "采纳 成员1 · codex。") {
		t.Fatalf("adopt line must name the author of the adopted text:\n%s", decisions)
	}
}
