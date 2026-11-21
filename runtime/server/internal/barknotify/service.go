// Package barknotify delivers the few notifications that matter on a phone
// lock screen (approval needed, question asked, final failure, optionally
// completion) through the Bark app's HTTP API. Settings live on the node, so
// every client (App, phone web, desktop web) shows and edits the same ones.
package barknotify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"mindfs/server/internal/config"
)

const (
	fileName           = "bark.json"
	DefaultServer      = "https://api.day.app"
	sendTimeout        = 10 * time.Second
	maxConcurrentSends = 4
	recentEventHorizon = 30 * time.Minute
	maxTitleRunes      = 80
	maxBodyRunes       = 120
	maxBaseURLLength   = 512
	maxCapturedBody    = 2048

	// LinkModeApp opens the session through the iOS App's URL scheme,
	// LinkModeWeb opens the plain https page (Safari / home-screen web app).
	LinkModeApp = "app"
	LinkModeWeb = "web"
	appScheme   = "localaiagent"
)

// Kind is the category of a notification as the user sees it in settings.
type Kind string

const (
	KindApproval Kind = "approval"
	KindAskUser  Kind = "ask_user"
	KindFailed   Kind = "failed"
	KindDone     Kind = "done"
)

// Types selects which kinds are pushed automatically.
type Types struct {
	Approval bool `json:"approval"`
	AskUser  bool `json:"ask_user"`
	Failed   bool `json:"failed"`
	Done     bool `json:"done"`
}

// DefaultTypes keeps the lock screen quiet: only things that need the user.
func DefaultTypes() Types {
	return Types{Approval: true, AskUser: true, Failed: true, Done: false}
}

func (t Types) allows(kind Kind) bool {
	switch kind {
	case KindApproval:
		return t.Approval
	case KindAskUser:
		return t.AskUser
	case KindFailed:
		return t.Failed
	case KindDone:
		return t.Done
	}
	return false
}

type settings struct {
	Enabled   bool   `json:"enabled"`
	Server    string `json:"server,omitempty"`
	DeviceKey string `json:"device_key,omitempty"`
	Types     Types  `json:"types"`
	OpenBase  string `json:"open_base,omitempty"`
	LinkMode  string `json:"link_mode,omitempty"`
}

// Status is what clients may read. The device key never leaves the node.
type Status struct {
	Configured bool   `json:"configured"`
	KeyHint    string `json:"key_hint,omitempty"`
	Server     string `json:"server"`
	Enabled    bool   `json:"enabled"`
	Types      Types  `json:"types"`
	LinkMode   string `json:"link_mode"`
	HasLink    bool   `json:"has_link"`
}

// TypesPatch updates only the provided kinds.
type TypesPatch struct {
	Approval *bool `json:"approval"`
	AskUser  *bool `json:"ask_user"`
	Failed   *bool `json:"failed"`
	Done     *bool `json:"done"`
}

// Update is a partial settings change; nil fields stay as they are.
// DeviceKey accepts a bare key or the URL the Bark app shows; an empty
// string removes the device.
type Update struct {
	Enabled   *bool       `json:"enabled"`
	DeviceKey *string     `json:"device_key"`
	Server    *string     `json:"server"`
	Types     *TypesPatch `json:"types"`
	OpenBase  *string     `json:"open_base"`
	LinkMode  *string     `json:"link_mode"`
}

// Event is one candidate notification.
type Event struct {
	Kind         Kind
	EventID      string
	RootID       string
	RootTitle    string
	SessionKey   string
	SessionTitle string
	Summary      string
}

type Service struct {
	path   string
	client *http.Client
	sem    chan struct{}

	mu       sync.RWMutex
	settings settings

	recentMu sync.Mutex
	recent   map[string]time.Time
}

// NewService loads settings from the MindFS config directory. A broken file
// is reported and replaced by defaults in memory only; it is not overwritten
// until the user saves new settings.
func NewService() (*Service, error) {
	dir, err := config.MindFSConfigDir()
	if err != nil {
		return nil, err
	}
	return newService(filepath.Join(dir, fileName)), nil
}

