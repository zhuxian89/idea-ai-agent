package claude

import (
	"context"
	"encoding/json"
	"errors"
	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"mindfs/server/internal/agent/types"
	"os"
	"reflect"
	"testing"
	"time"
)

func TestNativeOptionsInheritCLIConfiguration(t *testing.T) {
	s := &session{}
	opts := claudeagent.DefaultOptions()
	for _, option := range s.nativeOptions(OpenOptions{}) {
		option(&opts)
	}
	if opts.OnElicitation == nil || opts.OnUserDialog == nil || !reflect.DeepEqual(opts.SupportedDialogKinds, []string{"refusal_fallback_prompt"}) {
		t.Fatal("native interaction callbacks not registered")
	}
	if opts.Model != "" {
		t.Errorf("implicit model override: %s", opts.Model)
	}
	if opts.PermissionMode != "" {
		t.Errorf("implicit permission override: %s", opts.PermissionMode)
	}
	if !reflect.DeepEqual(opts.SkillsConfig.SettingSources, []string{"user", "project", "local"}) {
		t.Errorf("CLI setting sources: %v", opts.SkillsConfig.SettingSources)
	}
	if opts.SystemPrompt != "" {
		t.Errorf("native system prompt replaced")
	}
}

func TestNativePermissionModeChoices(t *testing.T) {
	modes, err := (&session{}).ListModes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"bypassPermissions", "default", "acceptEdits"}
	if len(modes.Modes) != len(want) {
		t.Fatalf("Claude modes = %+v, want %v", modes.Modes, want)
	}
	for i, mode := range modes.Modes {
		if mode.ID != want[i] || mode.Name != want[i] {
			t.Fatalf("Claude mode[%d] = {ID:%q Name:%q}, want native %q", i, mode.ID, mode.Name, want[i])
		}
	}
}

func TestNativeClientRetainsConfigurationValidation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		option claudeagent.Option
		field  string
	}{
		{"permission", claudeagent.WithPermissionMode("invalid"), "PermissionMode"},
		{"effort", claudeagent.WithEffort("invalid"), "Effort"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			options := (&session{}).nativeOptions(OpenOptions{RootPath: t.TempDir()})
			_, err := claudeagent.NewClient(append(options, tc.option)...)
			var configError *claudeagent.ErrInvalidConfiguration
			if !errors.As(err, &configError) || configError.Field != tc.field {
				t.Fatalf("expected %s validation, got %v", tc.field, err)
			}
		})
	}
}

func TestNativePermissionWaitsForUser(t *testing.T) {
	s := &session{}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	prompt := make(chan types.ToolCall, 1)
	s.OnUpdate(func(event types.Event) {
		if call, ok := event.Data.(types.ToolCall); ok {
			prompt <- call
		}
	})
	result := make(chan claudeagent.PermissionResult, 1)
	go func() {
		result <- s.handleCanUseTool(ctx, claudeagent.ToolPermissionRequest{ToolName: "Bash", Arguments: json.RawMessage(`{"command":"git status"}`), Context: claudeagent.PermissionContext{ToolUseID: "permission-1"}})
	}()
	select {
	case call := <-prompt:
		if err := s.AnswerQuestion(ctx, types.AskUserAnswer{ToolUseID: call.CallID, Answers: map[string]string{"q_0": "拒绝执行"}}); err != nil {
			t.Fatal(err)
		}
	case value := <-result:
		t.Fatalf("permission returned without asking: %T", value)
	case <-ctx.Done():
		t.Fatal("no permission question")
	}
	select {
	case value := <-result:
		if _, ok := value.(claudeagent.PermissionDeny); !ok {
			t.Fatalf("refusal = %T", value)
		}
	case <-ctx.Done():
		t.Fatal("permission answer was not consumed")
	}
}

func TestClaudeEnvironmentMarksRootServiceAsSandbox(t *testing.T) {
	user := map[string]string{"HOME": "/home/user"}
	if got := claudeEnvironment(1000, user); got["IS_SANDBOX"] != "" || len(got) != 1 {
		t.Fatalf("a normal user must not get the sandbox marker: %v", got)
	}
	got := claudeEnvironment(0, user)
	if got["IS_SANDBOX"] != "1" || got["HOME"] != "/home/user" {
		t.Fatalf("root must get IS_SANDBOX=1 and keep its environment: %v", got)
	}
	if _, changed := user["IS_SANDBOX"]; changed {
		t.Fatal("the caller's environment map was modified")
	}
	if got := claudeEnvironment(0, nil); got["IS_SANDBOX"] != "1" {
		t.Fatalf("root with no environment: %v", got)
	}
	if got := claudeEnvironment(0, map[string]string{"IS_SANDBOX": "0"}); got["IS_SANDBOX"] != "0" {
		t.Fatalf("an explicit setting must be kept: %v", got)
	}
}

// Runs for real only when the test process is uid 0 (for example in a container).
func TestNativeOptionsCarrySandboxMarkerForRealRoot(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("not running as root")
	}
	opts := claudeagent.DefaultOptions()
	for _, option := range (&session{}).nativeOptions(OpenOptions{RootPath: t.TempDir()}) {
		option(&opts)
	}
	if opts.Env["IS_SANDBOX"] != "1" {
		t.Fatalf("root session options lack IS_SANDBOX=1: %v", opts.Env)
	}
}
