package claude

import (
	"context"
	"errors"
	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"io"
	"reflect"
	"slices"
	"testing"
)

type argumentRecorder struct {
	claudeagent.SubprocessRunner
	args []string
	cwd  string
}

var errArgumentsRecorded = errors.New("arguments recorded without starting a model")

func (r *argumentRecorder) Start(_ context.Context, args, _ []string, cwd string) (io.WriteCloser, io.ReadCloser, io.ReadCloser, error) {
	r.args, r.cwd = args, cwd
	return nil, nil, nil, errArgumentsRecorded
}

func TestNativeCLIFlagsAndArguments(t *testing.T) {
	opts := claudeagent.DefaultOptions()
	for _, option := range (&session{}).nativeOptions(OpenOptions{RootPath: t.TempDir()}) {
		option(&opts)
	}
	recorder := &argumentRecorder{}
	extra := []string{"--add-dir", "C:/a folder", "--add-dir", "C:/second", "--effort", "max"}
	transport := claudeagent.NewSubprocessTransportWithRunner(&cliArgumentRunner{SubprocessRunner: recorder, args: extra}, &opts)
	if err := transport.Connect(context.Background()); !errors.Is(err, errArgumentsRecorded) {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"--model", "--permission-mode", "--system-prompt", "--max-turns", "--max-budget-usd"} {
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
}
