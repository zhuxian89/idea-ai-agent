package collab

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"
)

const meetingPositionsIntro = "正文完整保留观点与依据。最后另起一行输出一个控制块，quote 必须逐字引用正文中的原话，出处用真实项目相对路径和行号。"
const meetingProposalExample = `{"id":%q,"title":"条目标题","stance":"propose","quote":"正文中的方案","citations":[{"file_path":"src/app.go","line_start":12}]}`
const meetingReviewExample = `{"id":%q,"version_id":"<清单版本号>","stance":"agree","quote":"正文中的原话","checked":"一句话说明依据（可省略）","citations":[{"file_path":"src/app.go","line_start":12}]}`

func meetingPositionsFormat(example string) string {
	return meetingPositionsIntro + "\n```mindfs-control\n" +
		`{"kind":"meeting-positions","items":[` + example + "]}\n```"
}

func parseMeetingPositions(root string, round MeetingRound, turn MeetingTurn, blocks []ControlBlock) ([]MeetingPosition, *bool, string) {
	if len(blocks) == 0 {
		return nil, nil, "控制块缺失"
	}
	if len(blocks) != 1 || blocks[0].Err != nil || blocks[0].Unclosed {
		return nil, nil, "控制块无效"
	}
	var data struct {
		Kind      string            `json:"kind"`
		Items     []MeetingPosition `json:"items"`
		Confirmed *bool             `json:"confirmed"`
	}
	if err := json.Unmarshal(blocks[0].Payload, &data); err != nil {
		return nil, nil, "控制块无效"
	}
	if turn.Kind == meetingConfirm {
		if data.Kind == "meeting-confirmation" && data.Confirmed != nil {
			return nil, data.Confirmed, ""
		}
		return nil, nil, "控制块无效"
	}
	if data.Kind != "meeting-positions" || data.Items == nil {
		return nil, nil, "控制块无效"
	}
	var positions []MeetingPosition
	var unknownIDs []string
	for _, item := range data.Items {
		id := strings.ToUpper(strings.TrimSpace(item.ID))
		if turn.Kind == meetingReview && !slices.ContainsFunc(round.Items, func(item MeetingItem) bool { return item.ID == id }) {
			unknownIDs = append(unknownIDs, fmt.Sprintf("%q", clipRunes(id, meetingTitleLimit)))
			continue
		}
		pos := MeetingPosition{ID: id, Title: strings.TrimSpace(item.Title),
			Stance: strings.TrimSpace(item.Stance), Quote: strings.TrimSpace(item.Quote), Checked: strings.TrimSpace(item.Checked),
			Risk: strings.TrimSpace(item.Risk), Reason: strings.TrimSpace(item.Reason), VersionID: strings.TrimSpace(item.VersionID),
			Citations: VerifyCitations(root, item.Citations), TurnID: turn.ID, SlotID: turn.SlotID, Doc: turn.Doc, Agent: turn.Agent}
		quote, quoteFound := locateMeetingQuote(turn.Body, pos.Quote)
		// 互评里的同意、反对，立场写在正文里，引文只是佐证：引文缺失或对不上时保留立场并提醒，
		// 不让一句引文的瑕疵把整票作废；提案和修订要靠引文承载方案原文，仍然必须核对通过。
		reviewVote := turn.Kind == meetingReview && (pos.Stance == "agree" || pos.Stance == "disagree")
		quoteIssue := ""
		switch {
		case pos.Quote == "":
			quoteIssue = "缺少逐字引文"
		case !quoteFound:
			quoteIssue = "引文与正文不匹配"
			pos.RejectedQuote, pos.Quote = pos.Quote, "" // 留下被拒绝的引文，事后能看出差在哪
		default:
			pos.Quote = quote // 存正文里的原文片段（带 Markdown 标记），页面和文档与正文一致
		}
		keepVote := false
		switch {
		case quoteIssue != "" && !reviewVote:
			pos.Issue = quoteIssue
		case pos.Stance == "disagree" && pos.Reason == "":
			pos.Issue = "缺少异议理由"
		case pos.Stance == "propose" && (pos.Title == "" || turn.Kind == meetingReview && pos.Reason == ""):
			pos.Issue = "缺少标题或修订理由"
		case pos.Stance != "agree" && pos.Stance != "disagree" && pos.Stance != "propose":
			pos.Issue = "立场无效"
		case quoteIssue != "":
			pos.Issue, keepVote = quoteIssue, true
		}
		if pos.Issue != "" {
			if reviewVote {
				pos.ReportedStance = pos.Stance // 与上一轮同版本同立场的重述有瑕疵时，沿用上一轮有引文有理由的表态
			}
			if !keepVote {
				pos.Stance = "unconfirmed"
			}
		}
		clipMeetingPosition(&pos)
		positions = append(positions, pos)
	}
	if len(unknownIDs) > 0 {
		return positions, nil, "未识别的条目编号：" + strings.Join(dedupeStrings(unknownIDs), "、")
	}
	return positions, nil, ""
}

