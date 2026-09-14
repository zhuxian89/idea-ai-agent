---
doc_type: feature-acceptance
feature: 2026-09-14-activity-compact-rows
status: completed
summary: F1 共用轻量工具行通过浏览器、类型与构建验证，保留详情和两项会话计时
tags: [tool-activity, frontend, acceptance]
---

# F1 共用轻量工具活动行验收报告

验收日期：2026-09-14。关联[已批准方案](activity-compact-rows-design.md)。用户本轮已明确授权继续并审核通过方案，按该范围完成实现和验收，无新增范围决定。

## 1. 接口契约核对

- [x] `buildToolActivityView(call, context)` 无网络依赖：execute + complete → “运行了命令”；description 优先；英文为 “Ran a command”；长 Unicode 标题不截断代理对。
- [x] `ActivityContext`、`ToolActivityView` 沿用 roadmap F1 旧字段子集。原生事实、耗时和高级摘要尚未接入。
- [x] `ToolActivityHeader` 只接收展示和展开回调；原 `ToolCall` 传输结构未改。
- [x] §2.2 流程中的时间线入口、投影、普通头部、特殊头部、原详情均在代码有对应分支。

## 2. 行为与决策核对

- [x] 普通命令、读取、搜索、网页获取和 MCP 使用无外框的轻量行；两种 Agent 共用实现。Codex MCP rawType 与 Claude MCP 旧名称前缀均识别。
- [x] 命令描述优先；无描述命令使用通用文案，完整命令和输出仍在原详情中。
- [x] 默认收起；运行完成不关闭主动展开；失败/拒绝/取消/中断/未知状态有文字。
- [x] 原详情加载和状态协调代码未重写；折叠不加载、展开按原接口加载，接口返回由测试夹具提供。
- [x] 反向范围检查：无后端/SDK/持久化/正文编排/输入框/工具栏/SessionActivity 代码改动；没有提前实现分组或永久展开偏好。
- [x] 实际 `rg` 反查：新增生产引用只在 `ToolCallCard`、新增摘要模块/头部/CSS 与两个词典，全部落于 §2.3 挂载点。
- [x] 拔除推演：恢复卡片原头部和容器条件、删除新模块/头部/CSS/词条及专用测试，即回到原展示；无迁移、注册器或服务端残留。

## 3. 验收场景核对

| 场景 | 可观察证据与结果 |
|---|---|
| S1 双 Agent 开始/完成 | 浏览器用两种适配器代表性旧字段、真实卡片/流 hook/服务事件驱动，开始收起、完成状态正确，通过。父层 exchanges 更新由夹具供给，未运行完整 App 或 CLI。 |
| S2 长命令/Unicode | 长 shell 命令只占单行摘要，展开 `pre` 与原文完全一致；110 个 emoji 标题截为 100 个码点；无横向溢出，通过。 |
| S3 主动展开/键盘 | Enter 展开、Space 收起，aria 指向真实详情；完成后保持展开；无详情项为非按钮，通过。 |
| S4 远程详情 | 折叠请求数 0，展开 1，再次收展不重复请求；返回原文可见，通过。 |
| S5 特殊交互 | 用户 shell 输出默认可见，diff before/after 和子任务 prompt 可展开；SessionViewer 提问分支未改，已有提问确认/拒绝/断线及审批状态回归通过。 |
| S6 两项计时 | 工具开始 10 秒、展开 15 秒、完成 20 秒、收起/重渲染 25 秒时两项计时准确；会话切换、重挂载、后台事件、重放、新轮次和结束显隐既有浏览器回归通过。 |
| S7 主题/宽度 | 亮暗 × 320/375/720px，行高至少 24px、无横向溢出、摘要对比度 ≥4.5:1、键盘焦点可见；8 张首轮截图及完成态对照已肉眼检查，通过。 |
| S8 范围 | git diff 与生产引用反查通过；仅 F1 展示层、词典、测试和相关文档变化。 |

验证命令（在 `runtime/web`）：

```sh
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node --test tests/tool-activity.test.mjs
node --test tests/session-activity-lifecycle.test.mjs tests/session-activity-time.test.mjs tests/session-stream-lifecycle.test.mjs tests/question-delivery.test.mjs tests/approval-activity.test.mjs
node node_modules/vite/bin/vite.js build
```

结果：类型检查通过；专用浏览器测试 8 项（含父套件）、既有相关测试 22 项通过，无跳过。生产构建通过；构建输出有第三方 zod PURE 注释和大 chunk 提示，本阶段未更改构建配置。Impeccable 对改动 UI 文件运行一次 detector，结果 `[]`。

截图（本地构建报告，不进入应用包）：[同数据修改前后](../../../build/reports/tool-activity/before-after.png)、[主题与宽度](../../../build/reports/tool-activity/theme-widths.png)、[展开详情](../../../build/reports/tool-activity/expanded.png)。修改前截图使用 `a903fbe` 的真实旧卡片与相同代表性记录。截图中的描边是键盘焦点，不是默认卡片外框。

## 4. 术语一致性

- [x] `buildToolActivityView`、`ToolActivityView` 和 `ToolActivityHeader` 在方案、实现和架构文档中指向同一职责；生产入口无同名冲突。
- [x] “轻量活动行”指普通单项工具；“特殊工具”和“会话状态”仍为独立保留边界，没有混作活动分组。

## 5. 架构归并

- [x] 新增 [ui-tool-activity](../../architecture/ui-tool-activity.md)，包含数据投影、头部/详情所有权、现有特殊分支、计时和真实代码锚点。
- [x] 架构索引描述该模块实际形态，明确仅覆盖已核实范围；未写入尚未实现的 F2–F7 结构。

## 6. requirement 回写

- [x] `compact-tool-activity` 从 draft 升为 current，保留原始用户故事与边界，追加变更日志，`implemented_by` 指向现状架构；VISION 同步。

## 7. roadmap 回写

- [x] `activity-compact-rows` 从 in-progress 改为 done，feature 关联一致，items.yaml 与主文档同步。
- [x] F2–F7 维持 planned；63 项整体矩阵仍为验收契约，没有将全部标为通过。

## 8. attention.md 候选盘点

候选：当前 shell 无 `pnpm` 命令，但已有依赖可直接用 Node 调用本地 TypeScript/Vite，并用 `node --test` 执行测试。本次只记在验收报告，不把暂时的 shell 状态固化为永久项目要求。

## 9. 遗留

- 底部 `SessionActivity` 仍使用原始工具 title，长命令会使运行提示偏长；已归 F3 的共用摘要范围，保留两项计时要求不变。
- 原生事实/真实耗时、完整语义摘要、历史一致性、跨会话详情生命周期、连续分组分别由 F2–F6 覆盖。
- 本阶段使用浏览器真实组件及受控数据，尚未执行真实双 CLI 与 IDEA/JCEF 联调；该项归 F7，未宣称整体桌面体验验收通过。
- 未提交、推送、安装或发布。本轮交付为 main 工作区的 F1 代码与验收记录。
