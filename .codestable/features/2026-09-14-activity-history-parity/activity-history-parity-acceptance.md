---
doc_type: feature-acceptance
feature: 2026-09-14-activity-history-parity
status: accepted
summary: 双 Agent 历史事实、幂等补录、缓存恢复和可靠归属已验证，两项会话计时保留
tags: [tool-activity, history, cache, codex, claude]
---

# F4 历史与缓存一致性验收

阶段：阶段 3；日期：2026-09-14。关联 [批准方案](activity-history-parity-design.md) 与 [清单](activity-history-parity-checklist.yaml)。授权沿用用户对整体方案的直接批准及“继续”。在 main 工作，未提交、未推送、未安装发布。

## 1. 接口契约核对

- [x] ActivityFactsV1 契约复用；历史 origin=imported，实时仍为 live。新增 list 工具种类与既有 Web list 操作一致。
- [x] Claude Read/Grep/Bash/MCP 输入产生与实时相同的可用事实；Codex 原生 ThreadItem 经同一 SDK/投影，durationMs=0 和明确 turn ID 保留。两个 `TestImportedActivityFixtures` 对照通过。
- [x] 时间线可选 agent/sourceTurnKey：有效事实优先，缺事实取 exchange 所属 Agent；原生 turn 或已保存用户 seq 提供边界，未保存用户清除旧边界。
- [x] 可选 activity_history_version=1 表示服务端本次完整补录已完成，保存在同会话缓存。IndexedDB 仍为版本 4；服务端暂缓或失败不生成完成标记。
- [x] 流程图全部对应 importer → usecase → Manager → HTTP → sessionHistory/session → hook → 原有展示入口，无独立重复状态源。

## 2. 行为与决策核对

- [x] 两个 importer 与服务层移除选择性工具过滤；保留原参数、结果、patch、提问答案和任务信息。Claude 原生 system/permission_denied 可保留拒绝事实。
- [x] 重复原生调用和旧派生 aux 的重复条目按 ID 合并、保留首次位置；完整同步补录原条目，原始文件只读。重复导入已有绑定复用同一会话；显式重导入使用所请求 Agent 的绑定。
- [x] Manager 在锁内批量读取、原子写派生 aux；已有完整详情不会被紧凑数据清空。原生更完整的 live 事实优先于历史通用投影。
- [x] 快速同步只按已知调用 ID 合并迟到结果，不把新一轮内容相同的用户消息当旧消息；响应可携带旧 seq 的紧凑 aux。空文件游标路径保留。
- [x] 旧工具响应被整条遗漏时，在可靠匹配的用户 seq 后补辅助记录，不改写正文或重排 seq；无法匹配的旧前缀保守降级。
- [x] 正在运行时暂缓完整补录，保留原 pending 用户、seq=0 与原时间戳。底部状态/计时计算没有修改。
- [x] 挂载点反向 rg 已核查：历史计算、导入/同步和 HTTP、Manager、缓存/App gate、时间线/Card/底部及对应测试。逆向移除这些接线可恢复旧字段降级；不需要删除日志、缓存或数据表。
- [x] 未实现 F5 展开记忆/新详情状态机、F6 分组或正文 phase 推断；无真实 CLI 调用。审批回归夹具改用不同终态场景的独立调用 ID，避免把上一场景的终态 ID 当成新的调用重用；审批生产逻辑未改变。

## 3. 验收场景核对

