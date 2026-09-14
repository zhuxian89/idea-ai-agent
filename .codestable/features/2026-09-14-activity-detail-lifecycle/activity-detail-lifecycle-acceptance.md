---
doc_type: feature-acceptance
feature: 2026-09-14-activity-detail-lifecycle
status: accepted
summary: 有界展开选择、详情请求与快照、阅读滚动和原文复制已验证，保留两项会话计时
tags: [tool-activity, details, lifecycle, accessibility]
---

# F5 展开与详情生命周期验收

阶段：阶段 3；日期：2026-09-14。关联 [批准方案](activity-detail-lifecycle-design.md) 与 [清单](activity-detail-lifecycle-checklist.yaml)。授权沿用用户对整体方案的直接批准及“继续”。在 main 工作，未提交、未推送、未安装发布。

## 1. 接口契约核对

- [x] DisclosureChoice=open/closed：root/session/call 隔离，无 call ID 用稳定 localKey；应用内 singleton 只存选择，刷新恢复默认。ActivityDisclosureStore 的 50/500 LRU 与当前焦点保护有边界测试。
- [x] ActivityRef=rootId/sessionKey/callId，JSON 三元组避免分隔符碰撞。loadActivityDetails(ref, signal?) 只合并在途请求，单消费者取消不影响其他人；完成/全部取消后删除表项。
- [x] ActivityDetailResult=loaded/missing/unavailable；实际 sessionService.getToolCallDetails 经保护接口读取，200 null/404、网络/408/429/5xx、400/401/403 分别验证。旧 getToolCall 仍返回 ToolCall/null，HTTP 路径与响应不变。
- [x] A 打开后切 B、回 A 保留选择；用户 shell 显式关闭后更新/终态不重开；同 ID 不同 root/session 不串状态。请求后切换的迟到响应被取消与身份检查隔离，渲染阶段也核对身份。
- [x] 流程图对应 disclosure store/hook → Card → details hook → shared loader → session API → feedback/content/scroll；底部计时继续独立。

## 2. 行为与决策核对

- [x] 普通活动默认关闭，用户 shell 默认打开；显式选择覆盖默认、流更新、终态与语言。无 ID 不请求远程详情。
- [x] 普通工具/执行命令展开后可读完整快照，已有内容立即可见；完整 diff/任务沿用特殊渲染。摘要和内联内容不会被加载/失败分支挡住。
- [x] 完整输出仅在挂载条目中；成功的运行详情每次完成后至少一秒再取，背景刷新不插入加载行。收起/卸载停止后续请求，错误/缺失不自动循环重试，终态可再次核对，终态在请求中途到达也补取最终快照。
- [x] 当前终态/事实高于陈旧快照，完整命令文本只有包含当前内联前缀才替换紧凑内容；旧 running 或 completed 事实均不能覆盖最新 declined/interrupted。明确截断的输出未取全时不提供输出复制入口。
- [x] 所有详情使用独立滚动容器，48px 内跟随，否则保留阅读位置；工具内指针、聚焦、触摸与滚轮暂停外层自动跟随，原跳到最新按钮恢复。没有新增外层 scrollIntoView 调用。
- [x] 复制使用既有 clipboard 服务，原始命令空白与 ANSI 输出原文保留；成功/失败中英文反馈，fallback 不丢失按钮焦点。复制、重试、轮询未发会话事件，也未写 lastEventAt。
- [x] 挂载点已实际 rg 反查：两个 service、三个 hook、反馈组件/局部 CSS、Card、session API、SessionViewer 接线与词典。逆向移除这些接线即可退回旧详情策略，不涉及日志或数据库迁移；底部计时、审批回答处理器、diff/任务业务无需要回退的修改。
- [x] 范围外未做：分组、永久偏好、共享完整输出缓存、正文/phase 改写、真实 CLI、IDEA 安装发布。新调度和存储放专用小文件，卡片减少原局部 effect；不扩大大组件职责。

## 3. 验收场景核对

