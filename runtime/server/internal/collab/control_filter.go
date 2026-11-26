package collab

import (
	"encoding/json"
	"errors"
	"strings"
)

const ControlBlockFenceTag = "mindfs-control"

type ControlBlock struct {
	Raw      string          `json:"raw"`
	Payload  json.RawMessage `json:"payload,omitempty"`
	Unclosed bool            `json:"unclosed,omitempty"`
	Err      error           `json:"-"`
}

type filterState int

const (
	stateNormal filterState = iota
	stateCodeFence
	stateControlFence
)

// ControlStreamFilter hides fenced ```mindfs-control ... ``` blocks from
// live streaming output while preserving normal prose token-by-token and
// keeping outer/nested Markdown code fences intact.
type ControlStreamFilter struct {
	state          filterState
	fenceChar      byte
	fenceLen       int
	lineConfirmed  bool
	lineBuf        strings.Builder
	controlBuf     strings.Builder
	visibleBuf     strings.Builder
	deliverableBuf strings.Builder
	postToolBuf    strings.Builder
	afterTool      bool
	blocks         []ControlBlock
	flushed        bool
	deliveryPath   string
	checkReview    func([]ControlBlock) error
}

func NewControlStreamFilter() *ControlStreamFilter {
	return &ControlStreamFilter{
		state: stateNormal,
	}
}

func NewControlStreamFilterWithDeliveryPath(docPath string) *ControlStreamFilter {
	return &ControlStreamFilter{
		state:        stateNormal,
		deliveryPath: strings.TrimSpace(docPath),
	}
}

func (f *ControlStreamFilter) RequireValidReviewBlock(round int, step *StepCard) *ControlStreamFilter {
	f.checkReview = func(blocks []ControlBlock) error {
		_, err := parseRoundReviewControl(blocks, round, step)
		return err
	}
	return f
}

// MarkToolActivity records a tool boundary so transitional pre-tool status
// lines stay in the chat stream without polluting the saved deliverable doc.
func (f *ControlStreamFilter) MarkToolActivity() {
	if f == nil || f.flushed {
		return
	}
	f.postToolBuf.Reset()
	f.afterTool = true
}

func (f *ControlStreamFilter) recordVisibleDelta(delta string) {
	if delta == "" {
		return
	}
	f.visibleBuf.WriteString(delta)
	if f.afterTool {
		f.postToolBuf.WriteString(delta)
		if strings.TrimSpace(f.postToolBuf.String()) != "" {
			f.deliverableBuf.Reset()
			f.deliverableBuf.WriteString(strings.TrimLeft(f.postToolBuf.String(), "\r\n"))
			f.postToolBuf.Reset()
			f.afterTool = false
		}
		return
	}
	f.deliverableBuf.WriteString(delta)
}

func (f *ControlStreamFilter) Push(chunk string) string {
	if f == nil || chunk == "" || f.flushed {
		return ""
	}
	var out strings.Builder
	for i := 0; i < len(chunk); i++ {
		ch := chunk[i]
		switch f.state {
		case stateNormal:
			f.pushNormalByte(ch, &out)
		case stateCodeFence:
			f.pushCodeFenceByte(ch, &out)
		case stateControlFence:
			f.pushControlFenceByte(ch)
		}
	}
	delta := out.String()
	f.recordVisibleDelta(delta)
	return delta
}

func (f *ControlStreamFilter) pushNormalByte(ch byte, out *strings.Builder) {
	if f.lineConfirmed {
		out.WriteByte(ch)
		if ch == '\n' {
			f.lineConfirmed = false
			f.lineBuf.Reset()
		}
		return
	}

	f.lineBuf.WriteByte(ch)
	current := f.lineBuf.String()

	if ch == '\n' {
		lineNoLF := strings.TrimSuffix(strings.TrimSuffix(current, "\n"), "\r")
		if fenceChar, fenceLen, info, ok := parseOpeningFence(lineNoLF); ok {
			if isControlFenceInfo(info) {
				f.state = stateControlFence
				f.fenceChar = fenceChar
				f.fenceLen = fenceLen
				f.controlBuf.Reset()
				f.lineBuf.Reset()
				return
			}
			f.state = stateCodeFence
			f.fenceChar = fenceChar
			f.fenceLen = fenceLen
			out.WriteString(current)
			f.lineBuf.Reset()
			return
		}
		out.WriteString(current)
		f.lineBuf.Reset()
		return
	}

	if !mayStillOpenFence(current) {
		out.WriteString(current)
		f.lineBuf.Reset()
		f.lineConfirmed = true
	}
}

func (f *ControlStreamFilter) pushCodeFenceByte(ch byte, out *strings.Builder) {
	out.WriteByte(ch)
	f.lineBuf.WriteByte(ch)
	if ch == '\n' {
		lineNoLF := strings.TrimSuffix(strings.TrimSuffix(f.lineBuf.String(), "\n"), "\r")
		if isClosingFence(lineNoLF, f.fenceChar, f.fenceLen) {
			f.state = stateNormal
		}
		f.lineBuf.Reset()
	}
}

func (f *ControlStreamFilter) pushControlFenceByte(ch byte) {
	f.lineBuf.WriteByte(ch)
	if ch == '\n' {
		rawLine := f.lineBuf.String()
		lineNoLF := strings.TrimSuffix(strings.TrimSuffix(rawLine, "\n"), "\r")
		f.lineBuf.Reset()
		if isClosingFence(lineNoLF, f.fenceChar, f.fenceLen) {
			f.finishControlBlock(false)
			f.state = stateNormal
			return
		}
		f.controlBuf.WriteString(rawLine)
	}
}

