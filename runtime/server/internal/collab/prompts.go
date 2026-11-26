package collab

import (
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"strings"
)

type reviewControlWire struct {
	Resolved []string         `json:"resolved"`
	Kind     string           `json:"kind"`
	Summary  string           `json:"summary"`
	Items    []reviewItemWire `json:"items"`
}

type reviewItemWire struct {
	ItemID      string `json:"item_id"`
	Dimension   string `json:"dimension"`
	Severity    string `json:"severity"`
	FilePath    string `json:"file_path"`
	LineStart   int    `json:"line_start"`
	LineEnd     int    `json:"line_end"`
	RuleRef     string `json:"rule_ref"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type reviewControlPayload struct {
	Resolved []string
	Kind     string
	Summary  string
	Items    []ReviewItem
}

type responseControlItem struct {
	ItemID string `json:"item_id"`
	Status string `json:"status"`
	Note   string `json:"note"`
}

type responseControlPayload struct {
	Kind      string                `json:"kind"`
	Summary   string                `json:"summary"`
	Responses []responseControlItem `json:"responses"`
}

type reportControlPayload struct {
	Kind        string `json:"kind"`
	TestStatus  string `json:"test_status"`
	TestCommand string `json:"test_command"`
	TestSummary string `json:"test_summary"`
}

func reviewControlFormatSpec() string {
	return strings.Join([]string{
		"```" + ControlBlockFenceTag,
		"{",
		"  \"kind\": \"review\",",
		"  \"summary\": \"一句话审核总结（如：发现 2 处问题：1 处并发锁遗漏，1 处违反 AGENTS.md 规范）\",",
		"  \"resolved\": [],",
		"  \"items\": [",
		"    {",
		"      \"item_id\": \"R1\",",
		"      \"dimension\": \"functional\",",
		"      \"severity\": \"high\",",
		"      \"file_path\": \"relative/path/to/file.go\",",
		"      \"line_start\": 42,",
		"      \"line_end\": 48,",
		"      \"rule_ref\": \"\",",
		"      \"title\": \"简短问题标题\",",
		"      \"description\": \"具体问题说明与触发条件\"",
		"    }",
		"  ]",
		"}",
		"```",
		"（直接输出上述 mindfs-control 围栏，不要在外面再包裹外层代码块；若无问题，`\"items\"` 填 `[]`。）",
	}, "\n")
}

func responseControlFormatSpec() string {
	return strings.Join([]string{
		"```" + ControlBlockFenceTag,
		"{",
		"  \"kind\": \"response\",",
		"  \"summary\": \"一句话回应总结\",",
		"  \"responses\": [",
		"    {",
		"      \"item_id\": \"R1\",",
		"      \"status\": \"accepted\",",
		"      \"note\": \"已在 path/to/file.go:45 增加边界检查并更新单测\"",
		"    },",
		"    {",
		"      \"item_id\": \"R2\",",
		"      \"status\": \"disputed\",",
		"      \"note\": \"调用入口已完成校验，按 AGENTS.md 避免重复防御，交由作者确认\"",
		"    }",
		"  ]",
		"}",
		"```",
		"（直接输出上述 mindfs-control 围栏，不要在外面再包裹外层代码块。）",
	}, "\n")
}

func reportControlFormatSpec() string {
	return strings.Join([]string{
		"```" + ControlBlockFenceTag,
		"{",
		"  \"kind\": \"report\",",
		"  \"test_status\": \"passed\",",
		"  \"test_command\": \"实际执行的测试或构建命令\",",
		"  \"test_summary\": \"测试/构建结果摘要（如：12 个用例全部通过；若失败或跳过请写明原因）\"",
		"}",
		"```",
		"（直接输出上述 mindfs-control 围栏，不要在外面再包裹外层代码块；`test_status` 只能是 `\"passed\"`、`\"failed\"`、`\"skipped\"` 之一。）",
	}, "\n")
}

