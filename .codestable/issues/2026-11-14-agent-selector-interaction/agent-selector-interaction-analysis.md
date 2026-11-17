---
doc_type: issue-analysis
issue: 2026-11-14-agent-selector-interaction
status: analyzed
summary: 远程与插件采用不同的选择后关闭配置，切模型还会重置已选参数
tags: [remote, agent-selector, defaults]
---

# 定位与修复范围

- `ActionBar.tsx` 的 `closeOnSelect={!compactWorkbench}`：插件保留菜单，远程每次选择都关闭。`AgentSelector.tsx` 在不关闭分支中已有 Agent 名称点击选中并展开的逻辑。
- `ActionBar.tsx` 的 `onAgentChange` 每次重置 effort 和 fastService，包括同 Agent 换模型，连续设置会丢失已选值。
- `agentDefaults.ts` 原生 Agent 的 effort/fast 返回空字符串，模式也没有统一默认；远程发送未选模式时不采用首项。
- 375px 浏览器回归发现绝对定位菜单左侧越界，现有 viewportMenu 可处理视口边界。

采用方案：远程聊天启用不关闭选择与现有视口定位；共享选择器默认连续选择；默认值集中在 `agentDefaults.ts`，首项模式、支持时 high、Fast 关闭。同 Agent 换模型保留兼容设置，换 Agent 应用默认，已有会话保留显式设置。

生产代码范围仅 `ActionBar.tsx`、`AgentSelector.tsx`、`agentDefaults.ts`；验证覆盖远程/插件真实浏览器组件和实际发送参数。