func (f *ControlStreamFilter) Flush() string {
	if f == nil || f.flushed {
		return ""
	}
	f.flushed = true
	var out strings.Builder

	switch f.state {
	case stateNormal:
		if f.lineBuf.Len() > 0 {
			rem := f.lineBuf.String()
			lineNoCR := strings.TrimSuffix(rem, "\r")
			if _, _, info, ok := parseOpeningFence(lineNoCR); ok && isControlFenceInfo(info) {
				f.blocks = append(f.blocks, ControlBlock{
					Raw:      "",
					Unclosed: true,
					Err:      errors.New("unclosed empty control fence"),
				})
			} else {
				out.WriteString(rem)
			}
			f.lineBuf.Reset()
		}
	case stateCodeFence:
		f.lineBuf.Reset()
		f.state = stateNormal
	case stateControlFence:
		if f.lineBuf.Len() > 0 {
			rem := f.lineBuf.String()
			lineNoCR := strings.TrimSuffix(rem, "\r")
			f.lineBuf.Reset()
			if isClosingFence(lineNoCR, f.fenceChar, f.fenceLen) {
				f.finishControlBlock(false)
				f.state = stateNormal
				break
			}
			f.controlBuf.WriteString(rem)
		}
		f.finishControlBlock(true)
		f.state = stateNormal
	}

	delta := out.String()
	f.recordVisibleDelta(delta)
	return delta
}

func (f *ControlStreamFilter) VisibleText() string {
	if f == nil {
		return ""
	}
	return f.visibleBuf.String()
}

// DeliverableText returns the final post-tool deliverable prose while falling
// back to VisibleText when no post-tool prose was emitted.
func (f *ControlStreamFilter) DeliverableText() string {
	if f == nil {
		return ""
	}
	if strings.TrimSpace(f.deliverableBuf.String()) != "" {
		return f.deliverableBuf.String()
	}
	return f.visibleBuf.String()
}

// CompletionSuffix returns the delivery path notice appended to the stage
// conversation after a successful turn without polluting VisibleText().
func (f *ControlStreamFilter) CompletionSuffix() string {
	if f == nil || f.deliveryPath == "" {
		return ""
	}
	if f.checkReview != nil && f.checkReview(f.blocks) != nil {
		return ""
	}
	visible := f.visibleBuf.String()
	if strings.TrimSpace(visible) == "" {
		return ""
	}
	notice := "阶段交付路径：" + f.deliveryPath
	if strings.Contains(visible, notice) {
		return ""
	}
	normalized := strings.ReplaceAll(visible, "\r\n", "\n")
	switch {
	case strings.HasSuffix(normalized, "\n\n"):
		return notice
	case strings.HasSuffix(normalized, "\n"):
		return "\n" + notice
	default:
		return "\n\n" + notice
	}
}

func (f *ControlStreamFilter) Blocks() []ControlBlock {
	if f == nil || len(f.blocks) == 0 {
		return nil
	}
	out := make([]ControlBlock, len(f.blocks))
	copy(out, f.blocks)
	return out
}

func (f *ControlStreamFilter) finishControlBlock(unclosed bool) {
	raw := strings.TrimSpace(f.controlBuf.String())
	f.controlBuf.Reset()
	block := ControlBlock{
		Raw:      raw,
		Unclosed: unclosed,
	}
	if unclosed {
		block.Err = errors.New("unclosed control block")
		f.blocks = append(f.blocks, block)
		return
	}
	if raw == "" {
		block.Err = errors.New("empty control block")
		f.blocks = append(f.blocks, block)
		return
	}
	var js json.RawMessage
	if err := json.Unmarshal([]byte(raw), &js); err != nil {
		block.Err = err
		f.blocks = append(f.blocks, block)
		return
	}
	block.Payload = append(json.RawMessage(nil), js...)
	f.blocks = append(f.blocks, block)
}

func mayStillOpenFence(linePrefix string) bool {
	spaces := 0
	for spaces < len(linePrefix) && linePrefix[spaces] == ' ' {
		spaces++
		if spaces > 3 {
			return false
		}
	}
	if spaces == len(linePrefix) {
		return true
	}
	fenceChar := linePrefix[spaces]
	if fenceChar != '`' && fenceChar != '~' {
		return false
	}
	return true
}

func parseOpeningFence(line string) (fenceChar byte, fenceLen int, info string, ok bool) {
	spaces := 0
	for spaces < len(line) && line[spaces] == ' ' {
		spaces++
		if spaces > 3 {
			return 0, 0, "", false
		}
	}
	if spaces >= len(line) {
		return 0, 0, "", false
	}
	ch := line[spaces]
	if ch != '`' && ch != '~' {
		return 0, 0, "", false
	}
	idx := spaces
	for idx < len(line) && line[idx] == ch {
		idx++
	}
	count := idx - spaces
	if count < 3 {
		return 0, 0, "", false
	}
	rest := line[idx:]
	if ch == '`' && strings.ContainsRune(rest, '`') {
		return 0, 0, "", false
	}
	return ch, count, strings.TrimSpace(rest), true
}

func isClosingFence(line string, fenceChar byte, minLen int) bool {
	spaces := 0
	for spaces < len(line) && line[spaces] == ' ' {
		spaces++
		if spaces > 3 {
			return false
		}
	}
	if spaces >= len(line) || line[spaces] != fenceChar {
		return false
	}
	idx := spaces
	for idx < len(line) && line[idx] == fenceChar {
		idx++
	}
	if idx-spaces < minLen {
		return false
	}
	return strings.Trim(line[idx:], " \t") == ""
}

func isControlFenceInfo(info string) bool {
	fields := strings.Fields(info)
	if len(fields) == 0 {
		return false
	}
	return strings.EqualFold(fields[0], ControlBlockFenceTag)
}
