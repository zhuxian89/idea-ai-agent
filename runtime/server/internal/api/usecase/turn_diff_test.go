package usecase

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	rootfs "mindfs/server/internal/fs"
	"mindfs/server/internal/session"
	"mindfs/server/internal/turndiff"
)

type turnDiffRegistry struct {
	*commandTestRegistry
	pool *agent.Pool
}

func (r *turnDiffRegistry) GetAgentPool() *agent.Pool { return r.pool }

// The test binary doubles as a scripted App Server so the test traverses the
// real SDK, event adapter, SendMessage and persisted history, without an API call.
func init() {
	if os.Getenv("IDE_AGENT_TURN_DIFF_TEST_HELPER") != "1" {
		return
	}
	enc := json.NewEncoder(os.Stdout)
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 4096), 1<<20)
	turn := 0
	for input.Scan() {
		var req struct {
			ID     any            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if json.Unmarshal(input.Bytes(), &req) != nil {
			os.Exit(2)
		}
		if req.ID == nil {
			continue
		}
		result := any(map[string]any{})
		if req.Method == "thread/start" {
			result = map[string]any{"thread": map[string]any{"id": "test-thread"}}
		}
		if req.Method == "turn/start" {
			turn++
			result = map[string]any{"turn": map[string]any{"id": "test-turn"}}
			payload, _ := json.Marshal(req.Params)
			if err := os.WriteFile(os.Getenv("IDE_AGENT_TURN_DIFF_REQUEST"), payload, 0600); err != nil {
				os.Exit(3)
			}
		}
		_ = enc.Encode(map[string]any{"id": req.ID, "result": result})
		if req.Method != "turn/start" {
			continue
		}
		notify := func(method string, extra map[string]any) {
			extra["threadId"], extra["turnId"] = "test-thread", "test-turn"
			_ = enc.Encode(map[string]any{"method": method, "params": extra})
		}
		notify("turn/started", map[string]any{"turn": map[string]any{"id": "test-turn"}})
		item := map[string]any{"id": "exec-patch", "type": "commandExecution", "command": "codex.exe --codex-run-as-apply-patch", "status": "inProgress"}
		notify("item/started", map[string]any{"item": item})
		if turn == 1 {
			cwd, _ := req.Params["cwd"].(string)
			if err := os.WriteFile(filepath.Join(cwd, "RuoYiApplication.java"), []byte("public class RuoYiApplication {\n}\n"), 0600); err != nil {
				os.Exit(4)
			}
		}
		item["status"], item["exitCode"] = "completed", 0
		notify("item/completed", map[string]any{"item": item})
		notify("item/completed", map[string]any{"item": map[string]any{"id": "answer", "type": "agentMessage", "text": "Done."}})
		notify("turn/completed", map[string]any{"turn": map[string]any{"id": "test-turn", "status": "completed"}})
	}
	os.Exit(0)
}

