package collab

import "path"

func currentMeetingPlan(round MeetingRound) *MeetingTurn {
	return previousMeetingPlan(round, "")
}

func previousMeetingPlan(round MeetingRound, before string) *MeetingTurn {
	var plan *MeetingTurn
	for i := range round.Turns {
		turn := &round.Turns[i]
		if turn.ID == before {
			break
		}
		if turn.Kind == meetingPlan {
			plan = turn
		}
	}
	return plan
}

func meetingConfirmationFor(turn, plan MeetingTurn) bool {
	return turn.Kind == meetingConfirm && (turn.PlanID == plan.ID || turn.PlanID == "" && plan.Doc == MeetingPlanDoc)
}

func meetingPlanDisputed(round MeetingRound, plan MeetingTurn) bool {
	for _, turn := range round.Turns {
		if meetingConfirmationFor(turn, plan) && turn.Status == StepStatusDone && turn.Confirmed != nil && !*turn.Confirmed {
			return true
		}
	}
	return false
}

func meetingPlanResolutionDoc(plan MeetingTurn) string {
	return path.Join(path.Dir(plan.Doc), "作者退回-"+plan.ID+".md")
}
