package api

import (
	"net/http"

	"mindfs/server/internal/sysstats"
)

// One collector serves every browser: readings are shared within a second.
var systemStats = sysstats.NewCollector()

// handleSystemStats reports the load of the machine running this backend, not of the client.
func (h *HTTPHandler) handleSystemStats(w http.ResponseWriter, r *http.Request) {
	sample, err := systemStats.Read()
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respondJSON(w, http.StatusOK, sample)
}
