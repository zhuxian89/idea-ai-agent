# Local compatibility patch

Source: `github.com/yandc/codex-go-sdk` at
`c8b61217fb04` (`v0.0.0-20260820040224-c8b61217fb04`), module name
`github.com/fanwenlin/codex-go-sdk`. Only `codex/`, `types/`, `go.mod` and
the MIT `LICENSE` are included. Upstream production code and tests are retained.

Local changes:

- Preserve reasoning effort values for every model, including explicit collaboration modes.
- Expose native approval parameters and request context to the adapter; preserve structured decisions.
- Process user questions and approvals without blocking stream notifications; cancel and join pending handlers when a turn ends.
- Return a refusal/empty answer on cancellation instead of abandoning a server RPC.
- Add regression tests and replace upstream tests that expected silent effort downgrades.

The installed official Codex CLI still executes the Agent. This is a patched
third-party Go transport, not an official OpenAI SDK. `runtime/go.mod` uses a local
replace so builds do not depend on edits to a developer's Go module cache.

Native interaction and delivery patch (2026-09-14):

- Forward MCP elicitation and additional-permission requests through
  `ServerRequestHandler`, retaining method, request ID, parameters and context.
  Thread-only MCP requests route to their thread; multiple subscribers claim a
  request once without blocking each other. `serverRequest/resolved` retires
  pending interactions. Turn completion cancels and joins their handlers.
- Buffer each subscriber independently in order instead of dropping events when
  the 256-entry output channel fills. Consumption clears retained entries;
  unsubscribe/Close releases the backlog and stops its worker.
- Subscribe before `turn/start` so notifications preceding its RPC reply survive.
- `native_interactions_test.go` covers bursts, ordering, isolated consumers,
  request identity, cancellation, duplicate subscribers and early completion.

The backlog grows with unconsumed events; this is not a disk-backed event log.
Only the two interaction methods above were added in this patch.
