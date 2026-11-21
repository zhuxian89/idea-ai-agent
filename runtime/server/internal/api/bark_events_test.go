package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/barknotify"
)

type barkSink struct {
	mu   sync.Mutex
	seen []map[string]any
}

func (b *barkSink) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	b.mu.Lock()
	b.seen = append(b.seen, body)
	b.mu.Unlock()
	_, _ = w.Write([]byte(`{"code":200}`))
}

func (b *barkSink) wait(t *testing.T, count int) []map[string]any {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		b.mu.Lock()
		n := len(b.seen)
		b.mu.Unlock()
		if n >= count {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Give an unexpected extra push a moment to show up.
	time.Sleep(80 * time.Millisecond)
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]map[string]any(nil), b.seen...)
}

func barkContext(t *testing.T, sink *barkSink, types *barknotify.TypesPatch) *AppContext {
	t.Helper()
	server := httptest.NewServer(sink)
	t.Cleanup(server.Close)
	svc := barknotify.NewServiceAt(filepath.Join(t.TempDir(), "bark.json"))
	key, base, enabled := "abcDEF1234567890xyz", "https://relay.example.com/n/n1/", true
	if _, err := svc.Apply(barknotify.Update{DeviceKey: &key, Server: &server.URL, OpenBase: &base, Enabled: &enabled, Types: types}); err != nil {
		t.Fatal(err)
	}
	return &AppContext{Bark: svc}
}

func TestSessionFailureIsReportedAsFailureNotCompletion(t *testing.T) {
	sink := &barkSink{}
	truth := true
	app := barkContext(t, sink, &barknotify.TypesPatch{Done: &truth})

	app.notifySessionDone("root", "s1", "req1", PendingSessionSnapshot{SessionTitle: "跑回归", Summary: "all good", UpdatedAt: time.Now()})
	app.recordSessionFailure("root", "s2", "exit status 1")
	app.notifySessionDone("root", "s2", "req2", PendingSessionSnapshot{SessionTitle: "构建", Summary: "stale summary", UpdatedAt: time.Now()})
	// The mark is consumed: a later normal turn in the same session is a completion again.
	app.notifySessionDone("root", "s2", "req3", PendingSessionSnapshot{SessionTitle: "构建", Summary: "fixed", UpdatedAt: time.Now()})

	seen := sink.wait(t, 3)
	if len(seen) != 3 {
		t.Fatalf("expected 3 pushes, got %d: %v", len(seen), seen)
	}
	bodies := []string{}
	for _, item := range seen {
		bodies = append(bodies, item["body"].(string))
	}
	joined := strings.Join(bodies, "|")
	for _, want := range []string{"任务完成 · all good", "任务失败 · exit status 1", "任务完成 · fixed"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %q", want, joined)
		}
	}
	if strings.Contains(joined, "stale summary") {
		t.Fatalf("failed turn leaked the success summary: %q", joined)
	}
}

func TestDefaultSettingsStayQuietForCompletion(t *testing.T) {
	sink := &barkSink{}
	app := barkContext(t, sink, nil)
	app.notifySessionDone("root", "s1", "req1", PendingSessionSnapshot{SessionTitle: "x", Summary: "ok", UpdatedAt: time.Now()})
	app.recordSessionFailure("root", "s1", "boom")
	app.notifySessionDone("root", "s1", "req2", PendingSessionSnapshot{SessionTitle: "x", UpdatedAt: time.Now()})
	seen := sink.wait(t, 1)
	if len(seen) != 1 || !strings.Contains(seen[0]["body"].(string), "任务失败") {
		t.Fatalf("expected only the failure, got %v", seen)
	}
}

func TestScheduledTaskOutcomes(t *testing.T) {
	sink := &barkSink{}
	truth := true
	app := barkContext(t, sink, &barknotify.TypesPatch{Done: &truth})
	app.BroadcastScheduledTaskDone("root", "t1", "夜间检查", "sess", "全部通过")
	app.BroadcastScheduledTaskFailed("root", "t2", "夜间构建", "sess2", "编译失败")
	seen := sink.wait(t, 2)
	if len(seen) != 2 {
		t.Fatalf("got %v", seen)
	}
	joined := seen[0]["title"].(string) + seen[0]["body"].(string) + seen[1]["title"].(string) + seen[1]["body"].(string)
	for _, want := range []string{"夜间检查", "任务完成 · 全部通过", "夜间构建", "任务失败 · 编译失败"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %q", want, joined)
		}
	}
}

