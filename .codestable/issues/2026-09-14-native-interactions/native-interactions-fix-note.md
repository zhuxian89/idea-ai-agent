---
doc_type: issue-fix-note
issue: 2026-09-14-native-interactions
status: fixed
fixed_at: 2026-09-14
tags: [codex, claude, native-protocol]
---

# 原生交互与事件可靠性修复

已修复用户授权的第 1、2 项。直接在当前工作区修改，没有创建 worktree、提交、发布或覆盖已有 macOS 本地 ZIP。

## 修复结果

- Codex 新增 MCP elicitation 和额外权限交互回调，保留原始请求 ID、method、params。没有 turnId 的 MCP 请求按 threadId 路由；多个订阅者只回应一次。服务器退休请求、结束回合或取消时，待回答状态会结束。
- Claude 注册 MCP elicitation、已知 `refusal_fallback_prompt` 回调，保留 control request ID。备用模型重试／修改提示词／取消按原生枚举返回；未知对话类型仍按协议取消。SDK 保留接受空对象表单的 content。
- 共用现有问题提交与服务端确认链路。MCP 表单支持标量、枚举、布尔值和数字输入，复杂结构提供 JSON 输入；服务端完整验证请求 schema，错误不会消费待回答状态，可以修改后重试。拒绝／取消不要求填表。URL 由用户主动打开并明确确认。
- 额外权限提供仅本轮／本会话／拒绝，批准数据只取自原始请求，客户端传来的额外权限字段不能扩大授权。
- Codex 每个订阅者独立按序缓存，消费清除引用，取消或关闭释放队列和 worker；不再在 256 条缓冲满后静默丢弃。订阅提前到 turn/start 之前，避免启动响应前的事件丢失。

## 文件范围

- `runtime/third_party/codex-go-sdk/{codex,types}`：订阅队列、turn 启动订阅时机、原生交互回调及类型传递、回归测试。
- `runtime/third_party/claude-agent-sdk-go/{options.go,protocol.go,protocol_test.go}`：回调 ID 和空对象响应。
- `runtime/server/internal/agent/{types,codex,claude}`：schema 校验、回调注册、问题生命周期及测试。
- `runtime/web/src/components/{SessionViewer.tsx,NativeInteractionFields.tsx}`、中英文词条、浏览器测试。
- `runtime/go.mod`、`go.sum`：新增 jsonschema/v6 v6.0.3 直接依赖；禁止 schema 编译器读取外部引用。
- 两个 SDK 补丁说明及本 issue／audit 文档。

此前移除 worktree 的 README、App、ActionBar、session service 和 smoke 脚本改动保留。Claude 计划工具白名单、Codex 异步提问暂停策略、思考强度参数优先级没有修改。

## 验证

- [x] 原生交互模拟：接受／拒绝／取消、结构化类型、无 turnId 路由、原始请求 ID、并发去重和取消。
- [x] 无效表单输入拒绝后可以重试，旧问题和重复回答被拒绝；权限字段不能从浏览器扩大。
- [x] 2,048 条积压事件后原生请求和结束事件完整按序送达；另一个订阅者继续工作。
- [x] turn/start 回复前的消息及完成事件保留；unsubscribe 释放 4,096 条积压；回合结束和服务器退休请求不遗留回调。
- [x] Go 适配器、通用问题状态、会话管理和 Codex SDK 全套测试及 race 通过：`build/reports/native-interactions-go-tests.log`。
- [x] Claude SDK 两类原生交互协议测试及 race 通过：`build/reports/native-interactions-claude-sdk-tests.log`。
- [x] 原生会话 usecase 回归通过：`build/reports/native-interactions-usecase-tests.log`。
- [x] TypeScript 类型检查通过：`build/reports/native-interactions-typecheck.log`。
- [x] Chromium 真实组件验证和现有答案确认链路共 4 项测试通过：`build/reports/native-interactions-browser-tests.log`。包括服务器拒绝后重试、确认前禁用按钮、复杂 JSON、无表单拒绝、URL、权限、备用模型和过期问题禁用。
- [x] 375px 移动端及 900px 中文深色界面截图验证，位于 `build/reports/native-interactions/`。

## 边界

验证使用模拟原生协议和真实浏览器组件，没有调用付费模型，也没有将“全部原生能力”作为结论。只声明支持已实现的 dialog kind。表单的外部 schema 引用不会被自动加载，用户仍可拒绝／取消。订阅积压保存在内存中，会随未消费事件增长，并非磁盘持久化日志。