func TestCommandOnlyTurnDiffSurvivesSendAndReload(t *testing.T) {
	rootDir := t.TempDir()
	runUsecaseGit(t, rootDir, "init", "-q")
	before := "public class RuoYiApplication extends RuoYiServletInitializer{\n}\n"
	mustWriteFile(t, filepath.Join(rootDir, "RuoYiApplication.java"), before)
	root := rootfs.NewRootInfo("root", "Root", rootDir)
	manager := session.NewManager(root)
	t.Cleanup(func() { _ = manager.Shutdown() })
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	current, err := manager.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: "codex", Model: "test-model"})
	if err != nil {
		t.Fatal(err)
	}
	requestPath := filepath.Join(t.TempDir(), "request.json")
	bin, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	pool := agent.NewPool(agent.Config{Agents: []agent.Definition{{Name: "codex", Command: bin, Protocol: agent.ProtocolCodexSDK, Env: map[string]string{
		"IDE_AGENT_TURN_DIFF_TEST_HELPER": "1", "IDE_AGENT_TURN_DIFF_REQUEST": requestPath,
	}}}})
	t.Cleanup(pool.CloseAll)
	service := &Service{Registry: &turnDiffRegistry{commandTestRegistry: &commandTestRegistry{root: root, manager: manager}, pool: pool}}
	sawCommand, sawNativeDiff := false, false
	input := SendMessageInput{RootID: root.ID, Key: current.Key, Agent: "codex", Content: "Remove the extends clause.", Model: "test-model", Mode: "full-access", Effort: "high", OnUpdate: func(event agenttypes.Event) {
		if event.Type == agenttypes.EventTypeTurnDiff {
			sawNativeDiff = true
		}
		if call, ok := event.Data.(agenttypes.ToolCall); ok && call.Kind == agenttypes.ToolKindExecute {
			sawCommand = true
		}
	}}
	if err := service.SendMessage(ctx, input); err != nil {
		t.Fatal(err)
	}
	if !sawCommand || sawNativeDiff {
		t.Fatalf("command=%v native diff=%v", sawCommand, sawNativeDiff)
	}
	fresh := session.NewManager(root)
	t.Cleanup(func() { _ = fresh.Shutdown() })
	aux, err := fresh.GetExchangeAux(ctx, current.Key, 0)
	if err != nil {
		t.Fatal(err)
	}
	var diff *agenttypes.TurnDiffUpdate
	for _, entry := range aux[2] {
		if entry.TurnDiff != nil {
			diff = entry.TurnDiff
		}
	}
	if diff == nil || !diff.Workspace || !strings.Contains(diff.Diff, "-public class RuoYiApplication extends RuoYiServletInitializer{") || !strings.Contains(diff.Diff, "+public class RuoYiApplication {") {
		t.Fatalf("missing saved diff: %#v", diff)
	}
	if diff.SnapshotID == "" || len(diff.ComparePaths) != 1 || diff.ComparePaths[0] != "RuoYiApplication.java" {
		t.Fatalf("missing saved artifact metadata: %#v", diff)
	}
	artifact, err := (&Service{Registry: &turnDiffRegistry{commandTestRegistry: &commandTestRegistry{root: root, manager: manager}, pool: pool}}).GetTurnDiffArtifact(ctx, TurnDiffArtifactInput{
		RootID: root.ID, Key: current.Key, SnapshotID: diff.SnapshotID, Path: "RuoYiApplication.java",
	})
	if err != nil || !artifact.Before.Present || !artifact.After.Present ||
		!strings.Contains(decodeTurnDiffBase64(t, artifact.Before.Data), "RuoYiServletInitializer") ||
		!strings.Contains(decodeTurnDiffBase64(t, artifact.After.Data), "public class RuoYiApplication {") {
		t.Fatalf("artifact = %#v, err = %v", artifact, err)
	}
	request, _ := os.ReadFile(requestPath)
	var params map[string]any
	if err := json.Unmarshal(request, &params); err != nil {
		t.Fatal(err)
	}
	if params["model"] != input.Model || params["effort"] != input.Effort || params["approvalPolicy"] != "never" || params["sandboxPolicy"].(map[string]any)["type"] != "dangerFullAccess" {
		t.Fatalf("native request changed: %s", request)
	}
	if _, exists := params["tools"]; exists {
		t.Fatal("observer injected tools")
	}
	if _, exists := params["developerInstructions"]; exists {
		t.Fatal("observer injected instructions")
	}
	// A subsequent read-only turn must not repeat the first turn's change.
	if err := service.SendMessage(ctx, input); err != nil {
		t.Fatal(err)
	}
	aux, err = fresh.GetExchangeAux(ctx, current.Key, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range aux[4] {
		if entry.TurnDiff != nil {
			t.Fatal("old diff leaked into next turn")
		}
	}
	if dir := os.Getenv("TURN_DIFF_FIXTURE_DIR"); dir != "" {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		data, _ := json.Marshal(diff)
		if err := os.WriteFile(filepath.Join(dir, "turn-diff.json"), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func decodeTurnDiffBase64(t *testing.T, value string) string {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestWorkspaceFailurePreservesNativeDiff(t *testing.T) {
	native := &agenttypes.TurnDiffUpdate{TurnID: "native", Diff: "original"}
	if got := finishWorkspaceTurnDiff(nil, native, rootfs.RootInfo{}, "test", nil); got != native {
		t.Fatal("missing baseline changed native event")
	}
	root := t.TempDir()
	runUsecaseGit(t, root, "init", "-q")
	s, err := turndiff.Capture(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(root, ".git")); err != nil {
		t.Fatal(err)
	}
	if got := finishWorkspaceTurnDiff(s, native, rootfs.RootInfo{RootPath: root}, "test", nil); got != native {
		t.Fatal("failed observation changed native event")
	}
}

func TestArtifactComparePathsIncludeAddedAndDeletedFiles(t *testing.T) {
	rootDir := t.TempDir()
	runUsecaseGit(t, rootDir, "init", "-q")
	runUsecaseGit(t, rootDir, "config", "user.name", "Test")
	runUsecaseGit(t, rootDir, "config", "user.email", "test@example.invalid")
	mustWriteFile(t, filepath.Join(rootDir, "deleted.txt"), "deleted\n")
	runUsecaseGit(t, rootDir, "add", "deleted.txt")
	runUsecaseGit(t, rootDir, "commit", "-qm", "baseline")
	before, err := turndiff.Capture(context.Background(), rootDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(rootDir, "deleted.txt")); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(rootDir, "added.txt"), "added\n")
	root := rootfs.NewRootInfo("root", "Root", rootDir)
	update := finishWorkspaceTurnDiff(before, nil, root, "session", nil)
	if update == nil || update.SnapshotID == "" {
		t.Fatalf("missing artifact update: %#v", update)
	}
	compare := map[string]bool{}
	for _, path := range update.ComparePaths {
		compare[path] = true
	}
	if !compare["added.txt"] || !compare["deleted.txt"] {
		t.Fatalf("compare paths = %#v", update.ComparePaths)
	}
	for _, path := range []string{"added.txt", "deleted.txt"} {
		artifact, err := turndiff.LoadArtifact(root.MetaDir(), "session", update.SnapshotID, path)
		if err != nil {
			t.Fatalf("%s artifact: %v", path, err)
		}
		if path == "added.txt" && (artifact.Before.Present || !artifact.After.Present) {
			t.Fatalf("added artifact = %#v", artifact)
		}
		if path == "deleted.txt" && (!artifact.Before.Present || artifact.After.Present) {
			t.Fatalf("deleted artifact = %#v", artifact)
		}
	}
}
