---
doc_type: audit-finding
audit: 2026-09-14-native-agent-parity
finding_id: bug-02
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 02：Claude MCP 输入和原生对话框默认拒绝或取消

## 速答

普通 AskUserQuestion 已接入，但 MCP elicitation 和原生 user dialog 是不同的回调；当前插件未注册它们。

## 关键证据

- `runtime/server/internal/agent/claude/native_options.go:13`：完整 options 列表只设置 `WithCanUseTool(s.handleCanUseTool)`，没有 `WithOnElicitation`、`WithOnUserDialog` 或 supported dialog kinds；OpenSession 的后续追加项也未注册这些回调。
- `runtime/third_party/claude-agent-sdk-go/protocol.go:356`：`result := ElicitationResult{Action: ElicitationActionDecline}`，只有非 nil 的 `OnElicitation` 才覆盖默认值。
- `runtime/third_party/claude-agent-sdk-go/protocol.go:397`：`result := UserDialogResult{Behavior: UserDialogBehaviorCancelled}`；没有回调时维持取消。
- `runtime/third_party/claude-agent-sdk-go/options.go:86`：未声明支持的 dialog kinds 不会由 CLI 路由给客户端，相应功能采用无对话框行为。
- 现有 `TestProtocolHandleElicitationRequest` 的 `nil callback declines` 子用例，以及 `TestProtocolHandleUserDialogRequest` 定向运行通过，证实 SDK 默认处理方式。

## 影响

MCP 服务请求用户填写表单或确认流程时，用户无法在插件中处理，SDK 直接回绝。依赖特定原生对话框的功能可能不被启用，或收到后被取消。不能据此说全部 MCP 或普通 AskUserQuestion 不工作。

## 修复方向与建议动作

建议 cs-issue：将这两类原生交互接入已有提问基础设施，按各自数据结构保留 schema、URL、结果与取消语义；仅声明实际支持的 dialog kinds。

## 修复跟进（2026-09-14）

本发现已在当前工作区修复并通过回归。详见 [修复记录](../../issues/2026-09-14-native-interactions/native-interactions-fix-note.md)。上文保留审计时证据；既有本地 ZIP 尚未更新。