// 引文常把正文里的行内代码（`x`）或加粗（**x**）当作排版去掉标记再抄，句子本身并没有变。
// 只差这类 Markdown 标记也算逐字引用；返回正文里的原文片段，其他任何差异仍判为不匹配。
func locateMeetingQuote(body, quote string) (string, bool) {
	if quote == "" {
		return "", false
	}
	if strings.Contains(body, quote) {
		return quote, true
	}
	needle := strings.TrimSpace(stripMeetingMarks(quote))
	if needle == "" {
		return "", false
	}
	var plain strings.Builder
	var starts, ends []int // 去标记后的每个字节，对应正文里该字符的起止字节位置
	for i := 0; i < len(body); {
		_, width := utf8.DecodeRuneInString(body[i:])
		if !meetingMarkAt(body, i) {
			plain.WriteString(body[i : i+width])
			for k := 0; k < width; k++ {
				starts, ends = append(starts, i), append(ends, i+width)
			}
		}
		i += width
	}
	index := strings.Index(plain.String(), needle)
	if index < 0 {
		return "", false
	}
	start, end := starts[index], ends[index+len(needle)-1]
	// 片段两端紧挨着的标记一并带上，保证反引号成对。
	for start > 0 && meetingMarkAt(body, start-1) {
		start--
	}
	for end < len(body) && meetingMarkAt(body, end) {
		end++
	}
	return body[start:end], true
}

// meetingMarkAt 判断 text[i] 是否是 Markdown 排版定界符：反引号，或成对出现的加粗 `**`。
// 单个星号是内容（乘号、指针、通配符），不能当作排版去掉，否则 `2*3` 会被当成 `23`。
func meetingMarkAt(text string, i int) bool {
	switch text[i] {
	case '`':
		return true
	case '*':
		return i > 0 && text[i-1] == '*' || i+1 < len(text) && text[i+1] == '*'
	}
	return false
}

func stripMeetingMarks(text string) string {
	var b strings.Builder
	for i := 0; i < len(text); i++ {
		if !meetingMarkAt(text, i) {
			b.WriteByte(text[i])
		}
	}
	return b.String()
}

// 立场字段只在保存和展示时截断，引文校验已在截断前对照原文完成；完整内容见原文文件。
const (
	meetingProposalQuoteLimit = 800
	meetingStanceQuoteLimit   = 160
	meetingNoteLimit          = 300
	meetingTitleLimit         = 80
)

func clipRunes(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return strings.TrimSpace(string(runes[:limit])) + "…"
}

func clipMeetingPosition(pos *MeetingPosition) {
	quoteLimit := meetingStanceQuoteLimit
	if pos.Stance == "propose" {
		quoteLimit = meetingProposalQuoteLimit
	}
	pos.Quote = clipRunes(pos.Quote, quoteLimit)
	pos.RejectedQuote = clipRunes(pos.RejectedQuote, meetingStanceQuoteLimit)
	pos.Title = clipRunes(pos.Title, meetingTitleLimit)
	pos.Checked = clipRunes(pos.Checked, meetingNoteLimit)
	pos.Risk = clipRunes(pos.Risk, meetingNoteLimit)
	pos.Reason = clipRunes(pos.Reason, meetingNoteLimit)
}

