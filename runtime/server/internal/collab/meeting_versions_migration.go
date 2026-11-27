package collab

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// Old rounds stored every revision alongside the current tally. Update the item
// snapshots in place, leaving the turns, documents and recorded decisions intact.
func (s *Store) migrateMeetingItemVersions() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var rowID int64
	for {
		var itemsJSON, decisionsJSON string
		err := tx.QueryRow(`SELECT rowid, json_extract(state_json,'$.items'), COALESCE(json_extract(state_json,'$.decisions'),'[]')
			FROM collab_meeting_rounds WHERE rowid > ? AND instr(state_json,'"versions"') > 0 AND EXISTS (
				SELECT 1 FROM json_each(state_json,'$.items') WHERE json_type(value,'$.versions') = 'array'
			) ORDER BY rowid LIMIT 1`, rowID).Scan(&rowID, &itemsJSON, &decisionsJSON)
		if err == sql.ErrNoRows {
			return tx.Commit()
		}
		if err != nil {
			return err
		}
		patch, err := migrateMeetingItems(itemsJSON, decisionsJSON)
		if err != nil {
			return fmt.Errorf("migrate meeting round row %d: %w", rowID, err)
		}
		if _, err := tx.Exec(`UPDATE collab_meeting_rounds SET state_json=json_patch(state_json, ?) WHERE rowid=?`, string(patch), rowID); err != nil {
			return err
		}
	}
}

func migrateMeetingItems(itemsJSON, decisionsJSON string) ([]byte, error) {
	var legacy []struct {
		MeetingItem
		Versions []struct {
			ID        string            `json:"id"`
			Proposal  MeetingPosition   `json:"proposal"`
			Positions []MeetingPosition `json:"positions"`
		} `json:"versions"`
	}
	var decisions []MeetingDecision
	if err := json.Unmarshal([]byte(itemsJSON), &legacy); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(decisionsJSON), &decisions); err != nil {
		return nil, err
	}
	patch := struct {
		Items   []MeetingItem              `json:"items"`
		Adopted map[string]MeetingPosition `json:"adopted_positions,omitempty"`
	}{Adopted: make(map[string]MeetingPosition)}
	for _, old := range legacy {
		item := old.MeetingItem
		if n := len(old.Versions); n > 0 {
			latest := old.Versions[n-1]
			latest.Proposal.VersionID = latest.ID
			item.Proposal, item.Revision = &latest.Proposal, n
			item.Title = firstNonEmpty(latest.Proposal.Title, item.Title)
			for _, decision := range decisions {
				if decision.ItemID != item.ID || decision.Choice != "adopt" || adoptedMeetingPosition(item, decision) != nil {
					continue
				}
				for _, v := range old.Versions {
					if v.ID != decision.VersionID {
						continue
					}
					v.Proposal.VersionID = v.ID
					if pos := adoptedMeetingPosition(MeetingItem{Proposal: &v.Proposal, Positions: v.Positions}, decision); pos != nil {
						patch.Adopted[item.ID] = *pos
					}
					break
				}
			}
		}
		patch.Items = append(patch.Items, item)
	}
	return json.Marshal(patch)
}
