---
doc_type: audit-index
audit: 2026-09-14-native-agent-parity
scope: IDEA 插件对 Codex app-server 与 Claude Code stream-json 的原生能力保真度
created: 2026-09-14
status: active
total_findings: 4
---

# 原生 Agent 能力审计

## 修复跟进（2026-09-14）

用户授权的优先级第 1、2 项已修复：finding-01、02、04 标记 fixed。下面保留修复前审计快照；当前实现与验证见 [修复记录](../../issues/2026-09-14-native-interactions/native-interactions-fix-note.md)。计划白名单和异步提问暂停策略未改，finding-03 的附加 effort 参数冲突也未改。既有本地 ZIP 未覆盖。

## 范围

检查当前工作区的输入区、会话发送与设置、Go 适配器、两个本地补丁版第三方 SDK，以及相关回归测试。包含此前移除会话 worktree 的未提交改动。审计只新增文档，没有修改实现或重新打包。

本机版本查询：Codex CLI 0.154.0、Claude Code 2.1.270。通过本机 Codex 的 `app-server generate-json-schema --experimental` 导出协议，和当前请求处理分支逐项比对。未读取用户凭证或运行付费模型任务。

## 总评

核心 Agent 执行依赖原生 CLI，普通编码任务所需的模型调用、工具循环、文件读写、命令执行和上下文管理没有被插件自行重写。模型和思考强度有明确的传递链路，因此不能把一般回答失误直接归因于插件“降低了智力”。

但目前不能宣称“非常接近全部原生能力”或 100% 对等。两个传输层仍有未接入的原生交互；Codex 事件分发存在丢失关键消息的风险；Claude 附加参数与界面思考强度存在优先级冲突风险。没有定义完整能力清单并进行相同环境下的 CLI／插件对照实验，不给出百分比评分。

## 能力核对

| 能力 | 当前事实 | 证据与边界 |
| --- | --- | --- |
| 原生执行引擎 | Codex 启动 `app-server`；Claude 启动本机 CLI 的双向 `stream-json` | `runtime/server/internal/agent/codex/session.go:181`；`runtime/third_party/claude-agent-sdk-go/transport.go:136`。使用的是第三方 Go 传输层，不是官方 Go SDK |
| 模型／思考强度 | Codex 显式 effort 原样送到 `turn/start.effort`；Claude 显式 effort 生成 `--effort` | `runtime/third_party/codex-go-sdk/codex/reasoning_effort.go:12`、`app_server_exec.go:1417`；`runtime/server/internal/agent/claude/session.go:120`。未发现 High → Medium 的映射；附加参数风险见 finding-03 |
| 原生默认值 | 新原生会话不把缓存模型和 effort 当作用户选择；未选择时交给 CLI 默认值 | `runtime/server/internal/api/usecase/session.go:1125`。现有会话继续使用其已有选择 |
| 系统／开发者指令 | 普通原生聊天不注入额外排版 developer instructions；Claude 默认不发送自定义 `--system-prompt` | `runtime/server/internal/api/usecase/session.go:2197`；`runtime/third_party/claude-agent-sdk-go/transport.go:163`。这不能代替真实进程的系统提示词对照验证，也不能把官方 Python／TS SDK 的默认行为直接套到本地 Go SDK |
| Skills、项目设置、MCP、Hooks | CLI 负责加载；Claude 明确加载 `user,project,local`，未默认配置工具禁用名单或回合／花费上限 | `runtime/server/internal/agent/claude/native_options.go:21`；`runtime/third_party/claude-agent-sdk-go/options.go:2762`。工具能加载不代表所有交互已经接通，见 finding-01／02 |
| 子 Agent | 原生执行；Claude 开启子 Agent 文本转发并处理任务开始、进展、完成；Codex 映射协作工具事件 | `runtime/server/internal/agent/claude/native_options.go:26`；`runtime/server/internal/agent/claude/session.go:655`；`runtime/server/internal/agent/codex/activity.go`。未验证所有原生子 Agent 工作流 |
| 计划模式／提问 | Codex collaboration mode、Claude permission mode 和普通提问均有接入 | 存在主动改变的语义，见下一节；MCP elicitation 不属于已接入的普通提问 |
| 会话恢复／分叉 | 两个适配器都有原生 ID 恢复和分叉路径 | `runtime/server/internal/agent/codex/session.go:82`；`runtime/server/internal/agent/claude/session.go:94`。通用层恢复失败会尝试新建原生会话（`runtime/server/internal/api/usecase/session.go:1933`），不能承诺所有失败情况下仍保留完整原生状态 |
| 新版能力发现 | Codex 读取原生模型列表及 effort；Claude effort 列表固定为五档 | `runtime/server/internal/agent/codex/session.go:751`；`runtime/server/internal/agent/claude/session.go:428`；`runtime/third_party/claude-agent-sdk-go/client.go:1504`。新 CLI 能力不会自动全部成为界面选项 |