func TestApprovalPromptsAreSeparatedFromQuestions(t *testing.T) {
	approvalByID := agenttypes.ToolCall{Kind: agenttypes.ToolKindAskUser, CallID: "approval-item1"}
	approvalByHeader := agenttypes.ToolCall{Kind: agenttypes.ToolKindAskUser, CallID: "x", Meta: map[string]any{
		"questions": []agenttypes.AskUserQuestionItem{{Question: "q", Header: "执行授权"}},
	}}
	question := agenttypes.ToolCall{Kind: agenttypes.ToolKindAskUser, CallID: "call1", Meta: map[string]any{
		"questions": []agenttypes.AskUserQuestionItem{{Question: "用哪个方案?", Header: "方案"}},
	}}
	if !isApprovalPrompt(approvalByID) || !isApprovalPrompt(approvalByHeader) || isApprovalPrompt(question) {
		t.Fatal("approval classification is wrong")
	}

	sink := &barkSink{}
	app := barkContext(t, sink, nil)
	for _, call := range []agenttypes.ToolCall{
		{Kind: agenttypes.ToolKindAskUser, CallID: "approval-1", Meta: map[string]any{
			"questions": []agenttypes.AskUserQuestionItem{{Question: "Codex 请求授权：commandExecution\n{\"command\":\"rm -rf build\"}", Header: "执行授权"}},
		}},
		question,
	} {
		call := call
		app.notifyAskUserIfNeeded("root", "s1", &StreamEvent{Type: string(agenttypes.EventTypeToolCall), Data: call})
	}
	seen := sink.wait(t, 2)
	if len(seen) != 2 {
		t.Fatalf("got %v", seen)
	}
	var raw bytes.Buffer
	_ = json.NewEncoder(&raw).Encode(seen)
	text := raw.String()
	if !strings.Contains(text, "需要审批 · Codex 请求授权：commandExecution：rm -rf build") || !strings.Contains(text, "需要回答 · 用哪个方案?") {
		t.Fatalf("labels wrong: %s", text)
	}
}

func TestFailureMarksExpireAndDoNotCrossSessions(t *testing.T) {
	app := &AppContext{}
	app.recordSessionFailure("r", "a", "boom")
	if _, ok := app.takeSessionFailure("r", "b"); ok {
		t.Fatal("failure leaked to another session")
	}
	app.failureMu.Lock()
	entry := app.sessionFailures[sessionFailureKey("r", "a")]
	entry.at = time.Now().Add(-2 * sessionFailureMemory)
	app.sessionFailures[sessionFailureKey("r", "a")] = entry
	app.failureMu.Unlock()
	if _, ok := app.takeSessionFailure("r", "a"); ok {
		t.Fatal("expired failure must not turn a later completion into a failure")
	}
}

func TestBarkHandlersNeverExposeTheDeviceKey(t *testing.T) {
	sink := &barkSink{}
	app := barkContext(t, sink, nil)
	h := &HTTPHandler{AppContext: app}

	rec := httptest.NewRecorder()
	h.handleBarkStatus(rec, httptest.NewRequest(http.MethodGet, "/api/bark", nil))
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "abcDEF1234567890xyz") || !strings.Contains(rec.Body.String(), `"configured":true`) {
		t.Fatalf("status: %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.handleBarkUpdate(rec, httptest.NewRequest(http.MethodPut, "/api/bark", strings.NewReader(`{"types":{"done":true},"unknown":1}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown fields must be rejected, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.handleBarkUpdate(rec, httptest.NewRequest(http.MethodPut, "/api/bark", strings.NewReader(`{"types":{"done":true}}`)))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"done":true`) {
		t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.handleBarkTest(rec, httptest.NewRequest(http.MethodPost, "/api/bark/test", nil))
	if rec.Code != http.StatusOK || len(sink.wait(t, 1)) != 1 {
		t.Fatalf("test push: %d %s", rec.Code, rec.Body.String())
	}

	missing := &HTTPHandler{AppContext: &AppContext{}}
	rec = httptest.NewRecorder()
	missing.handleBarkStatus(rec, httptest.NewRequest(http.MethodGet, "/api/bark", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing service: %d", rec.Code)
	}
}

func TestBarkMutationsFromRelayNeedASameOriginBrowserRequest(t *testing.T) {
	sink := &barkSink{}
	app := barkContext(t, sink, nil)
	h := &HTTPHandler{AppContext: app}
	relayed := func(method, target, body, host, origin string) *http.Request {
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		if host != "" {
			req.Header.Set("X-Forwarded-Host", host)
		}
		if origin != "" {
			req.Header.Set("X-Forwarded-Origin", origin)
		}
		return req
	}
	update := func(req *http.Request) int {
		rec := httptest.NewRecorder()
		h.handleBarkUpdate(rec, req)
		return rec.Code
	}
	test := func(req *http.Request) int {
		rec := httptest.NewRecorder()
		h.handleBarkTest(rec, req)
		return rec.Code
	}
	body := `{"types":{"done":true}}`
	if got := update(relayed(http.MethodPut, "/api/bark", body, "relay.example.com", "")); got != http.StatusForbidden {
		t.Fatalf("relayed request without Origin = %d", got)
	}
	if got := update(relayed(http.MethodPut, "/api/bark", body, "relay.example.com", "https://evil.example")); got != http.StatusForbidden {
		t.Fatalf("cross-site Origin = %d", got)
	}
	if got := test(relayed(http.MethodPost, "/api/bark/test", "", "relay.example.com", "https://evil.example")); got != http.StatusForbidden {
		t.Fatalf("cross-site test push = %d", got)
	}
	if n := len(sink.wait(t, 1)); n != 0 {
		t.Fatalf("a rejected test request still pushed %d messages", n)
	}
	if got := update(relayed(http.MethodPut, "/api/bark", body, "relay.example.com", "https://relay.example.com")); got != http.StatusOK {
		t.Fatalf("same-origin Relay page = %d", got)
	}
	if got := test(relayed(http.MethodPost, "/api/bark/test", "", "relay.example.com", "https://relay.example.com")); got != http.StatusOK {
		t.Fatalf("same-origin test push = %d", got)
	}
	if got := update(relayed(http.MethodPut, "/api/bark", body, "", "")); got != http.StatusOK {
		t.Fatalf("local request must keep working, got %d", got)
	}
}
