---
doc_type: issue-analysis
issue: 2026-09-14-native-interactions
status: confirmed
tags: [codex, claude, native-protocol]
---

# 根因与修复范围

根因证据沿用 `.codestable/audits/2026-09-14-native-agent-parity/finding-01.md`、`finding-02.md`、`finding-04.md`。用户已授权修复这两类问题，不重复索取阶段确认。

实施方案：

1. Codex SDK 增加保留请求 ID／method／params 的原生交互回调，覆盖额外权限、MCP elicitation 及取消生命周期；适配器复用现有待回答状态及确认提交链路。
2. Claude 注册 MCP elicitation 与已知 `refusal_fallback_prompt` 对话框，未知 dialog kind 按协议取消；使用相同的表单与显式选择界面。
3. 表单用原生 schema 构建输入，服务端验证结构，错误可重试；拒绝／取消不要求填写表单。URL 仅经用户主动打开，授权范围只返回请求中的权限。
4. Codex 为每个订阅者使用独立按序缓冲，stdout 不被慢消费者阻塞；关闭时释放队列及 goroutine。开始 turn 前订阅，避免启动响应前的事件丢失。

影响面：`runtime/third_party/codex-go-sdk/{codex,types}`，`runtime/server/internal/agent/{types,codex,claude}`，`runtime/web/src/components/SessionViewer.tsx` 及新增原生交互表单组件／样式／翻译，`runtime/go.mod`／`go.sum`（schema 验证），相关回归测试、SDK 补丁说明和本 issue 文档。

不修改：Claude 计划工具白名单、Codex 异步提问暂停、思考强度参数优先级、worktree 移除改动。不提交、不发布；既有本地包不自动覆盖。
