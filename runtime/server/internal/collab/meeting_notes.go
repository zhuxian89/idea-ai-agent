package collab

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

func addMeetingNote(run Run, round *MeetingRound, input MeetingActionInput) error {
	body := strings.TrimSpace(input.Text)
	if body == "" {
		return errors.New("请填写补充内容或添加附件")
	}
	resolved, err := meetingMentions(run, body, input.Mentions)
	if err != nil {
		return err
	}
	if len(resolved) == 0 && run.CurrentStep == meetingReady {
		if slot := defaultMeetingAnswerSlot(run, *round); slot != "" {
			resolved = []string{slot}
		}
	}
	id := fmt.Sprintf("m-%02d-%03d", round.Number, len(round.Turns)+1)
	round.Turns = append(round.Turns, MeetingTurn{ID: id, Kind: meetingAuthor, Status: StepStatusDone,
		Doc: round.doc(meetingNotesDoc), Body: body, At: time.Now().UTC(), Mentions: resolved})
	for _, slot := range resolved {
		round.addTurn(run, meetingAnswer, slot, id)
	}
	return nil
}

func defaultMeetingAnswerSlot(run Run, round MeetingRound) string {
	if plan := currentMeetingPlan(round); plan != nil && plan.SlotID != "" {
		return plan.SlotID
	}
	if run.Snapshot.FinalAuthorSlotID != "" {
		return run.Snapshot.FinalAuthorSlotID
	}
	if len(run.Snapshot.Members) > 0 {
		return run.Snapshot.Members[0].SlotID
	}
	return ""
}

func meetingMentions(run Run, text string, selected []string) ([]string, error) {
	aliases := map[string][]string{}
	for i, slot := range run.Snapshot.Members {
		for _, alias := range dedupeStrings([]string{strings.ToLower(slot.SlotID), strings.ToLower(slot.Agent), strings.ToLower(slot.Model), fmt.Sprintf("成员%d", i+1)}) {
			aliases[alias] = append(aliases[alias], slot.SlotID)
		}
	}
	var found []string
	var fence byte
	var fenceLen int
	for _, line := range strings.Split(strings.ToLower(text), "\n") {
		if ch, n, info, ok := parseOpeningFence(line); fence != 0 {
			if isClosingFence(line, fence, fenceLen) {
				fence = 0
			}
			continue
		} else if ok && (ch != '`' || !strings.Contains(info, "`")) {
			fence, fenceLen = ch, n
			continue
		}
		for i := 0; i < len(line); {
			r, width := utf8.DecodeRuneInString(line[i:])
			if r == '`' {
				n := len(line[i:]) - len(strings.TrimLeft(line[i:], "`"))
				delimiter := strings.Repeat("`", n)
				if end := strings.Index(line[i+n:], delimiter); end >= 0 {
					i += end + n*2
					continue
				}
			}
			if r != '@' && r != '＠' {
				i += width
				continue
			}
			prev, _ := utf8.DecodeLastRuneInString(line[:i])
			if i > 0 && !unicode.IsSpace(prev) && !unicode.In(prev, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) &&
				!strings.ContainsRune("([（【，。！？：；、「『", prev) {
				i += width
				continue
			}
			start := i + width
			match := ""
			for alias := range aliases {
				if len(alias) <= len(match) || !strings.HasPrefix(line[start:], alias) {
					continue
				}
				rest := line[start+len(alias):]
				next, n := utf8.DecodeRuneInString(rest)
				last, _ := utf8.DecodeLastRuneInString(alias)
				if rest == "" || unicode.IsSpace(next) || strings.ContainsRune(",，。!！?？:：;；、)）]】」』", next) ||
					(next == '.' && (len(rest) == n || !unicode.IsLetter(firstRune(rest[n:])) && !unicode.IsDigit(firstRune(rest[n:])))) ||
					(last < utf8.RuneSelf && unicode.In(next, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul)) {
					match = alias
				}
			}
			i = start
			if match == "" {
				continue
			}
			i += len(match)
			targets := aliases[match]
			if len(targets) > 1 {
				matches := []string{}
				for _, target := range targets {
					if slices.Contains(selected, target) {
						matches = append(matches, target)
					}
				}
				if len(matches) != 1 {
					return nil, fmt.Errorf("@%s 对应多位成员，请从输入框的成员列表点名", match)
				}
				targets = matches
			}
			if !slices.Contains(found, targets[0]) {
				found = append(found, targets[0])
			}
		}
	}
	return found, nil
}

func firstRune(text string) rune {
	r, _ := utf8.DecodeRuneInString(text)
	return r
}

func writeMeetingNotes(root string, run Run, round MeetingRound) error {
	var b strings.Builder
	b.WriteString("# 作者补充\n")
	for _, turn := range round.Turns {
		if turn.Kind != meetingAuthor {
			continue
		}
		fmt.Fprintf(&b, "\n## %s · %s\n\n%s\n", turn.ID, turn.At.Format(time.RFC3339), turn.Body)
		for _, slot := range turn.Mentions {
			fmt.Fprintf(&b, "\n点名：%s\n", meetingMemberName(run, slot))
		}
	}
	_, err := WriteRunDoc(root, run.ID, round.doc(meetingNotesDoc), b.String())
	return err
}

func meetingNoteInputs(rounds ...MeetingRound) []string {
	var docs []string
	for _, round := range rounds {
		for _, turn := range round.Turns {
			if (turn.Kind == meetingAuthor || turn.Kind == meetingAnswer) && turn.Status == StepStatusDone {
				docs = append(docs, turn.Doc)
			}
		}
	}
	return dedupeStrings(docs)
}

func hasPendingMeetingAnswer(round MeetingRound) bool {
	return slices.ContainsFunc(round.Turns, func(turn MeetingTurn) bool {
		return turn.Kind == meetingAnswer && turn.Status != StepStatusDone
	})
}
