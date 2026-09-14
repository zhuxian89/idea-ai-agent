package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/session"
)

type historyActivityImporter struct {
	calls     int
	exchanges []agenttypes.ImportedExchange
}

func (i *historyActivityImporter) AgentName() string { return "codex" }
func (i *historyActivityImporter) ListExternalSessions(context.Context, agenttypes.ListExternalSessionsInput) (agenttypes.ListExternalSessionsResult, error) {
	return agenttypes.ListExternalSessionsResult{}, nil
}
func (i *historyActivityImporter) ImportExternalSession(_ context.Context, in agenttypes.ImportExternalSessionInput) (agenttypes.ImportedExternalSession, error) {
	i.calls++
	exchanges := i.exchanges
	if !in.AfterTimestamp.IsZero() {
		exchanges = exchanges[1:]
	}
	return agenttypes.ImportedExternalSession{Agent: "codex", AgentSessionID: "external", Exchanges: exchanges}, nil
}

func TestHistorySyncDefersActiveTurnAndReturnsBackfilledAuxForOldSeq(t *testing.T) {
	ctx := context.Background()
	registry := fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json"))
	root, err := registry.Upsert(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	importer := &historyActivityImporter{}
	app := &AppContext{Dirs: registry, Agents: &agent.Pool{}, externalImporters: map[string]agenttypes.ExternalSessionImporter{"codex": importer}}
	manager, err := app.GetSessionManager(root.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Shutdown() })
	sess, err := manager.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	ts := time.Date(2026, 9, 14, 1, 0, 0, 0, time.UTC)
	for _, ex := range []struct{ role, text string }{{"user", "inspect"}, {"agent", "working"}} {
		if err := manager.AddExchangeForAgentAt(ctx, sess, ex.role, ex.text, "codex", "", "", "", ts); err != nil {
			t.Fatal(err)
		}
	}
	call := agenttypes.ToolCall{CallID: "call", Kind: agenttypes.ToolKindRead, Status: "running"}
	if err := manager.AddExchangeAux(ctx, sess.Key, session.ExchangeAux{Seq: 2, ToolCall: &call}); err != nil {
		t.Fatal(err)
	}
	if err := manager.UpdateAgentState(ctx, sess, "codex", 2, "external"); err != nil {
		t.Fatal(err)
	}
	call.Status = "failed"
	call.Activity = &agenttypes.ActivityFactsV1{SchemaVersion: 1, Agent: "codex", Origin: "imported", Operation: "read", Source: "agent", Outcome: "failed"}
	importer.exchanges = []agenttypes.ImportedExchange{{Role: "user", Content: "inspect", Timestamp: ts}, {Role: "agent", Content: "working", Timestamp: ts.Add(time.Second), Aux: []agenttypes.ImportedExchangeAux{{ToolCall: &call}}}}
	handler := &HTTPHandler{AppContext: app}
	request := func(sync bool, seq string) map[string]any {
		t.Helper()
		r := httptest.NewRequest(http.MethodGet, "/session?root="+root.ID+"&seq="+seq, nil)
		route := chi.NewRouteContext()
		route.URLParams.Add("key", sess.Key)
		r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, route))
		w := httptest.NewRecorder()
		if sync {
			handler.handleSessionSync(w, r)
		} else {
			handler.handleSessionGet(w, r)
		}
		if w.Code != 200 {
			t.Fatalf("HTTP %d: %s", w.Code, w.Body)
		}
		var result map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	app.GetSessionStreamHub().SetPendingUserAt(root.ID, sess.Key, "session", "codex", "", "", "", "", false, "still running", ts.Add(time.Minute))
	pending := request(true, "")
	if importer.calls != 0 || pending["activity_history_version"] != nil {
		t.Fatal("active turn was imported or marked reconciled")
	}
	exchanges := pending["exchanges"].([]any)
	last := exchanges[len(exchanges)-1].(map[string]any)
	if last["content"] != "still running" || last["seq"] != float64(0) || last["timestamp"] != ts.Add(time.Minute).Format(time.RFC3339) {
		t.Fatalf("pending turn/time lost: %#v", last)
	}
	app.GetSessionStreamHub().ClearSessionPending(sess.Key)
	full := request(true, "")
	if importer.calls != 1 || full["activity_history_version"] != float64(1) {
		t.Fatal("full projection marker missing")
	}
	delta := request(false, "2")
	aux := delta["exchange_aux"].(map[string]any)["2"].([]any)
	if len(aux) != 1 || aux[0].(map[string]any)["toolcall"].(map[string]any)["activity"].(map[string]any)["outcome"] != "failed" {
		t.Fatalf("old seq facts omitted: %#v", delta)
	}
}
