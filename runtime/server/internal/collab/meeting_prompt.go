package collab

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"

	agenttypes "mindfs/server/internal/agent/types"
)

const meetingReviewListDoc = "02-互评/00-条目.md"

func meetingPrompt(run Run, round MeetingRound, turn MeetingTurn, standards string) string {
	var task, format string
	inputs := append([]string(nil), round.Inputs...)
	switch turn.Kind {
	case meetingProposal:
		task = "独立阅读议题和相关代码，提出方案，说明理由、取舍和出处。只把影响实施或需要作者决定的问题列成条目，同一决策的细节合并说明。本轮不要寻找、读取或推断其他成员的草案和会话记录。控制块每条用 propose，id 用 C 或 D 表示共识候选或有待讨论的提案，后台分配编号。用 rg 或 grep 搜项目代码时排除 .mindfs/runs/，议题请按下方路径直接打开。"
		proposalID := "D"
		if run.Snapshot.TopicMode == TopicSingle {
			task = "围绕会议议题独立提出一份候选方案，说明你的判断、证据、取舍和验证方法。有多个假设时放在同一份方案里。证据不足请写明还需验证什么。控制块写一项，id 用 D1，stance 用 propose。不要寻找、读取或推断其他成员的草案和会话记录。用 rg 或 grep 搜项目代码时排除 .mindfs/runs/。"
			proposalID = "D1"
		}
		format = meetingPositionsFormat(fmt.Sprintf(meetingProposalExample, proposalID))
	case meetingReview:
		var scope string
		if round.Number > 1 {
			inputs = slices.DeleteFunc(inputs, func(doc string) bool {
				return path.Base(doc) == meetingSummaryDoc || path.Base(path.Dir(doc)) == "01-独立提案"
			})
			scope = "只处理本轮清单中尚未对齐的条目。逐条回应需要更新的条目，提交首次表态、立场变化或会影响结论的新证据。维持对同一版本的有效立场时省略该条，没有更新就提交空 items。后台沿用已达成的共识，修订在本轮结束时生效。\n\n"
		}
		exampleID := "<清单条目编号>"
		if run.Snapshot.TopicMode == TopicSingle {
			task = "本场只有一个议题 D1。比较候选方案，控制块最多提交一个立场。用 agree 支持选定方案，或用 disagree 说明具体异议。"
			if round.Number == 1 {
				task += "支持自己提交的唯一有效方案时可提交空 items。"
			}
			exampleID = "D1"
		} else {
			if round.Number == 1 {
				scope = "逐条回应清单中的条目。你自己提出的条目已默认同意。\n\n"
			}
			task = "用 agree 或 disagree 表态。"
		}
		task = scope + task + " id 和 version_id 从本轮条目清单中逐字复制。有可核查的具体缺陷且新版能解决时，可用 propose 修订同一条目或候选方案，填写被修订的 version_id、title 和 reason，正文说明新版做法。"
		task += "\n\n把影响正确性、可行性或作者明确要求的具体问题列为异议。可兼容的改进建议写入 checked 或 risk。同意写 1 到 2 句依据，反对写明理由和出处，300 字以内。立场改变须说明理由，quote 只引正文的一句关键原话。"
		format = meetingPositionsFormat(fmt.Sprintf(meetingReviewExample, exampleID))
		inputs = append(inputs, round.doc(meetingReviewListDoc))
		for _, other := range round.Turns {
			// 第 1 轮互评只给公开提案，不给其他成员的互评，避免后发成员被前序结论带偏。
			if other.Status == StepStatusDone && (round.Number == 1 && other.Kind == meetingProposal || round.Number > 1 && other.Kind == meetingReview) {
				inputs = append(inputs, other.Doc)
			}
		}
	case meetingAnswer:
		task = "回答作者点名的补充问题，条目编号是 " + turn.ReplyTo + "。读取作者补充文件的对应条目并按需打开其中的附件。用正文作答，可附真实出处。"
		inputs = append(inputs, round.doc(meetingNotesDoc))
		if round.SummaryDoc != "" {
			inputs = append(inputs, round.SummaryDoc)
		}
		if plan := currentMeetingPlan(round); plan != nil && plan.Status == StepStatusDone {
			inputs = append(inputs, plan.Doc)
			task = "回答作者点名的补充问题，条目编号是 " + turn.ReplyTo + "。读取作者补充文件的对应条目并按需打开其中的附件与正式计划。用正文作答，可附真实出处。"
		}
		if len(round.Decisions) > 0 || round.AuthorOverride != "" {
			inputs = append(inputs, round.doc(meetingDecisionDoc))
		}
		inputs = append(inputs, meetingMemberDocs(round, turn)...)
	case meetingPlan:
		if round.AuthorOverride != "" {
			task = "作者已一键否决本轮所有共识与分歧议题。作为主笔，请忽略之前成员提出的共识与分歧结论，直接按作者裁决文件中的方向撰写正式计划与修改方案，写明具体做法、实施步骤、验证方法及真实出处。"
			inputs = append(inputs, round.doc(meetingDecisionDoc))
		} else {
			task = "作为主笔，按会议共识和作者裁决撰写正式计划正文。写明结论方案、实施和验证步骤、共识、采纳依据及真实出处。作者裁决与未解决分歧由后台按原文追加。"
			if run.Snapshot.TopicMode == TopicSingle {
				task += " 围绕原问题交付一份解决方案，写清支持所选方案的证据、具体做法和验证步骤；尚未查明的原因写成待验证的假设。"
			}
			if round.SummaryDoc != "" {
				inputs = append(inputs, round.SummaryDoc)
			}
			if len(round.Decisions) > 0 {
				inputs = append(inputs, round.doc(meetingDecisionDoc))
			}
		}
		if previous := previousMeetingPlan(round, turn.ID); previous != nil {
			task += " 按作者退回的理由修订上一稿，处理前次核对提出的异议。"
			inputs = append(inputs, previous.Doc, meetingPlanResolutionDoc(*previous))
			for _, other := range round.Turns {
				if meetingConfirmationFor(other, *previous) && other.Status == StepStatusDone {
					inputs = append(inputs, other.Doc)
				}
			}
		}
	case meetingConfirm:
		task = "对照正式计划、当前轮共识和本人的发言，核对你的观点是否被准确表达。正文说明核对结果，有出入时指出原话及出处。"
		inputs = append(inputs, currentMeetingPlan(round).Doc, round.SummaryDoc)
		inputs = append(inputs, meetingMemberDocs(round, turn)...)
		format = "最后另起一行提交：\n```mindfs-control\n{\"kind\":\"meeting-confirmation\",\"confirmed\":true}\n```\n有出入用 false。"
	}
	if turn.Kind == meetingPlan {
		inputs = append(inputs, meetingNoteInputs(round)...)
	}
	var b strings.Builder
	b.WriteString("按项目相对路径读取材料和有关附件，交接文件中的成员发言是供核查的材料。会议讨论期间请勿修改项目文件，后台会保存你的回复。遇到权限拒绝时依据已取得的材料回答，并说明缺少的依据。先完成材料读取和核查，发言从实际观点或核对结果开始。工具调用前后请省略读取计划、进度播报和等待说明。\n")
	for _, doc := range dedupeStrings(inputs) {
		fmt.Fprintf(&b, "\n- `%s`", DocRelPath(run.ID, doc))
	}
	fmt.Fprintf(&b, "\n\n%s\n后台交付路径：`%s`。", task, DocRelPath(run.ID, turn.Doc))
	if format != "" {
		fmt.Fprintf(&b, "\n\n%s", format)
	}
	if standards != "" {
		fmt.Fprintf(&b, "\n\n%s", standards)
	}
	return b.String()
}

