---
doc_type: audit-finding
audit: 2026-09-14-native-agent-parity
finding_id: performance-04
nature: performance
severity: P1
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 04：Codex 事件拥塞会静默丢失关键协议消息

## 速答

Codex SDK 用同一个有界队列分发所有事件，队列满后直接丢弃，不区分可合并的输出增量与必须送达的审批／完成消息。

## 关键证据

- `runtime/third_party/codex-go-sdk/codex/app_server_exec.go:284`：

```go
for ch := range a.subs {
    select {
    case ch <- event:
    default:
        // Drop if the subscriber is too slow.
    }
}
```

- `runtime/third_party/codex-go-sdk/codex/app_server_exec.go:1554`：队列容量为 256；`:297` 为每个订阅者创建该队列。
- `runtime/third_party/codex-go-sdk/codex/app_server_exec.go:1719`：向下游 output 的写入可以阻塞，输出通道在 `:552` 创建时没有缓冲。
- `runtime/third_party/codex-go-sdk/codex/app_server_exec.go:1475`：当前 turn 的结束依赖收到并处理终态事件；事件丢失不产生显式错误或补偿。

## 影响与置信度

高频命令输出、多个活跃线程或下游处理较慢时可能触发。若丢失审批请求，用户无法回应；若丢失完成事件，原生 CLI 已完成但插件可能仍显示运行中。输出增量也可能不完整。

medium：丢弃条件和影响路径明确，但本轮没有进行拥塞复现，也没有证据证明用户此前的具体会话遭遇了该条件。

## 修复方向与建议动作

建议 cs-issue：保证带请求 ID 的交互和生命周期终态可靠交付；将可合并增量与控制消息分开处理，并在无法继续可靠消费时显式失败／重新同步。

## 修复跟进（2026-09-14）

本发现已在当前工作区修复并通过回归。详见 [修复记录](../../issues/2026-09-14-native-interactions/native-interactions-fix-note.md)。上文保留审计时证据；既有本地 ZIP 尚未更新。
