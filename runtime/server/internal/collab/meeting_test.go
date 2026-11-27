package collab

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
)

type meetingTestRunner struct {
	*fakeCollabRunner
	respond func(context.Context, StageTurnRequest) (string, error)
}

func (r *meetingTestRunner) RunStageTurn(ctx context.Context, req StageTurnRequest) (StageTurnResult, error) {
	if req.OnRegistered != nil {
		if err := req.OnRegistered(); err != nil {
			return StageTurnResult{}, err
		}
	}
	r.mu.Lock()
	r.turns = append(r.turns, req)
	r.mu.Unlock()
	reply, err := r.respond(ctx, req)
	if err != nil {
		return StageTurnResult{}, err
	}
	// Split the fence across two deltas just like a native stream can.
	at := strings.Index(reply, "mindfs-control")
	if at < 0 {
		at = len(reply)
	} else {
		at += 5
	}
	for _, piece := range []string{reply[:at], reply[at:]} {
		delta := req.StreamFilter.Push(piece)
		if req.OnText != nil {
			req.OnText(delta)
		}
	}
	tail := req.StreamFilter.Flush()
	if req.OnText != nil {
		req.OnText(tail)
	}
	return StageTurnResult{ResolvedModel: req.Model}, nil
}

func meetingTestStore(t *testing.T) (*Store, *sql.DB, string) {
	t.Helper()
	name := filepath.Join(t.TempDir(), "session-list.db")
	db, err := sql.Open("sqlite", name)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	return store, db, name
}

