---
doc_type: audit-finding
audit: 2026-10-29-remote-release
finding_id: bug-01
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: resolved
---

# 轮次交接过早释放准入

已修复并验证，详见 [修复记录](../../issues/2026-10-29-remote-release-review/remote-release-review-fix-note.md)。以下为修复前证据。

## 证据

- `runtime/server/internal/api/appcontext.go:908` 先 `hub.ClearSessionPending(sessionKey)`，下一行才 `hub.BroadcastSessionDone(...)`。
- `runtime/server/internal/api/stream_hub.go:464` 的 `reserveOrQueueSessionMessage` 在 Active 已清除时允许新消息立即开始。
- `runtime/server/internal/api/stream_hub.go:929` 将上一轮完成通知逐连接发送，完成通知没有与下一轮准入串行化。
- `runtime/web/src/hooks/useSessionStream.ts:515` 收到 done 时直接 `setIsStreaming(false)`；`services/session.ts:782` 按会话分发 done，没有排除已经开始下一轮的过期完成通知。

## 影响与复现

上一轮清理状态后、新一轮另一端发消息，可以在旧 done 发出前获得执行权。调度交错或某个浏览器慢连接时，新一轮用户消息/输出与旧 done 可能乱序，界面把仍在执行的新一轮显示为结束；这不是第二个 Codex 进程抢占 thread 的问题。

临时 Go overlay 探针创建真实 WebSocket，持有该连接写锁，调用 `AppContext.BroadcastSessionDone`；等待完成记录建立但发送仍被阻塞，再调用 `reserveOrQueueSessionMessage`。期望排队，实际返回可直接启动：

```text
TestReviewCompletionMustPublishBeforeNextAdmission
new writer admitted while previous completion is still blocked on the browser connection
```

该测试验证后端交接缺口；具体前端乱序时刻由多连接调度决定，未声称在用户手机上复现。

## 修复方向

保证上一轮终态发布完成之后才释放下一轮准入，并覆盖慢连接、并发新消息、既有队列及断线回放的顺序。建议 cs-issue 定点修复，不另建会话执行器。
