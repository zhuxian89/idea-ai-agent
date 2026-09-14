---
doc_type: issue-fix
issue: 2026-09-14-agent-model-startup
fix_date: 2026-09-14
tags: [agent, model, startup, windows]
---

# Agent 启动模型识别修复

## 修改

- 各平台启动时自动探测已配置 Agent；新增配置也采用有初始超时的探测路径。移除过时的 Windows 禁用分支，传输层原有隐藏控制台窗口设置保留。
- HTTP 和 WebSocket 提供独立 `probe_pending`。探测完成、真实失败和成功交互均结束等待状态，初始化不再填充错误字符串。
- 选择器名称下直接显示“正在识别模型”等状态文字；真实错误显示“需要登录”或“暂不可用”和最多两行原始原因摘要，不再使用问号隐藏信息。主按钮的感叹号也改为状态文字。
- “查看详情”和“重启 Agent”均有可见文字。打开菜单或切换到当前出错的 Agent 时直接展示完整错误；恢复成功后旧错误面板自动切回模型选项。
- App 首次连接、重连均补拉 Agent 列表。探测事件遇到在途请求时，在其结束后合并补读，直到得到包含最新事件的快照。

## 验证

- `node scripts/test-runtime.mjs ./server/internal/agent ./server/internal/api/... -count=1` 通过。新增测试走实际 Prober.Start / UpdateConfig 链路，以受控会话验证无需手动重启即可发布模型，以及失败退出 pending。
- 前端刷新服务测试通过：过期在途快照、多次通知合并、普通请求去重、catalog 隔离、错误恢复。将同一测试用于基线源码，确认旧实现因复用 pending 快照而失败，证据：`build/reports/agent-discovery-baseline.log`。
- 选择器 Chrome 测试通过：375px 等待提示、菜单打开时接收模型、真实错误可查看；未触发重启。
- TypeScript 检查及 Vite/本地运行时构建通过。
- Windows Agent 测试包及完整运行时交叉编译通过。Windows 实机行为未验证。
- `node scripts/smoke-runtime.mjs` 全部通过，见 `build/reports/agent-discovery-smoke.log`。新增完整 App 测试分别控制首次连接、断线重连和实时状态事件，模型无需手动重启即可刷新；同时通过既有 Agent 管理、发送/队列/会话模型、工具活动及双计时回归。
- 已查看 375px 菜单等待态和整页模型恢复截图：`build/reports/agent-discovery/pending.png`、`build/reports/agent-discovery-app.png`。浏览器为 Chrome，未替代 IDEA/JCEF 和 Windows 实机验收。

后续文字状态交互验证：

- `node --test tests/agent-discovery.test.mjs tests/menu-controls.test.mjs tests/agent-lifecycle-restart.test.mjs`：20 项通过。覆盖不点击就能看到错误摘要、明确的文字入口、键盘展开、选中错误 Agent 默认显示完整详情、重启等待状态和恢复后切回模型。
- 320px 中文浅色、375px 英文深色及长 Agent 名称/结构化长错误均无横向溢出。截图：`build/reports/agent-discovery/visible-errors-zh-CN-320.png`、`build/reports/agent-discovery/visible-errors-en-US-375.png`。已做两轮有边界的视觉检查，修掉英文同义状态重复显示。
- 完整 App 冒烟通过：`build/reports/agent-status-labels-smoke.log`。最后的重复文案消除及加载提示调整另经组件浏览器回归和 TypeScript 检查通过；构建日志：`build/reports/agent-status-labels-build.log`。

## 交付状态

修复位于本地 `main` 工作区，未提交、未推送、未重新发布。已发布的 `0.1.14` 安装包不包含本次修改。未替换正在运行的 IDEA 插件，也未调用真实模型或修改用户配置。

## 后续发布

用户随后授权推送和发布，本次修复已纳入 `0.1.15` 发布源码。安装包及验证边界见 `docs/releases/v0.1.15.md`；上面的本地交付状态记录修复当时的情况。
