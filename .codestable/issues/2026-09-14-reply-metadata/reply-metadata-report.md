---
doc_type: issue-report
issue: reply-metadata
status: confirmed
severity: P2
summary: 真实回复的信息栏缺少思考强度和 Context 占用
tags: [codex, history, metadata, ui]
---

## 现象与复现
用户截图 image (14).png 的回复信息栏只有模型和时间/耗时；参考图 image (15).png 还显示 high 和 42% used (109K/258K)。打开真实 Codex 会话并查看旧回复即可检查；具体截图对应会话尚未唯一定位。

## 期望与实际
期望每条回复直接显示其实际思考强度与当时的 Context 占用，窄侧栏可换行，缺值明确标注。实际缺项且没有解释。用户明确授权补齐；Token 输入/输出及缓存命中率仅在工作量小的情况下附带，不应阻塞这两项。

## 环境与范围
main，IDEA 插件 v0.1.15 使用场景。保留复制、分叉、模型、时间、耗时、工具折叠和独立计时；现有未提交的文件路径入口不在本 issue 范围。P2：不阻塞对话，但关键运行信息不完整。
