package collab

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

const (
	meetingProposal   = "proposal"
	meetingReview     = "review"
	meetingAligned    = "alignment"
	meetingPlan       = "plan"
	meetingConfirm    = "confirmation"
	meetingReady      = "ready"
	meetingAnswer     = "answer"
	meetingAuthor     = "author"
	meetingDelivering = "delivering"
)

const (
	MeetingTopicDoc    = "00-会议议题.md"
	MeetingPlanDoc     = "05-正式计划.md"
	meetingSummaryDoc  = "03-共识与分歧.md"
	meetingNotesDoc    = "04-作者补充.md"
	meetingDecisionDoc = "作者裁决.md"
)

type MeetingDetail struct {
	Rounds     []MeetingRound `json:"rounds"`
	QuickRunID string         `json:"quick_run_id,omitempty"`
}

type MeetingRound struct {
	RunID      string        `json:"-"`
	Number     int           `json:"number"`
	Inputs     []string      `json:"inputs,omitempty"`
	Turns      []MeetingTurn `json:"turns"`
	PriorTurns []MeetingTurn `json:"-"`
	Items      []MeetingItem `json:"items,omitempty"`
	SummaryDoc string        `json:"summary_doc,omitempty"`
	SummaryAt  string        `json:"summary_at,omitempty"`
	AnswerOnly bool          `json:"answer_only,omitempty"`
	// Older meetings could adopt a superseded proposal. Keep the author's chosen quotation with the decision.
	AdoptedPositions map[string]MeetingPosition `json:"adopted_positions,omitempty"`
	Decisions        []MeetingDecision          `json:"decisions,omitempty"`
	AuthorOverride   string                     `json:"author_override,omitempty"`
	PlanResolutions  []MeetingPlanResolution    `json:"plan_resolutions,omitempty"`
	QuickRunID       string                     `json:"-"`
}

type MeetingTurn struct {
	ID            string             `json:"id"`
	Kind          string             `json:"kind"`
	SlotID        string             `json:"slot_id,omitempty"`
	Agent         string             `json:"agent,omitempty"`
	Model         string             `json:"model,omitempty"`
	Status        string             `json:"status"`
	SessionKey    string             `json:"session_key,omitempty"`
	Doc           string             `json:"doc"`
	Body          string             `json:"body,omitempty"`
	LiveSeq       int                `json:"live_seq,omitempty"`
	At            time.Time          `json:"at"`
	ReplyTo       string             `json:"reply_to,omitempty"`
	Mentions      []string           `json:"mentions,omitempty"`
	Positions     []MeetingPosition  `json:"positions,omitempty"`
	PositionIssue string             `json:"position_issue,omitempty"`
	PlanID        string             `json:"plan_id,omitempty"`
	Confirmed     *bool              `json:"confirmed,omitempty"`
	BlindReads    []string           `json:"blind_reads,omitempty"`
	ReadOnlyState ReadOnlyCheckState `json:"readonly_state,omitempty"`
	ReadOnlyNote  string             `json:"readonly_note,omitempty"`
}

type MeetingPosition struct {
	ID        string       `json:"id,omitempty"`
	Title     string       `json:"title,omitempty"`
	Stance    string       `json:"stance"`
	Quote     string       `json:"quote"`
	Checked   string       `json:"checked,omitempty"`
	Risk      string       `json:"risk,omitempty"`
	Reason    string       `json:"reason,omitempty"`
	Citations []ReviewItem `json:"citations,omitempty"`
	TurnID    string       `json:"turn_id,omitempty"`
	SlotID    string       `json:"slot_id,omitempty"`
	Doc       string       `json:"doc,omitempty"`
	VersionID string       `json:"version_id,omitempty"`
	Issue     string       `json:"issue,omitempty"`
	Source    string       `json:"source,omitempty"`
	// ReportedStance records an agree or disagree that failed field validation.
	ReportedStance string `json:"reported_stance,omitempty"`
}

