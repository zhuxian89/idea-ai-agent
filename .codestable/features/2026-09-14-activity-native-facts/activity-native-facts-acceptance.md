---
doc_type: feature-acceptance
feature: 2026-09-14-activity-native-facts
status: completed
summary: F2 原生工具事实贯通 SDK、实时适配器、保存传输与 Web，可靠终态和可用耗时通过验证且两项会话计时保留
tags: [tool-activity, protocol, acceptance, codex, claude]
---

# F2 原生工具事实贯通验收报告

阶段：阶段 3（验收闭环）。验收日期：2026-09-14。关联[已批准方案](activity-native-facts-design.md)。授权沿用用户整体方案批准及本轮“继续”，按单个子 feature 完成 F2，未新增范围决定。

## 1. 接口契约核对

- [x] Go/Web 的可选 `ToolCall.activity: ActivityFactsV1` 与 roadmap §4.1 对应，包含原生身份、动作、描述、工具信息、结果和可用耗时；格式化摘要不持久化。
- [x] Codex 命令 completed + read action + durationMs=0 → 保留读动作、completed 和 0；原命令/输出仍在旧字段。SDK 同时支持命令耗时的 camelCase/snake_case 字段。
- [x] Claude Bash description → `displayLabel.source=tool_argument`；`tool_result.is_error=true` → failed；未提供工具耗时则省略。明确取消/中断优先于同时出现的通用错误标记。
- [x] 单消息多个 `tool_result` 按自身 `tool_use_id` 分配，原 `content` 保留；重复结果不更新其他 pending 调用。父关系只取明确 Assistant `parent_tool_use_id`。
- [x] 无工具终态证据的轮次收尾 → unknown，既有 task/ask_user 生命周期除外；不生成 completed 事实。
- [x] 名词层变化均有实际类型/解码/合并入口；§2.2 流程中的 SDK、实时投影、Manager、完整详情、紧凑事件、Web 和轻量行均经 `rg` 核对。

## 2. 行为与决策核对

- [x] Codex 的 started/updated/completed 三个实时挂载点调用 `mapLiveToolItem`。无状态的更新保持 running；未知完成状态保守降级；混合未知或明确空 actions 清除旧投影，缺失 actions 保留。
- [x] Claude 仅在实时 Assistant 入口附加事实。原生 permission_denied 产生 declined，后续通用失败不抹掉拒绝证据；Bash 结构化字段区分失败/取消/中断，任意 MCP 业务字段和 stdout 文字不参与推断。
- [x] Manager 与 usecase 缓冲去重均合并 activity；缺失字段不覆盖旧事实，显式数组整体替换，嵌套字段克隆隔离；更晚有序终态可修正之前结果，running 重放不能抹除终态。
- [x] 紧凑列表、流事件和完整详情保留一致事实，大日志仍仅在原详情路径；HTTP 路由与响应封装未修改。
- [x] Web 接入校验、合并、原生描述、状态和耗时；版本/结构不兼容降级旧字段。0 正常显示，非法/缺失耗时省略。Go 无法解码的可选事实降为内部版本 0，不丢弃外层 ToolCall。
- [x] 反向范围检查：两个 importer 未挂入新事实；Codex 旧 `mapToolItem` 与 Claude 共享 `newRunningToolCall` 未改变历史投影行为。没有新增分组、底部语义摘要、详情请求生命周期或输入区改造。
- [x] 挂载点反查实际搜索 `ActivityFactsV1 / MergeActivityFacts / CloneActivityFacts / mergeActivityFacts / mapLiveToolItem / claudeActivityFacts / durationLabel`，生产引用落于方案 §2.3；补全了原清单中较粗的 usecase 缓冲、词典与具体文件位置。
- [x] 拔除推演：恢复 SDK 字段、共享类型与 Manager/usecase/实时入口，恢复 App/hook/Viewer/Card 的 F2 接线，删除事实模块及 F2 耗时显示/词条即可回到 F1；已存可选字段可由旧读端忽略。无迁移、注册器、额外网络端点或计时服务残留。

## 3. 验收场景核对

| 场景 | 证据与结果 |
| --- | --- |
| S1 可选事实与非法值 | Go 类型/SDK 反序列化及 Web 校验测试覆盖旧 ToolCall、未知版本、损坏结构、非字符串枚举、0/缺失/负数/NaN/Infinity 耗时；通过。 |
| S2 Codex 原生事实 | `TestNativeActivityFixtures` 经 SDK 解码再调用实际适配器，覆盖动作/来源/轮次/MCP/耗时/终态、空与混合未知动作、增量不假完成；通过。 |
| S3 Claude 逐调用结果 | 同名协议 fixture 经 `handleAssistantMessage` / `handleUserMessage`，验证描述、动作、MCP、父关系、多个并发结果及重复投递；拒绝、带 is_error 的取消/中断与普通失败保持区别；通过。 |
| S4 合并/重放/隔离 | Go 契约、Manager、usecase 及 Web 合并用例验证部分更新、actions 替换、终态纠正、running 重放保护和克隆后修改；通过。 |
| S5 完整与紧凑一致 | 两种 Agent 在临时根目录创建真实会话、合并 pending、落盘，再用新 Manager 读取；完整/紧凑 activity 深度相同，大输出仅详情保留。usecase 另测缓冲去重、紧凑流、详情服务和 JSON 封装往返；通过。 |
| S6 Web 原生状态/耗时 | 浏览器直接消费 Go 固定协议测试产生的 JSON，实际卡片显示 `0 毫秒`、`1.25 秒`、失败/拒绝/取消/中断；Claude 无工具耗时不显示计时，未知版本降级，结束轮次未决工具显示未知；通过。 |
| S7 计时/特殊交互 | 实际组件验证默认折叠、主动展开保持、按需详情、用户 shell 默认展开、diff 与子任务详情；既有会话计时、流生命周期、审批/提问回归通过。展开和重放后仍显示正确的已等待/最近更新时间，结束显隐沿用原规则。 |
| S8 阶段边界 | `git diff`、生产引用及 roadmap 状态检查确认仅完成 F2；F3–F7 保持 planned，SessionActivity 计时代码未改；通过。 |

