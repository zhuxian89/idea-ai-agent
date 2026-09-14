---
doc_type: feature-design
feature: 2026-09-14-activity-history-parity
requirement: compact-tool-activity
roadmap: tool-activity-experience
roadmap_item: activity-history-parity
status: approved
summary: 补齐双 Agent 历史工具事实、幂等补录与缓存合并，并携带可靠的 Agent 和轮次归属
tags: [tool-activity, history, codex, claude, cache]
---

# F4 历史与缓存一致性

授权沿用用户对整体方案的批准及本轮“继续”；F2/F3 已完成，按 cs-feat-design / impl / accept 推进，不重复请求批准。

## 0. 术语约定

- 活动事实：既有 ActivityFactsV1；历史 origin 为 imported，缺失信息保持缺失。
- 调用身份：原生 call ID，始终限定在 root/session 内；无 ID 不建立远程详情引用。
- sourceTurnKey：优先原生 nativeTurnId，否则明确的已保存用户 seq；不把当前 Agent 选择或推算 seq 当原生事实。
- 历史补录：合并已有调用并在可靠的 exchange 位置补上先前过滤的工具；不修改原生日志。

## 1. 决策与约束

范围为已批准 roadmap §4.6。支持当前适配器能识别的工具种类，复用实时事实计算；保留特殊工具内容和真实结果。默认工程档位。

full 同步原本已绕过文件游标，但跳过已导入前缀；本阶段在追加之前按调用身份和有序正文锚点补录旧工具。重复导入已有绑定复用原会话。仅确定归属的旧记录补录，无法可靠匹配的存量记录保持原文降级，不猜测位置或改写用户消息。

Web 不提升 IndexedDB 版本，不清空任何 store。旧缓存首次同步请求一次完整紧凑历史以补充旧 seq，再按 seq/call ID 合并；服务端确认成功后记录本会话 activity_history_version=1 标记。显式历史同步同样读取完整紧凑历史；后续普通恢复继续增量请求。同步失败保留旧缓存并允许再次补录，不把失败标记为完成。正在运行的会话暂缓补录，完整接口继续返回原 pending 用户及其时间戳；仅服务端完成补录才提供版本标记。

明确不做：工具分组、展开记忆、新详情请求状态机、推断正文 phase、真实 CLI 调用/安装发布、计时及其优先级修改。F5–F7 保持 planned。

## 2. 名词与编排

### 2.1 名词层

现状：两个 importer 过滤 read/search/MCP/task 等工具并不保存 activity；服务层还有第二次类型过滤。时间线工具项丢弃所属 exchange.agent；Web 增量仅拼接 seq。

变化：ToolCall 继续使用既有可选 activity，不新增事实协议。时间线工具项增加可选 agent/sourceTurnKey。缓存会话保存可选的服务端补录完成标记 activity_history_version，不改变数据库版本。

示例：Claude Read(file_path=README.md) 的导入与实时产生相同动作，origin 分别为 imported/live；Codex 原生 durationMs=0 保留 0，缺值不从整轮时间推算。旧记录与旧缓存中重复的 call-1 再次导入仍为一条，补充事实但保留原有完整详情；新增 read-2 位于原生工具顺序中。混合会话中 Claude exchange 下无事实的工具仍归 Claude，即使当前选择 Codex。

### 2.2 编排层

```mermaid
flowchart LR
  N[只读原生 JSONL] --> I[双 Agent 历史投影]
  I --> R[按调用与正文锚点补录]
  R --> P[完整保存及紧凑列表]
  P --> C[按 seq 与 call ID 合并缓存]
  C --> T[时间线 Agent 与用户轮次上下文]
  T --> V[既有共享摘要与详情入口]
```

现状：游标/时间戳跳过旧文件，full 同步按旧 exchange 数量跳过前缀；旧缓存 maxSeq 阻断此前 seq 的新事实。

变化：保留快速游标路径；快速同步遇到已知调用的迟到结果时更新原调用，并返回旧 seq 的紧凑 aux。完整同步读取全部历史并先补充能匹配的旧调用/辅助记录，再追加未同步尾部。补录在会话存储锁内完成，完整详情和紧凑数据一致，重复操作不增加条目。补录只修改派生 aux 数据，不修改正文、seq 或原始日志。Web 完整紧凑请求解决旧 seq 更新，合并保留缓存中未返回的记录，离线可读。

约束：不从任意 MCP 业务 JSON 的 error/status 推断工具失败；只有结构化原生结果可提供耗时/终态。部分更新和重放不能将终态降回 running。工具位置不能通过当前选择器或时间相近猜测。

### 2.3 挂载点

1. 双 importer 的工具/结果投影及其事实计算文件。
2. 外部导入/完整与快速同步编排、HTTP 紧凑补录响应及 Manager 的历史 aux 合并入口。
3. Web session 缓存完整补录/幂等合并及 App 旧缓存恢复 gate。
4. 时间线工具上下文、ToolCallCard 和底部共享展示入口。
5. 导入/保存/缓存/混合归属的回归与浏览器夹具。

### 2.4 推进策略

1. 历史计算：补齐工具种类、事实、结果、可靠 ID；导入用例通过。
2. 补录编排与持久化：重导入复用绑定，旧调用补齐且顺序不变；存储测试通过。
3. 缓存和展示上下文：完整补录后增量恢复，混合 Agent 与轮次上下文正确。
4. 验证与归档：浏览器真实 IndexedDB 恢复、相关回归/构建通过，归并架构与能力并将 F4 标 done。

### 2.5 结构健康度与微重构

importer、Manager、App 已较大；新增历史计算和合并逻辑放相邻专用文件，原文件只保留入口接线。当前 compound 无目录归属规约。无需前置纯移动重构；不顺手整理邻近业务。缓存合并限 session 模块，避免增加另一套状态源。

## 3. 验收契约

- S1：双 Agent 的已支持种类完整导入；实时/历史相同可用事实摘要一致，缺失信息不虚构。
- S2：失败/取消/拒绝/中断、显式原生耗时及 0 保留；MCP 业务返回不误判。
- S3：重复原生条目与重复导入无调用重复，稳定顺序；旧事实补齐且原始日志字节不变。
- S4：完整/紧凑保存、WS、缓存保留事实，终态不回退，原详情/提问/任务/diff 保留。
- S5：不清缓存、不升级版本；旧缓存一次完整补录后增量，真实 IndexedDB 刷新/切回与离线可读。
- S6：activity.agent > exchange.agent，混合 Agent 不受选择器影响；原生/用户轮次上下文可靠，无 ID 不远程请求。
- S7：折叠历史加载没有逐工具详情请求，浏览器可读；底部两项计时与既有优先级回归通过。
- S8：类型、构建、相关测试通过；无分组/新详情生命周期/CLI 执行，文档状态一致。

## 4. 架构归并

更新 ui-tool-activity 的历史投影、补录与缓存链路、调用/轮次上下文及边界；compact-tool-activity 记录历史恢复能力并保留愿景。更新索引、roadmap、矩阵和九节验收报告。
