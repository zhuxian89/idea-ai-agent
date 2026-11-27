package collab

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mindfs/server/internal/turndiff"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"
)

const taskFile = "00-任务说明.md"
const changeListFile = "本轮改动清单.md"
const authorReviewNoteFile = "00-作者补充意见.md"

var stageDocuments = map[string]string{
	DocImpl: "01-初次实现说明.md", DocReview: "02-审核意见.md", DocResponse: "03-逐条回应.md",
	DocDecisions: "04-作者裁决.md", DocReport: "05-改动结果.md",
}

func roundDir(round int) string { return fmt.Sprintf("第%02d轮", round) }
func (r Run) doc(name string) string {
	if r.Round == 0 {
		return name
	}
	if name == DocImpl {
		if step := findStep(&r, StepImpl); step != nil && path.Base(step.DocPath) == DocImpl {
			return DocImpl
		}
		return stageDocuments[name]
	}
	if translated, ok := stageDocuments[name]; ok {
		name = translated
	}
	return path.Join(roundDir(r.Round), name)
}
func (r Run) previousDoc(name string) string {
	r.Round--
	if r.Round == 1 && r.doc(DocImpl) == DocImpl {
		return name
	}
	return r.doc(name)
}

type ChangeList struct {
	Paths   []string `json:"paths"`
	Partial bool     `json:"partial"`
}

func (c ChangeList) Markdown() string {
	var b strings.Builder
	b.WriteString("# 改动文件\n\n")
	if c.Partial {
		b.WriteString("部分改动未能采集，请结合任务核对。\n\n")
	}
	if len(c.Paths) == 0 {
		b.WriteString("本次记录未列出文件。\n")
	}
	for _, p := range c.Paths {
		fmt.Fprintf(&b, "- %s\n", strconv.Quote(p))
	}
	return b.String()
}

