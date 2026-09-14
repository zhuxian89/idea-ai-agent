---
doc_type: issue-fix
issue: 2026-09-14-user-message-alignment
fix_date: 2026-09-14
tags: [ui, session, activity, layout]
---

# 用户消息停在聊天区域中间偏右

## 现象与期望

用户截图 `image (13).png` 显示用户消息右侧仍有大块空白。用户随后明确纠正：消息应该靠最右边，现在却停在中间。期望是贴齐聊天内容区右边缘并保留现有页面内边距，助手正文继续靠左。

## 根因

`SessionViewer.tsx:1755` 的用户消息使用 `alignSelf: flex-end` 和 `maxWidth: 80%`。工具活动分组在 `ActivityTimeline.tsx:42` 新增稳定成员容器后，消息的直接父级变成普通 block，`align-self` 失效。外层消息盒被限制在左起 80% 宽度，内部气泡再靠该盒右侧排列，因此停在页面约 80% 的位置。

浏览器基线回归在 Codex/Claude、375px/1080px 四种组合中均复现。1080px 视口内，用户消息右边缘为 `854.390625px`，期望内容区右边缘为 `1064px`。证据：`build/reports/session-message-layout-baseline.log` 及 `build/reports/session-message-layout/baseline-*.png`。

## 修复

通过 `ActivityTimeline.tsx` 与 `ActivityTimeline.css` 为每个稳定成员容器恢复纵向 flex 布局，使原有消息对齐规则继续有效。保留分组缩进与显式 `[hidden]` 隐藏规则，避免 flex 覆盖折叠状态。没有调整消息顺序、80% 最大宽度、内容区边距或用户消息本身的气泡样式。

## 验证

- `node --test tests/session-message-layout.test.mjs tests/activity-segment-grouping.test.mjs`：16 项通过，日志为 `build/reports/session-message-layout-tests.log`。
- Codex/Claude、375px/1080px 均验证短文本、长文本、图片消息及消息操作栏与内容区右边缘对齐；助手保持左对齐和完整内容宽度；用户消息保持 80% 最大宽度；无横向溢出，消息垂直顺序正确。
- 展开、折叠工具活动组以及追加回复后，对齐仍正确。原有活动组的焦点、DOM 保持、滚动、双计时和边界回归通过。
- TypeScript 检查通过，`git diff --check` 无错误。
- 已查看宽屏与窄侧栏截图：`build/reports/session-message-layout/fixed-claude-1080.png`、`build/reports/session-message-layout/fixed-codex-375.png`。修复后宽屏气泡右边缘恢复到 `1064px`，即保留 16px 内容区边距。
- 浏览器验证使用真实 SessionViewer 和受控会话，未发送真实模型请求，未在已安装 IDEA/JCEF 内替换插件验证。

## 交付状态

修改在本地 `main`，未提交、未推送、未打包。保留此前 Agent 自动识别及状态文字交互的工作区修改。

## 后续发布

用户随后授权推送和发布，本次修复已纳入 `0.1.15` 发布源码。安装包及验证边界见 `docs/releases/v0.1.15.md`；上面的本地交付状态记录修复当时的情况。
