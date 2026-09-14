---
doc_type: feature-acceptance
feature: 2026-09-14-activity-segment-grouping
status: accepted
summary: 连续完成段分组、两层展开与焦点保持已验证，正文、特殊操作和两项计时保持独立
tags: [tool-activity, grouping, timeline, accessibility]
---

# F6 连续活动分组验收

阶段：阶段 3；日期：2026-09-14。关联 [批准方案](activity-segment-grouping-design.md) 与 [清单](activity-segment-grouping-checklist.yaml)。沿用用户对整体方案的直接批准与本轮“继续”。main 开发，未提交、未推送、未安装发布。

## 1. 接口契约核对

- [x] ActivitySegmentEntry / ActivityGroup / groupCompletedActivities 与 roadmap §4.4 一致，使用 closedTurnKeys 和 minGroupSize=3；原时间线映射由 projectActivityTimeline 提供，不生成新的会话事件。
- [x] 0/1/2 项逐条，3 项闭合后成组；开放段内的 running 不使前缀提前折叠，后继边界关闭后才将连续完成子段聚合。
- [x] 组 key 由 root/session、Agent、sourceTurnKey、首成员 key 组成；追加成员、标题/语言变化不改变已有 key。同调用重复更新使用首次位置与最新 view，20 次更新只计 1 次。
- [x] F5 DisclosureChoice 复用，call/local/group 命名空间互不冲突；组与条目合计 50 会话/每会话 500 选择，焦点受保护，不保存日志或永久偏好。
- [x] 方案流程图可逐点对应原 timeline → 共用视图/边界 → 纯分组 → 稳定平级渲染/组标题 → 原 Card/特殊正文，原 SessionActivity 仍使用原 timeline。

## 2. 行为与决策核对

- [x] 仅同可靠身份的普通完成 execute/read/list/search/web_search/fetch/MCP 入组。未知 Agent/轮次或无远程调用引用时保守单列；原生事实经既有视图校验与旧字段降级。
- [x] 任意正文、用户、思考、计划/todo/压缩、特殊操作、失败/拒绝/取消/中断/未知状态及身份变化切断分组；原始 kind/meta、typed diff 的特殊证据不会因冲突 activity 被误收组。不读日志正文推断种类或 phase。
- [x] pending/streaming 未结束时尾段开放；loading 期间不以初始静态状态关闭，断连也不证明结束。无终态证据的工具继续显示 unknown，不伪造成功。
- [x] 组标题复用 ToolActivityHeader 的次级字体、单色图标、焦点样式与中英文词典。全命令计数和混合操作计数准确，不添加总耗时或业务结论。
- [x] 自动成组前后成员保持同一 React 父级/key，焦点与详情 DOM 不被替换；新组继承用户已开/聚焦的阅读意图，blur 不使组突然关闭。用户关闭组后成员卸载，选择保留；重开仅恢复明确打开的子项详情。
- [x] 组控件 aria-controls 引用展开成员容器，关闭组内无可聚焦子项；组区复用 F5 的外层阅读暂停/跳最新恢复。
- [x] 挂载点已实际 rg 反查：activityGrouping、ActivityTimeline/CSS、useActivityGroupChoices、既有 store/hook、SessionViewer 的唯一渲染入口及词典/测试。逆向拔除入口并恢复 timeline.map，再移除组接口可退回 F5；不需要改数据、日志、计时或审批回答处理器。
- [x] 未做 F7、真实 CLI/IDEA、提交/推送、持久偏好、虚拟化、任务语义生成、MCP 父子树或正文改写。新逻辑集中在专用小文件，SessionViewer 仅替换显示入口。

## 3. 验收场景核对

