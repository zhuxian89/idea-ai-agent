---
doc_type: audit-finding
audit: 2026-09-14-native-agent-parity
finding_id: bug-03
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: open
---

# Finding 03：Claude 附加参数可能覆盖界面思考强度

## 速答

界面和 Agent 附加启动参数都能配置 effort，当前代码没有消除两者冲突，实际命令可能包含互相矛盾的多组 `--effort`。

## 关键证据

- `runtime/server/internal/agent/claude/session.go:120`：界面选择转成 `WithEffort(...)`，随后在 `:124` 追加 `withCLIArguments(opts.Args)`。
- `runtime/third_party/claude-agent-sdk-go/transport.go:159`、`:197`：SDK 将非空 effort 写入 `--effort` 参数，两处还重复生成同一选择。
- `runtime/server/internal/agent/claude/cli_arguments.go:11`：冲突校验限制协议和 permission 参数，没有限制或归并 `--effort`。
- `runtime/server/internal/agent/claude/cli_arguments.go:29`：`combined := append(append([]string(nil), args...), r.args...)`，附加参数位于最后。
- `runtime/server/internal/agent/claude/cli_arguments_test.go:43`：现有测试明确允许附加 `--effort max`；`TestNativeCLIFlagsAndArguments` 验证附加参数保持在尾部。

例如界面选 High、配置附加 `--effort low`，构造出的命令尾部仍包含 `--effort high ... --effort high ... --effort low`。界面没有提示重复设置。

## 影响与置信度

只影响配置了冲突附加参数的用户。仓库内置 Codex／Claude 定义没有这类 args，不能认定用户当前的 High 已经被覆盖。

medium：重复且冲突的实际参数构造可静态确认；本轮未执行真实模型请求，也未确认用户当前 Agent 配置或当前 CLI 对重复参数的最终解析结果，故不把“已降级到 Low”当作实测事实。

## 修复方向与建议动作

建议 cs-issue：明确“显式界面选择／附加默认参数”的优先级，归并重复 effort 参数并显示有效设置。不能只让 UI 和传输层各自保存一份互不校验的值。
