---
doc_type: issue-fix
issue: 2026-09-14-async-question
fix_date: 2026-09-14
tags: [codex, idea, question, async, user-input]
---

# 异步选择题未显示交互界面，Agent 继续执行

## 用户澄清与现场证据

用户指的是插件应弹出选择界面并等待提交，而不是在对话中重新询问快捷切换方案。截图 `image (7).png` 的选择题下方仍有工具执行。

实际 Codex 记录显示：本次调用 `request_user_input_async`，随即返回 `{"accepted":true}`；对应 AgentMessage 带 `delivery: "async"` 和 `questions: [{title, options}]`。这只是问题投递成功，不是用户回答。插件自己的会话记录只有普通文本，没有对应 `ask_user` 工具记录。

核对 [官方 App Server 文档](https://developers.openai.com/codex/app-server) 及本机 Codex CLI 0.154.0 生成的协议类型：异步选择题通过 `item/completed` 中的 `agentMessage.questions` 传输，不是同步 `item/tool/requestUserInput` RPC。项目 vendored SDK 的 AgentMessageItem 只有 id/type/text，反序列化丢失了 delivery/questions；所以后续只能渲染文字，无法进入现有选择卡片及回答通路。

## 修复行为与范围

- SDK `types/items.go` 保留异步投递及结构化问题，`types/events.go` 保留完成事件的 threadId/turnId。
- `agent/codex/async_questions.go` 仅针对带结构化问题的异步消息，向精确的 native thread/turn 发送 `turn/interrupt`，等本轮停止后展示现有待回答卡片。插件外层会话一直保持 pending，不发送虚假的完成事件。
- 用户提交完整答案后，作为真实用户输入启动同一 native thread 的后续轮次；不伪造同步 RPC 回答，不将 accepted 或推荐选项当作作答。取消、暂停失败或暂停完成超时均不自动继续。暂停确认的超时不用于代替用户回答。
- `agent/codex/session.go` 的发送及原生线程订阅使用上述处理；保留同步提问通路，并在答案接收前验证必答问题完整。
- 复用已有选择卡片、提交确认、历史状态和取消逻辑；没有对普通自然语言问题做文本猜测，也未修改全局 Codex 配置。
- `scripts/smoke-question-choice.mjs` 加入常规浏览器冒烟，覆盖选择卡片及整个 App 的提交路径。

## 验证

- 修复前 `TestAsyncQuestionPausesUntilExplicitAnswer` 失败：收到的是 `message_chunk: Choose a layout`，而不是待回答问题。证据：`build/reports/async-question-baseline.log`。
- SDK 原始 App Server 事件转换测试确认 delivery/questions 与 thread/turn 身份完整保留。
- Adapter 测试经 SDK RunStreamed、原生事件反序列化、会话事件及 AnswerQuestion 往返，覆盖停止等待、重复事件、完整答案、Unicode 自定义答案、同一线程恢复、取消及原生暂停失败。
- `node scripts/test-runtime.mjs github.com/fanwenlin/codex-go-sdk/codex ./server/internal/agent/codex ./server/internal/session ./server/internal/api/usecase -run 'Question|AskUser|Item|Native|Stream' -count=1` 通过；`-race -run '^TestAsyncQuestion'` 通过。
- `node scripts/smoke-runtime.mjs --delivery-only` 通过。选择题自动展开、不默认勾选、不因单次勾选而提交、切换回来仍可回答、仅匹配的服务端确认完成提交；既有模型、原生工具栏、消息及活动栏回归也通过。
- 前端 question-delivery/approval-activity 六项测试通过。已查看 375px 截图 `build/reports/ide-question-choice.png`。

日志：`build/reports/question-choice-go-regression.log`、`question-choice-race.log`、`question-choice-browser-tests.log`、`question-choice-smoke.log`。

## 交付边界

原生 Agent 调用使用受控 Go SDK 执行器；完整页面使用受控 HTTP/WebSocket，未调用付费模型。没有替换已安装的 IDEA/JCEF 插件进行实测。本次改动仅在本地，未发布、未打包、未修改版本号；现有 0.1.12 安装包不包含此次修复。


## 后续发布源码

本次修复已纳入 0.1.13 发布源码。安装包及本轮验证边界见 `docs/releases/v0.1.13.md`；上述“未打包”说明记录的是修复当时的状态。
