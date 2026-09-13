package claude

import (
	"context"
	"fmt"
	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"io"
	"strings"
)

func validateCLIArguments(args []string) error {
	for _, arg := range args {
		flag := strings.SplitN(arg, "=", 2)[0]
		switch flag {
		case "--input-format", "--output-format", "--permission-prompt-tool":
			return fmt.Errorf("%s is managed by the IDEA streaming transport; remove it from the Agent arguments", flag)
		}
	}
	return nil
}

type cliArgumentRunner struct {
	claudeagent.SubprocessRunner
	args []string
}

func (r *cliArgumentRunner) Start(ctx context.Context, args, env []string, cwd string) (io.WriteCloser, io.ReadCloser, io.ReadCloser, error) {
	// Keep order, repeated options and arguments containing spaces intact.
	combined := append(append([]string(nil), args...), r.args...)
	return r.SubprocessRunner.Start(ctx, combined, env, cwd)
}

func withCLIArguments(args []string) claudeagent.Option {
	return func(options *claudeagent.Options) {
		if len(args) == 0 {
			return
		}
		command := strings.TrimSpace(options.CLIPath)
		if command == "" {
			command = "claude"
		}
		runner := &cliArgumentRunner{SubprocessRunner: claudeagent.NewLocalSubprocessRunner(command), args: append([]string(nil), args...)}
		options.Transport = claudeagent.NewSubprocessTransportWithRunner(runner, options)
	}
}
