package barknotify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func boolPtr(v bool) *bool    { return &v }
func strPtr(v string) *string { return &v }

type capture struct {
	mu       sync.Mutex
	requests []map[string]any
	path     string
}

func (c *capture) handler(status int, reply string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		c.mu.Lock()
		c.requests = append(c.requests, body)
		c.path = r.URL.Path
		c.mu.Unlock()
		w.WriteHeader(status)
		_, _ = w.Write([]byte(reply))
	}
}

func (c *capture) wait(t *testing.T, count int) []map[string]any {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		c.mu.Lock()
		n := len(c.requests)
		c.mu.Unlock()
		if n >= count {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]map[string]any(nil), c.requests...)
}

func configured(t *testing.T, serverURL string) *Service {
	t.Helper()
	svc := newService(filepath.Join(t.TempDir(), "bark.json"))
	if _, err := svc.Apply(Update{
		DeviceKey: strPtr("abcDEF1234567890xyz"),
		Server:    strPtr(serverURL),
		Enabled:   boolPtr(true),
		OpenBase:  strPtr("https://relay.example.com/n/node1"),
	}); err != nil {
		t.Fatal(err)
	}
	return svc
}

func TestParseDeviceInput(t *testing.T) {
	cases := []struct {
		in, server, key string
		fail            bool
	}{
		{in: "", key: ""},
		{in: "  abcDEF1234  ", key: "abcDEF1234"},
		{in: "https://api.day.app/abcDEF1234/推送内容", server: "https://api.day.app", key: "abcDEF1234"},
		{in: "http://bark.lan:8080/abcDEF1234", server: "http://bark.lan:8080", key: "abcDEF1234"},
		{in: "https://api.day.app/", fail: true},
		{in: "ab", fail: true},
		{in: "abc def ghi", fail: true},
		{in: "ftp://x/abcDEF1234", fail: true},
		{in: "https://user:pw@api.day.app/abcDEF1234", server: "https://api.day.app", key: "abcDEF1234", fail: false},
	}
	for _, tc := range cases {
		server, key, err := ParseDeviceInput(tc.in)
		if tc.fail {
			if err == nil {
				t.Errorf("%q: expected error", tc.in)
			}
			continue
		}
		if err != nil || server != tc.server || key != tc.key {
			t.Errorf("%q: got (%q,%q,%v) want (%q,%q)", tc.in, server, key, err, tc.server, tc.key)
		}
	}
}

func TestApplyPersistsAndStatusHidesKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bark.json")
	svc := newService(path)
	status := svc.Status()
	if status.Configured || status.Enabled || status.Types != DefaultTypes() || status.Server != DefaultServer {
		t.Fatalf("unexpected defaults: %+v", status)
	}
	if _, err := svc.Apply(Update{Enabled: boolPtr(true)}); err == nil {
		t.Fatal("enabling without a device must fail")
	}
	status, err := svc.Apply(Update{DeviceKey: strPtr("abcDEF1234567890xyz"), Enabled: boolPtr(true), Types: &TypesPatch{Done: boolPtr(true), Failed: boolPtr(false)}})
	if err != nil {
		t.Fatal(err)
	}
	if !status.Configured || !status.Enabled || status.KeyHint != "…0xyz" || !status.Types.Done || status.Types.Failed || !status.Types.Approval {
		t.Fatalf("unexpected status: %+v", status)
	}
	if encoded, _ := json.Marshal(status); strings.Contains(string(encoded), "abcDEF1234567890xyz") {
		t.Fatalf("status leaks the device key: %s", encoded)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("settings file mode = %v", info.Mode().Perm())
	}
	reloaded := newService(path).Status()
	if reloaded != status {
		t.Fatalf("reload mismatch: %+v vs %+v", reloaded, status)
	}
	cleared, err := svc.Apply(Update{DeviceKey: strPtr("")})
	if err != nil || cleared.Configured || cleared.Enabled {
		t.Fatalf("clearing the device must disable pushes: %+v err=%v", cleared, err)
	}
}

func TestApplyValidatesInputs(t *testing.T) {
	svc := newService(filepath.Join(t.TempDir(), "bark.json"))
	for _, update := range []Update{
		{Server: strPtr("ftp://x")},
		{Server: strPtr("https://u:p@host")},
		{OpenBase: strPtr("javascript:alert(1)")},
		{OpenBase: strPtr("https://relay.example.com/?x=1")},
		{LinkMode: strPtr("other")},
	} {
		if _, err := svc.Apply(update); err == nil {
			t.Errorf("expected error for %+v", update)
		}
	}
	status, err := svc.Apply(Update{OpenBase: strPtr("https://relay.example.com/n/a"), LinkMode: strPtr(LinkModeWeb)})
	if err != nil || !status.HasLink || status.LinkMode != LinkModeWeb {
		t.Fatalf("unexpected: %+v %v", status, err)
	}
}