func meetingCandidates(run Run, round MeetingRound) []MeetingItem {
	var proposals []MeetingPosition
	for _, turn := range round.Turns {
		if turn.Kind != meetingProposal || turn.Status != StepStatusDone {
			continue
		}
		before := len(proposals)
		for _, position := range turn.Positions {
			if position.Stance == "propose" || position.Stance == "unconfirmed" {
				proposals = append(proposals, position)
			}
		}
		if len(proposals) == before {
			proposals = append(proposals, MeetingPosition{Stance: "unconfirmed", Quote: strings.TrimSpace(turn.Body),
				TurnID: turn.ID, SlotID: turn.SlotID, Doc: turn.Doc, Agent: turn.Agent, Issue: firstNonEmpty(turn.PositionIssue, "控制块未提供提案")})
		}
	}
	if run.Snapshot.TopicMode == TopicSingle && len(proposals) > 0 {
		for i := range proposals {
			proposals[i].ID = "D1"
			proposals[i].VersionID = singleCandidateVersion(i, proposals[i].TurnID)
		}
		return []MeetingItem{{ID: "D1", Title: run.Title, Candidates: proposals}}
	}
	items := make([]MeetingItem, 0, len(proposals))
	next := map[byte]int{'C': 1, 'D': 1}
	for i := range proposals {
		proposal := &proposals[i]
		prefix := byte('D')
		if strings.HasPrefix(proposal.ID, "C") {
			prefix = 'C'
		}
		proposal.ID = fmt.Sprintf("%c%d", prefix, next[prefix])
		next[prefix]++
		proposal.VersionID = proposal.ID + "-v1"
		items = append(items, MeetingItem{ID: proposal.ID, Title: firstNonEmpty(proposal.Title, "待确认的提案"), Proposal: proposal, Revision: 1})
	}
	return items
}

func alignMeetingItems(run Run, round MeetingRound) []MeetingItem {
	items := make([]MeetingItem, 0, len(round.Items))
	for _, previous := range round.Items {
		if previous.Aligned {
			items = append(items, previous)
			continue
		}
		if len(previous.Candidates) > 0 {
			items = append(items, alignSingleTopic(run, previous, round))
			continue
		}
		if previous.Proposal == nil {
			items = append(items, previous)
			continue
		}
		proposal := *previous.Proposal
		item := MeetingItem{ID: previous.ID, Title: previous.Title, Revision: max(1, previous.Revision), Proposal: &proposal}
		previousVersion := firstNonEmpty(proposal.VersionID, item.ID+"-v1")
		proposal.VersionID = previousVersion
		previousVotes := make(map[string]MeetingPosition)
		for _, vote := range previous.Positions {
			previousVotes[vote.SlotID] = vote
		}
		currentVotes := make(map[string]MeetingPosition)
		for _, turn := range round.Turns {
			if turn.Kind != meetingReview {
				continue
			}
			prior := previousVotes[turn.SlotID]
			position := meetingReviewPosition(item.ID, turn, prior)
			if round.Number > 1 {
				switch position.Stance {
				case "propose":
					if proposal.VersionID != previousVersion || !strings.EqualFold(position.VersionID, previousVersion) {
						position.Stance, position.Issue = "unconfirmed", "修订未针对本轮有效版本"
					}
				case "agree", "disagree":
					if !strings.EqualFold(firstNonEmpty(position.VersionID, item.ID+"-v1"), previousVersion) {
						position.Stance, position.Issue = "unconfirmed", "未对本轮清单中的版本表态"
					}
				}
			}
			if position.Stance == "propose" {
				item.Revision++
				position.VersionID = fmt.Sprintf("%s-v%d", item.ID, item.Revision)
				proposal = position
				item.Title = position.Title
				position.Stance, position.Source = "agree", "submission"
			} else {
				if position.VersionID == "" && (position.Stance == "unconfirmed" || item.Revision == 1) {
					position.VersionID = proposal.VersionID
				}
				if strings.EqualFold(position.VersionID, proposal.VersionID) {
					position.VersionID = proposal.VersionID
					if prior.Stance != "" && firstNonEmpty(prior.VersionID, item.ID+"-v1") == proposal.VersionID &&
						prior.Stance != "unconfirmed" && position.Stance != "unconfirmed" &&
						prior.Stance != position.Stance && position.Reason == "" {
						position.Stance, position.Issue = "unconfirmed", "改口缺少理由"
					}
				}
			}
			currentVotes[turn.SlotID] = position
		}
		item.Aligned = true
		unchanged := previousVersion == proposal.VersionID
		hasDisagreement := false
		for _, member := range run.Snapshot.Members {
			position, exists := currentVotes[member.SlotID]
			prev := previousVotes[member.SlotID]
			if proposal.SlotID == member.SlotID && proposal.Issue == "" && prev.Stance == "" &&
				(!exists || position.Stance == "unconfirmed" && position.VersionID == proposal.VersionID) {
				// 提案人对自己提出的版本默认同意，不必再回应一遍。
				position = MeetingPosition{ID: item.ID, SlotID: member.SlotID, VersionID: proposal.VersionID, Stance: "agree", Source: "author"}
			} else if !exists {
				position = MeetingPosition{ID: item.ID, SlotID: member.SlotID, Stance: "unconfirmed", VersionID: proposal.VersionID, Issue: "成员未交付互评"}
			} else if position.VersionID != proposal.VersionID {
				position = MeetingPosition{ID: item.ID, SlotID: member.SlotID, VersionID: proposal.VersionID, Stance: "unconfirmed", Issue: "本轮未对该版本表态"}
			}
			unchanged = unchanged && prev.Stance == position.Stance &&
				firstNonEmpty(prev.VersionID, item.ID+"-v1") == proposal.VersionID && !newMeetingCitation(prev.Citations, position.Citations)
			hasDisagreement = hasDisagreement || position.Stance == "disagree"
			item.Aligned = item.Aligned && position.Stance == "agree"
			item.Positions = append(item.Positions, position)
		}
		item.Stalled = unchanged && hasDisagreement
		items = append(items, item)
	}
	return items
}

