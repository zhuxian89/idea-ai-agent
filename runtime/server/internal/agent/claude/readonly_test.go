package claude

import (
	"context"
	"encoding/json"
	"slices"
	"testing"

	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
)

func TestReadOnlyNativeOptionsAndPermissions(t *testing.T) {
	s := &session{readOnly: true}
	cfg := claudeagent.NewOptions()
	for _, opt := range s.nativeOptions(OpenOptions{
		SessionKey: "ro-1",
		Mode:       "bypassPermissions",
		PlanMode:   true,
		ReadOnly:   true,
		RootPath:   t.TempDir(),
	}) {
		opt(cfg)
	}

	if cfg.PermissionMode != claudeagent.PermissionModeDefault {
		t.Fatalf("PermissionMode = %q, want %q", cfg.PermissionMode, claudeagent.PermissionModeDefault)
	}
	if cfg.AllowDangerouslySkipPermissions {
		t.Fatalf("AllowDangerouslySkipPermissions = true, want false")
	}
	for _, tool := range []string{"Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "EnterPlanMode", "ExitPlanMode"} {
		if !slices.Contains(cfg.DisallowedTools, tool) {
			t.Fatalf("DisallowedTools missing %q: %v", tool, cfg.DisallowedTools)
		}
	}

	for _, allowed := range []struct {
		name string
		args string
	}{
		{name: "Read", args: `{}`},
		{name: "Glob", args: `{}`},
		{name: "Grep", args: `{}`},
		{name: "Skill", args: `{}`},
		{name: "Agent", args: `{"subagent_type":"Explore"}`},
	} {
		res, handled := s.automaticToolPermission(claudeagent.ToolPermissionRequest{
			ToolName:  allowed.name,
			Arguments: json.RawMessage(allowed.args),
		})
		if !handled {
			t.Fatalf("%s was not handled automatically", allowed.name)
		}
		if _, ok := res.(claudeagent.PermissionAllow); !ok {
			t.Fatalf("%s result = %T, want PermissionAllow", allowed.name, res)
		}
	}

	for _, blocked := range []struct {
		name string
		args string
	}{
		{name: "Write", args: `{}`},
		{name: "Edit", args: `{}`},
		{name: "MultiEdit", args: `{}`},
		{name: "NotebookEdit", args: `{}`},
		{name: "Bash", args: `{"command":"rm -rf ."}`},
		{name: "EnterPlanMode", args: `{}`},
		{name: "ExitPlanMode", args: `{}`},
		{name: "Agent", args: `{"subagent_type":"general-purpose"}`},
		{name: "Agent", args: `{"subagent_type":"Explore","run_in_background":true}`},
		{name: "Task", args: `{"subagent_type":"Explore","run_in_background":true}`},
	} {
		res, handled := s.automaticToolPermission(claudeagent.ToolPermissionRequest{
			ToolName:  blocked.name,
			Arguments: json.RawMessage(blocked.args),
		})
		if !handled {
			t.Fatalf("%s was not handled automatically", blocked.name)
		}
		if _, ok := res.(claudeagent.PermissionDeny); !ok {
			t.Fatalf("%s result = %T, want PermissionDeny", blocked.name, res)
		}
	}

	if err := s.SetMode(context.Background(), "bypassPermissions"); err == nil {
		t.Fatal("SetMode on read-only session succeeded, want error")
	}
}