// NewServiceAt keeps the settings in an explicit file (used by tests and tools).
func NewServiceAt(path string) *Service { return newService(path) }

func newService(path string) *Service {
	s := &Service{
		path:   path,
		client: &http.Client{Timeout: sendTimeout},
		sem:    make(chan struct{}, maxConcurrentSends),
		recent: make(map[string]time.Time),
	}
	s.settings = settings{Server: DefaultServer, Types: DefaultTypes(), LinkMode: LinkModeApp}
	if loaded, err := readSettings(path); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("[bark] settings.read.error err=%v", err)
		}
	} else {
		s.settings = loaded
	}
	return s
}

func readSettings(path string) (settings, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return settings{}, err
	}
	loaded := settings{Types: DefaultTypes()}
	if err := json.Unmarshal(raw, &loaded); err != nil {
		return settings{}, err
	}
	if loaded.Server == "" {
		loaded.Server = DefaultServer
	}
	if loaded.LinkMode == "" {
		loaded.LinkMode = LinkModeApp
	}
	return loaded, nil
}

func writeSettings(path string, value settings) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(path)
		if retryErr := os.Rename(tmp, path); retryErr != nil {
			_ = os.Remove(tmp)
			return err
		}
	}
	return nil
}

func (s *Service) Status() Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return statusOf(s.settings)
}

func statusOf(v settings) Status {
	hint := ""
	if len(v.DeviceKey) > 4 {
		hint = "…" + v.DeviceKey[len(v.DeviceKey)-4:]
	} else if v.DeviceKey != "" {
		hint = "…"
	}
	return Status{
		Configured: v.DeviceKey != "",
		KeyHint:    hint,
		Server:     v.Server,
		Enabled:    v.Enabled,
		Types:      v.Types,
		LinkMode:   v.LinkMode,
		HasLink:    v.OpenBase != "",
	}
}

var deviceKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{6,128}$`)

// ParseDeviceInput accepts either a bare Bark key or the https URL shown in
// the Bark app (https://api.day.app/<key>[/...]) and returns server and key.
// The server is empty when a bare key was given.
func ParseDeviceInput(input string) (server, key string, err error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return "", "", nil
	}
	if strings.Contains(input, "://") {
		parsed, parseErr := url.Parse(input)
		if parseErr != nil {
			return "", "", errors.New("Bark 地址格式不正确")
		}
		normalized, err := normalizeServer(parsed.Scheme + "://" + parsed.Host)
		if err != nil {
			return "", "", err
		}
		for _, segment := range strings.Split(parsed.Path, "/") {
			if segment == "" {
				continue
			}
			if !deviceKeyPattern.MatchString(segment) {
				return "", "", errors.New("Bark 设备 Key 格式不正确")
			}
			return normalized, segment, nil
		}
		return "", "", errors.New("Bark 地址里没有设备 Key")
	}
	if !deviceKeyPattern.MatchString(input) {
		return "", "", errors.New("Bark 设备 Key 格式不正确")
	}
	return "", input, nil
}

func normalizeServer(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return "", errors.New("Bark 服务器地址必须是 http 或 https 地址")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("Bark 服务器地址不能包含账号、查询或片段")
	}
	return parsed.Scheme + "://" + parsed.Host + strings.TrimRight(parsed.Path, "/"), nil
}

func normalizeOpenBase(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	if len(raw) > maxBaseURLLength {
		return "", errors.New("跳转地址过长")
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return "", errors.New("跳转地址必须是 http 或 https 地址")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("跳转地址不能包含账号、查询或片段")
	}
	path := parsed.EscapedPath()
	if !strings.HasSuffix(path, "/") {
		path += "/"
	}
	return parsed.Scheme + "://" + parsed.Host + path, nil
}

// Apply validates and persists a partial change, then returns the new status.
func (s *Service) Apply(update Update) (Status, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.settings
	if update.DeviceKey != nil {
		server, key, err := ParseDeviceInput(*update.DeviceKey)
		if err != nil {
			return Status{}, err
		}
		next.DeviceKey = key
		if server != "" {
			next.Server = server
		}
		if key == "" {
			next.Enabled = false
		}
	}
	if update.Server != nil {
		server := strings.TrimSpace(*update.Server)
		if server == "" {
			next.Server = DefaultServer
		} else {
			normalized, err := normalizeServer(server)
			if err != nil {
				return Status{}, err
			}
			next.Server = normalized
		}
	}
	if update.Enabled != nil {
		if *update.Enabled && next.DeviceKey == "" {
			return Status{}, errors.New("请先设置 Bark 设备")
		}
		next.Enabled = *update.Enabled
	}
	if patch := update.Types; patch != nil {
		if patch.Approval != nil {
			next.Types.Approval = *patch.Approval
		}
		if patch.AskUser != nil {
			next.Types.AskUser = *patch.AskUser
		}
		if patch.Failed != nil {
			next.Types.Failed = *patch.Failed
		}
		if patch.Done != nil {
			next.Types.Done = *patch.Done
		}
	}
	if update.OpenBase != nil {
		base, err := normalizeOpenBase(*update.OpenBase)
		if err != nil {
			return Status{}, err
		}
		next.OpenBase = base
	}
	if update.LinkMode != nil {
		mode := strings.TrimSpace(*update.LinkMode)
		if mode != LinkModeApp && mode != LinkModeWeb {
			return Status{}, errors.New("链接方式只能是 app 或 web")
		}
		next.LinkMode = mode
	}
	if err := writeSettings(s.path, next); err != nil {
		return Status{}, fmt.Errorf("保存 Bark 设置失败: %w", err)
	}
	s.settings = next
	return statusOf(next), nil
}

// Notify filters by switch and kind, drops repeats of the same event and
// sends in the background so a slow Bark server never delays a session.
func (s *Service) Notify(ctx context.Context, event Event) {
	if s == nil {
		return
	}
	s.mu.RLock()
	current := s.settings
	s.mu.RUnlock()
	if !current.Enabled || current.DeviceKey == "" || !current.Types.allows(event.Kind) {
		return
	}
	if !s.firstSight(string(event.Kind) + "|" + strings.TrimSpace(event.EventID)) {
		return
	}
	message := buildMessage(current, event)
	go func() {
		if err := s.deliver(context.WithoutCancel(ctx), current, message); err != nil {
			log.Printf("[bark] send.error kind=%s err=%v", event.Kind, err)
		}
	}()
}

// SendTest pushes one message regardless of the switches so the user can
// check the whole path. It returns the real failure reason.
func (s *Service) SendTest(ctx context.Context) error {
	s.mu.RLock()
	current := s.settings
	s.mu.RUnlock()
	if current.DeviceKey == "" {
		return errors.New("请先设置 Bark 设备")
	}
	message := barkMessage{
		Title: "测试通知",
		Body:  "Bark 已连接",
		Group: "local-ai-agent",
		Level: "active",
		URL:   openLink(current, "", ""),
	}
	return s.deliver(ctx, current, message)
}

func (s *Service) firstSight(key string) bool {
	if strings.HasSuffix(key, "|") {
		return true
	}
	now := time.Now()
	s.recentMu.Lock()
	defer s.recentMu.Unlock()
	for k, seen := range s.recent {
		if now.Sub(seen) > recentEventHorizon {
			delete(s.recent, k)
		}
	}
	if _, ok := s.recent[key]; ok {
		return false
	}
	s.recent[key] = now
	return true
}

type barkMessage struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	// Markdown replaces Body in Bark versions that know it (the banner shows it as plain text
	// with its line breaks); older versions keep showing Body.
	Markdown string `json:"markdown,omitempty"`
	Group    string `json:"group,omitempty"`
	Level    string `json:"level,omitempty"`
	URL      string `json:"url,omitempty"`
}

var statusLabels = map[Kind]string{
	KindApproval: "需要审批",
	KindAskUser:  "需要回答",
	KindFailed:   "任务失败",
	KindDone:     "任务完成",
}

// interruptionLevel decides how loudly iOS delivers a kind. Every kind a person switched on must
// light the screen with a banner: Bark's "passive" level only files the message in the
// notification list, with no banner, so it is never used. What needs the person now may also break
// through a Focus.
func interruptionLevel(kind Kind) string {
	switch kind {
	case KindApproval, KindAskUser:
		return "timeSensitive"
	default:
		return "active"
	}
}

func buildMessage(current settings, event Event) barkMessage {
	root := firstNonBlank(event.RootTitle, event.RootID, "Local AI Agent")
	session := strings.TrimSpace(event.SessionTitle)
	title := root
	if session != "" {
		title = root + " · " + session
	}
	summary := summarize(event.Kind, event.Summary)
	body := statusLabels[event.Kind]
	if summary != "" {
		body += " · " + summary
	}
	markdown := ""
	if event.Kind == KindApproval {
		markdown = approvalMarkdown(strings.TrimSpace(event.Summary))
	}
	level := interruptionLevel(event.Kind)
	group := firstNonBlank(event.SessionKey, event.RootID, "local-ai-agent")
	return barkMessage{
		Title:    truncateRunes(title, maxTitleRunes),
		Body:     truncateRunes(body, maxBodyRunes),
		Markdown: markdown,
		Group:    group,
		Level:    level,
		URL:      openLink(current, event.RootID, event.SessionKey),
	}
}

// maxPreviewRunes keeps the part of a request that goes to the lock screen to one short line.
const maxPreviewRunes = 80

// summarize turns what the session produced into the one line a lock screen can use:
// an approval says what is being asked for, a completion ends on the conclusion (the last
// line of the final answer), anything else keeps its beginning.
func summarize(kind Kind, raw string) string {
	raw = strings.TrimSpace(raw)
	switch kind {
	case KindApproval:
		return approvalSummary(raw)
	case KindDone:
		return lastLine(raw)
	default:
		return plain(raw)
	}
}

var (
	markdownLink  = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)
	markdownBlock = regexp.MustCompile(`^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)`)
	markdownMarks = strings.NewReplacer("**", "", "__", "", "`", "")
)