func meetingReviewPosition(itemID string, turn MeetingTurn, prior MeetingPosition) MeetingPosition {
	position := MeetingPosition{ID: itemID, SlotID: turn.SlotID, Stance: "unconfirmed"}
	if turn.Status != StepStatusDone {
		position.Issue = "成员未交付互评"
		return position
	}
	position.TurnID, position.Doc = turn.ID, turn.Doc
	position.Issue = firstNonEmpty(turn.PositionIssue, "成员漏答此条")
	matches := 0
	for _, candidate := range turn.Positions {
		if candidate.ID == itemID {
			matches++
			if matches == 1 {
				position = candidate
			}
		}
	}
	if matches > 1 {
		position = MeetingPosition{ID: itemID, SlotID: turn.SlotID, TurnID: turn.ID, Doc: turn.Doc, Stance: "unconfirmed", Issue: "重复表态"}
	}
	if prior.Stance == "agree" || prior.Stance == "disagree" {
		restated := strings.HasPrefix(prior.Issue, "本轮重述")
		if matches == 0 && turn.PositionIssue == "" {
			if restated {
				prior.Issue = "" // 只清掉上一轮的「重述未通过」说明；引文未核实的提醒要保留到成员补正
			}
			return prior
		}
		// 上一轮表态自己就带着引文问题（没有有效引文）时，不用它去顶替本轮新交的理由和出处。
		priorVerified := prior.Quote != "" || prior.Issue == "" || restated
		if priorVerified && matches == 1 && position.ReportedStance == prior.Stance && position.VersionID != "" && strings.EqualFold(position.VersionID, prior.VersionID) {
			prior.Issue = "本轮重述未通过校验（" + position.Issue + "），沿用上一轮有效立场"
			return prior
		}
	}
	return position
}

func newMeetingCitation(old, current []ReviewItem) bool {
	for _, cite := range current {
		if cite.CitationVerified && !slices.ContainsFunc(old, func(previous ReviewItem) bool {
			return previous.CitationVerified && previous.FilePath == cite.FilePath &&
				previous.LineStart == cite.LineStart && previous.LineEnd == cite.LineEnd
		}) {
			return true
		}
	}
	return false
}

func validateMeetingDecisions(items []MeetingItem, decisions []MeetingDecision) error {
	resolved := map[string]bool{}
	for _, decision := range decisions {
		var item *MeetingItem
		for i := range items {
			if items[i].ID == decision.ItemID && !items[i].Aligned {
				item = &items[i]
				break
			}
		}
		if item == nil || resolved[decision.ItemID] {
			return fmt.Errorf("裁决条目无效：%s", decision.ItemID)
		}
		switch decision.Choice {
		case "adopt":
			if adoptedMeetingPosition(*item, decision) == nil {
				return fmt.Errorf("请选择 %s 有原话的成员方案", item.ID)
			}
		case "custom":
			if strings.TrimSpace(decision.Note) == "" {
				return fmt.Errorf("请填写 %s 的裁决说明", item.ID)
			}
		case "defer":
		default:
			return errors.New("请选择有效的裁决方式")
		}
		resolved[item.ID] = true
	}
	for _, item := range items {
		if !item.Aligned && !resolved[item.ID] {
			return fmt.Errorf("请先裁决 %s，全部分歧处理后才能生成正式计划", item.ID)
		}
	}
	return nil
}