func parseReviewControl(blocks []ControlBlock) (reviewControlPayload, error) {
	for i := len(blocks) - 1; i >= 0; i-- {
		b := blocks[i]
		if b.Err != nil || len(b.Payload) == 0 {
			continue
		}
		var wire reviewControlWire
		if err := json.Unmarshal(b.Payload, &wire); err != nil {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(wire.Kind), "review") {
			continue
		}
		// Only an explicit JSON array ("items": [] or [...]) counts as a valid review control block.
		// Omitting "items" or sending null must not silently pass as "0 issues".
		if wire.Items == nil {
			continue
		}
		items := make([]ReviewItem, len(wire.Items))
		for idx, input := range wire.Items {
			item := &items[idx]
			*item = ReviewItem{
				ItemID:      input.ItemID,
				Ordinal:     idx + 1,
				Dimension:   normalizeReviewDimension(input.Dimension),
				Severity:    normalizeReviewSeverity(input.Severity),
				FilePath:    input.FilePath,
				LineStart:   input.LineStart,
				LineEnd:     input.LineEnd,
				RuleRef:     input.RuleRef,
				Title:       strings.TrimSpace(input.Title),
				Description: input.Description,
			}
			if strings.TrimSpace(item.ItemID) == "" {
				item.ItemID = fmt.Sprintf("R%d", idx+1)
			}
			if item.Title == "" {
				item.Title = truncateTitle(item.Description, 48)
			}
		}
		return reviewControlPayload{
			Kind: wire.Kind, Resolved: wire.Resolved,
			Summary: wire.Summary,
			Items:   items,
		}, nil
	}
	return reviewControlPayload{}, errors.New("未找到包含显式 items 数组的 review 控制块")
}

// ReconcilePrimaryResponses enforces the Quick Mode invariants:
// 1. If the control block is missing or unparseable, ALL items become disputed (ParseFallback=true), never accepted.
// 2. If any review item is missing from a parsed response list, returns missingIDs so the step stays incomplete.
// 3. Any status other than "accepted"/"disputed", or an "accepted" with empty fix explanation, becomes "disputed" (ParseFallback=true).
func ReconcilePrimaryResponses(items []ReviewItem, blocks []ControlBlock) (updated []ReviewItem, summary string, missingIDs []string) {
	out := make([]ReviewItem, len(items))
	copy(out, items)

	var parsed *responseControlPayload
	for i := len(blocks) - 1; i >= 0; i-- {
		b := blocks[i]
		if b.Err != nil || len(b.Payload) == 0 {
			continue
		}
		var candidate responseControlPayload
		if err := json.Unmarshal(b.Payload, &candidate); err != nil {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(candidate.Kind), "response") {
			parsed = &candidate
			break
		}
	}

	if parsed == nil {
		for i := range out {
			if strings.TrimSpace(out[i].PrimaryStatus) != "" {
				continue
			}
			out[i].PrimaryStatus = PrimaryStatusDisputed
			out[i].ParseFallback = true
			out[i].PrimaryNote = "主模型回应控制块缺失或格式无法解析，按规则自动转为“有疑问”交由作者裁决（请查看 03-response.md 正文）"
		}
		return out, fmt.Sprintf("回应结构解析失败，未确认条目已转交作者裁决"), nil
	}

	byID := make(map[string]responseControlItem, len(parsed.Responses))
	for _, r := range parsed.Responses {
		id := strings.ToUpper(strings.TrimSpace(r.ItemID))
		if id != "" {
			byID[id] = r
		}
	}

	missing := make([]string, 0)
	acceptedCount := 0
	disputedCount := 0
	for i := range out {
		id := strings.ToUpper(strings.TrimSpace(out[i].ItemID))
		resp, hasNew := byID[id]
		if !hasNew {
			switch strings.TrimSpace(out[i].PrimaryStatus) {
			case PrimaryStatusAccepted:
				acceptedCount++
			case PrimaryStatusDisputed:
				disputedCount++
			default:
				missing = append(missing, out[i].ItemID)
			}
			continue
		}
		status := strings.ToLower(strings.TrimSpace(resp.Status))
		note := strings.TrimSpace(resp.Note)
		switch status {
		case PrimaryStatusAccepted:
			if note == "" {
				out[i].PrimaryStatus = PrimaryStatusDisputed
				out[i].ParseFallback = true
				out[i].PrimaryNote = "主模型标记为认同但未写明具体修改内容，按规则转为“有疑问”交由作者确认"
				disputedCount++
			} else {
				out[i].PrimaryStatus = PrimaryStatusAccepted
				out[i].ParseFallback = false
				out[i].PrimaryNote = note
				acceptedCount++
			}
		case PrimaryStatusDisputed:
			out[i].PrimaryStatus = PrimaryStatusDisputed
			out[i].ParseFallback = false
			if note == "" {
				note = "主模型标记为有分歧（详见 03-response.md）"
			}
			out[i].PrimaryNote = note
			disputedCount++
		default:
			out[i].PrimaryStatus = PrimaryStatusDisputed
			out[i].ParseFallback = true
			if note == "" {
				out[i].PrimaryNote = fmt.Sprintf("主模型返回了未知状态 %q，按规则自动转为“有疑问”交由作者裁决", resp.Status)
			} else {
				out[i].PrimaryNote = fmt.Sprintf("主模型返回状态 %q（说明：%s），按规则自动转交作者裁决", resp.Status, note)
			}
			disputedCount++
		}
	}
	if len(missing) > 0 {
		return out, "", missing
	}

	sum := strings.TrimSpace(parsed.Summary)
	if sum == "" {
		if disputedCount > 0 {
			sum = fmt.Sprintf("%d 条已认同修改 · %d 条分歧待裁决", acceptedCount, disputedCount)
		} else {
			sum = fmt.Sprintf("全部 %d 条已认同并修改", acceptedCount)
		}
	}
	return out, sum, nil
}