// plainLine removes the Markdown an Agent writes its answers in, which a lock screen shows
// literally: backticks, bold marks, heading, quote and list markers, and link targets.
func plainLine(line string) string {
	line = markdownBlock.ReplaceAllString(line, "")
	line = markdownLink.ReplaceAllString(line, "$1")
	return strings.TrimSpace(markdownMarks.Replace(line))
}

func isCodeFence(line string) bool { return strings.HasPrefix(strings.TrimSpace(line), "```") }

// plain is the whole text as one line without Markdown marks.
func plain(raw string) string {
	var parts []string
	for _, line := range strings.Split(raw, "\n") {
		if isCodeFence(line) {
			continue
		}
		if text := plainLine(line); text != "" {
			parts = append(parts, text)
		}
	}
	return oneLine(strings.Join(parts, " "))
}

// approvalSummary is the single line form of an approval: who asks, then what for.
func approvalSummary(raw string) string {
	head, preview := approvalParts(raw)
	if preview == "" {
		return head
	}
	return head + "：" + preview
}

// approvalParts reads "<who asks for what>:\n<json arguments>" and returns the first line plus a
// short preview of the one argument that says what will happen, so the person can tell what they
// are asked to allow. The full request stays in the session.
func approvalParts(raw string) (head, preview string) {
	first, rest, found := strings.Cut(raw, "\n")
	head = strings.TrimRight(oneLine(first), "：:")
	if !found {
		return head, ""
	}
	return head, requestPreview(rest)
}

