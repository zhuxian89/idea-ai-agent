---
doc_type: issue-fix
issue: 2026-09-14-session-model
fix_date: 2026-09-14
tags: [idea, session, composer, agent, model]
---

# 发送后输入栏显示其他会话的 Agent 和模型

## 现象与根因

用户报告发送消息后，输入栏显示成其他会话的 Agent/模型，切走再切回才恢复。

完整 App 回归复现：先向 Claude 会话发送消息，再从历史打开正在运行的 Codex 会话并追加消息，界面从 `Codex · codex-model` 变成 `Claude Code · fable`。捕获的 WebSocket 请求仍使用正确的 Codex 会话 key、Agent 和模型。

`App.handleSendMessage` 对排队消息更新了 `activeBoundSessionKey`，但跳过 `setDrawerSessionForRoot`。输入栏先前因为主视图会话与绑定不同而显示主视图数据；发送后两个 key 相同，`actionBarSession` 转而优先使用旧的 `currentSession`，且不验证它的身份。`ActionBar` 将这份旧数据同步到本地 Agent/模型选择。重新打开历史会话又会同步 drawer，所以显示恢复。

另外，发送逻辑中的 `useTargetSessionDefaults` 在主视图与旧绑定会话不同时强制使用目标会话旧配置，忽略输入栏上的新选择。单独修正显示后，回归继续复现了实际请求模型错误：用户已选 `fable-alternate`，请求仍为 `fable`。同一分支也覆盖 Agent、权限、effort、fast service 和 shell。

## 修复范围

- `runtime/web/src/App.tsx`：排队发送也同步新绑定的 drawer 数据；主视图输入栏始终使用选中会话，drawer 回退要求会话 key/root 匹配；发送优先使用当前输入栏参数，仅缺少参数时沿用目标会话配置。
- `scripts/smoke-session-model.mjs`：新增完整应用 HTTP/WebSocket 受控回归，使用不同 Agent/模型的两份会话，断言显示与实际请求。
- `scripts/smoke-runtime.mjs`：常规浏览器冒烟加入该回归。
- `scripts/smoke-message-delivery.mjs`：既有夹具先等待请求到达，再回传 accepted，随后检查输入清空，兼容工作区正在开发的“收到确认后清空输入”流程。

保留工作区其他未提交修改，包括并行开发的压缩功能；未实现尚未选定的快捷切换交互。

## 验证

- 显示问题修复前失败证据：`build/reports/session-model-baseline.log`，期望 Codex，实际 Claude Code。
- 配置覆盖问题修复前失败证据：`build/reports/session-model-selection-baseline.log`，期望 alternate 模型，请求仍为原模型。
- 修复后 `node scripts/smoke-runtime.mjs --delivery-only` 通过：`build/reports/session-model-smoke.log`。覆盖双向切换、多次排队、发送确认前后、手动选择模型/权限、后台事件、权威用户消息、切换后恢复，以及空闲会话重新发送；同时通过原生指令入口和既有消息/活动栏回归。
- `node --test tests/menu-controls.test.mjs tests/session-stream-lifecycle.test.mjs tests/session-activity-lifecycle.test.mjs`：31 项通过，见 `build/reports/session-model-browser-tests.log`。
- TypeScript 检查与 Vite 构建通过，见 `build/reports/session-model-typecheck.log`、`build/reports/session-model-web-build.log`。
- 已查看 375px 完整页面截图：`build/reports/ide-session-model.png`。

浏览器验证使用当前工作区构建的前端，配合此前隔离构建目录中已修复原生入口的本地运行时；会话、Agent 和 WebSocket 使用受控数据，未调用真实模型。未在已安装的 IDEA/JCEF 内替换插件验证。

## 交付状态

仅本地代码与测试完成，未提交、未发布，未修改版本号或重打安装包。用户已经安装的 0.1.12 ZIP 保持原样；本次修复需在用户后续要求打包时一并交付。


## 后续发布源码

本次修复已纳入 0.1.13 发布源码。安装包及本轮验证边界见 `docs/releases/v0.1.13.md`；上述“未打包”说明记录的是修复当时的状态。
