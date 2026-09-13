package claude

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	agenttypes "mindfs/server/internal/agent/types"
)

func TestSubagentDisplayFindsSourceWithoutChangingCanonicalResolution(t *testing.T) {
	importer, root := newDisplayTestImporter(t)
	parent := writeClaudeDisplayFixture(t, importer, root, "parent",
		claudeDisplayUserLine("parent", root, "u1", "2026-09-13T10:00:00Z", "Inspect the code", nil))
	dir := filepath.Join(parent[:len(parent)-len(filepath.Ext(parent))], "subagents")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	line := claudeDisplayUserLine("parent", root, "child-user", "2026-09-13T10:00:01Z", displayFixtureNotification, map[string]any{"kind": "task-notification"})
	line["agentId"] = "child-1"
	data, err := json.Marshal(line)
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	path := filepath.Join(dir, "agent-another-filename.jsonl")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	input := agenttypes.ImportExternalSessionInput{RootPath: root, Agent: "claude", AgentSessionID: "claude-subagent:child-1"}
	projection, err := importer.ProjectExternalSessionDisplay(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if projection.AgentSessionID != input.AgentSessionID || len(projection.Users[0]) != 1 || projection.Users[0][0].Display != "" {
		t.Fatalf("subagent notification projection = %#v", projection)
	}
	if _, err := importer.ImportExternalSession(context.Background(), input); err == nil {
		t.Fatal("display resolution changed canonical session resume behavior")
	}
	if !bytes.Equal(data, mustReadFixtureBytes(t, path)) {
		t.Fatal("subagent source was modified")
	}
}