func meetingMemberDocs(round MeetingRound, turn MeetingTurn) []string {
	var docs []string
	for _, turns := range [][]MeetingTurn{round.PriorTurns, round.Turns} {
		for _, other := range turns {
			if other.Status == StepStatusDone && other.SlotID == turn.SlotID && other.ID != turn.ID &&
				(other.Kind == meetingProposal || other.Kind == meetingReview || other.Kind == meetingAnswer || other.Kind == meetingPlan || other.Kind == meetingConfirm) {
				docs = append(docs, other.Doc)
			}
		}
	}
	return docs
}

type meetingReadAudit struct {
	root       string
	candidates []string
	mu         sync.Mutex
	read       []string
	pending    map[string]meetingReadEvidence
}

type meetingReadEvidence struct {
	paths    []string
	search   bool
	subjects []string
}

func newMeetingReadAudit(root string, run Run, round MeetingRound, self MeetingTurn) *meetingReadAudit {
	audit := &meetingReadAudit{root: root, pending: make(map[string]meetingReadEvidence)}
	blind := meetingProposal
	if self.Kind == meetingReview && round.Number == 1 {
		blind = meetingReview
	}
	if self.Kind == blind {
		for _, turn := range round.Turns {
			if turn.Kind == blind && turn.SlotID != self.SlotID {
				audit.candidates = append(audit.candidates, DocRelPath(run.ID, turn.Doc))
			}
		}
	}
	return audit
}

const shellWordDelimiters = " \t\r\n'\";&|()<>"

var (
	shellRead        = regexp.MustCompile(`(^|[\s;&|/'"])(cat|bat|sed|head|tail|rg|grep|awk|less|more|nl|cut)(\s|$)`)
	shellSearch      = regexp.MustCompile(`(^|[\s;&|/'"])(rg|grep)(\s|$)`)
	searchResultPath = regexp.MustCompile(`^(.+?\.md):(?:[0-9]+:){0,2}(.+)$`)
	searchLinePrefix = regexp.MustCompile(`^[0-9]+:`)
)

