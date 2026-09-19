---
doc_type: issue-fix
issue: 2026-09-19-jump-bottom-button-stuck
path: fast-track
fix_date: 2026-09-19
tags: [frontend, session-viewer, scrolling]
---

# “回到底部”按钮滚动到底后不消失修复记录

## 1. 问题描述

用户展开活动详情后手动将会话滚动到底部，“回到底部最新消息”按钮仍然显示。

## 2. 根因

`SessionViewer` 先判断活动详情阅读状态，后判断是否已接近底部。阅读状态为真时，即使已到底部也会继续禁用自动跟随并保留按钮。

## 3. 修复方案

将“已接近底部”提到阅读状态之前判断：进入 40px 底部阈值时立即结束阅读暂停、恢复自动跟随并隐藏按钮。

## 4. 改动文件清单

- `runtime/web/src/components/SessionViewer.tsx` — 调整底部与阅读状态的判断优先级。
- `runtime/web/tests/activity-detail-lifecycle.test.mjs` — 新增手动到底后按钮消失、新消息继续跟随的真实 Chromium 回归。

## 5. 验证结果

- `node --test --test-concurrency=1 tests/activity-detail-lifecycle.test.mjs`：11 项全部通过。
- `corepack pnpm run typecheck`：通过。
- Gradle `test verifyPluginProjectConfiguration buildPlugin --offline`：通过。
- macOS Apple Silicon 本地包 `0.1.23-local.5` 已生成并通过版本、ZIP、Mach-O arm64 和可执行权限校验。

## 6. 遗留事项

- 等待用户在 IDEA 中安装 `local.5` 后完成实机交互确认。