| 场景 | 证据与观察 | 结果 |
| --- | --- | --- |
| S1 阈值/开放尾段 | 0/1/2/3、completed+running 的纯投影；真实双 Agent 会话在运行时逐项，后继正文出现后关闭成组 | 通过 |
| S2 边界/内容/操作 | 所有 timeline 类型和异常种类纯测试；真实失败、用户 shell、diff、子任务独立，组开关后问答选项仍可选且提交正确 toolUseId/answers | 通过 |
| S3 身份/唯一计数 | root/session/Agent/轮次隔离；混合历史保留 3 个独立组，未知身份单列；20 次重复更新、追加成员、locale/标题变化不改变组身份 | 通过 |
| S4 标题/请求 | “运行了 3 条命令”/“完成了 4 项操作”及英文；默认组关闭，展开组 0 日志请求，只打开 c2 时 1 请求 | 通过 |
| S5 选择/焦点/边界 | 自动成组前后 header/detail 元素 ===，焦点与 scrollTop=80 保留；关闭/重开及切会话/根目录恢复选择；focus/key namespace/500 合计边界测试 | 通过 |
| S6 视觉/可访问性 | 亮暗 × 320/375/720 肉眼截图核验；Tab/Enter/Space、aria-expanded/controls、焦点外框与横向溢出检查 | 通过 |
| S7 计时/旧详情 | 真实 SessionViewer 分组开关前后仍为“已等待 15 秒 · 最近更新于 15 秒前”，随后到 20 秒；结束撤除；F5 迟到/滚动/复制、原计时/重放/审批/缓存历史回归 | 通过 |
| S8 验证/范围 | 73 项不同 Web 检查、TypeScript、Vite；YAML/本地链接/DAG/空白检查；不扫描大日志，无真实 CLI/IDEA 操作 | 通过 |

73 项由 [回归日志](../../../build/reports/activity-segment-grouping/regression.log) 的 62 项和 [最终分组浏览器](../../../build/reports/activity-segment-grouping/browser-final.log) 的 11 项构成，重跑不重复计数。回归包括 8 项新分组纯测试、4 项展开存储（含新增组预算）、F5 详情浏览器、历史/缓存、活动事实/摘要、计时/流生命周期和审批。TypeScript 编译通过；[Vite 构建](../../../build/reports/activity-segment-grouping/build.log) 成功，无新增依赖或 Go 生产修改。

已肉眼核验 [六种尺寸/主题对照](../../../build/reports/activity-segment-grouping/overview.jpg)：普通组与子项使用次级文字，正文、失败与最终说明独立可读；长标题局部省略，组开关和焦点可见。采用真实生产 SessionViewer/Card/I18n/流 hook，网络详情和平台外部行为为固定夹具；不是完整 App/IDEA 或真实双 CLI 联调。

1,000 条结构性检查：折叠时完整详情请求=0，工具详情/日志 DOM=0；纯投影使用会抛错的日志 text getter 证明未读取正文。不据此声称已完成同机性能对比、1 MiB 连续输出或全部 F7 性能基线。

## 4. 术语一致性

- [x] ActivitySegmentEntry/ActivityGroup/groupCompletedActivities 沿用已批准契约，没有另一套工具/事件类型。
- [x] ActivityTimeline 是显示投影；原 timeline、ToolActivityView、ActivityRef 和两项会话时间继续各自职责。
- [x] group 命名空间表达组选择，存储只有选择/焦点版本，不是输出缓存；纯分组不依赖本地展开状态。

## 5. 架构归并

- [x] [工具活动架构](../../architecture/ui-tool-activity.md) 实际补充闭合段/唯一调用/保守边界、组 ID、平级 DOM、阅读继承和按需子项加载纪律；结构图与代码锚点同步。
- [x] [架构索引](../../architecture/ARCHITECTURE.md) 同步 F1–F6，真实环境未验证部分保持明确。

## 6. requirement 回写

- [x] [compact-tool-activity](../../requirements/compact-tool-activity.md) 保留原阅读愿景，加入连续完成段分组用户故事和两层展开；边界明确正文/异常/特殊操作独立及未知身份不分组。
- [x] [能力索引](../../requirements/VISION.md) 同步 F1–F6，两项计时要求不变。

## 7. roadmap 回写

- [x] F6 items 从 in-progress 改为 done，关联本 feature；主文档 F6/当前状态/共享契约实现说明/变更日志同步。
- [x] 矩阵记录 G01–G13、本阶段 D07/D08/A27/A28 和 V08 证据；主题/键盘/1,000 条检查不替代 F7 真实环境与完整性能基线。
- [x] F7 保持 planned，没有自动开始安装、调用真实 Agent 或发布。

## 8. attention.md 候选盘点

没有新增需要记入 attention.md 的通用约定。main 开发现有约束继续遵守；未修改 attention.md。

## 9. 遗留

- F7 仍需真实双 CLI、IDEA/JCEF 主题、缩放、焦点、复制和性能组合验证；当前不能宣布整个 roadmap 验收完成。
- 没有可靠 call ID、Agent 或轮次的旧记录保守单列，不猜归属或生成父子关系。
- 构建仍有已有依赖注释处理/大分块提示，本阶段没有全局打包改造。
