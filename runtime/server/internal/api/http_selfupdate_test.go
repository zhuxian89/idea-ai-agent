package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"mindfs/server/internal/e2ee"
)

func updateRequest(t *testing.T, h *HTTPHandler, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "/api/standalone/update", strings.NewReader(body))
	w := httptest.NewRecorder()
	if method == "GET" {
		h.protectedEndpoint(h.handleStandaloneUpdateStatus).ServeHTTP(w, r)
	} else {
		h.protectedEndpoint(h.handleStandaloneUpdateStart).ServeHTTP(w, r)
	}
	return w
}

func TestEmbeddedBackendDoesNotOfferSelfUpdate(t *testing.T) {
	h := &HTTPHandler{AppContext: &AppContext{}, Version: "0.1.52"}
	if w := updateRequest(t, h, "GET", ""); w.Code != 404 {
		t.Fatalf("status: %d", w.Code)
	}
	if w := updateRequest(t, h, "POST", `{"version":"0.1.53"}`); w.Code != 404 {
		t.Fatalf("start: %d", w.Code)
	}
}

func TestStandaloneReportsItsUpdateStatusAndRefusesBadRequests(t *testing.T) {
	t.Setenv("IDE_AGENT_REMOTE_HOST_DIR", t.TempDir())
	h := &HTTPHandler{AppContext: &AppContext{}, Version: "0.1.52", Standalone: true}
	w := updateRequest(t, h, "GET", "")
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status: %d %v", w.Code, w.Header())
	}
	var status struct {
		Supported bool   `json:"supported"`
		Phase     string `json:"phase"`
		Current   string `json:"current"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil || !status.Supported || status.Phase != "idle" || status.Current != "0.1.52" {
		t.Fatalf("%s %v", w.Body, err)
	}
	for name, body := range map[string]string{"not json": "nope", "no version": `{}`, "bad version": `{"version":"1;reboot"}`, "not newer": `{"version":"0.1.52"}`, "older": `{"version":"0.1.1"}`} {
		if w := updateRequest(t, h, "POST", body); w.Code != 400 {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	// A valid newer version still needs an installation this process belongs to.
	if w := updateRequest(t, h, "POST", `{"version":"0.1.53"}`); w.Code != 400 || !strings.Contains(w.Body.String(), "not an installed standalone service") {
		t.Fatalf("not installed: %d %s", w.Code, w.Body)
	}
}

func TestSelfUpdateIsBehindTheSameProofAsEveryOtherEndpoint(t *testing.T) {
	manager := e2ee.NewManager(e2ee.Config{Enabled: true, NodeID: "node", PairingSecret: "secret"})
	h := &HTTPHandler{AppContext: &AppContext{E2EE: manager}, Version: "0.1.52", Standalone: true}
	for _, method := range []string{"GET", "POST"} {
		r := httptest.NewRequest(method, "/api/standalone/update", strings.NewReader(`{"version":"0.1.53"}`))
		r.Header.Set("X-MindFS-Relayed", "1")
		w := httptest.NewRecorder()
		if method == "GET" {
			h.protectedEndpoint(h.handleStandaloneUpdateStatus).ServeHTTP(w, r)
		} else {
			h.protectedEndpoint(h.handleStandaloneUpdateStart).ServeHTTP(w, r)
		}
		if w.Code != 401 {
			t.Errorf("%s through the relay without proof: %d", method, w.Code)
		}
	}
}
