---
doc_type: issue-fix
issue: 2026-11-10-session-disconnect-reconnect
path: fast-track
fix_date: 2026-11-10
tags: [websocket, lifecycle, reconnect]
---

# App 卸载后自动重连修复

## 问题与根因

App 卸载时调用 `sessionService.disconnect()`，关闭连接但保留 `rootId`。
常驻的 3 秒看门狗及页面唤醒事件仍将它视为需要连接的会话，再次建立 WebSocket。
卸载前正在准备的连接也可能在异步准备结束后打开。

## 修复

`runtime/web/src/services/session.ts` 的 `disconnect()` 首先将 `rootId` 清为 `null`，
沿用已有检查停止自动重连及尚未打开的连接。重新挂载时显式调用 `connect(rootId)`，恢复连接目标。

## 验证

新增 `runtime/web/tests/session-connection-lifecycle.test.mjs`，在浏览器内挂载和卸载使用真实 SessionService 的 React 组件。
修复前两项用例均失败，修复后均通过，覆盖卸载后经过看门狗周期、页面唤醒事件、准备中的连接、重新挂载和意外断线自动重连。

- `node --test tests/session-connection-lifecycle.test.mjs tests/question-delivery.test.mjs tests/send-failure-resend.test.mjs`：11 项通过。
- `npm run typecheck`：通过。
