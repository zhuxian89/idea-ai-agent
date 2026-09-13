package claude

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
)

const displayFixtureNotification = "<task-notification>Background command completed (id: bg-1)</task-notification>"

func newDisplayTestImporter(t *testing.T) (*Importer, string) {
	t.Helper()
	home := t.TempDir()
	rootPath := filepath.Join(home, "work")
	if err := os.MkdirAll(rootPath, 0o755); err != nil {
		t.Fatal(err)
	}
	// The importer is built directly so the fixture stays inside t.TempDir()
	// and never touches the real ~/.claude directory.
	importer := &Importer{
		agentName: "claude",
		baseDir:   filepath.Join(home, "claude-projects"),
		index:     make(map[string]claudeSessionFile),
	}
	return importer, rootPath
}

func writeClaudeDisplayFixture(t *testing.T, importer *Importer, rootPath, sessionID string, lines ...map[string]any) string {
	t.Helper()
	dir := filepath.Join(importer.baseDir, claudeProjectDirName(rootPath))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	var builder strings.Builder
	for _, line := range lines {
		data, err := json.Marshal(line)
		if err != nil {
			t.Fatal(err)
		}
		builder.Write(data)
		builder.WriteByte('\n')
	}
	path := filepath.Join(dir, sessionID+".jsonl")
	if err := os.WriteFile(path, []byte(builder.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func claudeDisplayUserLine(sessionID, cwd, uuid, timestamp, text string, origin map[string]any) map[string]any {
	line := map[string]any{
		"type":      "user",
		"sessionId": sessionID,
		"cwd":       cwd,
		"uuid":      uuid,
		"timestamp": timestamp,
		"message": map[string]any{
			"role":    "user",
			"content": text,
		},
	}
	if origin != nil {
		line["origin"] = origin
	}
	return line
}

func claudeDisplayAssistantLine(sessionID, cwd, uuid, timestamp, text string) map[string]any {
	return map[string]any{
		"type":      "assistant",
		"sessionId": sessionID,
		"cwd":       cwd,
		"uuid":      uuid,
		"timestamp": timestamp,
		"message": map[string]any{
			"role": "assistant",
			"content": []any{
				map[string]any{"type": "text", "text": text},
			},
		},
	}
}

func mustReadFixtureBytes(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// TestClaudeCanonicalExchangesKeepTaskNotifications pins the canonical import
// contract: native task notifications stay in the exchange list with their
// original role, merged content, and timestamp, and the JSONL file is left
// untouched. Full syncs, fork resolution, and AgentCtxSeq slicing depend on
// this never changing.
func TestClaudeCanonicalExchangesKeepTaskNotifications(t *testing.T) {
	importer, rootPath := newDisplayTestImporter(t)
	cwd := normalizeComparablePath(rootPath)
	path := writeClaudeDisplayFixture(t, importer, rootPath, "sess-canonical",
		claudeDisplayUserLine("sess-canonical", cwd, "u1", "2026-01-02T03:04:05Z", "please review", nil),
		claudeDisplayAssistantLine("sess-canonical", cwd, "a1", "2026-01-02T03:04:06Z", "done"),
		claudeDisplayUserLine("sess-canonical", cwd, "u2", "2026-01-02T03:04:07Z", displayFixtureNotification, map[string]any{"kind": "task-notification"}),
	)
	before := mustReadFixtureBytes(t, path)
	exchanges, err := readClaudeImportedExchanges(path, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if len(exchanges) != 3 {
		t.Fatalf("len(exchanges) = %d, want 3", len(exchanges))
	}
	wantRoles := []string{"user", "agent", "user"}
	wantContents := []string{"please review", "done", displayFixtureNotification}
	wantTimes := []string{"2026-01-02T03:04:05Z", "2026-01-02T03:04:06Z", "2026-01-02T03:04:07Z"}
	for i := range exchanges {
		if exchanges[i].Role != wantRoles[i] {
			t.Fatalf("exchanges[%d].Role = %q, want %q", i, exchanges[i].Role, wantRoles[i])
		}
		if exchanges[i].Content != wantContents[i] {
			t.Fatalf("exchanges[%d].Content = %q, want %q", i, exchanges[i].Content, wantContents[i])
		}
		if !exchanges[i].Timestamp.Equal(parseTimeRFC3339(wantTimes[i])) {
			t.Fatalf("exchanges[%d].Timestamp = %v, want %v", i, exchanges[i].Timestamp, parseTimeRFC3339(wantTimes[i]))
		}
	}
	after := mustReadFixtureBytes(t, path)
	if !bytes.Equal(before, after) {
		t.Fatal("native JSONL file was modified by the import read")
	}
}

// TestProjectExternalSessionDisplayHidesPureNotification verifies the display
// projection for a pure task-notification exchange: the snapshot keeps the
// original content and timestamp as the match key while Display collapses to
// empty (hidden bubble). Resolution goes through the regular lookup/scan path
// because the importer index starts empty.
func TestProjectExternalSessionDisplayHidesPureNotification(t *testing.T) {
	importer, rootPath := newDisplayTestImporter(t)
	cwd := normalizeComparablePath(rootPath)
	writeClaudeDisplayFixture(t, importer, rootPath, "sess-pure",
		claudeDisplayUserLine("sess-pure", cwd, "u1", "2026-01-02T03:04:05Z", "please review", nil),
		claudeDisplayAssistantLine("sess-pure", cwd, "a1", "2026-01-02T03:04:06Z", "done"),
		claudeDisplayUserLine("sess-pure", cwd, "u2", "2026-01-02T03:04:07Z", displayFixtureNotification, map[string]any{"kind": "task-notification"}),
	)
	projection, err := importer.ProjectExternalSessionDisplay(context.Background(), agenttypes.ImportExternalSessionInput{
		RootPath:       rootPath,
		Agent:          "claude",
		AgentSessionID: "sess-pure",
	})
	if err != nil {
		t.Fatal(err)
	}
	if projection.AgentSessionID != "sess-pure" {
		t.Fatalf("AgentSessionID = %q", projection.AgentSessionID)
	}
	if len(projection.Users) != 2 {
		t.Fatalf("len(Users) = %d, want 2 (indexes 0 and 2)", len(projection.Users))
	}
	realSnapshots := projection.Users[0]
	if len(realSnapshots) != 1 || realSnapshots[0].Display != "please review" || realSnapshots[0].Content != "please review" {
		t.Fatalf("real user snapshots = %#v", realSnapshots)
	}
	if !realSnapshots[0].Timestamp.Equal(parseTimeRFC3339("2026-01-02T03:04:05Z")) {
		t.Fatalf("real user timestamp = %v", realSnapshots[0].Timestamp)
	}
	notificationSnapshots := projection.Users[2]
	if len(notificationSnapshots) != 1 {
		t.Fatalf("notification snapshots = %#v", notificationSnapshots)
	}
	snapshot := notificationSnapshots[0]
	if snapshot.Content != displayFixtureNotification {
		t.Fatalf("snapshot.Content = %q, want the original notification text", snapshot.Content)
	}
	if snapshot.Display != "" {
		t.Fatalf("snapshot.Display = %q, want empty (hidden)", snapshot.Display)
	}
	if !snapshot.Timestamp.Equal(parseTimeRFC3339("2026-01-02T03:04:07Z")) {
		t.Fatalf("snapshot.Timestamp = %v", snapshot.Timestamp)
	}
}

// TestProjectExternalSessionDisplayMixedMergeAndPrefixSnapshots covers a real
// user message merged with a consecutive notification line. The canonical
// exchange must stay a single merged user entry, and the projection must
// record both intermediate states: the prefix the file had before the
// notification arrived (what older client caches persisted) and the merged
// state with only the notification body stripped.
func TestProjectExternalSessionDisplayMixedMergeAndPrefixSnapshots(t *testing.T) {
	importer, rootPath := newDisplayTestImporter(t)
	cwd := normalizeComparablePath(rootPath)
	path := writeClaudeDisplayFixture(t, importer, rootPath, "sess-mixed",
		claudeDisplayUserLine("sess-mixed", cwd, "u1", "2026-01-02T03:04:05Z", "please review", nil),
		claudeDisplayUserLine("sess-mixed", cwd, "u2", "2026-01-02T03:04:07Z", displayFixtureNotification, map[string]any{"kind": "task-notification"}),
	)
	exchanges, err := readClaudeImportedExchanges(path, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if len(exchanges) != 1 || exchanges[0].Role != "user" {
		t.Fatalf("canonical exchanges = %#v, want one merged user exchange", exchanges)
	}
	if exchanges[0].Content != "please review\n\n"+displayFixtureNotification {
		t.Fatalf("merged content = %q", exchanges[0].Content)
	}
	projection, err := importer.ProjectExternalSessionDisplay(context.Background(), agenttypes.ImportExternalSessionInput{
		RootPath:       rootPath,
		Agent:          "claude",
		AgentSessionID: "sess-mixed",
	})
	if err != nil {
		t.Fatal(err)
	}
	snapshots := projection.Users[0]
	if len(snapshots) != 2 {
		t.Fatalf("snapshots = %#v, want 2 intermediate states", snapshots)
	}
	if snapshots[0].Content != "please review" || snapshots[0].Display != "please review" {
		t.Fatalf("prefix snapshot = %#v", snapshots[0])
	}
	if !snapshots[0].Timestamp.Equal(parseTimeRFC3339("2026-01-02T03:04:05Z")) {
		t.Fatalf("prefix snapshot timestamp = %v", snapshots[0].Timestamp)
	}
	if snapshots[1].Content != "please review\n\n"+displayFixtureNotification {
		t.Fatalf("merged snapshot content = %q", snapshots[1].Content)
	}
	if snapshots[1].Display != "please review" {
		t.Fatalf("merged snapshot display = %q, want the real body only", snapshots[1].Display)
	}
	if !snapshots[1].Timestamp.Equal(parseTimeRFC3339("2026-01-02T03:04:07Z")) {
		t.Fatalf("merged snapshot timestamp = %v", snapshots[1].Timestamp)
	}
}

// TestProjectExternalSessionDisplayKeepsUnprovenOrigins verifies that only the
// explicit task-notification origin is trusted: identical text without an
// origin (a real user quoting the same XML) and unknown origin kinds both stay
// visible.
func TestProjectExternalSessionDisplayKeepsUnprovenOrigins(t *testing.T) {
	importer, rootPath := newDisplayTestImporter(t)
	cwd := normalizeComparablePath(rootPath)
	writeClaudeDisplayFixture(t, importer, rootPath, "sess-origins",
		claudeDisplayUserLine("sess-origins", cwd, "u1", "2026-01-02T03:04:05Z", displayFixtureNotification, nil),
		claudeDisplayUserLine("sess-origins", cwd, "u2", "2026-01-02T03:04:06Z", displayFixtureNotification, map[string]any{"kind": "background-retry"}),
	)
	projection, err := importer.ProjectExternalSessionDisplay(context.Background(), agenttypes.ImportExternalSessionInput{
		RootPath:       rootPath,
		Agent:          "claude",
		AgentSessionID: "sess-origins",
	})
	if err != nil {
		t.Fatal(err)
	}
	snapshots := projection.Users[0]
	if len(snapshots) != 2 {
		t.Fatalf("snapshots = %#v, want 2", snapshots)
	}
	for i, snapshot := range snapshots {
		if snapshot.Display != snapshot.Content || snapshot.Display == "" {
			t.Fatalf("snapshots[%d] = %#v, want unmodified display content", i, snapshot)
		}
	}
}

// TestProjectExternalSessionDisplayMissingSourceReturnsError pins the fallback
// contract: when the native source cannot be resolved the projector fails and
// callers keep the stored content instead of hiding anything.
func TestProjectExternalSessionDisplayMissingSourceReturnsError(t *testing.T) {
	importer, rootPath := newDisplayTestImporter(t)
	_, err := importer.ProjectExternalSessionDisplay(context.Background(), agenttypes.ImportExternalSessionInput{
		RootPath:       rootPath,
		Agent:          "claude",
		AgentSessionID: "sess-missing",
	})
	if err == nil {
		t.Fatal("expected an error for a missing native source")
	}
}

// TestProjectionLeavesToolResultsAndAuxIntact verifies that tool_result lines
// are applied to the assistant aux entries exactly as before, that they never
// become user exchanges, and that the display projection does not touch agent
// exchanges or aux data.
func TestProjectionLeavesToolResultsAndAuxIntact(t *testing.T) {
	importer, rootPath := newDisplayTestImporter(t)
	cwd := normalizeComparablePath(rootPath)
	writeClaudeDisplayFixture(t, importer, rootPath, "sess-tools",
		claudeDisplayUserLine("sess-tools", cwd, "u1", "2026-01-02T03:04:05Z", "run the tests", nil),
		map[string]any{
			"type":      "assistant",
			"sessionId": "sess-tools",
			"cwd":       cwd,
			"uuid":      "a1",
			"timestamp": "2026-01-02T03:04:06Z",
			"message": map[string]any{
				"role": "assistant",
				"content": []any{
					map[string]any{"type": "text", "text": "running"},
					map[string]any{"type": "tool_use", "id": "call-1", "name": "Bash", "input": map[string]any{"command": "go test ./..."}},
				},
			},
		},
		map[string]any{
			"type":      "user",
			"sessionId": "sess-tools",
			"cwd":       cwd,
			"uuid":      "u2",
			"timestamp": "2026-01-02T03:04:07Z",
			"message": map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "tool_result", "tool_use_id": "call-1", "content": "ok"},
				},
			},
			"toolUseResult": map[string]any{"stdout": "ok"},
		},
		claudeDisplayUserLine("sess-tools", cwd, "u3", "2026-01-02T03:04:08Z", displayFixtureNotification, map[string]any{"kind": "task-notification"}),
	)
	path := filepath.Join(importer.baseDir, claudeProjectDirName(rootPath), "sess-tools.jsonl")
	exchanges, err := readClaudeImportedExchanges(path, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	// Canonical contract: the tool_result line never becomes a user exchange,
	// but the trailing task notification stays in the list with its original
	// role, content, and timestamp. Hiding it is display-only.
	if len(exchanges) != 3 {
		t.Fatalf("len(exchanges) = %d, want 3", len(exchanges))
	}
	if exchanges[0].Role != "user" || exchanges[0].Content != "run the tests" {
		t.Fatalf("exchanges[0] = %#v", exchanges[0])
	}
	if exchanges[1].Role != "agent" {
		t.Fatalf("exchanges[1].Role = %q", exchanges[1].Role)
	}
	if exchanges[2].Role != "user" || exchanges[2].Content != displayFixtureNotification {
		t.Fatalf("exchanges[2] = %#v, want the preserved notification entry", exchanges[2])
	}
	if len(exchanges[1].Aux) != 1 || exchanges[1].Aux[0].ToolCall == nil {
		t.Fatalf("agent aux = %#v, want the preserved tool call", exchanges[1].Aux)
	}
	toolCall := exchanges[1].Aux[0].ToolCall
	if toolCall.CallID != "call-1" || toolCall.Status != "complete" {
		t.Fatalf("tool call = %#v, want call-1 completed by the tool result", toolCall)
	}
	projection, err := importer.ProjectExternalSessionDisplay(context.Background(), agenttypes.ImportExternalSessionInput{
		RootPath:       rootPath,
		Agent:          "claude",
		AgentSessionID: "sess-tools",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.Users) != 2 {
		t.Fatalf("len(Users) = %d, want 2 (real user and trailing notification)", len(projection.Users))
	}
	if _, ok := projection.Users[1]; ok {
		t.Fatal("agent exchange must never appear in the display projection")
	}
	snapshots := projection.Users[0]
	if len(snapshots) != 1 || snapshots[0].Display != "run the tests" {
		t.Fatalf("user snapshots = %#v", snapshots)
	}
	notificationSnapshots := projection.Users[2]
	if len(notificationSnapshots) != 1 || notificationSnapshots[0].Display != "" {
		t.Fatalf("notification snapshots = %#v", notificationSnapshots)
	}
}

// TestIsClaudeTaskNotificationLine verifies the strict origin gate: only the
// explicit task-notification origin kind is trusted.
func TestIsClaudeTaskNotificationLine(t *testing.T) {
	cases := []struct {
		name string
		raw  map[string]any
		want bool
	}{
		{"no origin", map[string]any{}, false},
		{"task notification", map[string]any{"origin": map[string]any{"kind": "task-notification"}}, true},
		{"task notification spaced", map[string]any{"origin": map[string]any{"kind": " task-notification "}}, true},
		{"unknown kind", map[string]any{"origin": map[string]any{"kind": "background-retry"}}, false},
		{"empty kind", map[string]any{"origin": map[string]any{"kind": ""}}, false},
		{"origin not an object", map[string]any{"origin": "task-notification"}, false},
	}
	for _, testCase := range cases {
		if got := isClaudeTaskNotificationLine(testCase.raw); got != testCase.want {
			t.Fatalf("%s: isClaudeTaskNotificationLine = %v, want %v", testCase.name, got, testCase.want)
		}
	}
}
