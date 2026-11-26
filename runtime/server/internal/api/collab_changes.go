package api

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/collab"
	"mindfs/server/internal/session"
	"mindfs/server/internal/turndiff"
)

// Both the reviewer's file list and the author's diff viewer read the recorded session turns.
func (s *AppContext) visitCollabChanges(ctx context.Context, rootID, runID string, since time.Time, visit func(*session.Session, session.Exchange, *agenttypes.TurnDiffUpdate)) error {
	mgr, err := s.GetSessionManager(rootID)
	if err != nil {
		return err
	}
	db, err := mgr.MetaDB()
	if err != nil {
		return err
	}
	rows, err := db.QueryContext(ctx, "SELECT key FROM sessions WHERE task_id=? AND source IN (?,?)", runID, session.SourceCollabStage, session.SourceCollabReview)
	if err != nil {
		return err
	}
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		keys = append(keys, key)
	}
	// The metadata store uses a single connection; release it before reading sessions.
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, key := range keys {
		sess, err := mgr.Get(ctx, key, 0)
		if err != nil {
			return err
		}
		if len(sess.Exchanges) == 0 {
			continue
		}
		aux, err := mgr.GetExchangeAux(ctx, key, 0)
		if err != nil {
			return err
		}
		for _, ex := range sess.Exchanges {
			if ex.Timestamp.Before(since) {
				continue
			}
			for _, a := range aux[ex.Seq] {
				if a.TurnDiff != nil {
					visit(sess, ex, a.TurnDiff)
				}
			}
		}
	}
	return nil
}

func (s *AppContext) CollabChangedFiles(ctx context.Context, rootID, runID string, since time.Time) (collab.ChangeList, error) {
	out := collab.ChangeList{Paths: []string{}}
	seen := map[string]bool{}
	err := s.visitCollabChanges(ctx, rootID, runID, since, func(_ *session.Session, _ session.Exchange, d *agenttypes.TurnDiffUpdate) {
		out.Partial = out.Partial || d.Partial || !d.Workspace
		for _, p := range turndiff.FilePaths(d.Diff) {
			if !seen[p] {
				out.Paths = append(out.Paths, p)
				seen[p] = true
			}
		}
	})
	sort.Strings(out.Paths)
	return out, err
}

type collabFileTurn struct {
	SessionKey string                    `json:"session_key"`
	Title      string                    `json:"title"`
	Seq        int                       `json:"seq"`
	Timestamp  time.Time                 `json:"timestamp"`
	Update     agenttypes.TurnDiffUpdate `json:"update"`
}

func (h *HTTPHandler) handleCollabChanges(w http.ResponseWriter, r *http.Request) {
	rootID, runID := r.URL.Query().Get("root"), chi.URLParam(r, "id")
	file := r.URL.Query().Get("path")
	if file == "" {
		list, err := h.AppContext.CollabChangedFiles(r.Context(), rootID, runID, time.Time{})
		if err != nil {
			respondError(w, http.StatusBadRequest, err)
			return
		}
		respondJSON(w, http.StatusOK, list)
		return
	}
	turns := []collabFileTurn{}
	err := h.AppContext.visitCollabChanges(r.Context(), rootID, runID, time.Time{}, func(sess *session.Session, ex session.Exchange, d *agenttypes.TurnDiffUpdate) {
		patch := turndiff.FilePatch(d.Diff, file)
		if patch == "" {
			return
		}
		update := *d
		update.Diff = patch
		turns = append(turns, collabFileTurn{sess.Key, sess.Name, ex.Seq, ex.Timestamp, update})
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	sort.Slice(turns, func(i, j int) bool { return turns[i].Timestamp.Before(turns[j].Timestamp) })
	respondJSON(w, http.StatusOK, turns)
}