func TestBrokenSettingsFileFallsBackWithoutOverwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bark.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	svc := newService(path)
	if svc.Status().Configured {
		t.Fatal("broken file must not configure anything")
	}
	if raw, _ := os.ReadFile(path); string(raw) != "{not json" {
		t.Fatal("broken file was overwritten without a save")
	}
}

func TestNotifyFiltersByKindAndSwitch(t *testing.T) {
	cap := &capture{}
	server := httptest.NewServer(cap.handler(200, `{"code":200,"message":"success"}`))
	defer server.Close()
	svc := configured(t, server.URL)

	svc.Notify(context.Background(), Event{Kind: KindDone, EventID: "d1", RootTitle: "p", SessionTitle: "s"})
	svc.Notify(context.Background(), Event{Kind: KindApproval, EventID: "a1", RootID: "root1", RootTitle: "idea-ai-agent", SessionKey: "sess1", SessionTitle: "检查会话恢复", Summary: "Codex 请求授权：commandExecution\n{\"command\":\"go test ./...\"}"})
	svc.Notify(context.Background(), Event{Kind: KindApproval, EventID: "a1", RootTitle: "dup"})
	svc.Notify(context.Background(), Event{Kind: KindFailed, EventID: "f1", RootTitle: "p", SessionTitle: "s", Summary: "exit status 1"})
	requests := cap.wait(t, 2)
	time.Sleep(100 * time.Millisecond)
	requests = cap.wait(t, 2)
	if len(requests) != 2 {
		t.Fatalf("expected approval + failed only, got %d: %v", len(requests), requests)
	}
	var approval, failed map[string]any
	for _, r := range requests {
		if strings.Contains(r["body"].(string), "需要审批") {
			approval = r
		} else {
			failed = r
		}
	}
	if approval == nil || failed == nil {
		t.Fatalf("missing requests: %v", requests)
	}
	if approval["title"] != "idea-ai-agent · 检查会话恢复" || approval["body"] != "需要审批 · Codex 请求授权：commandExecution：go test ./..." {
		t.Fatalf("approval text: %v", approval)
	}
	if approval["markdown"] != "**需要审批** · Codex 请求授权：commandExecution\n\n```\ngo test ./...\n```" {
		t.Fatalf("approval markdown on the wire: %v", approval["markdown"])
	}
	if approval["level"] != "timeSensitive" || approval["group"] != "sess1" || approval["device_key"] != "abcDEF1234567890xyz" {
		t.Fatalf("approval fields: %v", approval)
	}
	link, _ := approval["url"].(string)
	prefix := "localaiagent://open?url="
	if !strings.HasPrefix(link, prefix) {
		t.Fatalf("link = %q", link)
	}
	inner, err := url.QueryUnescape(strings.TrimPrefix(link, prefix))
	if err != nil || inner != "https://relay.example.com/n/node1/?root=root1&session=sess1" {
		t.Fatalf("inner link = %q err=%v", inner, err)
	}
	if failed["level"] != "active" || failed["body"] != "任务失败 · exit status 1" {
		t.Fatalf("failed fields: %v", failed)
	}
	if cap.path != "/push" {
		t.Fatalf("path = %s", cap.path)
	}

	if _, err := svc.Apply(Update{Types: &TypesPatch{Done: boolPtr(true)}}); err != nil {
		t.Fatal(err)
	}
	svc.Notify(context.Background(), Event{Kind: KindDone, EventID: "d2", RootTitle: "p", SessionTitle: "s", Summary: "ok"})
	requests = cap.wait(t, 3)
	if len(requests) != 3 || requests[2]["level"] != "active" {
		t.Fatalf("done push after enabling: %v", requests)
	}

	if _, err := svc.Apply(Update{Enabled: boolPtr(false)}); err != nil {
		t.Fatal(err)
	}
	svc.Notify(context.Background(), Event{Kind: KindFailed, EventID: "f2", RootTitle: "p"})
	time.Sleep(100 * time.Millisecond)
	if got := cap.wait(t, 3); len(got) != 3 {
		t.Fatalf("master switch off must stop pushes, got %d", len(got))
	}
}

func TestWebLinkModeUsesPlainURL(t *testing.T) {
	current := settings{OpenBase: "https://relay.example.com/n/a/p/proj/", LinkMode: LinkModeWeb}
	if got := openLink(current, "r", "s"); got != "https://relay.example.com/n/a/p/proj/?root=r&session=s" {
		t.Fatalf("got %q", got)
	}
	if got := openLink(settings{}, "r", "s"); got != "" {
		t.Fatalf("no base must give no link, got %q", got)
	}
}