// NextReview keeps previous handoffs on disk. Only the current round's UI rows are reset.
func (s *Service) NextReview(ctx context.Context, rootID, runID string, expectedRound int, authorNote string) (RunDetail, error) {
	store, err := s.runner.GetCollabStore(rootID)
	if err != nil {
		return RunDetail{}, err
	}
	r, err := store.GetRun(ctx, runID)
	if err != nil {
		return RunDetail{}, err
	}
	if r.Round != expectedRound || r.CurrentStep != StepDone || r.Status != RunStatusCompleted {
		return RunDetail{}, errors.New("请刷新并从已完成的当前轮开始复核")
	}
	s.mu.Lock()
	previousWorker := s.workers[workerKey(rootID, runID)]
	s.mu.Unlock()
	if previousWorker != nil {
		select {
		case <-previousWorker.done:
		case <-ctx.Done():
			return RunDetail{}, ctx.Err()
		}
	}
	root, err := s.runner.RootPath(rootID)
	if err != nil {
		return RunDetail{}, err
	}
	prev := findStep(&r, StepReview)
	if prev == nil {
		return RunDetail{}, errors.New("缺少上轮审核阶段记录")
	}
	for _, step := range r.Steps {
		if step.Status == StepStatusSkipped {
			continue
		}
		if _, err := ReadRunDoc(root, runID, strings.TrimPrefix(step.DocPath, RunRelDir(runID)+"/")); err != nil {
			return RunDetail{}, fmt.Errorf("复核需要上轮交付文件 %s: %w", step.DocPath, err)
		}
	}
	since := prev.FinishedAt
	high := prev.HighestItemID
	items, err := store.ListReviewItems(ctx, runID)
	if err != nil {
		return RunDetail{}, err
	}
	var ids []string
	for _, it := range items {
		ids = append(ids, it.ItemID)
		n, _ := strconv.Atoi(strings.TrimPrefix(it.ItemID, "R"))
		high = max(high, n)
	}
	trimmedNote := strings.TrimSpace(authorNote)
	r.Round = max(1, r.Round) + 1
	primary, reviewer := extractQuickMembers(r.Snapshot.Members)
	for i := range r.Steps {
		step := &r.Steps[i]
		if step.Key == StepImpl {
			continue
		}
		step.Status, step.SessionKey, step.StartedAt, step.FinishedAt, step.Summary, step.AuthorNote = StepStatusPending, "", "", "", "", ""
		switch step.Role {
		case RolePrimary:
			if primary.Agent != "" {
				step.SlotID, step.Agent, step.Model, step.Effort = primary.SlotID, primary.Agent, primary.Model, primary.Effort
			}
		case RoleReviewer:
			if reviewer.Agent != "" {
				step.SlotID, step.Agent, step.Model, step.Effort = reviewer.SlotID, reviewer.Agent, reviewer.Model, reviewer.Effort
			}
		}
		step.DocPath = DocRelPath(r.ID, r.doc(map[string]string{StepReview: DocReview, StepResponse: DocResponse, StepDecisions: DocDecisions, StepFixTest: DocReport}[step.Key]))
	}
	prev.ChangesSince, prev.PreviousItems, prev.HighestItemID, prev.AuthorNote = since, ids, high, trimmedNote
	r.CurrentStep, r.Status = StepReview, RunStatusRunning
	r.CompletedAt, r.TestCommand, r.TestStatus, r.TestSummary, r.ErrorMessage = "", "", "", "", ""
	r.ReadOnlyCheckState, r.ReadOnlyCheckNote = "", ""
	r.UpdatedAt = time.Now().UTC()
	data, err := json.Marshal(r.Steps)
	if err != nil {
		return RunDetail{}, err
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return RunDetail{}, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE collab_runs SET review_round=?,current_step=?,status=?,step_status_json=?,completed_at='',test_status='',test_summary='',test_command='',error_message='',readonly_check_note='',readonly_check_state='',updated_at=? WHERE id=? AND review_round=? AND status='completed' AND docs_cleaned=0`, r.Round, r.CurrentStep, r.Status, string(data), r.UpdatedAt.Format(time.RFC3339Nano), r.ID, expectedRound)
	if err != nil {
		return RunDetail{}, err
	}
	count, err := res.RowsAffected()
	if err != nil {
		return RunDetail{}, err
	}
	if count != 1 {
		return RunDetail{}, errors.New("运行状态已变化")
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM collab_review_items WHERE run_id=?", r.ID); err != nil {
		return RunDetail{}, err
	}
	if trimmedNote != "" {
		if _, err := WriteRunDoc(root, r.ID, r.doc(authorReviewNoteFile), "# 作者补充审核意见\n\n"+trimmedNote+"\n"); err != nil {
			return RunDetail{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return RunDetail{}, err
	}
	s.notifyRunUpdated(ctx, store, rootID, r)
	s.launchQuickWorker(rootID, r.ID, false, false)
	return s.GetRunDetail(ctx, rootID, runID)
}

func parseRoundReviewControl(blocks []ControlBlock, round int, step *StepCard) (reviewControlPayload, error) {
	review, err := parseReviewControl(blocks)
	if err == nil && round > 1 {
		err = validateReReview(step, review)
	}
	return review, err
}

func validateReReview(step *StepCard, review reviewControlPayload) error {
	previous := map[string]bool{}
	for _, id := range step.PreviousItems {
		previous[id] = true
	}
	seen := map[string]bool{}
	for _, id := range review.Resolved {
		if !previous[id] || seen[id] {
			return fmt.Errorf("已解决条目编号无效：%s", id)
		}
		seen[id] = true
	}
	for _, it := range review.Items {
		n, err := strconv.Atoi(strings.TrimPrefix(it.ItemID, "R"))
		if seen[it.ItemID] || (!previous[it.ItemID] && (err != nil || it.ItemID != fmt.Sprintf("R%d", n) || n <= step.HighestItemID)) {
			return fmt.Errorf("审核意见编号无效或重复：%s", it.ItemID)
		}
		seen[it.ItemID] = true
	}
	for _, id := range step.PreviousItems {
		if !seen[id] {
			return fmt.Errorf("遗漏上轮意见 %s", id)
		}
	}
	return nil
}

// Reuse completed session turns, including the author's interventions, as the file inventory.
func (s *Service) changedFiles(ctx context.Context, rootID string, r Run, since string) (ChangeList, error) {
	var from time.Time
	if since != "" {
		var err error
		from, err = time.Parse(time.RFC3339Nano, since)
		if err != nil {
			return ChangeList{}, err
		}
	}
	changes, err := s.runner.CollabChangedFiles(ctx, rootID, r.ID, from)
	if err != nil {
		return changes, err
	}
	// Pre-round runs kept an additional implementation snapshot beside their handoffs.
	if r.doc(DocImpl) == DocImpl && from.IsZero() {
		root, err := s.runner.RootPath(rootID)
		if err != nil {
			return changes, err
		}
		if meta, ok := ReadImplDiffMeta(root, r.ID); ok {
			changes.Paths = append(changes.Paths, turndiff.FilePaths(meta.Diff)...)
			changes.Partial = changes.Partial || meta.Partial || !meta.Observed
		}
	}
	slices.Sort(changes.Paths)
	changes.Paths = slices.Compact(changes.Paths)
	return changes, nil
}

func roundSessionKey(id string, round int, step string) string {
	if round <= 1 {
		return fmt.Sprintf("collab-%s-%s", id, step)
	}
	return fmt.Sprintf("collab-%s-r%d-%s", id, round, step)
}
