---
doc_type: issue-fix
issue: 2026-10-23-answer-and-network-status
path: fast-track
fix_date: 2026-10-23
tags: [ask-user, websocket, desktop, recovery]
---

# 回答状态残留与断网提示修复记录

## 1. 问题描述

- 用户提交选择题答案且 Agent 已继续执行后，旧问题仍显示为可回答，底部持续显示“等待你的回答”。
- 桌面端物理断网后，本地 `127.0.0.1` WebSocket 仍然正常，界面没有离线提示而继续累计等待时间。
- 网络恢复后缺少明确的恢复反馈和失败会话的手动继续入口。

## 2. 根因

- 回答入口持久化 `complete` 后没有同步到已打开时间线。初版普通 `tool_call_update` 方案又会在消息晚于 `session.done` 时把已结束的回合重新标为 pending/streaming。
- WebSocket 心跳只能检测本地运行时连接，不能代表外部网络状态；原 watchdog 也未定期探测 OPEN 的僵死连接。
- `SessionViewer` 自定义 memo 比较遗漏 `connected`，单独的连接状态变化不会刷新活动条和恢复按钮（新增浏览器回归先失败，修复后重跑）。

## 3. 修复方案

- 回答成功后广播专用 `question_answered` 被动同步事件。只修改匹配 call ID 的现有问题及辅助历史，不改变 pending、进度时间或后续问题。服务端只把匹配当前问题的更正留在 replay 中，完成后到达不会重新创建 pending turn。
- watchdog 每 3 秒对 OPEN 连接探测，2 秒无响应进入重连。同时独立订阅浏览器 online/offline 状态，离线覆盖普通等待/停滞趣味提示，全局提示不依赖任务是否运行。
- 联网后显示 8 秒安静提示，不自动发送请求。已收到错误终态的普通 Agent 会话保留“继续此会话”按钮；运行中、离线、本地连接断开及发送中均不能继续。原始 shell 命令不提供自动重跑。
- “继续”在原 root/session 内发送明确的新请求，要求先核对已完成工作再继续剩余任务；保留 Agent/model/mode/effort/fast_service，不读取或覆盖输入草稿。不是断点重放，也不承诺业务操作天然幂等。
- 恢复状态保存在页面内服务中，切换视图后仍可恢复；新回合清除旧错误。请求锁跨主视图/抽屉共享，防止双击发送；服务端拒绝、发送失败和只收到完成 replay 都能释放锁。普通队列拒绝不误终止当前运行流。
- memo 比较补上 `connected`。保留已有桌面 Enter/IME 修复和安静工作台表情，不引入自动重发或连续动画。

## 4. 改动文件清单

- `runtime/server/internal/api/ws.go`
- `runtime/server/internal/api/stream_hub.go`
- `runtime/server/internal/api/ws_test.go`
- `runtime/web/src/App.tsx`
- `runtime/web/src/services/session.ts`
- `runtime/web/src/services/answeredQuestion.ts`
- `runtime/web/src/hooks/useNetworkOnline.ts`
- `runtime/web/src/components/SessionActivity.tsx`
- `runtime/web/src/components/SessionViewer.tsx`
- `runtime/web/src/components/SessionRecovery.tsx`
- `runtime/web/src/layout/IdeaWorkbench.tsx`
- `runtime/web/src/index.css`、中英文 locales
- `runtime/web/tests/question-delivery.test.mjs`
- `runtime/web/tests/answered-question.test.mjs`
- `runtime/web/tests/answer-network-regression.test.mjs`
- `runtime/web/tests/session-stream-lifecycle.test.mjs`

## 5. 验证结果

- [x] 服务端回归确认回答后广播 `question_answered`，状态为 `complete` 且包含持久化答案；迟到更正不会复活已完成回合或污染下一问题。
- [x] watchdog 回归确认会探测 `OPEN` 连接、收到消息后取消旧超时、无响应时触发重连。
- [x] `api`、`session`、`agent/codex`、`agent/claude` 完整包测试通过；新增服务端回归 `go test -race` 通过。
- [x] 真实 Chrome 组件测试覆盖提交回答、完成后迟到更新、离线时 localhost 仍 OPEN、联网不重发、保留草稿、手动继续目标与双击、防止跨会话错误污染。
- [x] 浅色/深色窄桌面侧栏截图检查、键盘焦点、reduced-motion 与横向溢出检查通过。UI 恢复规范只影响状态文案、可达性和禁用反馈，不改变视觉体系。
- [x] TypeScript 类型检查通过。
- [x] 最终全量前端回归（补上连接状态 memo 修复后）：221/221 通过，0 失败、0 跳过。使用已安装的 Chrome 运行浏览器测试，不依赖缺失的 Playwright Chromium 下载。
- [x] Vite/Gradle 构建、58 项插件测试与配置校验通过；`git diff --check` 通过。Review 发现的连接状态 memo 遗漏已经修复，没有剩余已确认阻塞项。
- [x] 同版本 `0.1.23-local.18` Mac ARM64 / Windows x64 ZIP 已生成。ZIP CRC、插件版本、单一目标二进制格式/架构/执行权限通过；两包 160 个 web 文件逐字节一致，生产 bundle 确认包含 `question_answered`、手动继续和联网恢复文案。

测试包（`build/local-packages/`）：

- `idea-ai-agent-0.1.23-local.18-macos-arm64.zip`，SHA-256 `34c8c64d4f8adafef51152b77aa94ae2c3dca36d520587b771a52ceffec84f49`
- `idea-ai-agent-0.1.23-local.18-windows-amd64.zip`，SHA-256 `5f76995525ec96f2c346db72103a1a02d902cb7e6c05de1d1656f7867ff335e5`

## 6. 遗留事项

- 浏览器 online 只代表操作系统报告的网络可用性，不保证模型服务、代理、DNS 可达；未接入外部探测请求。无进展 30/90 秒只是提醒，不宣称超时或失败。
- 恢复入口基于本次页面生命周期内收到的错误，不从历史文字猜测失败。整页重载后若没有服务端错误 replay，不会人为重建按钮；仍可在原会话输入继续指令。
- 真实 Windows/macOS IDE 的物理断网、中文输入法和安装体验仍需用户验收。浏览器模拟离线不等于双平台真机通过。
- 先前 `/plan` 偶发停止尚无稳定复现证据，本次不把它冒称为已定位并修复的问题。