type MeetingItem struct {
	Candidates []MeetingPosition `json:"candidates,omitempty"`
	ID         string            `json:"id"`
	Title      string            `json:"title"`
	Proposal   *MeetingPosition  `json:"proposal,omitempty"`
	Positions  []MeetingPosition `json:"positions"`
	Aligned    bool              `json:"aligned"`
	Stalled    bool              `json:"stalled,omitempty"`
	Revision   int               `json:"revision,omitempty"`
}

type MeetingDecision struct {
	ItemID    string `json:"item_id"`
	Choice    string `json:"choice"`
	SlotID    string `json:"slot_id,omitempty"`
	TurnID    string `json:"turn_id,omitempty"`
	VersionID string `json:"version_id,omitempty"`
	Note      string `json:"note,omitempty"`
}

type MeetingPlanResolution struct {
	PlanID string `json:"plan_id"`
	Action string `json:"action"`
	Reason string `json:"reason"`
}

func (r MeetingRound) doc(name string) string {
	return roundDir(r.Number) + "/" + name
}

func (s *Store) readMeeting(ctx context.Context, runID string) (*MeetingDetail, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT number, state_json, quick_run_id FROM collab_meeting_rounds WHERE run_id = ? ORDER BY number`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	detail := &MeetingDetail{Rounds: []MeetingRound{}}
	for rows.Next() {
		var round MeetingRound
		var state string
		if err := rows.Scan(&round.Number, &state, &round.QuickRunID); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(state), &round); err != nil {
			return nil, err
		}
		round.RunID = runID
		if round.QuickRunID != "" {
			detail.QuickRunID = round.QuickRunID
		}
		detail.Rounds = append(detail.Rounds, round)
	}
	return detail, rows.Err()
}

func (s *Store) createMeeting(ctx context.Context, run Run, round MeetingRound) (Run, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Run{}, err
	}
	defer tx.Rollback()
	created, err := s.createRun(ctx, tx, run)
	if err != nil {
		return Run{}, err
	}
	if err := writeMeetingRound(ctx, tx, round); err != nil {
		return Run{}, err
	}
	return created, tx.Commit()
}

func writeMeetingRound(ctx context.Context, tx *sql.Tx, round MeetingRound) error {
	state, err := json.Marshal(round)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO collab_meeting_rounds(run_id,number,state_json,quick_run_id) VALUES (?,?,?,?)
		ON CONFLICT(run_id,number) DO UPDATE SET state_json=excluded.state_json, quick_run_id=excluded.quick_run_id`,
		round.RunID, round.Number, string(state), round.QuickRunID)
	return err
}

func (s *Store) saveMeeting(ctx context.Context, run Run, rounds ...MeetingRound) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, round := range rounds {
		if err := writeMeetingRound(ctx, tx, round); err != nil {
			return err
		}
	}
	snapshotJSON, err := json.Marshal(run.Snapshot)
	if err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `UPDATE collab_runs SET template_snapshot_json=?, review_round=?, current_step=?, status=?, error_message=?, updated_at=?, completed_at=?
		WHERE id=? AND mode=?`, string(snapshotJSON), run.Round, run.CurrentStep, run.Status, run.ErrorMessage, run.UpdatedAt.Format(time.RFC3339Nano), run.CompletedAt, run.ID, ModeGroup)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrRunNotFound
	}
	return tx.Commit()
}

func (s *Store) createMeetingQuickRun(ctx context.Context, quick Run, round MeetingRound) (Run, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Run{}, err
	}
	defer tx.Rollback()
	created, err := s.createRun(ctx, tx, quick)
	if err != nil {
		return Run{}, err
	}
	round.QuickRunID = created.ID
	created.MeetingRunID = round.RunID
	if err := writeMeetingRound(ctx, tx, round); err != nil {
		return Run{}, err
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	_, err = tx.ExecContext(ctx, `UPDATE collab_runs SET status=?, updated_at=?, completed_at=? WHERE id=?`,
		RunStatusCompleted, now, now, round.RunID)
	if err != nil {
		return Run{}, err
	}
	return created, tx.Commit()
}
