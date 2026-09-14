# Third-party source

`runtime/` contains the MindFS local server and web application from the sibling
`mindfs` checkout, baseline commit `7b2cb729c5f655e5a7b7dc72c9101783c88d9057`.
Upstream: https://github.com/a9gent/mindfs

MindFS is licensed under GNU AGPL version 3; its license is retained in
`runtime/LICENSE` and the repository `LICENSE`. Existing upstream notices are
preserved. This derivative project uses the same license.

Local changes add a plugin-owned loopback runtime, isolated configuration,
IDE editor integration, and a local-only web entry. The Agent adapters and
session workflows originate from MindFS.

`runtime/third_party/codex-go-sdk/` retains the MIT license from
`github.com/yandc/codex-go-sdk` at `c8b61217fb04`. Local protocol patches are
documented in its `README.idea-agent.md`; the license is included in the runtime
distribution. `runtime/third_party/claude-agent-sdk-go/` retains the MIT license
from `github.com/yandc/claude-agent-sdk-go` at `fc2d6ef2e3eb`, also included in the
distribution. Its `README.idea-agent.md` documents the minimal constructor patch
that allows the CLI to choose its native model. Neither transport is represented
as an official vendor SDK.

`github.com/santhosh-tekuri/jsonschema/v6` v6.0.3 validates native MCP form
responses. Its Apache-2.0 license is retained in
`runtime/third_party/jsonschema-v6-LICENSE` and included in runtime distributions.