func TestMeetingRoundsDecisionsAndQuickHandoff(t *testing.T) {
	root, ctx := newTestGitRepo(t), context.Background()
	store, _, _ := meetingTestStore(t)
	members := []MemberSlot{{SlotID: "one", Agent: "codex"}, {SlotID: "two", Agent: "claude"}}
	started := make(chan StageTurnRequest, 2)
	release := make(chan struct{})
	runner := &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root}}
	runner.respond = func(ctx context.Context, req StageTurnRequest) (string, error) {
		switch {
		case strings.Contains(req.Prompt, "独立阅读议题"):
			started <- req
			select {
			case <-release:
			case <-ctx.Done():
				return "", ctx.Err()
			}
			if req.Agent == "claude" {
				doc := strings.Replace(req.Prompt[strings.Index(req.Prompt, ".mindfs/runs/"):], "/00-会议议题.md", "/第01轮/01-独立提案/成员1.md", 1)
				path, _, _ := strings.Cut(doc, "`")
				draft := filepath.Join(root, filepath.FromSlash(path))
				req.OnToolCall(agenttypes.ToolCall{CallID: "read", Kind: agenttypes.ToolKindRead, Status: "running",
					Locations: []agenttypes.ToolCallLocation{{Path: draft}}})
				deadline := time.Now().Add(2 * time.Second)
				for {
					if contents, err := os.ReadFile(draft); err == nil && strings.Contains(string(contents), "原生 codex 提案") {
						break
					}
					if time.Now().After(deadline) {
						return "", errors.New("并行成员的已交付草案不可读")
					}
					time.Sleep(5 * time.Millisecond)
				}
				req.OnToolCall(agenttypes.ToolCall{CallID: "read", Status: "complete"})
			}
			body := "原生 " + req.Agent + " 提案\n\n```go\nfmt.Println(1)\n```"
			items := fmt.Sprintf(`{"id":"%s","title":"%s 提案","stance":"propose","quote":"原生 %s 提案","citations":[{"file_path":"service.go","line_start":1}]}`,
				map[string]string{"codex": "C", "claude": "D"}[req.Agent], req.Agent, req.Agent)
			if req.Agent == "claude" {
				body += "\n\n保留旧入口。\n\n统一说明文案。"
				items += `,{"id":"D","title":"旧入口","stance":"propose","quote":"改写的旧入口引文"},{"id":"D","stance":"propose","quote":"统一说明文案。","citations":[{"file_path":"service.go","line_start":2}]}`
			}
			return body + "\n\n```mindfs-control\n" + `{"kind":"meeting-positions","items":[` + items + "]}\n```\n", nil
		case strings.Contains(req.Prompt, "回答作者点名"):
			for _, want := range []string{"第01轮/01-独立提案/成员2.md", "第01轮/02-互评/成员2.md", "第01轮/04-作者补充.md"} {
				if !strings.Contains(req.Prompt, want) || strings.Contains(req.Prompt, "mindfs-control") {
					return "", fmt.Errorf("点名提示缺少本人材料或仍要求控制块: %s", req.Prompt)
				}
			}
			return "这是 Claude 的现场答复。", nil
		case strings.Contains(req.Prompt, "逐条回应"):
			if strings.Contains(req.Prompt, "只处理本轮清单中尚未对齐的条目") {
				if req.Agent == "codex" && strings.Contains(req.Prompt, "第02轮/02-互评/00-条目.md") {
					return "我仍同意 D1。\n\n```mindfs-control\n" +
						`{"kind":"meeting-positions","items":[{"id":"D1","version_id":"D1-v1","stance":"agree","quote":"改写的引文"}]}` + "\n```", nil
				}
				return "试图重新反对已通过的 C1，D1 维持上一轮立场。\n\n```mindfs-control\n" +
					`{"kind":"meeting-positions","items":[{"id":"C1","version_id":"C1-v1","stance":"disagree","quote":"试图重新反对已通过的 C1","reason":"复述一项偏好"}]}` + "\n```", nil
			}
			agree := `{"id":"C1","stance":"agree","quote":"C1 认可","checked":"检查入口","risk":"无","citations":[{"file_path":"service.go","line_start":1}]}`
			disagree := `{"id":"D1","stance":"disagree","quote":"D1 仍有异议","reason":"启动延迟","citations":[{"file_path":"service.go","line_start":2}]}`
			if req.Agent == "codex" {
				disagree = `{"id":"D1","stance":"agree","quote":"D1 仍有异议"}`
			}
			return "C1 认可\n\nD1 仍有异议\n\n```mindfs-control\n" +
				`{"kind":"meeting-positions","items":[` + agree + "," + disagree + "]}\n```", nil
		case strings.Contains(req.Prompt, "作为主笔"):
			return "# 结论方案\n\n执行定稿方案。\n\n## 共识点\nC1。", nil
		case strings.Contains(req.Prompt, "核对你的观点"):
			return "交接准确。\n\n```mindfs-control\n{\"kind\":\"meeting-confirmation\",\"confirmed\":true}\n```", nil
		case strings.Contains(req.Prompt, "00-任务说明.md"):
			return "快速模式已经读到正式计划。", nil
		default:
			return "", errors.New("停止测试快速模式后续阶段")
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
	for range members {
		select {
		case req := <-started:
			if !req.ReadOnly || !req.SkipSwitchHint || strings.Count(req.Prompt, "/01-独立提案/") != 1 {
				t.Fatalf("unsafe blind prompt: %#v", req)
			}
			index := map[string]string{"codex": "1", "claude": "2"}[req.Agent]
			if !strings.Contains(req.Prompt, "成员"+index+".md") {
				t.Fatalf("blind prompt points to another draft: %s", req.Prompt)
			}
		case <-time.After(4 * time.Second):
			t.Fatal("first-round proposals did not run in parallel")
		}
	}
	close(release)
	waitMeeting := func(step string, round int) RunDetail {
		t.Helper()
		return waitForRunCondition(t, service, "root", id, func(d RunDetail) bool {
			return d.Run.Round == round && d.Run.CurrentStep == step && d.Run.Status == RunStatusWaitingUser
		})
	}
	first := waitMeeting(meetingAligned, 1)
	firstRound := first.Meeting.Rounds[0]
	if len(firstRound.Items) != 4 || !firstRound.Items[0].Aligned || firstRound.Items[1].Aligned ||
		firstRound.Items[1].Positions[0].Stance != "agree" || len(firstRound.Turns[1].BlindReads) != 1 {
		t.Fatalf("first-round result: %#v", firstRound)
	}
	badQuote, missingTitle := firstRound.Items[2], firstRound.Items[3]
	if badQuote.ID != "D2" || badQuote.Aligned || badQuote.Proposal.Stance != "unconfirmed" ||
		badQuote.Proposal.Quote != "" || badQuote.Proposal.Doc != firstRound.Turns[1].Doc ||
		missingTitle.ID != "D3" || missingTitle.Title != "待确认的提案" || missingTitle.Aligned ||
		missingTitle.Proposal.Stance != "unconfirmed" || missingTitle.Proposal.Quote != "统一说明文案。" ||
		len(missingTitle.Proposal.Citations) != 1 || !missingTitle.Proposal.Citations[0].CitationVerified {
		t.Fatalf("unconfirmed proposals lost original evidence: %#v %#v", badQuote, missingTitle)
	}
	body, err := ReadRunDoc(root, id, "第01轮/01-独立提案/成员1.md")
	if err != nil || !strings.Contains(body, "```go\nfmt.Println(1)") || strings.Contains(body, "mindfs-control") {
		t.Fatalf("control filter or document failed: %q %v", body, err)
	}
	for _, doc := range []string{"第01轮/02-互评/00-条目.md", firstRound.SummaryDoc} {
		body, err := ReadRunDoc(root, id, doc)
		if err != nil || !strings.Contains(body, "## D2 旧入口") ||
			!strings.Contains(body, "## D3 待确认的提案") || !strings.Contains(body, "> 统一说明文案。") ||
			!strings.Contains(body, DocRelPath(id, firstRound.Turns[1].Doc)) {
			t.Fatalf("unconfirmed proposals missing from %s: %q %v", doc, body, err)
		}
	}
	act := func(input MeetingActionInput) (RunDetail, error) {
		return service.MeetingAction(ctx, "root", id, input)
	}
	if _, err := act(MeetingActionInput{Round: 1, Action: "message", Text: "保留 A。 foo@claude.test\n@Override\n`@codex`"}); err != nil {
		t.Fatal(err)
	}
	if _, err := act(MeetingActionInput{Round: 1, Action: "message", Text: "请@Claude补充一下。\n[file: .mindfs/attachments/例子.txt]"}); err != nil {
		t.Fatal(err)
	}
	answer := waitForRunCondition(t, service, "root", id, func(d RunDetail) bool {
		return d.Run.Status == RunStatusWaitingUser && slices.Contains(d.Docs, "第01轮/04-补充答复/成员2.md")
	})
	if slices.Contains(answer.Docs, "第01轮/04-补充答复/成员1.md") {
		t.Fatal("ordinary email or code annotation was scheduled")
	}
	if _, err := act(MeetingActionInput{Round: 1, Action: "next"}); err != nil {
		t.Fatal(err)
	}
	second := waitMeeting(meetingAligned, 2)
	secondRound := second.Meeting.Rounds[1]
	if !secondRound.Items[1].Stalled || !slices.Contains(secondRound.Inputs, "第01轮/04-作者补充.md") ||
		!slices.Contains(secondRound.Inputs, "第01轮/04-补充答复/成员2.md") {
		t.Fatalf("round 2 lacks stalemate or author files: %#v", secondRound)
	}
	wantVotes := slices.Clone(firstRound.Items[1].Positions)
	wantVotes[0].Issue = "本轮重述未通过校验（引文与正文不匹配），沿用上一轮有效立场"
	if !reflect.DeepEqual(secondRound.Items[0], firstRound.Items[0]) || !reflect.DeepEqual(secondRound.Items[1].Positions, wantVotes) {
		t.Fatalf("follow-up should preserve settled items and the previous votes after omission or an invalid restatement: %#v", secondRound.Items)
	}
	reviewDoc := "第02轮/02-互评/00-条目.md"
	brief, err := ReadRunDoc(root, id, reviewDoc)
	if err != nil || strings.Contains(brief, "## C1 ") || !strings.Contains(brief, "## D1 ") || !strings.Contains(brief, "D1 仍有异议") {
		t.Fatalf("follow-up brief should contain only open items and their prior positions: %v\n%s", err, brief)
	}
	summary, err := ReadRunDoc(root, id, secondRound.SummaryDoc)
	if err != nil || !strings.Contains(summary, "## C1 codex 提案（共识）") || !strings.Contains(summary, "提醒："+wantVotes[0].Issue) {
		t.Fatalf("the summary needs the locked consensus and the restatement warning: %v\n%s", err, summary)
	}
	runner.mu.Lock()
	var secondReview []StageTurnRequest
	for _, req := range runner.turns {
		if strings.Contains(req.Prompt, "逐条回应") && strings.Contains(req.Prompt, "第02轮/02-互评/") {
			secondReview = append(secondReview, req)
		}
	}
	runner.mu.Unlock()
	if len(secondReview) != 2 || secondReview[0].Agent != "codex" || secondReview[1].Agent != "claude" ||
		!strings.Contains(secondReview[1].Prompt, "第02轮/02-互评/成员1.md") || strings.Contains(secondReview[0].Prompt, "成员2.md`。") {
		t.Fatalf("round 2 did not hand off earlier turns in order: %#v", secondReview)
	}
	for _, turn := range secondReview {
		if !strings.Contains(turn.Prompt, reviewDoc) || strings.Contains(turn.Prompt, firstRound.SummaryDoc) ||
			strings.Contains(turn.Prompt, firstRound.Turns[0].Doc) {
			t.Fatalf("follow-up received the full previous review scope: %s", turn.Prompt)
		}
	}
	if _, err := act(MeetingActionInput{Round: 2, Action: "message", Text: "第 2 轮补充。"}); err != nil {
		t.Fatal(err)
	}
	if _, err := act(MeetingActionInput{Round: 2, Action: "next"}); err != nil {
		t.Fatal(err)
	}
	third := waitMeeting(meetingAligned, 3)
	wantInputs := []string{"第01轮/04-作者补充.md", "第01轮/04-补充答复/成员2.md", "第02轮/04-作者补充.md"}
	for _, doc := range wantInputs {
		if !slices.Contains(third.Meeting.Rounds[2].Inputs, doc) {
			t.Fatalf("round 3 is missing %s: %v", doc, third.Meeting.Rounds[2].Inputs)
		}
	}
	if _, err := act(MeetingActionInput{Round: 3, Action: "message", Text: "第 3 轮补充。"}); err != nil {
		t.Fatal(err)
	}
	if _, err := act(MeetingActionInput{Round: 3, Action: "plan"}); err == nil {
		t.Fatal("plan started before unresolved item was decided")
	}
	decisions := []MeetingDecision{
		{ItemID: "D1", Choice: "defer"},
		{ItemID: "D2", Choice: "custom", Note: "  保留旧入口，由作者确认。  "},
		{ItemID: "D3", Choice: "adopt", SlotID: "two"},
	}
	if _, err := act(MeetingActionInput{Round: 3, Action: "plan", Decisions: decisions[:2]}); err == nil {
		t.Fatal("plan started with only some of the unresolved items decided")
	}
	invalid := slices.Clone(decisions)
	invalid[1].Note = " "
	if _, err := act(MeetingActionInput{Round: 3, Action: "plan", Decisions: invalid}); err == nil {
		t.Fatal("custom decision without a note accepted")
	}
	invalid[1], invalid[2].SlotID = decisions[1], "one"
	if _, err := act(MeetingActionInput{Round: 3, Action: "plan", Decisions: invalid}); err == nil {
		t.Fatal("adopt decision without a quoted position accepted")
	}
	if _, err := act(MeetingActionInput{Round: 3, Action: "plan", Decisions: decisions}); err != nil {
		t.Fatal(err)
	}
	ready := waitMeeting(meetingReady, 3)
	for _, turn := range ready.Meeting.Rounds[2].Turns {
		if turn.Kind == meetingConfirm {
			t.Fatalf("formal plan should only run lead model, got confirmation turn: %#v", turn)
		}
	}
	runner.mu.Lock()
	turns := slices.Clone(runner.turns)
	runner.mu.Unlock()
	reviewCount, planCount, confirmCount := 0, 0, 0
	for _, req := range turns {
		if strings.Contains(req.Prompt, "核对你的观点") {
			confirmCount++
		}
		planTurn := strings.Contains(req.Prompt, "作为主笔")
		thirdReview := strings.Contains(req.Prompt, "逐条回应") && strings.Contains(req.Prompt, "第03轮/02-互评/")
		if !planTurn && !thirdReview {
			continue
		}
		docs := wantInputs
		if planTurn {
			planCount++
			docs = append(slices.Clone(docs), "第03轮/04-作者补充.md", "第03轮/作者裁决.md")
		} else {
			reviewCount++
		}
		for _, doc := range docs {
			if strings.Count(req.Prompt, DocRelPath(id, doc)) != 1 {
				t.Fatalf("expected one reference to %s in %s", doc, req.Prompt)
			}
		}
	}
	if reviewCount != len(members) || planCount != 1 || confirmCount != 0 {
		t.Fatalf("round 3 sent %d review prompts, %d plan prompts, and %d confirm prompts", reviewCount, planCount, confirmCount)
	}
	plan, err := ReadRunDoc(root, id, MeetingPlanDoc)
	if err != nil || !strings.Contains(plan, "D1 claude 提案 · 暂不决定") ||
		!strings.Contains(plan, "D2 作者说明\n\n保留旧入口，由作者确认。") ||
		!strings.Contains(plan, "D3 采纳 成员2 · claude") || !strings.Contains(plan, "> 统一说明文案。") {
		t.Fatalf("formal plan: %q %v", plan, err)
	}
	decisionDoc, err := ReadRunDoc(root, id, "第03轮/作者裁决.md")
	if err != nil || !strings.Contains(decisionDoc, "## D1 claude 提案\n\n暂不决定。") ||
		!strings.Contains(decisionDoc, "## D2 旧入口\n\n保留旧入口，由作者确认。") ||
		!strings.Contains(decisionDoc, "## D3 待确认的提案\n\n采纳 成员2 · claude。") ||
		!strings.Contains(decisionDoc, "> 统一说明文案。") || !strings.Contains(decisionDoc, DocRelPath(id, firstRound.Turns[1].Doc)) {
		t.Fatalf("decision file: %q %v", decisionDoc, err)
	}
	linked, err := act(MeetingActionInput{Round: 3, Action: "implement"})
	if err != nil {
		t.Fatal(err)
	}
	quickID := linked.Meeting.QuickRunID
	if quickID == "" || quickID == id {
		t.Fatalf("invalid child: %q", quickID)
	}
	again, err := act(MeetingActionInput{Round: 3, Action: "implement"})
	if err != nil || again.Meeting.QuickRunID != quickID {
		t.Fatalf("repeat handoff: %#v %v", again, err)
	}
	waitForRunCondition(t, service, "root", quickID, func(d RunDetail) bool {
		return d.Run.Status != RunStatusRunning
	})
	task, err := ReadRunDoc(root, quickID, taskFile)
	if err != nil || !strings.Contains(task, plan) || !strings.Contains(task, DocRelPath(id, MeetingPlanDoc)) {
		t.Fatalf("quick task does not contain formal plan and origin: %q %v", task, err)
	}
	list, _, err := service.ListRuns(ctx, "root", "", 0)
	if err != nil || len(list) != 1 || list[0].QuickRunID != quickID {
		t.Fatalf("handoff should appear on one row: %#v %v", list, err)
	}
}

func TestMeetingBlindReadAuditShell(t *testing.T) {
	root := t.TempDir()
	run := Run{ID: "blind-read", Snapshot: TemplateSnapshot{Members: []MemberSlot{
		{SlotID: "one"}, {SlotID: "two"}, {SlotID: "three"},
	}}}
	round := MeetingRound{Number: 1}
	round.addMembers(run, meetingProposal)
	otherDoc := round.Turns[1].Doc
	if _, err := WriteRunDoc(root, run.ID, otherDoc, "独立方案"); err != nil {
		t.Fatal(err)
	}
	otherPath := DocRelPath(run.ID, otherDoc)
	if _, err := WriteRunDoc(root, run.ID, otherDoc+".备份.md", "备份方案"); err != nil {
		t.Fatal(err)
	}
	glob := DocRelPath(run.ID, round.doc("01-独立提案")) + "/*.md"
	search := "grep -r 独立方案 " + DocRelPath(run.ID, "") + "/"
	for _, tc := range []struct {
		name, command, output, status string
		wantRead                      bool
	}{
		{name: "explicit draft", command: "cat " + otherPath, status: "complete", wantRead: true},
		{name: "similarly named backup", command: "cat " + otherPath + ".备份.md", status: "complete"},
		{name: "glob", command: "/bin/zsh -lc 'cat " + glob + "'", status: "complete", wantRead: true},
		{name: "failed glob", command: "cat " + glob, status: "failed"},
		{name: "recursive search", command: search, output: otherPath + ":独立方案", status: "complete", wantRead: true},
		{name: "search without draft result", command: search, output: "notes.md:独立方案", status: "complete"},
		{name: "listing", command: "rg --files " + otherPath, output: otherPath, status: "complete"},
		{name: "explicit path filenames only", command: "rg -l 独立方案 " + otherPath, output: otherPath, status: "complete"},
		{name: "explicit path matching body", command: "rg -n 独立方案 " + otherPath, output: "1:独立方案", status: "complete", wantRead: true},
		{name: "glob search no match", command: "rg 不存在 " + glob, status: "complete"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			audit := newMeetingReadAudit(root, run, round, round.Turns[0])
			tool := agenttypes.ToolCall{CallID: "shell", Kind: agenttypes.ToolKindExecute, Status: "running", Meta: map[string]any{"command": tc.command}}
			if audit.observe(tool) {
				t.Fatal("read was recorded before the tool completed")
			}
			tool.Status = tc.status
			tool.Content = []agenttypes.ToolCallContentItem{{Type: "text", Text: tc.output}}
			if got := audit.observe(tool); got != tc.wantRead {
				t.Fatalf("read recorded = %v, want %v", got, tc.wantRead)
			}
			if tc.wantRead && !slices.Equal(audit.paths(), []string{otherPath}) {
				t.Fatalf("expected only the delivered draft, got %v", audit.paths())
			}
		})
	}
}