| 场景 | 证据 | 结果 |
| --- | --- | --- |
| S1 展开选择与身份 | 真实 Card 的键盘展开、语言/状态更新、卸载重挂、root/session 切换和 shell 明确关闭；新应用 store 无选择 | 通过 |
| S2 容量与无 ID | 501+ 项/51+ 会话验证 LRU 与焦点保护，旧 blur 不释放新焦点；localKey 切换且详情请求始终为 0 | 通过 |
| S3 错误与重试 | 实际 service 方法的 HTTP 错误边界测试；浏览器加载保留日志、missing/临时失败主动重试、权限错误无重试循环、不暴露内部文本 | 通过 |
| S4 共享请求与迟到 | 两张同身份卡片仅 1 次请求，卸载一个仍能完成另一个；B/C 身份切换不显示迟到 B 数据；全部取消及迟到旧请求不会删除新请求 | 通过 |
| S5 更新与滚动 | 999ms 无新增请求，1000ms 刷新；向上 80px 阅读保持、后台加载不插行；请求中终态补取，旧事实/输出不回退；运行时收起停止，SessionViewer 跳最新可恢复跟随 | 通过 |
| S6 复制及可访问性 | 完整命令含首尾空白、完整 ANSI 输出逐字一致；复制失败英文反馈/焦点保持；亮暗 × 320/375/720，无外层横向溢出，键盘展开与 aria 关联有效 | 通过 |
| S7 计时与特殊流程 | 原 session activity/stream/time/duration、approval、history/cache 回归；ToolCallCard 双 Agent、用户 shell、diff/子任务分支通过；问答回答处理器未修改 | 通过 |
| S8 构建与范围 | TypeScript、Vite 生产构建、65 项不同 Web 检查通过；main 未提交，F6/F7 保持 planned，文档/引用/YAML 同步 | 通过 |

测试分组：基础/HTTP/新浏览器/历史/计时/审批/缓存共 52 项，新增“运行时收起与权限错误”后新浏览器为 10 项（替代原 9 项），已有 tool-activity 为 12 项，共 65 项，不重复计算重跑。日志见 [回归](../../../build/reports/activity-detail-lifecycle/tests.log)、[最终浏览器](../../../build/reports/activity-detail-lifecycle/browser-final.log) 和 [构建](../../../build/reports/activity-detail-lifecycle/build.log)。未改 Go 生产代码；tool-activity/history 测试仍使用实际 Go 适配器/importer 固定样例。

已肉眼检查 [六种尺寸/主题对照](../../../build/reports/activity-detail-lifecycle/overview.jpg)：进展/最终文字仍高于次级活动摘要，详情内命令、日志与反馈可读；长行只在日志内部横向滚动。浏览器实际挂载生产 Card、Markdown、I18n 和 SessionViewer；远程详情/剪贴板平台结果为固定夹具，HTTP 分类另测实际 service 方法。不是完整 App/真实 CLI/IDEA 联调。

## 4. 术语一致性

- [x] DisclosureChoice、ActivityRef、ActivityDetailResult 与方案名称/枚举一致；localKey 仅为无 ID 的本地时间线身份。
- [x] snapshot 为挂载详情快照，pending 表为在途请求；两者均不写 IndexedDB，不引入第二套会话进展时间。
- [x] hooks 与反馈组件只是方案既定职责的实现文件，没有增加分组、输出缓存或新协议概念。

## 5. 架构归并

- [x] [工具活动架构](../../architecture/ui-tool-activity.md) 实际加入存储归属/50/500 限制、请求错误/取消、快照更新、滚动与复制纪律、代码锚点与限制，并更新结构图。
- [x] [架构索引](../../architecture/ARCHITECTURE.md) 同步 F1–F5 当前实现，不把分组规划写成现状。

## 6. requirement 回写

- [x] [compact-tool-activity](../../requirements/compact-tool-activity.md) 保留阅读愿景，补充切换后保留选择、持续日志阅读、原文复制与失败恢复；明确内存上限和刷新默认。
- [x] [能力索引](../../requirements/VISION.md) 同步 F1–F5，底部两项计时要求保留。

## 7. roadmap 回写

- [x] F5 items 从 in-progress 改为 done，feature 链接正确；主文档 F5、当前进度和变更日志同步。
- [x] 矩阵记录 D01–D06/D09–D12 的本阶段证据、A17/A19 与计时回归；组内行为和真实 IDE 部分留待 F6/F7。
- [x] F6/F7 保持 planned，无自动启动下一阶段。

## 8. attention.md 候选盘点

本阶段未暴露需要新增的通用环境约定。main 开发约束继续遵守；未修改 attention.md。

## 9. 遗留

- 真实双 CLI、IDEA/JCEF 的剪贴板桥接、主题缩放与最终性能基线未运行，属于 F7；浏览器平台夹具不替代这些证据。
- 当前按条目展示，F6 负责连续活动分组；内存只保留显式选择，刷新/插件重启恢复默认。
- 构建仍有依赖的注释处理和既有大分块提示，不影响生产构建；未引入额外依赖或全局打包改造。
