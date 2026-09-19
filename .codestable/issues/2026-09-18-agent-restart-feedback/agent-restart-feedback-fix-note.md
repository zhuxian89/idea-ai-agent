---
doc_type: issue-fix
issue: 2026-09-18-agent-restart-feedback
date: 2026-09-18
severity: P2
tags: [idea, agent, restart, ux]
status: fixed
---

# Agent 重启反馈闭环 Fix Note

## 问题

IDEA Agent 设置页点击“重启”后，页面长期停留在“已请求重启，检测结果会在此更新”，异步探测完成时也没有成功/失败反馈。用户无法判断重启是否结束。

## 根因

重启 API 只结束旧进程并启动后台 `ProbeOne`；前端把“请求已提交”写成一次性固定文案。状态广播虽然存在，但重启前仍保留旧的 available 状态，前端也没有关联目标 Agent 的探测完成事件。

## 修复

- `Prober.MarkRestartPending`：重启时先清除旧运行状态，标记 `probe_pending=true` 并广播。
- `restartAgent`：杀掉旧进程后调用 pending 标记，再触发异步探测；探测结果继续通过既有 `agent.status.changed` 广播。
- IDEA 设置页：状态只挂在被重启的 Agent 卡片上。重启期间该卡片显示 loading 与“正在重启并检测连接状态…”；目标 Agent 从 pending 变为最终状态后，同一张卡片显示“重启完成，Agent 连接可用”或失败提示及探测错误。
- 失败结果使用 `alert` 语义，成功和检测中使用 `status`；其他 Agent 卡片不显示本次重启状态。

## 验证

- 新增 Go 回归：重启请求必须发布 pending 状态，后台探测必须发布完成状态，未知 Agent 不 panic。
- 更新前端结构回归：立即显示检测中，并等待 `probe_pending` 结束后再显示成功/失败。
- 已通过：`go test ./internal/agent ./internal/api -count=1`、`tsc --noEmit`、Agent 重启卡片级状态/IDE Chrome/语言持久化共 22 项前端测试、Gradle `test --offline`。
