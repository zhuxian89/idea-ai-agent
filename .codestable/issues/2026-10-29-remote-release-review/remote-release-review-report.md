---
doc_type: issue-report
issue: remote-release-review
date: 2026-10-29
status: confirmed
---

# 远程访问发布前 review 修复

用户已明确要求“review 的问题，你直接修复”。输入为 [审计报告](../../audits/2026-10-29-remote-release/index.md) 的三项发现。

- 轮次完成时先释放 Active 再发送 done，多端接续消息可提前进入下一轮。
- 自动配对的握手/后续状态请求失败统一进入 needs_pairing 并清空错误，导致网络问题要求重输密钥。
- README、隐私说明和市场文案未包含新远程能力的数据流、浏览器存储和启停说明。

修复范围：api/appcontext.go、stream_hub.go 及交接回归；bootstrap.ts、App.tsx、连接错误弹窗、中英文文案及配对/浏览器回归；README、PRIVACY、CHANGELOG 和 plugin.xml 的发布材料。保留现有加密、会话后端和持久化结构，不改变版本号或执行市场上传。

验收：慢连接期间下一轮不能开始；完成状态能回放且不污染下一轮；正确配对在网络失败后保留、显示真实错误、由用户点击重试恢复；无自动重试循环；对外说明与当前功能一致。