func adoptedMeetingPosition(item MeetingItem, decision MeetingDecision) *MeetingPosition {
	slotID := decision.SlotID
	if len(item.Candidates) > 0 {
		for _, candidate := range item.Candidates {
			if candidate.SlotID == slotID && candidate.TurnID == decision.TurnID && candidate.VersionID == decision.VersionID && candidate.Quote != "" {
				return &candidate
			}
		}
		return nil
	}
	if decision.VersionID != "" || decision.TurnID != "" {
		if item.Proposal == nil || decision.VersionID == "" || decision.TurnID == "" || item.Proposal.VersionID != decision.VersionID {
			return nil
		}
		for _, pos := range append([]MeetingPosition{*item.Proposal}, item.Positions...) {
			if pos.VersionID == decision.VersionID && pos.TurnID == decision.TurnID && pos.SlotID == slotID && pos.Quote != "" {
				return &pos
			}
		}
		return nil
	}
	if item.Revision > 1 {
		return nil
	}
	// 没有版本和发言编号的旧格式：弹窗每个成员只显示第一条有原话的立场（先提案、再各立场），
	// 这里取同一条，保证作者点的和最终写进裁决、写进计划的是同一段原话。
	if item.Proposal != nil && item.Proposal.SlotID == slotID && item.Proposal.Quote != "" {
		return item.Proposal
	}
	for _, pos := range item.Positions {
		if pos.SlotID == slotID && pos.Quote != "" {
			return &pos
		}
	}
	return nil
}

// meetingPositionName 署名取发言当时的 Agent：成员中途换过模型后，历史原话不能署给新模型。
func meetingPositionName(run Run, pos MeetingPosition) string {
	for i, member := range run.Snapshot.Members {
		if member.SlotID == pos.SlotID {
			return fmt.Sprintf("成员%d · %s", i+1, firstNonEmpty(pos.Agent, member.Agent))
		}
	}
	return pos.SlotID
}

func meetingMemberName(run Run, slotID string) string {
	for i, member := range run.Snapshot.Members {
		if member.SlotID == slotID {
			return fmt.Sprintf("成员%d · %s", i+1, member.Agent)
		}
	}
	return slotID
}

// meetingItemPending 是「没有人反对，只是还有成员没有有效表态」：它不是分歧，只需要把没表态的人再问一遍。
func meetingItemPending(item MeetingItem) bool {
	if item.Aligned || item.Stalled || len(item.Candidates) > 0 {
		return false // 单议题是在多个候选方案里选，不是补齐一张票，沿用原判定
	}
	unconfirmed := false
	for _, pos := range item.Positions {
		if pos.Stance == "disagree" {
			return false
		}
		unconfirmed = unconfirmed || pos.Stance == "unconfirmed"
	}
	return unconfirmed
}

func renderMeetingItems(run Run, round MeetingRound) string {
	var b strings.Builder
	b.WriteString("# 共识与分歧\n")
	for _, item := range round.Items {
		state := "分歧待讨论"
		if item.Aligned {
			state = "共识"
		} else if item.Stalled {
			state = "僵持"
		} else if meetingItemPending(item) {
			state = "待确认"
		}
		fmt.Fprintf(&b, "\n## %s %s（%s）\n", item.ID, item.Title, state)
		writeMeetingItemPositions(&b, run, item)
	}
	for _, turn := range round.Turns {
		if (turn.Kind == meetingProposal || turn.Kind == meetingReview) && turn.Status != StepStatusDone {
			fmt.Fprintf(&b, "\n- %s · %s未交付\n", meetingMemberName(run, turn.SlotID), map[string]string{meetingProposal: "提案", meetingReview: "互评"}[turn.Kind])
		} else if turn.Kind == meetingReview && turn.PositionIssue != "" {
			fmt.Fprintf(&b, "\n- %s · %s\n", meetingMemberName(run, turn.SlotID), turn.PositionIssue)
		}
	}
	return b.String()
}

