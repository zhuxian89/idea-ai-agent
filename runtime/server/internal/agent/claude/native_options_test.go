package claude

import (
	"context"
	"encoding/json"
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