func TestMeetingBlindReadAuditSearchUpdate(t *testing.T) {
	root := t.TempDir()
	run := Run{ID: "search-update", Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "one"}, {SlotID: "two"}}}}
	round := MeetingRound{Number: 1}
	round.addMembers(run, meetingProposal)
	draftDoc := round.Turns[1].Doc
	if _, err := WriteRunDoc(root, run.ID, draftDoc, "独立方案"); err != nil {
		t.Fatal(err)
	}
	draft := DocRelPath(run.ID, draftDoc)
	for _, tc := range []struct {
		name, output string
		kind         agenttypes.ToolKind
		want         []string
	}{
		{name: "Claude Glob lists draft path", output: draft, kind: agenttypes.ToolKindSearch},
		{name: "search returns a matching line", output: draft + ":独立方案", want: []string{draft}},
		{name: "search returns a numbered matching line", output: draft + ":1:独立方案", kind: agenttypes.ToolKindSearch, want: []string{draft}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			audit := newMeetingReadAudit(root, run, round, round.Turns[0])
			start := agenttypes.ToolCall{CallID: "search", Kind: agenttypes.ToolKindSearch, Status: "running",
				Locations: []agenttypes.ToolCallLocation{{Path: DocRelPath(run.ID, "")}}}
			if audit.observe(start) {
				t.Fatal("directory search was recorded before completion")
			}
			// ACP tool updates can carry the status and output without repeating the kind.
			complete := agenttypes.ToolCall{CallID: start.CallID, Kind: tc.kind, Status: "complete",
				Content: []agenttypes.ToolCallContentItem{{Type: "text", Text: tc.output}}}
			if got := audit.observe(complete); got != (len(tc.want) != 0) || !slices.Equal(audit.paths(), tc.want) {
				t.Fatalf("read recorded = %v, paths = %v, want %v", got, audit.paths(), tc.want)
			}
		})
	}
}