func parseReportControl(blocks []ControlBlock) (status, command, summary string) {
	for i := len(blocks) - 1; i >= 0; i-- {
		b := blocks[i]
		if b.Err != nil || len(b.Payload) == 0 {
			continue
		}
		var payload reportControlPayload
		if err := json.Unmarshal(b.Payload, &payload); err != nil {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(payload.Kind), "report") {
			continue
		}
		st := strings.ToLower(strings.TrimSpace(payload.TestStatus))
		switch st {
		case TestStatusPassed, TestStatusFailed, TestStatusSkipped:
		default:
			st = TestStatusSkipped
		}
		sum := strings.TrimSpace(payload.TestSummary)
		if sum == "" {
			switch st {
			case TestStatusPassed:
				sum = "测试/构建通过"
			case TestStatusFailed:
				sum = "测试/构建失败，请查看报告与右侧对话输出"
			default:
				sum = "跳过或未执行测试（不记为通过）"
			}
		}
		return st, strings.TrimSpace(payload.TestCommand), sum
	}
	return TestStatusSkipped, "", "未解析到明确测试状态，按跳过处理（不记为通过）"
}

const reviewVerificationMarker = "\n---\n\n## 后台核验记录\n"

func stripReviewVerificationFooter(s string) string {
	if idx := strings.Index(s, reviewVerificationMarker); idx >= 0 {
		return strings.TrimSpace(s[:idx])
	}
	return strings.TrimSpace(s)
}

func renderReviewDocWithCitations(visibleBody string, items []ReviewItem, roState ReadOnlyCheckState, roNote string) string {
	var b strings.Builder
	body := stripReviewVerificationFooter(visibleBody)
	if body == "" {
		b.WriteString("# 审核报告\n")
	} else {
		b.WriteString(body)
		b.WriteString("\n")
	}
	b.WriteString(reviewVerificationMarker)
	b.WriteString("\n")
	switch roState {
	case ReadOnlyClean:
		b.WriteString("- 只读工作区检查：通过（审核期间工作区无源码变更）\n")
	case ReadOnlyModified:
		b.WriteString("- ⚠️ 只读工作区检查：" + roNote + "\n")
	default:
		b.WriteString("- ℹ️ 只读工作区检查：" + roNote + "\n")
	}
	if len(items) == 0 {
		b.WriteString("- 结构化审核条目：0 条（未发现问题）\n")
		return b.String()
	}
	b.WriteString("- 出处核验：\n")
	for _, item := range items {
		loc := item.FilePath
		if item.LineStart > 0 {
			if item.LineEnd > item.LineStart {
				loc = fmt.Sprintf("%s:%d-%d", item.FilePath, item.LineStart, item.LineEnd)
			} else {
				loc = fmt.Sprintf("%s:%d", item.FilePath, item.LineStart)
			}
		}
		verifyBadge := "✓ 已核实"
		if !item.CitationVerified {
			verifyBadge = "⚠ 查无此处（" + item.CitationNote + "）"
		}
		locPart := ""
		if loc != "" {
			locPart = " `" + loc + "`"
		}
		// Only append structured title/description when the reviewer omitted the item from the prose body.
		if !strings.Contains(body, item.ItemID) {
			detail := strings.TrimSpace(item.Title)
			if desc := strings.TrimSpace(item.Description); desc != "" && desc != detail {
				if detail != "" {
					detail += " — " + desc
				} else {
					detail = desc
				}
			}
			if detail != "" {
				b.WriteString(fmt.Sprintf("  - **%s**%s：%s · %s\n", item.ItemID, locPart, verifyBadge, detail))
				continue
			}
		}
		b.WriteString(fmt.Sprintf("  - **%s**%s：%s\n", item.ItemID, locPart, verifyBadge))
	}
	return b.String()
}

