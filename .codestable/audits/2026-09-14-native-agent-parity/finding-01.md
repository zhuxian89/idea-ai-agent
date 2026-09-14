---
doc_type: audit-finding
audit: 2026-09-14-native-agent-parity
finding_id: bug-01
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 01：Codex 两类原生交互请求未接入

## 速答

当前 CLI 发起 `mcpServer/elicitation/request` 或 `item/permissions/requestApproval` 时，客户端没有对应的响应路径，相关操作可能持续等待响应。

## 关键证据

- `runtime/third_party/codex-go-sdk/codex/app_server_exec.go:1539`：审批匹配只包含 commandExecution／fileChange；用户提问只匹配 `item/tool/requestUserInput`。
- `runtime/third_party/codex-go-sdk/codex/app_server_exec.go:1705`：只有上述匹配会调用 `submitApproval`／`submitAskUserResponse`。其他事件被转换为普通输出，没有发送 JSON-RPC response 的兜底。
- `runtime/third_party/codex-go-sdk/codex/app_server_exec.go:1748`：普通事件转换仅保存 params 和转换后的 type，不保留服务器请求 ID，后续适配器不能据此正常回复原始请求。
- `runtime/server/internal/agent/codex/session.go:996`：RawEvent 处理只有状态、token usage、plan；未补充这两类响应。
- 本机 `codex-cli 0.154.0` 导出的 `ServerRequest.json` 明确包含这两类方法；官方 App Server 文档分别要求返回 MCP 的 action/content 和权限的 permissions/scope。

关键分支：

```go
if args.ApprovalHandler != nil && isApprovalRequestedEvent(event.Method) {
    state.runRequest(func() { a.submitApproval(ctx, event, args.ApprovalHandler) })
}
if args.AskUserHandler != nil && isRequestUserInputEvent(event.Method) {
    state.runRequest(func() { a.submitAskUserResponse(event, args.AskUserHandler, ctx) })
}
```

## 影响

连接需要表单／URL 确认的 MCP 服务，或在受限执行策略下原生工具申请额外权限时触发。普通无需用户交互的 MCP 调用不受此结论覆盖。请求遗漏由协议和代码确认，本轮未运行模型制造等待场景。

## 修复方向与建议动作

建议 cs-issue：补齐请求识别、UI 交互和结构化响应；无 turnId 的合法 MCP 请求也需正确路由。其他服务器请求应明确处理或返回不支持，避免静默遗失。

## 修复跟进（2026-09-14）

本发现已在当前工作区修复并通过回归。详见 [修复记录](../../issues/2026-09-14-native-interactions/native-interactions-fix-note.md)。上文保留审计时证据；既有本地 ZIP 尚未更新。
