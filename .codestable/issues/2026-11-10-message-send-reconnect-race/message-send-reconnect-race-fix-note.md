---
doc_type: issue-fix
issue: 2026-11-10-message-send-reconnect-race
path: fast-track
fix_date: 2026-11-10
tags: [websocket, message-delivery, reconnect]
---

# 发送失败后仍被重连补发的竞态修复

## 问题与根因

首次发送尚在异步编码时，消息已经加入 `pendingMessages`。
重连的 `onopen` 会取出它并启动补发；原发送随后返回失败并删除记录，也无法取消已启动的补发。
用户按失败提示重试会产生另一个请求 ID，同一内容可能被分别接受。

## 修复

`session.ts` 的 `sendTracked()` 在首次发送返回成功后，才将消息加入待确认列表。
重连仅补发已发送但尚未确认的消息，继续沿用原请求 ID；服务端确认后移除记录。
普通消息和 slash command 共用该处理。

测试 fixture 改用 SessionService 的真实连接处理器，通过异步编码控制首次发送与重连顺序。
两个浏览器用例分别验证失败后手动重试只发送新消息，以及成功未确认消息沿用原 ID 补发、确认后停止补发。

## 验证

- 修正测试后、修改实现前：竞态用例失败，观察到报告失败的 `msg-lost` 被发送；成功补发用例通过。
- 修改实现后：`node --test tests/send-failure-resend.test.mjs tests/question-delivery.test.mjs tests/session-connection-lifecycle.test.mjs` 共 11 项通过。
- `npm run typecheck`：通过。
- `git diff --check`：通过。