func TestMeetingRecoveryOnlyRunsMissingMembers(t *testing.T) {
	root, ctx := newTestGitRepo(t), context.Background()
	store, _, name := meetingTestStore(t)
	run := Run{ID: "meeting-recovery", RootID: "root", Mode: ModeGroup, Round: 1, Status: RunStatusRunning, CurrentStep: meetingProposal,
		Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "one", Agent: "codex"}, {SlotID: "two", Agent: "claude"}, {SlotID: "three", Agent: "codex"}}, MaxRounds: 3}}
	round := MeetingRound{RunID: run.ID, Number: 1, Inputs: []string{MeetingTopicDoc}}
	round.addMembers(run, meetingProposal)
	round.Turns[0].Status = StepStatusRunning
	round.Turns[1].Status, round.Turns[1].Body = meetingDelivering, "已经记录但尚未写文件的提案"
	if _, err := store.createMeeting(ctx, run, round); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteRunDoc(root, run.ID, round.Turns[0].Doc, "已有文件的提案"); err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", name)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	reopened, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.RecoverInterruptedRuns(ctx); err != nil {
		t.Fatal(err)
	}
	runner := &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: reopened, rootPath: root}}
	runner.respond = func(_ context.Context, req StageTurnRequest) (string, error) {
		if strings.Contains(req.Prompt, "独立阅读议题") && req.SessionKey != round.Turns[2].SessionKey {
			return "", fmt.Errorf("already delivered member rerun: %s", req.SessionKey)
		}
		return "保留可读原文。\n```mindfs-control\n损坏的控制块\n```", nil
	}
	service := NewService(nil, runner)
	if _, err := service.ContinueRun(ctx, "root", run.ID); err != nil {
		t.Fatal(err)
	}
	done := waitForRunCondition(t, service, "root", run.ID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusWaitingUser && d.Run.CurrentStep == meetingAligned
	})
	if len(done.Meeting.Rounds[0].Items) != 3 || !slices.Contains(done.Docs, round.Turns[1].Doc) {
		t.Fatalf("interrupted files did not recover: %#v", done)
	}
	runner.mu.Lock()
	defer runner.mu.Unlock()
	if len(runner.turns) != 4 || runner.turns[0].SessionKey != round.Turns[2].SessionKey {
		t.Fatalf("expected one proposal and three reviews, got %#v", runner.turns)
	}
}

