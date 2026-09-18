---
doc_type: issue-report
issue: 2026-09-17-claude-turn-state-race
status: open
created: 2026-09-17
tags: [claude, concurrency, turn-state]
---

# Claude 连续回合状态存在并发写

本轮跨 Agent diff 验证中，Go race detector 报告 `runtime/server/internal/agent/claude/session.go:218` 的 `SendMessage` 与同文件第 697 行的结果消费并发写入 `sawMessageText`。功能测试中的回复及 diff 正常，尚未复现真实 CLI 回复丢失。

复现命令：

```sh
node scripts/test-runtime.mjs ./server/internal/api/usecase -race -run '^TestWorkspaceTurnDiffSharedAcrossAgents$/^claude$' -count=1
```

夹具通过真实 Claude SDK 传输与模拟本地进程执行连续两轮，不调用模型 API。

基线对照：用 `git show HEAD:runtime/server/internal/api/usecase/session.go` 导出不含工作区采集的原文件，通过 Go `-overlay` 替换编译，再运行 `claude/no-git` 子测试，相同竞态仍复现。Codex、Claude 和 ACP 适配器源码与 HEAD 完全一致。证据在 `build/reports/turn-diff-shared-race.log` 和 `build/reports/turn-diff-shared-baseline-race.log`。

期望：上一轮结果处理与下一轮状态重置具备明确同步关系，不存在并发读写；保持原生回复和完成事件语义。

这是原有回合状态问题，超出本次公共 diff 入口修复范围；尚未修改，后续单独定位并验证修复。