## 主动采用的产品行为

这些是可确认的差异，不在本次审计中擅自撤销：

- Codex 异步提问会触发 `turn/interrupt`，等待用户明确回答，再向同一线程发送新的用户输入。它保留问题，但改变了原生“提问后可继续独立工作”的执行方式。证据：`runtime/server/internal/agent/codex/async_questions.go:21`、`:118`。
- 从最高权限进入 Claude 计划模式后，插件按工具名白名单自动允许或拒绝请求。未在名单中的 Bash、MCP 工具和非 Explore 子 Agent 请求会被拒绝，而不是都交给原生策略或用户判断。证据：`runtime/server/internal/agent/claude/approval.go:23`、`:37`。仅描述进入回调后的行为，不声称所有只读 Bash 都会触发回调。
- 输入区默认最高权限、绑定当前 IDEA 项目以及移除 worktree 是当前产品要求，不作为原生能力缺陷计数。
- 当前没有覆盖所有原生 CLI 的终端命令、后台任务管理、MCP 管理及新增交互界面。原生执行能力与客户端界面覆盖需要分别评价。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
| --- | --- | --- | --- | --- | --- |
| 1 | bug | P1 | high | Codex 未响应 MCP elicitation 与额外权限请求 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | high | Claude MCP 用户输入和原生对话框未接入 | [finding-02.md](finding-02.md) |
| 3 | bug | P1 | medium | Claude 附加 effort 参数可能覆盖界面选择 | [finding-03.md](finding-03.md) |
| 4 | performance | P1 | medium | Codex 慢消费者可能丢失审批或完成事件 | [finding-04.md](finding-04.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
| --- | --- | --- | --- | --- |
| bug | 0 | 3 | 0 | 3 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 1 | 0 | 1 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| 合计 | 0 | 4 | 0 | 4 |

现有 architecture 只覆盖工具活动展示，不能据此推定完整原生协议的架构承诺。本报告也不是全仓库安全或性能审计。

## 验证

定向回归通过，覆盖两个适配器、两个 SDK 及会话 usecase 共五个包：

- `node scripts/test-runtime.mjs ./server/internal/agent/codex ./server/internal/agent/claude github.com/fanwenlin/codex-go-sdk/codex github.com/roasbeef/claude-agent-sdk-go -run 'Test(Native|BuildTurnParams|OpenSessionInherits|ProtocolHandleElicitation|ProtocolHandleUserDialog|PlanMode|FullAccessPlan|ClaudeModelInfo|AsyncQuestion|CanceledNative|PendingQuestion)' -count=1`
- `node scripts/test-runtime.mjs ./server/internal/api/usecase -run 'Test(NativeDefaults|BuildPromptAddsReplyTips|EnsureRuntimePermissionMode|NativeBackground)' -count=1`

日志：`build/reports/native-capability-audit-tests.log`、`build/reports/native-capability-audit-usecase-tests.log`。这些是协议／参数和模拟交互验证，不是实际模型效果、所有功能或真实 IDEA/JCEF 的端到端通过证明。

## 下一步建议

优先通过 cs-issue 补齐两个 CLI 的用户输入／权限回调，再处理 Codex 关键事件可靠交付和 Claude effort 参数优先级。之后在同一 CLI 版本、账号、配置、项目和提示词下，对照终端与插件的编码、计划、MCP 交互、子 Agent、压缩及恢复任务；检查真实出站参数和原生确认信息，而非只看界面标签。

## 官方参考

- [OpenAI：Codex App Server](https://developers.openai.com/codex/app-server)，尤其是 Permission requests、MCP server elicitation requests 和 Lifecycle overview。
- [Claude Code：程序化运行](https://code.claude.com/docs/en/headless)。
- [Claude Agent SDK：系统提示词](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)。

查阅日期：2026-09-14。Codex 请求名称另经本机 0.154.0 生成的 `ServerRequest.json` 交叉核对。
