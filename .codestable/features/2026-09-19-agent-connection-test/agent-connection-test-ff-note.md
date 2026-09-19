---
doc_type: feature-ff-note
feature: agent-connection-test
date: 2026-09-19
tags: [agent, native, connection-test, ui]
---

## 做了什么

在 IDEA 设置的每个已安装 Agent 卡片中增加“测试连接”。弹窗自动获取该 Agent 原生模型列表，默认测试消息为 Hi，允许修改模型与消息，点击后展示流式响应、耗时及成功或失败状态，支持停止、重试和刷新模型。

## 改了哪些

- 新增 AgentConnectionTest 组件及局部样式，接入 IdeaAgentSettings 和中英文本；沿用 IDEA 主题、常显表单标签与原生 dialog 焦点管理。
- 新增 agentConnectionTest 服务以及受保护的 test-models、test-connection 接口。使用当前 Agent 定义和新的原生运行时，工作目录为独立临时目录，结束后关闭并清理。未增加账号或供应商配置功能。
- 模型来自原生 ListModels；列表缺失时可测试默认模型。测试选择不会写入默认配置，不进入插件会话管理器。远程加密响应采用缓冲结果，本地 IDEA 响应为流式输出。

## 怎么验证的

TypeScript 检查通过。真实 Chromium 验证模型自动读取、打开不发送消息、自定义模型/消息、流式输出、错误、停止和 Esc 焦点恢复，明暗主题 375px 截图无横向溢出。既有 Agent 生命周期前端回归通过；Go 单元测试及 race 检查覆盖分块回复、完整结束、空回复、错误与取消。

验证使用模拟 Agent 回复，未使用用户凭据发起真实模型请求；尚待真实 CLI 配置下实测。此次未打包。
