---
doc_type: issue-fix
issue: 2026-09-24-enter-key-send
path: fast-track
fix_date: 2026-09-24
tags: [composer, keyboard, ime, desktop]
---

# 回车键偶发不发送消息修复记录

## 1. 问题描述

桌面端消息输入框有时按 Enter 不发送消息。窄工具窗口会按移动端规则处理 Enter；中文输入法结束组合后的 120ms 内，下一次 Enter 也会被静默消费。

## 2. 根因

- `ActionBar` 根据 `window.innerWidth < 768` 改变 Enter 行为，窄桌面工具窗口因此被误判为移动端。
- `compositionend` 后设置 120ms 时间保护窗，保护窗内所有 Enter 都被视为输入法组合事件，导致用户确认中文后快速再次按 Enter 时无法发送。

## 3. 修复方案

- 统一桌面端键盘语义：Enter 发送，Shift+Enter 换行，不再受窗口宽度、Chat/Command 模式或移动端偏好影响。
- 只根据当前组合状态、原生 `isComposing` 和 `keyCode === 229` 判断输入法事件，删除跨事件的 120ms 时间保护窗。
- 删除不再适用的“回车键发送”偏好、存储和设置入口。
- 增加处理函数级回归测试和真实 Chromium 窄窗口交互测试。

## 4. 改动文件清单

- `runtime/web/src/components/ActionBar.tsx`
- `runtime/web/src/App.tsx`
- `runtime/web/src/components/FileTree.tsx`
- `runtime/web/src/i18n/locales/en-US.ts`
- `runtime/web/src/i18n/locales/zh-CN.ts`
- `runtime/web/tests/composer-enter-key.test.mjs`
- `runtime/web/tests/idea-chrome.test.mjs`

## 5. 验证结果

- `node --test tests/composer-enter-key.test.mjs tests/composer-arrow-keys.test.mjs`：9 项通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `node --test tests/*.test.mjs`：197 项通过。
- `node --test tests/idea-chrome.test.mjs`：23 项通过；真实 Chromium 验证 430px 窄窗口、Shift+Enter 换行、Enter 发送及中文输入法组合结束后立即发送。

## 6. 遗留事项

无。
