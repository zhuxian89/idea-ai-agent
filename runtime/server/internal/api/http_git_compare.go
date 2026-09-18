package api

import (
	"net/http"
	"strings"

	"mindfs/server/internal/api/usecase"
)

func (h *HTTPHandler) handleGitFileCompare(w http.ResponseWriter, r *http.Request) {
	if !h.isLocalCLIRequest(r) {
		respondError(w, http.StatusForbidden, errInvalidRequest("local runtime token required"))
		return
	}
	rootID := strings.TrimSpace(r.URL.Query().Get("root"))
	repoPath := strings.TrimSpace(r.URL.Query().Get("repo_path"))
	repoKind := strings.TrimSpace(r.URL.Query().Get("repo_kind"))
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if rootID == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("root required"))
		return
	}
	if path == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("path required"))
		return
	}
	out, err := h.service().GetGitFileCompare(r.Context(), usecase.GitRelatedFileDiffInput{
		RootID:   rootID,
		RepoPath: repoPath,
		RepoKind: repoKind,
		Path:     path,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, out)
}
