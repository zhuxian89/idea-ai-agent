---
doc_type: issue-report
issue: 2026-11-14-agent-selector-interaction
status: recorded
severity: P2
summary: 远程模型选择器每选一项就关闭，完成模型设置需反复打开
tags: [remote, agent-selector, interaction]
---

# 远程模型选择器交互

用户在远程聊天页面打开 Agent 选择器后，点击 Agent 名称未直接展开；选择模型、思考强度、模式后整个面板关闭，连续配置需要多次重新打开。用户反馈插件已有交互优化。

复现：打开远程聊天输入框的 Agent 菜单 → 点击 Agent 名称 → 选择模型 → 继续选择思考强度、模式和 Fast。实际每选一项都会收起整个菜单；期望 Agent 名称点击即展开，面板内选择不中断后续操作。

用户要求的默认值：模式取第一项、思考强度 high、Fast 关闭。用户设备和浏览器版本未提供；复现测试覆盖手机触屏与桌面浏览器。
