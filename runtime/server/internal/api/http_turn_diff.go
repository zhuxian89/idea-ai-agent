package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"mindfs/server/internal/api/usecase"
)

func (h *HTTPHandler) handleTurnDiffArtifact(w http.ResponseWriter, r *http.Request) {
	if !h.isLocalCLIRequest(r) {
		respondError(w, http.StatusForbidden, errInvalidRequest("local runtime token required"))
		return
	}
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	key := strings.TrimSpace(chi.URLParam(r, "key"))
	snapshotID := strings.TrimSpace(chi.URLParam(r, "snapshotID"))
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	out, err := h.service().GetTurnDiffArtifact(r.Context(), usecase.TurnDiffArtifactInput{
		RootID:     rootID,
		Key:        key,
		SnapshotID: snapshotID,
		Path:       path,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, out)
}