| 场景 | 证据与观察 | 结果 |
| --- | --- | --- |
| S1 双 Agent 历史种类与事实 | 两个 importer 固定原生输入包含读取、搜索、网页、抓取、命令、任务、MCP；既有 edit/plan/ask_user/importer 回归继续通过 | 通过 |
| S2 原生终态与耗时 | 失败、拒绝、取消、中断和 0 毫秒保留；重复 start 不退回运行，MCP 的业务 error/exitCode 不误判，Claude 不伪造耗时 | 通过 |
| S3 重复导入与日志保护 | 连续三次导入同一绑定，不新增会话/消息/工具；补入 read 的顺序稳定；两个原生日志字节不变 | 通过 |
| S4 完整/紧凑/WS 一致 | 新 Manager 落盘重读的事实与紧凑列表相同、原详情保留；原有缓冲去重/WS 投影用例继续通过 | 通过 |
| S5 缓存补录与恢复 | 真实 Chrome IndexedDB 版本 4，旧会话首次完整紧凑请求，刷新后 maxSeq 增量；多次 full、离线、失败重试、其他会话与草稿保留 | 通过 |
| S6 Agent 与轮次 | 同一会话混合 Codex/Claude、旧/未来版本事实、缺 Agent/seq/call ID；确认事实优先、所属 exchange 降级、未知不串归属 | 通过 |
| S7 默认折叠及计时 | 加载三条历史活动详情请求数为 0，主动打开才请求 1 次；实际 hook/service/底部组件计时、切换、重放、分钟小时、中英文回归通过 | 通过 |
| S8 构建与阶段边界 | 相关 Go 包、48 项 Web 检查、TypeScript 与 Vite 生产构建通过；边界和文档同步 | 通过 |

Web 的 48 项来自同轮两组相关回归（31 + 17），末次缓存去重调整后另行重跑历史用例、类型和构建；重复运行不重复计数。Go 覆盖 agent/types、两个适配器、session、api/usecase 和 api；最后存储/同步调整后对应定点用例通过。未以构建代替浏览器验收。

浏览器实际挂载生产缓存模块、流 hook、摘要、ToolCallCard 与 Markdown，网络历史响应为固定夹具；不是完整 App/真实 CLI 联调。浏览器已有真实 Go importer 输出作为数据来源。

已肉眼检查 [亮色 375px 历史](../../../build/reports/activity-history-parity/light-375-history.png) 与 [暗色 720px 历史](../../../build/reports/activity-history-parity/dark-720-history.png)：正文层级清楚，普通活动保持默认收起，摘要、原生 0 毫秒和详情入口可读。未修改主题/全局字体。构建日志见 [build.log](../../../build/reports/activity-history-parity/build.log)。

## 4. 术语一致性

- [x] origin 使用原契约 imported，没有引入 import 枚举；activity.agent 与 exchange.agent 层级一致。
- [x] sourceTurnKey 是展示上下文，没有回写原日志/原生 phase；call ID 保持原生身份，无 ID 不生成远程详情引用。
- [x] activity_history_version 为会话补录标记，SESSION_CACHE_VERSION 仍是原来的 4，二者职责区分。

## 5. 架构归并

- [x] [工具活动架构](../../architecture/ui-tool-activity.md) 已实际补充历史投影、完整/快速补录、锁内批量写、旧 seq 紧凑响应、缓存合并、pending 保护和身份边界，并更新结构图/代码锚点/限制。
- [x] [架构索引](../../architecture/ARCHITECTURE.md) 同步为 F1–F4 现状，无未来实现混入。

## 6. requirement 回写

- [x] [compact-tool-activity](../../requirements/compact-tool-activity.md) 保留原始阅读愿景，加入切换/刷新/导入后信息一致、保留缓存与草稿的用户故事；边界明确可确认历史才补录。
- [x] VISION 索引同步 F1–F4，仍不宣称连续分组或新详情生命周期已实现。

## 7. roadmap 回写

- [x] items 中 F4 从 in-progress 改为 done，关联本 feature；主文档与矩阵同步。
- [x] A12/A14–A16/A18/A20/A24 的本阶段契约、A17 信息恢复、A19 降级、G08 身份部分有证据；合并场景中的 F5/F6 部分保留待验收。
- [x] F5–F7 保持 planned，没有自动启动下一阶段。

## 8. attention.md 候选盘点

本 feature 未产生新的环境或工作流约定。main 开发现有约束继续遵守；未改 attention.md。

## 9. 遗留

- 没有可用原生日志或无法可靠对应的旧正文只保留原字段降级，不通过猜测补齐耗时、phase 或归属。自动完整同步沿用会话默认绑定；显式重导入可指定已绑定 Agent。
- F5 负责展开选择与详情生命周期，F6 负责分组；目前仍逐项显示并沿用原详情加载机制。
- 真实双 CLI 和 IDEA/JCEF 尚未运行，归 F7；当前通过范围是固定协议、持久化、HTTP 和浏览器组件/IndexedDB。
- Vite 有现有大分块提示，未为本次历史数据功能引入全局打包重构。
