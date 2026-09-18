---
doc_type: issue-fix
issue: 2026-09-17-shared-turn-diff
path: fast-track
fix_date: 2026-09-17
tags: [turn-diff, agent, claude, codex, acp]
---

# 本轮文件差异跨 Agent 共用修复记录

## 1. 问题描述

用户指出本轮修改文件列表及 diff 应当是各 Agent 共用的公共能力。local.10 中的展示和持久化已共用，但工作区比较只在 Codex 回合运行，Claude 或 ACP Agent 没有原生 diff 事件时仍缺少文件列表。

## 2. 根因

`runtime/server/internal/api/usecase/session.go` 在公共 `SendMessage` 中用 `in.Agent == "codex"` 限制了基线采集。`turndiff` 本身不依赖 Agent 协议，前端及持久化也没有对应的 Agent 限制。

## 3. 修复方案

去掉 Agent 名称判断，在公共回合开始前采集文件基线，结束后使用原有合并及保存流程。沿用 local.10 的只读采集、范围限制、工作树映射和失败降级，不改原生工具、提示词、权限或适配器，不新增抽象。

范围限定为公共会话入口、新增跨 Agent 回归和验证文档。沿用用户授权修复并仅交付 Windows x64 本地包的要求，无提交或发布操作。

## 4. 改动文件清单

- `runtime/server/internal/api/usecase/session.go`：解除采集入口的 Codex 限制。
- `runtime/server/internal/api/usecase/turn_diff_agents_test.go`：Claude 与自定义名称 ACP Agent 的真实传输层回归夹具，覆盖保存／重载、连续两轮和非 Git 项目。
- `docs/validation.md` 和本记录：验证证据及交付范围。

其余工作区修改属于前一轮 local.10 修复，本次保留。

## 5. 验证结果

- 新增用例在修改生产代码前复现 Claude 和 ACP 的 diff 缺失。
- 修复后 `turndiff`、`api/usecase`、`agent/codex`、`agent/claude`、`agent/acp` 包回归全部通过；Codex 原生参数检查继续通过。
- Claude 和 ACP 的文件变更不依赖工具事件；重新创建管理器后能读取第一轮差异，第二轮没有旧 diff，非 Git 项目继续正常回复。
- 前端没有新增改动，沿用 local.10 的文件列表、diff 展开和 IDEA 打开文件桥接验证。
- 具体构建及包核验见 `docs/validation.md` 和 `build/reports/turn-diff-shared-*`。
- 额外并发检查发现 Claude 已有的回合状态竞态。用 HEAD 原始公共会话代码做 overlay 对照仍复现，详见下述独立问题记录；不能将本次验证表述为所有 race 检查通过。

## 6. 遗留事项

Windows 为 macOS 交叉编译，本机验证使用模拟 Agent 进程，不替代 Windows／真实 CLI 验收。用户安装新版后需要发起新回合；历史缺失的基线不能补回。等待用户本地测试反馈。

顺手发现已记录到 `../2026-09-17-claude-turn-state-race/claude-turn-state-race-report.md`，本次不扩大修改原生适配器。

项目存在 `.codestable/attention.md`，已读取；`compound/`、`tools/search-yaml.py` 和 `reference/shared-conventions.md` 当前不存在，未扩展修改项目知识库骨架。
