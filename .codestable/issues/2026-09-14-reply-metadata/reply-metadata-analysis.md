---
doc_type: issue-analysis
issue: reply-metadata
status: confirmed
root_cause_type: data-format
related: [reply-metadata-report.md]
tags: [codex, history, metadata, ui]
---

## 已证实的缺口
- `agent/codex/importer.go:readCodexImportedExchangeLocators` 只读取 turn_context 的 turn_id，忽略 effort 与 token_count 中的 last_token_usage/model_context_window。`ImportedExchange` 也没有对应字段。
- `api/usecase/external_sessions.go:appendImportedExchange` 保存导入回复时把 effort 传空值。
- `session/types.go:Exchange` 无 Context 字段；实时 done 的 Context 只更新会话级 LastContextWindow。旧回复没有自己的快照。
- `useSessionStream.ts:applySessionContextWindow` 把会话当前 Context 填到最后一段旧回复，缺乏轮次归属；`SessionViewer` 缺值直接隐藏。
- 本地原生 JSONL 的 turn_context 含实际 effort，token_count 含最后请求上下文及容量。只读检查未输出会话正文，也未修改用户记录。

## 修复选择与授权
用户已确认恢复思考强度与 Context，并授权在简单时附加 Token/缓存统计。采用贯通原生历史解析、每条回复保存、幂等补录、缓存迁移及显示的方案；只改 UI 占位会掩盖真实字段丢失，故不采用。

Token/缓存统计还需区分累计、单次请求及单轮消耗，超出顺带接字段的范围，按用户条件延后。本次不添加这些统计。

## 实现范围与约束
扩展共用 Exchange 的可选 Context；Codex importer 保留原生 effort/Context，通过现有有序身份匹配补录缺失字段，新回复直接保存 done 快照。Web 升级回复元数据同步标记并展示缺值状态，去除无归属的会话级回填。涉及 agent/types、agent/codex、session、api/usecase、HTTP 同步及 Web 回复信息栏/缓存；共用路径同时适用于 Claude 已有明确数据。

## 验证
原生事件/JSONL 解析、跨轮隔离、磁盘重开、重复补录、旧客户端缓存升级与离线恢复、中英文窄栏、未知/零值。使用隔离测试和原生只读数据；不启动真实模型请求或改写用户的原生历史。