const responseSummaryMarker = "\n---\n\n## 结构化回应汇总（后台合并）\n"

func buildResponseDocContent(beforeDisk, afterDisk, turnVisibleText string, isContinuation bool, reconciled []ReviewItem, complete bool) string {
	cleanDisk := func(s string) string {
		body, _, _ := strings.Cut(s, responseSummaryMarker)
		// Files written by the primary agent did not pass through the chat filter.
		filter := NewControlStreamFilter()
		filter.Push(body)
		filter.Flush()
		return strings.TrimSpace(filter.VisibleText())
	}
	prevClean := cleanDisk(beforeDisk)
	afterClean := cleanDisk(afterDisk)
	turnClean := strings.TrimSpace(turnVisibleText)

	var base string
	switch {
	case afterClean != "" && afterClean != prevClean:
		// The primary agent actively updated 03-response.md on disk during this turn.
		base = afterClean
	case isContinuation && prevClean != "":
		if turnClean != "" && turnClean != prevClean {
			base = prevClean + "\n\n---\n\n## 补充回应\n\n" + turnClean
		} else {
			base = prevClean
		}
	case afterClean != "":
		base = afterClean
	case turnClean != "":
		base = turnClean
	default:
		base = "# 主模型逐条回应"
	}

	if !complete || len(reconciled) == 0 {
		return base + "\n"
	}

	needsSummary := isContinuation
	if !needsSummary {
		for _, item := range reconciled {
			if item.ParseFallback || !strings.Contains(base, item.ItemID) {
				needsSummary = true
				break
			}
		}
	}
	if !needsSummary {
		return base + "\n"
	}

	var b strings.Builder
	b.WriteString(base)
	b.WriteString(responseSummaryMarker)
	b.WriteString("\n")
	for _, item := range reconciled {
		statusLabel := "有分歧待作者裁决 (disputed)"
		if item.PrimaryStatus == PrimaryStatusAccepted {
			statusLabel = "认同并已修改 (accepted)"
		}
		b.WriteString(fmt.Sprintf("- **%s** [%s]：%s\n", item.ItemID, statusLabel, strings.TrimSpace(item.PrimaryNote)))
	}
	return b.String()
}

func renderDecisionsDoc(run Run, items []ReviewItem) string {
	var b strings.Builder
	b.WriteString("# 作者分歧裁决（04-decisions.md）\n\n")
	b.WriteString(fmt.Sprintf("- 运行 ID：`%s`\n", run.ID))
	b.WriteString(fmt.Sprintf("- 任务：%s\n\n", strings.TrimSpace(run.TaskPrompt)))
	for _, item := range items {
		if item.PrimaryStatus != PrimaryStatusDisputed {
			continue
		}
		b.WriteString(fmt.Sprintf("## %s · %s\n\n", item.ItemID, item.Title))
		if item.FilePath != "" {
			b.WriteString(fmt.Sprintf("- 位置：`%s:%d`\n", item.FilePath, item.LineStart))
		}
		if item.RuleRef != "" {
			b.WriteString(fmt.Sprintf("- 规范出处：%s\n", item.RuleRef))
		}
		b.WriteString(fmt.Sprintf("- 审核模型意见：%s\n", strings.TrimSpace(item.Description)))
		b.WriteString(fmt.Sprintf("- 主模型疑问/理由：%s\n", strings.TrimSpace(item.PrimaryNote)))
		label := item.AuthorDecision
		switch item.AuthorDecision {
		case DecisionAcceptReview:
			label = "按审核意见修改（accept_review）"
		case DecisionKeepPrimary:
			label = "保留现状，不修改（keep_primary）"
		case DecisionCustom:
			label = "按作者自定义指示处理（custom）"
		}
		b.WriteString(fmt.Sprintf("- **作者裁决**：%s\n", label))
		if strings.TrimSpace(item.AuthorNote) != "" {
			b.WriteString(fmt.Sprintf("- **作者补充指示**：%s\n", strings.TrimSpace(item.AuthorNote)))
		}
		b.WriteString("\n")
	}
	return b.String()
}

func normalizeReviewDimension(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "standard", "standards", "norm", "rule", "规范":
		return "standard"
	default:
		return "functional"
	}
}

