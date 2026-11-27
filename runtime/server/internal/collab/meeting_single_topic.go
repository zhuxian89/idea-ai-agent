package collab

import (
	"fmt"
	"slices"
	"strings"
)

func singleCandidateVersion(index int, turnID string) string {
	return fmt.Sprintf("S%d-%s", index+1, turnID)
}

func singleCandidateIndex(candidates []MeetingPosition, versionID string) int {
	return slices.IndexFunc(candidates, func(candidate MeetingPosition) bool {
		return strings.EqualFold(candidate.VersionID, versionID)
	})
}

// An empty, valid review can endorse the member's own proposal when that
// identifies exactly one current candidate.
func singleOwnCandidate(candidates []MeetingPosition, turn MeetingTurn) string {
	var version string
	for _, candidate := range candidates {
		if candidate.SlotID == turn.SlotID && candidate.Issue == "" {
			if version != "" {
				return ""
			}
			version = candidate.VersionID
		}
	}
	return version
}

func alignSingleTopic(run Run, previous MeetingItem, round MeetingRound) MeetingItem {
	item := MeetingItem{ID: previous.ID, Title: previous.Title, Candidates: slices.Clone(previous.Candidates)}
	priorVotes := make(map[string]MeetingPosition)
	for _, pos := range previous.Positions {
		priorVotes[pos.SlotID] = pos
	}
	votes := make(map[string]MeetingPosition)
	for _, turn := range round.Turns {
		if turn.Kind != meetingReview {
			continue
		}
		vote := meetingReviewPosition(item.ID, turn, priorVotes[turn.SlotID])
		if vote.Stance == "unconfirmed" && turn.Status == StepStatusDone && turn.PositionIssue == "" && len(turn.Positions) == 0 {
			if own := singleOwnCandidate(previous.Candidates, turn); own != "" {
				vote.Stance, vote.VersionID, vote.Source, vote.Issue = "agree", own, "author", ""
			}
		}
		if vote.Stance != "unconfirmed" {
			index := singleCandidateIndex(previous.Candidates, vote.VersionID)
			switch {
			case index < 0:
				vote.Stance, vote.Issue = "unconfirmed", "未指定本轮清单中的候选方案"
			case vote.Stance == "propose" && item.Candidates[index].VersionID != previous.Candidates[index].VersionID:
				vote.Stance, vote.Issue = "unconfirmed", "本轮已有修订"
			case vote.Stance == "propose":
				vote.VersionID = singleCandidateVersion(index, turn.ID)
				item.Candidates[index] = vote
				vote.Stance, vote.Source = "agree", "submission"
			default:
				candidate := previous.Candidates[index]
				vote.VersionID = candidate.VersionID
				prior, ok := priorVotes[turn.SlotID]
				if candidate.Issue != "" && vote.Stance == "agree" {
					vote.Stance, vote.Issue = "unconfirmed", "候选方案尚未确认"
				} else if ok && prior.Stance != "unconfirmed" && vote.Reason == "" &&
					(prior.Stance != vote.Stance || prior.VersionID != vote.VersionID) {
					vote.Stance, vote.Issue = "unconfirmed", "改口缺少理由"
				}
			}
		}
		votes[turn.SlotID] = vote
	}
	item.Aligned = len(run.Snapshot.Members) > 0
	unchanged := len(previous.Positions) > 0
	var supported string
	for _, member := range run.Snapshot.Members {
		vote, ok := votes[member.SlotID]
		if !ok {
			vote = MeetingPosition{ID: item.ID, SlotID: member.SlotID, Stance: "unconfirmed", Issue: "成员未交付互评"}
		} else if vote.Stance != "unconfirmed" && singleCandidateIndex(item.Candidates, vote.VersionID) < 0 {
			vote = MeetingPosition{ID: item.ID, SlotID: member.SlotID, Stance: "unconfirmed", Issue: "方案已修订，待重新表态"}
		}
		if supported == "" {
			supported = vote.VersionID
		}
		item.Aligned = item.Aligned && vote.Stance == "agree" && vote.VersionID == supported
		prior := priorVotes[member.SlotID]
		unchanged = unchanged && vote.Stance != "unconfirmed" && vote.Stance == prior.Stance &&
			vote.VersionID == prior.VersionID && !newMeetingCitation(prior.Citations, vote.Citations)
		item.Positions = append(item.Positions, vote)
	}
	item.Stalled = unchanged && !item.Aligned
	return item
}