func TestMeetingMigrationPreservesOldRunData(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "session-list.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
	CREATE TABLE collab_runs (
		id TEXT PRIMARY KEY, root_id TEXT, mode TEXT, title TEXT, task_prompt TEXT,
		template_id TEXT DEFAULT '', template_name TEXT DEFAULT '', status TEXT, current_step TEXT,
		created_at TEXT, updated_at TEXT
	);
	INSERT INTO collab_runs VALUES ('old','root','quick','旧任务','旧正文','','','completed','done','2026-11-25T00:00:00Z','2026-11-25T00:00:00Z');
	CREATE TABLE sessions (key TEXT PRIMARY KEY, name TEXT);
	INSERT INTO sessions VALUES ('existing-session','已有单聊');
	CREATE TABLE agent_bindings (session_key TEXT PRIMARY KEY, agent_session_id TEXT);
	INSERT INTO agent_bindings VALUES ('existing-session','native-thread');
	`); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	old, err := store.GetRun(ctx, "old")
	if err != nil || old.TaskPrompt != "旧正文" || old.Status != RunStatusCompleted {
		t.Fatalf("old record: %#v %v", old, err)
	}
	var binding string
	if err := db.QueryRow(`SELECT agent_session_id FROM agent_bindings JOIN sessions ON agent_bindings.session_key=sessions.key`).Scan(&binding); err != nil || binding != "native-thread" {
		t.Fatalf("old binding: %q %v", binding, err)
	}
	meeting := Run{ID: "meeting", Mode: ModeGroup, Round: 1,
		Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "one"}, {SlotID: "two"}}}}
	if _, err := store.createMeeting(ctx, meeting, MeetingRound{RunID: meeting.ID, Number: 1}); err != nil {
		t.Fatal(err)
	}
	legacy := `{"number":1,"turns":[],"items":[{"id":"D1","title":"旧方案","aligned":false,
		"proposal":{"id":"D1","slot_id":"one","turn_id":"proposal-one","stance":"propose","quote":"原案"},
		"positions":[{"id":"D1","slot_id":"two","turn_id":"review-two","stance":"disagree","quote":"旧异议"}]}]}`
	if _, err := db.Exec(`UPDATE collab_meeting_rounds SET state_json=? WHERE run_id=?`, legacy, meeting.ID); err != nil {
		t.Fatal(err)
	}
	store, err = NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := store.readMeeting(ctx, meeting.ID)
	if err != nil || len(detail.Rounds) != 1 || detail.Rounds[0].Number != 1 {
		t.Fatalf("meeting read/write on migrated database: %#v %v", detail, err)
	}
	round := detail.Rounds[0]
	round.Turns = []MeetingTurn{{ID: "new-review", Kind: meetingReview, SlotID: "one", Status: StepStatusDone,
		Positions: []MeetingPosition{{ID: "D1", Stance: "propose", Title: "新方案", Quote: "修订原案", SlotID: "one", TurnID: "new-review"}}}}
	round.Items = alignMeetingItems(meeting, round)
	if err := store.saveMeeting(ctx, meeting, round); err != nil {
		t.Fatal(err)
	}
	detail, err = store.readMeeting(ctx, meeting.ID)
	if err != nil {
		t.Fatal(err)
	}
	item := detail.Rounds[0].Items[0]
	oldVote := adoptedMeetingPosition(item, MeetingDecision{SlotID: "two", TurnID: "review-two", VersionID: "D1-v1"})
	if item.Revision != 2 || item.Proposal.Quote != "修订原案" || oldVote != nil {
		t.Fatalf("old state_json did not survive versioning: %#v", item)
	}
}

func TestMeetingMigrationRemovesSupersededVersions(t *testing.T) {
	store, db, _ := meetingTestStore(t)
	state := `{"number":1,"turns":[],"items":[{"id":"D1","title":"旧标题","positions":[],
		"versions":[
			{"id":"D1-v1","proposal":{"slot_id":"one","turn_id":"p1","quote":"已采纳的原话","stance":"propose"}},
			{"id":"D1-v2","proposal":{"slot_id":"two","turn_id":"r1","quote":"过时的中间稿","stance":"propose"}},
			{"id":"D1-v3","proposal":{"slot_id":"one","turn_id":"r2","title":"新标题","quote":"当前方案","stance":"propose"}}]}],
		"decisions":[{"item_id":"D1","choice":"adopt","slot_id":"one","turn_id":"p1","version_id":"D1-v1"}]}`
	if _, err := db.Exec(`INSERT INTO collab_meeting_rounds(run_id, number, state_json) VALUES ('migrated',1,?)`, state); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := store.Migrate(); err != nil {
			t.Fatal(err)
		}
	}
	var stored string
	if err := db.QueryRow(`SELECT state_json FROM collab_meeting_rounds WHERE run_id='migrated'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored, `"versions"`) || strings.Contains(stored, "过时的中间稿") {
		t.Fatalf("数据库中仍有旧版本: %s", stored)
	}
	detail, err := store.readMeeting(context.Background(), "migrated")
	if err != nil {
		t.Fatal(err)
	}
	round := detail.Rounds[0]
	item := round.Items[0]
	if item.Revision != 3 || item.Title != "新标题" || item.Proposal.Quote != "当前方案" || item.Proposal.VersionID != "D1-v3" {
		t.Fatalf("没有保留当前版本: %#v", item)
	}
	if err := validateMeetingDecisions(round.Items, round.Decisions); err == nil {
		t.Fatal("新裁决不能重新采纳旧版本")
	}
	if plan := renderMeetingPlan(Run{}, round, MeetingTurn{}, false); !strings.Contains(plan, "> 已采纳的原话") {
		t.Fatalf("既有裁决丢失: %s", plan)
	}
}