func normalizeReviewSeverity(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "high", "critical", "error", "高":
		return "high"
	case "low", "minor", "nit", "低":
		return "low"
	default:
		return "medium"
	}
}

var collabAttachmentTokenStartRe = regexp.MustCompile(`\[(?:read file|file):\s*`)
var collabAnyTokenStartRe = regexp.MustCompile(`\[(?:read file|file|use skill):\s*`)

type attachmentTokenSpan struct {
	start int
	end   int
	path  string
}

func findAttachmentTokenSpans(text string) []attachmentTokenSpan {
	var spans []attachmentTokenSpan
	lineStart := 0
	for lineStart <= len(text) {
		relNL := strings.IndexByte(text[lineStart:], '\n')
		lineEnd := len(text)
		nextLine := len(text) + 1
		if relNL >= 0 {
			lineEnd = lineStart + relNL
			nextLine = lineEnd + 1
		}
		line := strings.TrimSuffix(text[lineStart:lineEnd], "\r")
		trimmed := strings.TrimSpace(line)

		pos := 0
		for pos < len(line) {
			loc := collabAttachmentTokenStartRe.FindStringIndex(line[pos:])
			if loc == nil {
				break
			}
			openIdx := pos + loc[0]
			valueStart := pos + loc[1]

			depth := 1
			closeIdx := -1
			for i := valueStart; i < len(line); i++ {
				switch line[i] {
				case '[':
					depth++
				case ']':
					depth--
					if depth == 0 {
						closeIdx = i
					}
				}
				if closeIdx >= 0 {
					break
				}
			}

			isStandalone := strings.TrimSpace(line[:openIdx]) == "" &&
				strings.HasSuffix(trimmed, "]") &&
				collabAnyTokenStartRe.FindStringIndex(line[valueStart:]) == nil

			if isStandalone {
				lastBracket := strings.LastIndexByte(line, ']')
				if closeIdx < 0 {
					closeIdx = lastBracket
				} else if closeIdx < lastBracket {
					rest := line[closeIdx+1 : lastBracket]
					nextByte := line[closeIdx+1]
					if (nextByte != ' ' && nextByte != '\t') || !strings.Contains(rest, "[") {
						closeIdx = lastBracket
					}
				}
			} else if closeIdx < 0 {
				if relClose := strings.IndexByte(line[valueStart:], ']'); relClose >= 0 {
					closeIdx = valueStart + relClose
				}
			}

			if closeIdx < 0 {
				break
			}
			rawPath := strings.TrimSpace(line[valueStart:closeIdx])
			if rawPath != "" {
				spans = append(spans, attachmentTokenSpan{
					start: lineStart + openIdx,
					end:   lineStart + closeIdx + 1,
					path:  rawPath,
				})
			}
			pos = closeIdx + 1
		}
		lineStart = nextLine
	}
	return spans
}

func stripAttachmentTokens(text string) string {
	spans := findAttachmentTokenSpans(text)
	if len(spans) == 0 {
		return text
	}
	var b strings.Builder
	last := 0
	for _, sp := range spans {
		if sp.start > last {
			b.WriteString(text[last:sp.start])
		}
		last = sp.end
	}
	if last < len(text) {
		b.WriteString(text[last:])
	}
	return b.String()
}

func deriveRunTitle(taskPrompt string) string {
	plain := strings.TrimSpace(stripAttachmentTokens(taskPrompt))
	if plain != "" {
		return truncateTitle(plain, 36)
	}
	spans := findAttachmentTokenSpans(taskPrompt)
	names := make([]string, 0, len(spans))
	for _, sp := range spans {
		rawPath := strings.TrimSpace(strings.ReplaceAll(sp.path, "\\", "/"))
		if rawPath == "" {
			continue
		}
		base := path.Base(rawPath)
		if base != "" && base != "." && base != "/" {
			names = append(names, base)
		}
	}
	if len(names) == 1 {
		return truncateTitle("附件："+names[0], 36)
	}
	if len(names) > 1 {
		return truncateTitle(fmt.Sprintf("附件：%s 等 %d 个文件", names[0], len(names)), 36)
	}
	return truncateTitle(taskPrompt, 36)
}

func truncateTitle(raw string, maxRunes int) string {
	oneLine := strings.Join(strings.Fields(strings.TrimSpace(raw)), " ")
	if oneLine == "" {
		return "未命名条目"
	}
	runes := []rune(oneLine)
	if len(runes) <= maxRunes {
		return oneLine
	}
	return string(runes[:maxRunes]) + "..."
}
