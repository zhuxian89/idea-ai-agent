---
doc_type: feature-ff-note
feature: agent-workbench-details
date: 2026-10-29
requirement:
tags: [desktop, activity, console, models]
---

## 做了什么

完善安静工作台：状态固定两行，只显示 Agent 原生工具信息或明确进行中的计划；支持主动刷新模型，以及将控制台选区交给当前或新会话分析。控制台内容只进入草稿，不自动发送、不打断执行。

## 改了哪些

- `SessionActivity.tsx`、`sessionActivityDetail.ts`、`toolActivitySummary.ts` — 真实活动细节、表情、独立计时与固定两行布局。
- `AgentModelRefresh.tsx`、`agentModelRefresh.ts` — 主动刷新 Agent/模型列表。
- `AnalyzeConsoleAction.kt`、`ConsoleContext.kt`、`useIdeaComposerContext.ts`、`composerDrafts.ts` — 原生控制台入口、选区处理与按会话隔离草稿。

## 怎么验证的

2026-10-25 的 Windows 测试包通过 236 项前端测试、64 项插件测试、类型检查、构建及旧库迁移/race 检查；浏览器覆盖窄桌面侧栏、深浅主题与长文字两行布局。用户于 2026-10-29 确认持续试用无问题，授权生成各平台包并 push；修复记录另见 `.codestable/issues/` 中本批三个 fix-note。
