# Local compatibility patch

Source: `github.com/yandc/claude-agent-sdk-go` at `fc2d6ef2e3eb`
(`v0.0.0-20260730033243-fc2d6ef2e3eb`), module name
`github.com/roasbeef/claude-agent-sdk-go`. Root Go sources and tests, `testdata/`,
`go.mod`, `go.sum`, and the MIT `LICENSE` are retained. CLI examples, documentation,
and upstream CI files are omitted.

The constructor patch permits an empty model in `NewClient` validation.
The existing transport already omits `--model` for that value; the installed
Claude CLI then resolves its own model configuration. Explicit model choices,
permission validation, session validation and all other behavior are unchanged.

The transport also corrects `AllowDangerouslySkipPermissions` to emit
`--allow-dangerously-skip-permissions`. Upstream incorrectly emitted
`--dangerously-skip-permissions`, which activates bypass rather than only enabling
later selection of that mode. The adapter explicitly sets `--permission-mode`
when the user selects permissions; `plan` remains distinct from bypass.

Regression coverage lives in the plugin adapter's `cli_arguments_test.go` and
`native_options_test.go`. It exercises the real constructor and transport with
a recording subprocess runner, without invoking a model.

This is a third-party Go transport, not an official Anthropic SDK. The installed
Claude Code CLI still executes the Agent. Builds use this local replacement,
not edits to the developer's Go module cache.
