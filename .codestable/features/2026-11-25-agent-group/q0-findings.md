# Q0 前提验证记录（2026-11-25）

本文件记录进入 Q1 实现前对代码库、本机 CLI 只读能力、全局规则/Skill 目录以及独立会话底座的实测结果。

## 1. 各 Agent 只读能力实测（临时目录 `/tmp` 隔离实测）

- **Codex（本机 `codex-cli 0.169.1`，`codex-sdk`）**
  - 在临时目录执行 `codex exec -s read-only` 要求其直接修改 `target.txt` 并用 Shell 执行 `echo MODIFIED > target.txt && touch extra.txt`。
  - **结果**：OS 沙箱直接拦截写盘，输出 `sh: target.txt: Operation not permitted`，原文件内容未变、无新增文件。SDK 传入 `SandboxMode: "read-only", ApprovalPolicy: "never"` 即可原生保障只读。
- **Claude（本机 `Claude Code 2.1.327`，`claude-sdk`）**
  - 在临时目录实测 `claude -p --permission-mode plan`：原文件未被修改，但暴露两个细节：
    1. `plan` 模式的内置系统提示会引导 Claude 往 `~/.claude/plans/*.md` 生成实现计划文件，偏离代码审查职责；
    2. 当前后端 `runtime/server/internal/agent/claude/approval.go` 的 `automaticToolPermission` 仅在 `previousPermissionMode == bypassPermissions` 时自动拦截非只读工具，且放行了 `ExitPlanMode`。
  - **结论**：审核会话不借用 `plan` 模式，直接为 Claude 会话增加显式 `ReadOnly: true` 标记，在 `handleCanUseTool` 回调层只放行只读工具（`Read` / `Glob` / `Grep` / `Search` / `Explore` / `LS` / `Skill`），对其余写盘与命令执行工具直接返回 `PermissionDeny`。
- **ACP 类 Agent（`agents.json` 中除 `codex`、`claude` 外的其余 17 个，含 `antigravity` `agy 1.5.16`、`gemini`、`hermes`、`opencode` 等）**
  - `antigravity` 确认走 `acp`（`agy acp`）。
  - `runtime/server/internal/agent/acp/session.go` 中 `SetPlanMode` 为空实现，且 `acp/process.go` 的 `RequestPermission` 当前默认自动选择 Allow。
  - **结论**：对 `ReadOnly: true` 的 ACP 会话，在 `RequestPermission` 中对非只读工具（`edit` / `delete` / `move` / `execute`）自动返回 `Reject`，同时叠加审核前后工作区快照对比（排除 `.mindfs/runs/<run-id>/`）兜底提示。

## 2. 本机全局规则与 Skill 盘点（跨 Agent 不对称）

实测扫描本机目录发现各 CLI 可见的个人规范与 Skill 并不一致：

- **全局规则文件**：
  - `~/.codex/AGENTS.md`（82 行）：包含“避免过度防御和过度设计”与“沟通与文档表达规范”两项长期准则；
  - `~/.claude/CLAUDE.md`（4 行）：仅剩注释，无实质规则。若用 Claude 担任审核模型，Claude 默认读不到 `~/.codex/AGENTS.md`。
- **Skill 目录**：
  - `~/.codex/skills`：38 个（含 `cs*` 全套、`impeccable`、`ui-ux-pro-max`、`unslop`、`playwright` 等）；
  - `~/.claude/skills`：5 个（`browser-bridge`、`browser-use`、`impeccable`、`ui-ux-pro-max`、`unslop`），另有 `~/.claude/plugins/marketplaces/codestable`；
  - `~/.gemini/skills`：不存在；`~/.gemini/config/skills` 软链指向 `~/.agents/skills`，而 `~/.agents/skills` 当前仅有 `browser-bridge`、`browser-use` 2 个。

待作者确认审核提示应注入哪些个人规则与 Skill（见 `README.md`）。

## 3. 独立界面外壳与现有底座复用核实

1. **阶段/成员会话与普通单聊列表隔离**：
   - `runtime/server/internal/session/manager_db.go` 的 `sessionListWhere` 支持按 `TopLevelOnly`（`parent_session_key = ''`）过滤。为每个阶段/成员创建标准 `session.Session` 时设置归属运行标识并在普通列表查询中排除协作会话，即可直接复用现有落盘、历史重放、空闲释放与前端 `SessionViewer`，同时不出现在普通单聊列表中。
2. **同 Agent 多模型并发进程池隔离**：
   - `runtime/server/internal/api/usecase/session_runtime.go` 使用 `agentPoolSessionKey(current.Key, agentName)` 作为 `Pool` 键。每个阶段/成员拥有独立 `session.Key`，同一运行内多个槽位同时使用同一 Agent 的不同模型（如 Opus + Sonnet）天然隔离。
3. **多路活动订阅与窄右栏（~300px）渲染**：
   - `useWorkspaceEvents.ts` 已在单一项目级 WebSocket 上按 `session_key` 多路分发流式事件，无需额外连接；
   - `runtime/web/tests/menu-controls.test.mjs` 已覆盖 `320px` 宽度下 `AgentSelector` 与 `PermissionSelector` 的不截断测试。