func TestMeetingDirectedReplyWhilePaused(t *testing.T) {
	root, ctx := newTestGitRepo(t), context.Background()
	store, _, _ := meetingTestStore(t)
	run := Run{ID: "paused-meeting", RootID: "root", Mode: ModeGroup, Round: 1,
		Status: RunStatusWaitingUser, CurrentStep: meetingProposal,
		Snapshot: TemplateSnapshot{Members: []MemberSlot{{SlotID: "one", Agent: "codex"}, {SlotID: "two", Agent: "claude"}}}}
	round := MeetingRound{RunID: run.ID, Number: 1, Inputs: []string{MeetingTopicDoc}}
	round.addMembers(run, meetingProposal)
	if _, err := store.createMeeting(ctx, run, round); err != nil {
		t.Fatal(err)
	}
	runner := &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root}}
	runner.respond = func(_ context.Context, req StageTurnRequest) (string, error) {
		if !strings.Contains(req.Prompt, "回答作者点名") || req.Agent != "codex" {
			return "", fmt.Errorf("unexpected turn: %s", req.Prompt)
		}
		return "暂停时只回应点名问题。", nil
	}
	service := NewService(nil, runner)
	if _, err := service.MeetingAction(ctx, "root", run.ID, MeetingActionInput{Round: 1, Action: "message", Text: "请@Codex看补充"}); err != nil {
		t.Fatal(err)
	}
	result := waitForRunCondition(t, service, "root", run.ID, func(d RunDetail) bool {
		return d.Run.Status == RunStatusWaitingUser && slices.Contains(d.Docs, "第01轮/04-补充答复/成员1.md")
	})
	if result.Run.CurrentStep != meetingProposal || result.Meeting.Rounds[0].Turns[0].Status != StepStatusPending {
		t.Fatalf("directed reply resumed the paused phase: %#v", result)
	}
}

