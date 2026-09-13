package claude

import (
	"context"
	"errors"
	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"io"
	"reflect"
	"slices"
	"strings"
	"testing"
)

type argumentRecorder struct {
	claudeagent.SubprocessRunner
	args []string
	cwd  string
}

func TestPermissionArgumentsCannotOverrideIDESelection(t *testing.T) {
	for _, args := range [][]string{
		{"--permission-mode", "bypassPermissions"},
		{"--permission-mode=bypassPermissions"},
		{"--permission-mode", "default"},
		{"--dangerously-skip-permissions"},
		{"--dangerously-skip-permissions=true"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			if err := validateCLIArguments(args); err == nil || !strings.Contains(err.Error(), "permission selector") {
				t.Fatalf("permission override must be rejected with recovery guidance, got %v", err)
			}
			for _, planning := range []bool{false, true} {
				_, err := NewRuntime().OpenSession(context.Background(), OpenOptions{
					SessionKey: "conflicting-permissions", Mode: "default", PlanMode: planning,
					Command: "must-not-launch-agent", Args: args,
				})
				if err == nil || !strings.Contains(err.Error(), "permission selector") {
					t.Fatalf("plan=%t: must reject before launching a CLI, got %v", planning, err)
				}
			}
		})
	}
	if err := validateCLIArguments([]string{"--add-dir", "a folder", "--effort", "max", "--allow-dangerously-skip-permissions"}); err != nil {
		t.Fatalf("non-overriding arguments should remain supported: %v", err)
	}
}

var errArgumentsRecorded = errors.New("arguments recorded without starting a model")

func (r *argumentRecorder) Start(_ context.Context, args, _ []string, cwd string) (io.WriteCloser, io.ReadCloser, io.ReadCloser, error) {
	r.args, r.cwd = args, cwd
	return nil, nil, nil, errArgumentsRecorded
}

func TestNativeCLIFlagsAndArguments(t *testing.T) {
	for _, model := range []string{"", "user-selected-model"} {
		t.Run("model="+model, func(t *testing.T) {
			options := (&session{}).nativeOptions(OpenOptions{RootPath: t.TempDir()})
			options = append(options, claudeagent.WithModel(model))
			opts := claudeagent.DefaultOptions()
			for _, option := range options {
				option(&opts)
			}
			recorder := &argumentRecorder{}
			extra := []string{"--add-dir", "C:/a folder", "--add-dir", "C:/second", "--effort", "max"}
			transport := claudeagent.NewSubprocessTransportWithRunner(&cliArgumentRunner{SubprocessRunner: recorder, args: extra}, &opts)
			client, err := claudeagent.NewClient(append(options, claudeagent.WithTransport(transport))...)
			if err != nil {
				t.Fatalf("construct native client: %v", err)
			}
			if err := client.Connect(context.Background()); !errors.Is(err, errArgumentsRecorded) {
				t.Fatal(err)
			}
			modelFlag := slices.Index(recorder.args, "--model")
			if model == "" && modelFlag >= 0 {
				t.Fatalf("native model must be inherited: %v", recorder.args)
			}
			if model != "" && (modelFlag < 0 || modelFlag+1 >= len(recorder.args) || recorder.args[modelFlag+1] != model) {
				t.Fatalf("explicit model must be forwarded: %v", recorder.args)
			}
			for _, forbidden := range []string{"--permission-mode", "--dangerously-skip-permissions", "--system-prompt", "--max-turns", "--max-budget-usd"} {
				if slices.Contains(recorder.args, forbidden) {
					t.Errorf("unexpected default CLI override: %s", forbidden)
				}
			}
			i := slices.Index(recorder.args, "--setting-sources")
			if i < 0 || recorder.args[i+1] != "user,project,local" {
				t.Fatalf("native setting sources missing: %v", recorder.args)
			}
			if !reflect.DeepEqual(recorder.args[len(recorder.args)-len(extra):], extra) {
				t.Fatalf("arguments changed: %v", recorder.args)
			}
			if recorder.cwd != opts.Cwd {
				t.Fatal("working directory not passed to CLI")
			}
			if err := validateCLIArguments([]string{"--output-format=text"}); err == nil {
				t.Fatal("incompatible transport flag silently accepted")
			}
		})
	}
}

func TestNativePermissionCLIArguments(t *testing.T) {
	for _, tc := range []struct {
		mode     string
		plan     bool
		expected string
	}{
		{"bypassPermissions", false, "bypassPermissions"},
		{"default", false, "default"},
		{"bypassPermissions", true, "plan"},
	} {
		t.Run(tc.expected, func(t *testing.T) {
			options := (&session{}).nativeOptions(OpenOptions{RootPath: t.TempDir(), Mode: tc.mode, PlanMode: tc.plan})
			opts := claudeagent.DefaultOptions()
			for _, option := range options {
				option(&opts)
			}
			recorder := &argumentRecorder{}
			transport := claudeagent.NewSubprocessTransportWithRunner(recorder, &opts)
			client, err := claudeagent.NewClient(append(options, claudeagent.WithTransport(transport))...)
			if err != nil {
				t.Fatal(err)
			}
			if err := client.Connect(context.Background()); !errors.Is(err, errArgumentsRecorded) {
				t.Fatal(err)
			}
			i := slices.Index(recorder.args, "--permission-mode")
			if i < 0 || i+1 >= len(recorder.args) || recorder.args[i+1] != tc.expected {
				t.Fatalf("incorrect native permission flags: %v", recorder.args)
			}
			if !slices.Contains(recorder.args, "--allow-dangerously-skip-permissions") {
				t.Fatal("native bypass switching not enabled")
			}
		})
	}
}
