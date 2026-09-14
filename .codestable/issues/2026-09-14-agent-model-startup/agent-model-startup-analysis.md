---
doc_type: issue-analysis
issue: 2026-09-14-agent-model-startup
status: confirmed
root_cause_type: logic
related: [agent-model-startup-report.md]
tags: [agent, model, startup, concurrency]
---

# Agent 启动识别根因分析

## 1. 问题定位

以下行号指修复前基线 `4e0a829`。

| 位置 | 证据 |
|---|---|
| `runtime/server/internal/agent/probe.go:258` | Windows 跳过首次运行时探测。 |
| `runtime/server/internal/agent/probe.go:789` | 命令存在时填入 `ProbeError = "probe pending"`，被 normalizeStatus 映射成公开错误。 |
| `runtime/web/src/components/AgentSelector.tsx:750` | 问号打开错误详情，重启按钮才触发恢复。 |
| `runtime/web/src/App.tsx:9697` | 首次连接和重连不补拉 Agent 状态。 |
| `runtime/web/src/services/agents.ts:159` | 强制刷新仍复用旧在途请求，可能读回事件之前的快照。 |
| `runtime/third_party/codex-go-sdk/codex/app_server_exec.go:141` | Codex 已调用 Windows 隐藏窗口配置。Claude subprocess 与 ACP process 同样已有对应设置。 |

## 2. 失败路径

命令检测成功 → 缓存“不可用，probe pending” → Windows 跳过深度探测 → API 持续返回该缓存 → 选择器展示问号，没有模型入口。

其他平台：自动探测期间也显示伪错误。如果完成事件发生在 WebSocket 注册前或断线期间，App 不补拉；若事件赶上旧 GET 尚未完成，强制请求会复用旧快照，同样可能保留过期状态。

## 3. 根因

主因是初始化状态和失败状态混用，叠加过时的 Windows 自动探测禁用策略。历史禁用是为了避免空白控制台窗口，但目前三个传输都已经在启动子进程时应用 `HideWindow` / `CREATE_NO_WINDOW`，禁用策略没有随之移除。

另外两个确定存在的时序缺口是连接后未补拉，以及在途请求吞掉强制刷新。它们由代码与受控回归确认；不将其描述为用户截图已经证明的具体触发顺序。

## 4. 影响面

影响启动、重新安装/启动、新增 Agent 配置以及连接恢复后的模型列表。共享选择器的等待状态也受影响。修复不修改登录凭据、模型默认值、用户会话和工具活动区的双计时显示。

## 5. 修复方案

**方案 A（采纳）**：恢复各平台的一次自动探测；独立 `probe_pending` 状态；完成、失败时结束 pending；选择器显示加载状态并保留真实错误；连接/重连补拉；强制刷新在旧请求结束后合并补读。继续使用现有后台探测去重和初始超时，保持 Windows 隐藏窗口代码。

**方案 B**：只隐藏 `probe pending` 并保留手动重启。改动少，但仍无法自动获取模型，不能满足报障期望。

**方案 C**：持久化模型能力并启动时读取。可缩短等待，但旧缓存可能与升级后的 CLI/账号不一致，且首次安装仍需补全自动探测，不作为本次前置条件。

本轮按既有修复授权执行 A，没有单独追加方案审批。范围限定为 `probe.go`、两个状态广播位置、`App.tsx`、Agent 状态服务/选择器/中英文文案，以及对应启动、刷新、浏览器和完整 App 冒烟测试。版本号、已发布资产不改。

用户进一步指出问号不可理解、不可发现后，共享选择器的修复范围补充为：移除问号及封闭状态下的感叹号徽标；Agent 名称下直接展示状态和两行原始原因摘要，完整错误仍可展开；当前选中 Agent 出错时默认显示完整详情；查看详情、重启均使用文字按钮。仅对 CLI 明确声明登录要求的文字显示“需要登录”，其他错误使用“暂不可用”并展示实际原因，不猜测根因。