func TestMeetingRetryContinuesOnlyThatMemberWithConfiguredPermission(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	root := newTestGitRepo(t)
	store, _, _ := meetingTestStore(t)
	peerRelease := make(chan struct{})
	entered := make(chan StageTurnRequest, 4)
	runner := &meetingTestRunner{fakeCollabRunner: &fakeCollabRunner{store: store, rootPath: root}}
	attempts := 0
	runner.respond = func(turnCtx context.Context, req StageTurnRequest) (string, error) {
		if !strings.Contains(req.Prompt, "独立阅读议题") {
			return "互评完成。", nil
		}
		entered <- req
		if req.MemberSlotID == "peer" {
			if !req.ReadOnly {
				return "", errors.New("default must stay strictly read-only")
			}
			select {
			case <-peerRelease:
				return "其他成员已交付。", nil
			case <-turnCtx.Done():
				return "", turnCtx.Err()
			}
		}
		if req.ReadOnly || req.PermissionMode != "" {
			return "", errors.New("configured agent default must reach the native session")
		}
		attempts++
		if attempts == 1 {
			return "", errors.New("test provider failure")
		}
		return "该成员重试后交付。", nil
	}
	service := NewService(nil, runner)
	started, err := service.StartMeeting(ctx, StartMeetingInput{StartQuickRunInput: StartQuickRunInput{
		RootID: "root", TaskPrompt: "讨论验证方案", Members: []MemberSlot{
			{SlotID: "retry", Agent: "antigravity", PermissionMode: meetingAgentDefaultMode}, {SlotID: "peer", Agent: "codex"},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_, _ = service.PauseRun(c, "root", started.Run.ID)
	})
	initial := waitForRunCondition(t, service, "root", started.Run.ID, func(d RunDetail) bool {
		return d.Meeting.Rounds[0].Turns[0].Status == StepStatusWaitingUser && d.Meeting.Rounds[0].Turns[1].Status == StepStatusRunning
	})
	for i := 0; i < 2; i++ {
		select {
		case <-entered:
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	retry := func(turn MeetingTurn) string {
		t.Helper()
		detail, err := service.MeetingAction(ctx, "root", started.Run.ID, MeetingActionInput{Round: 1, Action: "retry_turn", TurnID: turn.ID, Attempt: turn.At})
		if err != nil {
			t.Fatal(err)
		}
		return detail.ProgressAction
	}
	turns := initial.Meeting.Rounds[0].Turns
	if got := retry(turns[1]); got != "running" {
		t.Fatalf("active member: %s", got)
	}
	// The failed state is persisted just before the worker releases its reservation.
	for retry(turns[0]) == "running" {
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		time.Sleep(time.Millisecond)
	}
	select {
	case req := <-entered:
		if req.SessionKey != turns[0].SessionKey || req.MemberSlotID != "retry" {
			t.Fatalf("wrong member restarted: %+v", req)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	recovered := waitForRunCondition(t, service, "root", started.Run.ID, func(d RunDetail) bool {
		return d.Meeting.Rounds[0].Turns[0].Status == StepStatusDone
	})
	if got := retry(turns[0]); got != "unchanged" {
		t.Fatalf("completed member: %s", got)
	}
	if recovered.Meeting.Rounds[0].Turns[1].Status != StepStatusRunning {
		t.Fatal("peer must still own its original turn")
	}
	close(peerRelease)
	waitForRunCondition(t, service, "root", started.Run.ID, func(d RunDetail) bool { return d.Run.CurrentStep == meetingAligned })
}
