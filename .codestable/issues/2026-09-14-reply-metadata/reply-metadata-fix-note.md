---
doc_type: issue-fix-note
issue: reply-metadata
status: fixed
related: [reply-metadata-report.md, reply-metadata-analysis.md]
tags: [codex, history, metadata, ui]
---

## 修复结果

回复信息栏恢复思考强度和 Context，例如 `gpt-6-astra · high`、`Context 42% (109K/258K)`。缺少实际记录时明确显示“未提供”；窄栏自动换行，中英文及深浅色主题可用。原有耗时、等待时长和最近更新显示保留。

Codex 原生导入读取 `turn_context.effort` 和 `token_count.info.last_token_usage`，使用该次请求的上下文占用及容量，不使用累计计费 Token。原生 token_count 在回复之后到达也能补到所属轮次；新轮次清除上一轮 Context。

共用 Exchange 保存每条回复的 Context 快照，实时完成和历史导入均经过持久化；已有历史通过原有身份匹配只补缺失字段，不改正文、顺序、时间和已有明确数值。旧网页缓存通过回复元数据版本标记执行一次全量同步，随后恢复增量同步；磁盘重开、缓存重载和离线查看保留各轮快照。取消用会话最新 Context 回填旧回复的逻辑。

## 验证证据

- Go：Codex、session、API/usecase 相关包通过；新增真实原生 JSONL 导入 → 同步补录 → 磁盘重开回归，验证两轮独立数值、未知值、重复同步幂等及正文/时间不变。共用实时持久化覆盖 Codex 与 Claude、零占用和快照复制。日志：`build/reports/reply-metadata-go.log`、`reply-metadata-focused.log`。
- 流事件回归通过：第一轮返回 Context，第二轮缺少 usage 时不沿用第一轮数值。日志：`build/reports/reply-metadata-turn-reset.log`。
- 浏览器：元数据、活动历史、缓存迁移与会话活动共 11 项通过。新增测试直接使用 Go 导入器生成的合成会话，覆盖旧缓存补录、再次增量同步、离线、零值和缺值。日志：`build/reports/reply-metadata-web.log`、`reply-metadata-browser-final.log`。
- TypeScript 检查和 `node scripts/build-runtime.mjs` 通过；完整 `node scripts/smoke-runtime.mjs` 通过，包括后台回复、会话切换、状态计时、窄栏和主题。日志：`build/reports/reply-metadata-build.log`、`reply-metadata-runtime-smoke.log`。
- 已查看 375px 中文浅色和 900px 英文深色截图；UI 检查无发现，`git diff --check` 通过。截图位于 `build/reports/reply-metadata/`。

## 范围与限制

按用户条件，输入/输出 Token 和缓存命中率统计暂缓；正确区分累计、单次请求与单轮消耗需要单独处理。Claude 复用保存与显示，只展示实际已有数据，本次不推算缺失的 Claude 历史元数据。

验证使用隔离测试与合成会话；原生用户记录仅作只读格式核查，未修改。未发起真实模型请求，也未完成安装后的 IDEA/JCEF 人工验收。本次代码尚未提交、推送或发布新 Release。