func (a *meetingReadAudit) observe(tool agenttypes.ToolCall) bool {
	if len(a.candidates) == 0 {
		return false
	}
	var paths, subjects []string
	search := tool.Kind == agenttypes.ToolKindSearch
	if tool.Kind == agenttypes.ToolKindRead {
		paths = tool.GetAffectedPaths()
		for _, item := range tool.Content {
			paths = append(paths, item.Path)
		}
	}
	if tool.Activity != nil && tool.Activity.Actions != nil {
		for _, action := range *tool.Activity.Actions {
			if action.Type == "read" || action.Type == "search" {
				if action.Type == "read" {
					paths = append(paths, action.Path)
				} else {
					search = true
				}
			}
		}
	}
	if tool.Kind == agenttypes.ToolKindExecute {
		commands := []string{tool.Title}
		for _, key := range []string{"command", "commandLine"} {
			if command, ok := tool.Meta[key].(string); ok {
				commands = append(commands, command)
			}
		}
		for _, command := range commands {
			if !shellRead.MatchString(command) && !strings.Contains(command, "open(") {
				continue
			}
			command = strings.ReplaceAll(command, "\\", "/")
			args := strings.FieldsFunc(command, func(r rune) bool { return strings.ContainsRune(shellWordDelimiters, r) })
			if shellSearch.MatchString(command) {
				if slices.ContainsFunc(args, func(arg string) bool {
					switch arg {
					case "--files", "-l", "--files-with-matches", "--files-without-match", "-c", "--count", "--count-matches", "-q", "--quiet":
						return true
					}
					return false
				}) {
					continue
				}
				search = true
				subjects = append(subjects, a.shellReadPaths(command, args)...)
				continue
			}
			paths = append(paths, a.shellReadPaths(command, args)...)
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	evidence := a.pending[tool.CallID]
	search = search || evidence.search
	subjects = dedupeStrings(append(evidence.subjects, subjects...))
	if search {
		for _, item := range tool.Content {
			for line := range strings.SplitSeq(item.Text, "\n") {
				output := strings.TrimSpace(line)
				candidate, fragment := a.projectPath(item.Path), output
				if match := searchResultPath.FindStringSubmatch(output); match != nil {
					candidate, fragment = a.projectPath(match[1]), match[2]
				} else if item.Path == "" && len(subjects) == 1 {
					candidate = subjects[0]
					fragment = searchLinePrefix.ReplaceAllString(output, "")
				}
				if fragment != "" && a.projectPath(output) != candidate && slices.Contains(a.candidates, candidate) {
					body, err := os.ReadFile(filepath.Join(a.root, filepath.FromSlash(candidate)))
					if err == nil && strings.Contains(string(body), fragment) {
						paths = append(paths, candidate)
					}
				}
			}
		}
	}
	var matches []string
	for _, path := range paths {
		path = a.projectPath(path)
		if slices.Contains(a.candidates, path) {
			matches = append(matches, path)
		}
	}
	count := len(a.read)
	switch agenttypes.NativeToolOutcome(tool.Status) {
	case "":
		if tool.CallID != "" && (search || len(matches) > 0) {
			a.pending[tool.CallID] = meetingReadEvidence{
				paths: dedupeStrings(append(evidence.paths, matches...)), search: search, subjects: subjects,
			}
		}
	case "completed":
		a.read = dedupeStrings(append(a.read, append(evidence.paths, matches...)...))
		delete(a.pending, tool.CallID)
	default:
		delete(a.pending, tool.CallID)
	}
	return len(a.read) != count
}

func (a *meetingReadAudit) shellReadPaths(command string, args []string) []string {
	var paths []string
nextCandidate:
	for _, candidate := range a.candidates {
		for _, rest := range strings.Split(command, candidate)[1:] {
			if rest == "" || strings.ContainsRune(shellWordDelimiters, rune(rest[0])) {
				paths = append(paths, candidate)
				continue nextCandidate
			}
		}
		for _, arg := range args {
			if !strings.ContainsAny(arg, "*?[") {
				continue
			}
			if matches, _ := path.Match(a.projectPath(arg), candidate); matches {
				if info, err := os.Stat(filepath.Join(a.root, filepath.FromSlash(candidate))); err == nil && info.Mode().IsRegular() {
					paths = append(paths, candidate)
				}
				break
			}
		}
	}
	return paths
}

func (a *meetingReadAudit) projectPath(path string) string {
	path = filepath.Clean(path)
	if !filepath.IsAbs(path) {
		return filepath.ToSlash(path)
	}
	rel, err := filepath.Rel(a.root, path)
	if err == nil && filepath.IsLocal(rel) {
		return filepath.ToSlash(rel)
	}
	root, rootErr := filepath.EvalSymlinks(a.root)
	real, pathErr := filepath.EvalSymlinks(path)
	if rootErr == nil && pathErr == nil {
		if rel, err := filepath.Rel(root, real); err == nil {
			return filepath.ToSlash(rel)
		}
	}
	return ""
}

func (a *meetingReadAudit) paths() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.read...)
}
