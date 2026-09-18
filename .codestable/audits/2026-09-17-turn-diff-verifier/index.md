---
doc_type: audit-index
audit: 2026-09-17-turn-diff-verifier
scope: 当前未提交的 Plugin Verifier 兼容修复、共享 turn diff 捕获与 IDEA 原生对比
created: 2026-09-17
status: active
total_findings: 7
---

# Turn diff 与 Verifier 修复审查

## 范围

审查 `VoiceSettings.kt`、`LocalRuntime.kt`、JCEF bridge、`TurnDiffViewer.kt`、`internal/turndiff`、turn diff 用例/API、前端卡片与解析模型，以及公共会话流中的挂载点。对照已批准的 turn-diff-viewer design；本次只审查，不改产品代码、不发包。

## 总评

发现 7 项：3 项 P1、4 项 P2。路径约束、快照累计内存和 dirty 文件恢复时漏报应优先修复。新增/删除文件、快照一致性、左右视图解析和凭据构造器匹配也有确定缺陷。

Codex、Claude、ACP 适配器无未提交改动，公共挂载点未注入工具、提示词或权限参数。但观察器与 Agent 共用 runtime 进程，快照内存失控会影响服务存活，不能据此宣称旁路绝不影响原生会话。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 详情 |
|---|---|---|---|---|---|
| 1 | security | P1 | high | manifest 中的 blob 可越出快照目录 | [finding-01.md](finding-01.md) |
| 2 | performance | P1 | medium | Finish 累计保留内容没有内存预算 | [finding-02.md](finding-02.md) |
| 3 | bug | P1 | high | 本轮把 dirty 文件恢复到索引时漏报 | [finding-03.md](finding-03.md) |
| 4 | bug | P2 | high | 新增/删除文件无法进入原生对比 | [finding-04.md](finding-04.md) |
| 5 | bug | P2 | high | 补丁与 artifact 使用两次不同的读取 | [finding-05.md](finding-05.md) |
| 6 | bug | P2 | high | 左右视图误判空白行和连续符号开头的代码 | [finding-06.md](finding-06.md) |
| 7 | bug | P2 | high | 2026.3 构造器匹配条件永远不成立 | [finding-07.md](finding-07.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 4 | 5 |
| security | 0 | 1 | 0 | 1 |
| performance | 0 | 1 | 0 | 1 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| 合计 | 0 | 3 | 4 | 7 |

## 验证

- 现有 Go `turndiff`、`api/usecase`、`api` 测试通过。
- TypeScript 检查和 `turn-diff-workspace.test.mjs` 通过；该浏览器用例只覆盖普通修改文件。
- 临时独立副本/Go overlay 中的路径越界、dirty 恢复、新增/删除入口、累计内存、双次读取复现均失败，具体输出见各 finding；没有把临时测试写入产品源码目录。
- 直接执行现有前端解析函数，确认新增空白行和 `++j;` 的行类型/行号错误。
- 用本地 IDEA 2024.1 与 2026.3 EAP 的真实 jar 核对 `CredentialAttributes` 签名；2026.3 同时保留新 4 参数与旧 5 参数构造器。
- 已核对原有 `build/reports/turn-diff-verifier-final.log`：7 个目标 Compatible。本次未重新跑 Verifier，也未在 Windows IDEA 实机操作原生弹窗。静态 Verifier 不验证反射分支是否正确执行。

## 下一步建议

优先修复 P1 的 3 项，再修复 P2 的 4 项并加入对应回归。修复后重新生成本地 Windows x64 包验收。当前 local.16 不应直接作为这两项任务已完成的发布候选。