// approvalMarkdown lays an approval out on separate lines, the command in a code block, for Bark
// versions that read Markdown. It returns "" when the text could be misread as Markdown (a tool
// name such as mcp__server__tool contains emphasis marks), and the plain body is used instead.
func approvalMarkdown(raw string) string {
	head, preview := approvalParts(raw)
	if head == "" || strings.ContainsAny(head, "*_`[]<>#\\~|") {
		return ""
	}
	text := "**" + statusLabels[KindApproval] + "** · " + head
	if preview != "" {
		text += "\n\n" + fenced(preview)
	}
	return text
}

// fenced puts text in a code block whose fence is longer than any run of backticks inside it.
func fenced(text string) string {
	longest, run := 0, 0
	for _, r := range text {
		if r == '`' {
			run++
			if run > longest {
				longest = run
			}
		} else {
			run = 0
		}
	}
	fence := strings.Repeat("`", max(3, longest+1))
	return fence + "\n" + text + "\n" + fence
}

// previewKeys are the arguments worth showing, most telling first.
var previewKeys = []string{"command", "cmd", "file_path", "filePath", "notebook_path", "path", "url", "pattern", "query", "reason", "description", "grantRoot"}

func requestPreview(arguments string) string {
	var fields map[string]any
	if json.Unmarshal([]byte(strings.TrimSpace(arguments)), &fields) != nil {
		return ""
	}
	for _, key := range previewKeys {
		if text := previewText(fields[key]); text != "" {
			// A multi-line command is shown by its first line only.
			first, _, _ := strings.Cut(strings.TrimSpace(text), "\n")
			return truncateRunes(oneLine(first), maxPreviewRunes)
		}
	}
	return ""
}

func previewText(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, " ")
	}
	return ""
}

func lastLine(raw string) string {
	lines := strings.Split(raw, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if isCodeFence(lines[i]) {
			continue
		}
		if text := oneLine(plainLine(lines[i])); text != "" {
			return text
		}
	}
	return ""
}

func openLink(current settings, rootID, sessionKey string) string {
	if current.OpenBase == "" {
		return ""
	}
	target := current.OpenBase
	params := url.Values{}
	if strings.TrimSpace(rootID) != "" {
		params.Set("root", rootID)
	}
	if strings.TrimSpace(sessionKey) != "" {
		params.Set("session", sessionKey)
	}
	if encoded := params.Encode(); encoded != "" {
		target += "?" + encoded
	}
	if current.LinkMode == LinkModeWeb {
		return target
	}
	return appScheme + "://open?url=" + url.QueryEscape(target)
}

func (s *Service) deliver(ctx context.Context, current settings, message barkMessage) error {
	select {
	case s.sem <- struct{}{}:
		defer func() { <-s.sem }()
	case <-ctx.Done():
		return ctx.Err()
	}
	payload := struct {
		barkMessage
		DeviceKey string `json:"device_key"`
		IsArchive string `json:"isArchive"`
	}{message, current.DeviceKey, "1"}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, sendTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(current.Server, "/")+"/push", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("无法连接 Bark 服务器: %w", scrubKey(err, current.DeviceKey))
	}
	defer response.Body.Close()
	captured, _ := io.ReadAll(io.LimitReader(response.Body, maxCapturedBody))
	var reply struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(captured, &reply)
	if response.StatusCode >= 300 || (reply.Code != 0 && reply.Code != 200) {
		reason := firstNonBlank(reply.Message, strings.TrimSpace(string(captured)), response.Status)
		return fmt.Errorf("Bark 返回错误 (%d): %s", response.StatusCode, truncateRunes(strings.ReplaceAll(reason, current.DeviceKey, "…"), 200))
	}
	return nil
}

func scrubKey(err error, key string) error {
	if key == "" {
		return err
	}
	return errors.New(strings.ReplaceAll(err.Error(), key, "…"))
}

func oneLine(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func truncateRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit-1]) + "…"
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
