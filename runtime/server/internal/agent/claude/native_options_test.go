package claude

import (
	"context"
	"encoding/json"
	"errors"
	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"mindfs/server/internal/agent/types"
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
	for _, mode := range modes.Modes {
		if mode.ID == "bypassPermissions" {
			return
		}
	}
	t.Fatal("Claude bypassPermissions permission choice is missing")
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
