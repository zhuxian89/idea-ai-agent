package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"mindfs/server/internal/e2ee"
)

func TestSystemStatsReportsTheBackendMachine(t *testing.T) {
	h := &HTTPHandler{AppContext: &AppContext{}}
	r := httptest.NewRequest("GET", "/api/system/stats", nil)
	w := httptest.NewRecorder()
	h.protectedEndpoint(h.handleSystemStats).ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("readings must not be cached: %v", w.Header())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"host", "cpu_percent", "cpu_cores", "mem_percent", "mem_used", "mem_total", "sampled_at_ms"} {
		if _, ok := body[key]; !ok {
			t.Fatalf("missing %q in %s", key, w.Body)
		}
	}
	if body["mem_total"].(float64) <= 0 {
		t.Fatalf("no memory total: %s", w.Body)
	}
}

// Through the Relay the reading is behind the same proof as every other protected endpoint.
func TestSystemStatsRequiresAProofThroughTheRelay(t *testing.T) {
	manager := e2ee.NewManager(e2ee.Config{Enabled: true, NodeID: "node", PairingSecret: "secret"})
	h := &HTTPHandler{AppContext: &AppContext{E2EE: manager}}
	r := httptest.NewRequest("GET", "/api/system/stats", nil)
	r.Header.Set("X-MindFS-Relayed", "1")
	w := httptest.NewRecorder()
	h.protectedEndpoint(h.handleSystemStats).ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("an unauthenticated relayed request got %d: %s", w.Code, w.Body)
	}
}