func TestSendTestReportsRealFailureWithoutKey(t *testing.T) {
	svc := newService(filepath.Join(t.TempDir(), "bark.json"))
	if err := svc.SendTest(context.Background()); err == nil {
		t.Fatal("unconfigured test must fail")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"code":400,"message":"failed to get device token: abcDEF1234567890xyz"}`))
	}))
	defer server.Close()
	svc = configured(t, server.URL)
	err := svc.SendTest(context.Background())
	if err == nil || !strings.Contains(err.Error(), "400") || strings.Contains(err.Error(), "abcDEF1234567890xyz") {
		t.Fatalf("error = %v", err)
	}
	server.Close()
	err = svc.SendTest(context.Background())
	if err == nil || strings.Contains(err.Error(), "abcDEF1234567890xyz") {
		t.Fatalf("network error = %v", err)
	}
}

func TestSendTestIgnoresSwitches(t *testing.T) {
	cap := &capture{}
	server := httptest.NewServer(cap.handler(200, `{"code":200}`))
	defer server.Close()
	svc := configured(t, server.URL)
	if _, err := svc.Apply(Update{Enabled: boolPtr(false)}); err != nil {
		t.Fatal(err)
	}
	if err := svc.SendTest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := cap.wait(t, 1); len(got) != 1 || got[0]["title"] != "测试通知" {
		t.Fatalf("got %v", got)
	}
}

func TestBuildMessageTruncatesAndFallsBack(t *testing.T) {
	long := strings.Repeat("字", 400)
	msg := buildMessage(settings{}, Event{Kind: KindAskUser, RootTitle: long, Summary: "a\n b   c"})
	if len([]rune(msg.Title)) > maxTitleRunes || len([]rune(msg.Body)) > maxBodyRunes {
		t.Fatalf("not truncated: %d %d", len([]rune(msg.Title)), len([]rune(msg.Body)))
	}
	if !strings.HasPrefix(msg.Body, "需要回答 · a b c") {
		t.Fatalf("body = %q", msg.Body)
	}
	empty := buildMessage(settings{}, Event{Kind: KindDone})
	if empty.Title != "Local AI Agent" || empty.Body != "任务完成" {
		t.Fatalf("empty = %+v", empty)
	}
}

func TestApprovalSummaryShowsWhatIsAskedForInOneShortLine(t *testing.T) {
	long := strings.Repeat("x", 300)
	cases := []struct{ name, raw, want string }{
		{"claude bash", "Claude Code 请求执行 Bash：\n{\"command\":\"go test ./...\",\"description\":\"run tests\"}", "Claude Code 请求执行 Bash：go test ./..."},
		{"codex command", "Codex 请求授权：commandExecution\n{\"command\":\"git push origin main\",\"cwd\":\"/tmp\"}", "Codex 请求授权：commandExecution：git push origin main"},
		{"command array", "Codex 请求授权：commandExecution\n{\"command\":[\"rm\",\"-rf\",\"build\"]}", "Codex 请求授权：commandExecution：rm -rf build"},
		{"multi-line command keeps its first line", "Claude Code 请求执行 Bash：\n{\"command\":\"cat <<EOF\\nsecret\\nEOF\"}", "Claude Code 请求执行 Bash：cat <<EOF"},
		{"file edit", "Claude Code 请求执行 Edit：\n{\"file_path\":\"/repo/main.go\",\"old_string\":\"a\",\"new_string\":\"b\"}", "Claude Code 请求执行 Edit：/repo/main.go"},
		{"codex file change", "Codex 请求授权：fileChange\n{\"reason\":\"update docs\",\"grantRoot\":\"/repo\"}", "Codex 请求授权：fileChange：update docs"},
		{"no preview keys", "Claude Code 请求执行 Foo：\n{\"x\":1}", "Claude Code 请求执行 Foo"},
		{"not json", "Codex 请求授权：commandExecution\nplain text params", "Codex 请求授权：commandExecution"},
		{"head only", "需要你确认", "需要你确认"},
	}
	for _, tc := range cases {
		if got := approvalSummary(tc.raw); got != tc.want {
			t.Errorf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}
	got := approvalSummary("Claude Code 请求执行 Bash：\n{\"command\":\"" + long + "\"}")
	if n := len([]rune(strings.TrimPrefix(got, "Claude Code 请求执行 Bash："))); n > maxPreviewRunes {
		t.Errorf("preview is %d runes, limit %d", n, maxPreviewRunes)
	}
}

func TestCompletionEndsOnTheConclusionNotAMiddleFragment(t *testing.T) {
	answer := "第一段：我先检查了文件。\n\n中间过程很长很长。\n\n结论：回归测试全部通过，可以合并。\n"
	if got := summarize(KindDone, answer); got != "结论：回归测试全部通过，可以合并。" {
		t.Fatalf("got %q", got)
	}
	if got := summarize(KindDone, "  \n \n"); got != "" {
		t.Fatalf("blank answer: %q", got)
	}
	if got := summarize(KindFailed, "exit status 1\nsecond line"); got != "exit status 1 second line" {
		t.Fatalf("a failure keeps its beginning: %q", got)
	}
}

func TestLockScreenTextHasNoMarkdownMarks(t *testing.T) {
	answer := "## 结果\n\n我确认了服务 (进程 37897) 用的配置目录是 `~/Library/Application Support/mindfs/`，**没有** `bark.json`，见 [说明](https://example.com/x)。\n\n```\ncode line\n```\n"
	if got := summarize(KindAskUser, answer); got != "结果 我确认了服务 (进程 37897) 用的配置目录是 ~/Library/Application Support/mindfs/，没有 bark.json，见 说明。 code line" {
		t.Fatalf("question text: %q", got)
	}
	cases := []struct{ raw, want string }{
		{"前面的话\n- **结论**：全部通过，见 [报告](https://example.com)\n", "结论：全部通过，见 报告"},
		{"前面的话\n结论：改了 `main.go`\n```\n```\n", "结论：改了 main.go"},
		{"1. 第一步\n2. 最后一步", "最后一步"},
		{"> 引用的结论", "引用的结论"},
	}
	for _, tc := range cases {
		if got := summarize(KindDone, tc.raw); got != tc.want {
			t.Errorf("done %q: got %q want %q", tc.raw, got, tc.want)
		}
	}
	// A command in an approval keeps its characters: they are what is being approved.
	if got := approvalSummary("Claude Code 请求执行 Bash：\n{\"command\":\"echo `date` | tee **/x\"}"); got != "Claude Code 请求执行 Bash：echo `date` | tee **/x" {
		t.Fatalf("approval command must not be altered: %q", got)
	}
}

func TestApprovalIsSentAsMarkdownWithAPlainFallback(t *testing.T) {
	raw := "Claude Code 请求执行 Bash：\n{\"command\":\"go test ./... -count=1\"}"
	msg := buildMessage(settings{}, Event{Kind: KindApproval, RootTitle: "p", SessionTitle: "s", Summary: raw})
	if msg.Markdown != "**需要审批** · Claude Code 请求执行 Bash\n\n```\ngo test ./... -count=1\n```" {
		t.Fatalf("markdown = %q", msg.Markdown)
	}
	if msg.Body != "需要审批 · Claude Code 请求执行 Bash：go test ./... -count=1" {
		t.Fatalf("the plain body is the fallback for older Bark versions: %q", msg.Body)
	}

	// Without a preview there is nothing to put in a block.
	if got := approvalMarkdown("需要你确认"); got != "**需要审批** · 需要你确认" {
		t.Fatalf("head only: %q", got)
	}

	// A command that itself contains backticks must not close the block early.
	tricky := approvalMarkdown("Claude Code 请求执行 Bash：\n{\"command\":\"echo ```x``` done\"}")
	if !strings.Contains(tricky, "````\necho ```x``` done\n````") {
		t.Fatalf("fence must be longer than any backtick run inside: %q", tricky)
	}

	// Tool names with emphasis marks would be misread, so those go as plain text only.
	for _, head := range []string{"Claude Code 请求执行 mcp__server__tool：", "Claude Code 请求执行 a*b：", "请求 [x]"} {
		if got := approvalMarkdown(head + "\n{\"command\":\"ls\"}"); got != "" {
			t.Errorf("%q must not be sent as Markdown, got %q", head, got)
		}
	}

	// Only approvals use it; everything else stays plain.
	for _, kind := range []Kind{KindAskUser, KindFailed, KindDone} {
		if m := buildMessage(settings{}, Event{Kind: kind, Summary: "x"}); m.Markdown != "" {
			t.Errorf("%s: unexpected markdown %q", kind, m.Markdown)
		}
	}
}

func TestEveryEnabledKindLightsTheScreenWithABanner(t *testing.T) {
	want := map[Kind]string{KindApproval: "timeSensitive", KindAskUser: "timeSensitive", KindFailed: "active", KindDone: "active"}
	for kind, level := range want {
		got := buildMessage(settings{}, Event{Kind: kind, Summary: "x"}).Level
		if got != level {
			t.Errorf("%s: level %q, want %q", kind, got, level)
		}
		if got == "passive" {
			t.Errorf("%s: a passive notification has no banner", kind)
		}
	}
	if level := (barkMessage{}).Level; level != "" {
		t.Errorf("an unset level must be omitted so Bark's default (active) applies, got %q", level)
	}
}