Go 验证（`runtime/`）：

```sh
go test ./server/internal/agent/types ./server/internal/agent/codex ./server/internal/agent/claude ./server/internal/session ./server/internal/api/usecase
go test ./server/internal/api -run '^Test.*ToolCall'
```

5 个相关包通过，最终 Claude 状态优先级修正后再次运行亦通过。HTTP 包仅完成编译检查，命令报告 `[no tests to run]`，没有将其算作端点测试。

SDK 验证分别在对应 SDK 根目录执行：Codex `go test ./types`、Claude `go test . -run '^TestToolResultBlockPreservesNativeIdentityContentAndError$'`，均通过。

Web 验证（`runtime/web/`）：

```sh
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node --test tests/activity-facts.test.mjs tests/tool-activity.test.mjs tests/session-activity.test.mjs tests/session-activity-lifecycle.test.mjs tests/session-activity-time.test.mjs tests/session-stream-lifecycle.test.mjs tests/question-delivery.test.mjs tests/approval-activity.test.mjs
node --test tests/session-activity.test.mjs
node node_modules/vite/bin/vite.js build
```

类型检查和生产构建通过。相关 Web 用例分次共 35 项通过，无跳过：首轮 33 通过、1 失败，失败原因为旧 VM 夹具未提供新依赖；补齐真实模块并更新原有“轮次结束自动成功”的过时断言、增加原生结果优先断言后，该文件 2 项通过。其余用例无需因测试夹具修正重复运行。构建仍有第三方 zod PURE 注释和大 chunk 提示，本阶段未改构建配置。Impeccable detector 对改动 UI 运行一次，结果 `[]`。

浏览器肉眼核验已完成：[原生数据亮色](../../../build/reports/activity-native-facts/light-native.png)、[原生数据暗色](../../../build/reports/activity-native-facts/dark-native.png)。320px 原生数据页面无横向溢出，耗时和底部两项计时可读；另有亮暗 × 320/375/720px 的宽度、展开与完成态回归截图，同目录保留实际 [Codex JSON](../../../build/reports/activity-native-facts/codex.json) 和 [Claude JSON](../../../build/reports/activity-native-facts/claude.json)。F1 对照截图保留在原报告目录。

证据边界：浏览器使用真实 React 卡片/Markdown/流 hook/service/i18n，父层 exchanges 由夹具供给；Go 存储和 usecase 独立覆盖真实落盘链路。未启动完整 App + HTTP 服务 + CLI 的端到端运行，也未执行 IDEA/JCEF 联调。

## 4. 术语一致性

- [x] `ActivityFactsV1` 是可选原生事实，`ToolActivityView` 是临时展示投影；`ToolActivityHeader` 仅负责轻量展示。代码、方案和架构职责一致。
- [x] `outcome` 为有证据的工具终态；unknown/running 属于展示状态，不写成原生成功结果。既有顶层 complete 与事实 completed 的转换有明确边界。
- [x] `durationMs` 指单次工具原生耗时；“已等待 / 最近更新于”始终指底部会话状态，未混用。

## 5. 架构归并

- [x] 更新 [ui-tool-activity](../../architecture/ui-tool-activity.md) 的契约、SDK→实时适配→Manager/缓冲→完整/紧凑传输→Web 数据流、状态和耗时所有权、兼容及历史边界，附实际代码锚点。
- [x] [架构索引](../../architecture/ARCHITECTURE.md) 同步现状为 F1/F2；未把 F3 语义摘要、F4 历史回填、F5 新详情生命周期或 F6 分组写为已实现。

## 6. requirement 回写

- [x] [compact-tool-activity](../../requirements/compact-tool-activity.md) 保持 current 与原始愿景，补充可靠结果、可用原生耗时及缺失降级的用户故事/边界，追加 F2 日志。
- [x] [VISION](../../requirements/VISION.md) 同步 F1/F2 能力；两项会话计时要求保留。

## 7. roadmap 回写

- [x] `activity-native-facts` 从 in-progress 改为 done，feature 仍为 `2026-09-14-activity-native-facts`；主文档、items.yaml 和矩阵说明同步。
- [x] F1 维持 done，F3–F7 维持 planned；7 个条目的唯一性、依赖有效性和无环检查通过。整体 63 项矩阵继续作为完整路线的验收契约，未整体标为通过。
- [x] F2 checklist 5 个 steps 为 done、8 个 checks 为 passed；文档格式、链接与 diff 空白检查通过。

## 8. attention.md 候选盘点

本阶段未新增需要写入 attention.md 的长期规则。当前 shell 缺少 pnpm 的事实已在 F1 报告记录，本次继续使用已有本地 Node 入口，不把一次环境状态固化为永久要求。

## 9. 遗留

- 下一阶段 F3：基于动作、描述和 MCP 信息完善统一语义摘要，并精简底部工具名称；两项会话计时继续保留。
- F4/F5/F6 分别负责历史一致性、详情生命周期和连续活动分组，本阶段未提前实现。
- Codex 原生轮次仅在当前完成事件可读取时提供；Claude 未提供工具耗时则省略。旧记录不自动补事实。
- 真实双 CLI、IDEA/JCEF、完整组合场景与交付包验证归 F7；本阶段未宣称整套桌面体验完成。
- 本轮交付为 main 工作区代码和验收记录；F1/F2 尚未提交或推送，也未安装、发布。