func writeMeetingItemPositions(b *strings.Builder, run Run, item MeetingItem) {
	for i, candidate := range item.Candidates {
		fmt.Fprintf(b, "\n### 方案 %d %s\n", i+1, candidate.Title)
		writeMeetingPosition(b, run, candidate)
		if item.Aligned && candidate.VersionID == item.Positions[0].VersionID {
			fmt.Fprintf(b, "\n全体成员一致支持方案 %d。\n", i+1)
		}
	}
	if item.Proposal != nil {
		writeMeetingPosition(b, run, *item.Proposal)
	}
	for _, pos := range item.Positions {
		writeMeetingPosition(b, run, pos)
	}
}

func writeMeetingPosition(b *strings.Builder, run Run, pos MeetingPosition) {
	labels := map[string]string{"agree": "同意", "disagree": "异议", "propose": "提出方案", "unconfirmed": "未确认"}
	fmt.Fprintf(b, "\n#### %s · %s\n", meetingPositionName(run, pos), labels[pos.Stance])
	if pos.VersionID != "" {
		fmt.Fprintln(b, "\n版本："+pos.VersionID)
	}
	if pos.Source == "submission" {
		fmt.Fprintln(b, "\n来源：本人提交")
	}
	if pos.Issue != "" {
		label := "提醒"
		if pos.Stance == "unconfirmed" {
			label = "未确认"
		}
		fmt.Fprintln(b, "\n"+label+"："+pos.Issue)
	}
	if pos.Doc != "" {
		fmt.Fprintf(b, "\n原文文件：`%s`\n", DocRelPath(run.ID, pos.Doc))
	}
	if pos.Quote != "" {
		fmt.Fprintln(b, "\n> "+strings.ReplaceAll(pos.Quote, "\n", "\n> "))
	}
	if pos.RejectedQuote != "" {
		fmt.Fprintln(b, "\n未采纳的引文（正文中找不到）：`"+strings.ReplaceAll(strings.ReplaceAll(pos.RejectedQuote, "`", "'"), "\n", " ")+"`")
	}
	if pos.Checked != "" {
		fmt.Fprintln(b, "\n检查："+pos.Checked)
	}
	if pos.Risk != "" {
		fmt.Fprintln(b, "\n剩余风险："+pos.Risk)
	}
	if pos.Reason != "" {
		fmt.Fprintln(b, "\n理由："+pos.Reason)
	}
	if len(pos.Citations) == 0 {
		fmt.Fprintln(b, "\n出处待补")
	}
	for _, cite := range pos.Citations {
		label := "出处无效"
		if cite.CitationVerified {
			label = "出处已核实"
		}
		fmt.Fprintf(b, "\n- %s · `%s:%d-%d` %s\n", label, cite.FilePath, cite.LineStart, cite.LineEnd, cite.CitationNote)
	}
}

func renderMeetingOverride(direction string) string {
	return "# 作者裁决（否决全部议题）\n\n作者已否决本轮全部共识与分歧议题，请直接按以下方向生成正式计划与修改方案：\n\n" + strings.TrimSpace(direction) + "\n"
}

func renderMeetingDecisions(run Run, round MeetingRound) string {
	var b strings.Builder
	b.WriteString("# 作者裁决\n")
	for _, item := range round.Items {
		for _, decision := range round.Decisions {
			if decision.ItemID != item.ID {
				continue
			}
			fmt.Fprintf(&b, "\n## %s %s\n", item.ID, item.Title)
			switch decision.Choice {
			case "adopt":
				selected := adoptedMeetingPosition(item, decision)
				if selected != nil {
					fmt.Fprintf(&b, "\n采纳 %s。\n", meetingPositionName(run, *selected))
					writeMeetingPosition(&b, run, *selected)
				} else {
					fmt.Fprintf(&b, "\n采纳 %s。\n", meetingMemberName(run, decision.SlotID))
				}
			case "custom":
				fmt.Fprintln(&b, "\n"+strings.TrimSpace(decision.Note))
			case "defer":
				fmt.Fprintln(&b, "\n暂不决定。")
			}
			writeMeetingItemPositions(&b, run, item)
		}
	}
	return b.String()
}
