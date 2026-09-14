---
doc_type: issue-report
issue: 2026-09-14-native-interactions
status: confirmed
severity: P1
summary: 原生交互请求未接入，Codex 拥塞时可能丢失审批和完成事件
tags: [codex, claude, native-protocol]
---

# 问题报告

来源为 native-agent-parity 审计的 finding-01、02、04；用户已明确要求修复排序后的第 1、2 项。

期望：MCP 表单／URL 确认、Codex 额外权限和 Claude 已知原生对话框可以由用户响应；高频输出和慢消费者不会静默丢失关键事件。

实际：Codex 两类请求无返回路径，Claude 未注册回调而默认拒绝／取消；Codex 256 项订阅队列满后直接丢事件。

复现：用模拟原生协议发送相关请求；在消费者暂停时发送超过 256 项事件，再发送审批和完成事件，恢复消费后检查响应和结束状态。本轮补自动化复现，不声称此前用户现场已复现。

环境：当前 macOS arm64 工作区，Codex CLI 0.154.0、Claude Code 2.1.270。P1：影响原生交互与执行可靠性。
