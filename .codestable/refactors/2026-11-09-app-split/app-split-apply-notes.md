---
doc_type: refactor-apply-notes
refactor: 2026-11-09-app-split
---

# 变更与验证

## 最终变更

- 删除充值、余额、钱包 UI、专用服务、消息完成后的余额刷新及翻译。
- 删除任务看板、任务编辑器、模板管理、任务服务与缓存辅助函数。移除 App 的任务状态、启动请求、订阅更新、任务关联面板及引导。对应专用组件与测试一并删除。
- 删除已禁用的创建、导入、重命名、移除项目和 worktree 管理流程；清理 FileTree、DefaultListView 的相关接口和 UI。远程目录视图直接显示文件列表。
- Git、会话缓存、会话导航、消息发送和实时事件处理分别放在 `src/app/`。实时订阅与卸载清理留在 App。
- 新增接口不再复制宽泛的 action handler `any` 类型；工作区事件使用 `onOpenProject`，流事件复用会话缓存的函数类型。移除未使用的 `isTablet` 状态。
- 浏览器测试复现并修复会话切换问题：旧会话历史迟到时，会提前结束当前会话的加载提示。现在只有当前选中的项目和会话能结束该提示。

## Effect 与 request 核查

任务编辑器和创建项目 Hook 已删除，相关父子 effect 顺序与 request 身份问题随功能移除。

保留的 `useMessageSending`、`useWorkspaceGit` 没有 effect。`useSessionCache` 的列表同步 effect 在 App 的项目及会话 ref 同步之后注册；`useSessionNavigation` 的选择回调 ref 同步在 App 初始化与订阅 effect 之前注册。真实 App 的本地与远程启动用例覆盖这条初始化调用链。

## 验证结果

2026-11-09，在 `runtime/web/` 执行：

- `node --test tests/*.test.mjs`：273 项通过，0 失败，0 跳过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `git diff --check`：通过。

这 273 项包括已有源码文本断言，不能据此推断所有新模块已被完整运行覆盖。本次新增的运行测试为：

| 文件 | 实际覆盖 |
| --- | --- |
| `tests/app-hooks-browser.test.mjs`，7 项 | 旧会话历史迟到；发送目标和模型选择、发送失败恢复；新会话发送失败清理；跨项目 Git 状态与历史请求；暂存文件后的刷新；本地与远程真实 App 初始化不再请求任务接口、不展示项目创建控件 |
| `tests/app-event-handlers.test.mjs`，5 项 | 完成/取消与排队状态；卸载及新一轮消息后的迟到重放；跨项目文件通知；旧 slash command 输出 |

浏览器使用真实 React 与模块，API/Agent 响应由测试提供。保留任务加载错误分类测试，以及后端旧库迁移实现与测试。

## 结构现状

`App.tsx` 现为 7,838 行，`App()` 为 7,250 行。会话导航、发送和缓存 Hook 分别仍接收 51、37、24 个参数字段；多数状态仍由 App 持有。这轮完成了功能清理和代码分组，尚未完成会话状态解耦。

`sessionModel.ts` 的宽泛类型从原 App 沿用；按原 App 与拆出模块合计，含 `any` 的行数从 294 降至 291。行数用于记录现状，不作为类型安全或解耦完成的证明。
