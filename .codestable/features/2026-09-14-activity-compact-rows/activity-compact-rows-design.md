---
doc_type: feature-design
feature: 2026-09-14-activity-compact-rows
requirement: compact-tool-activity
roadmap: tool-activity-experience
roadmap_item: activity-compact-rows
status: approved
summary: 为 Codex 和 Claude 提供共用轻量工具活动行，默认显示短摘要并保留原有详情与运行计时
tags: [tool-activity, frontend, codex, claude]
---

# F1 共用轻量工具活动行

授权：用户已批准整体 roadmap 并要求继续，F1 在已批准范围内细化，无需重复方案确认。此文只定义 F1，后续事实字段、历史补全与分组仍在各自阶段。

## 0. 术语约定

- `ToolActivityView`：roadmap §4.3 的展示模型；F1 提供旧字段降级子集，后续扩展语义。
- `buildToolActivityView`：无网络的共用摘要入口；沿用 roadmap 命名，已检查当前代码没有同名实现。
- 轻量活动行：普通 execute/read/search/web_search/fetch/MCP 的可展开摘要行。
- 特殊工具：用户 shell、修改、子任务、审批、提问等；沿用现有卡片与内部交互。

## 1. 决策与约束

面向阅读 Agent 执行过程的用户，降低普通工具记录的视觉权重。两种 Agent 共用组件，不按 Agent 复制样式。默认前端应用复杂度，无偏离。

F1 优先使用现有 description 和短标题。无描述的命令使用按状态区分的通用命令摘要，完整命令保留在详情；更细的命令预览及语义解析归 F3。其他普通工具沿用现有可读标题并安全截短。

不做：改 SDK/后端/持久化/历史导入；连续分组；变更详情请求生命周期；永久展开偏好；修改输入区、工具栏、diff、审批/提问内部 UI；修改 SessionActivity 的两项计时及状态优先级。仅调整普通活动行，避免改变特殊工具行为。

## 2. 名词与编排

### 2.1 名词层

现状：`ToolCallCard` 直接把 title 作为按钮文本，使用通用卡片边框；其详情已默认折叠。`ToolCall` 的 title/meta/locations/status 足以支持基础展示。

变化：采用 roadmap §4.3 的 `ActivityContext`、`ToolActivityView` 与 `buildToolActivityView(call, context)`，提供 F1 所需的旧字段投影；无新网络接口。新增仅负责摘要外观的 `ToolActivityHeader`，详情仍由现有 `ToolCallCard` 负责。

旧字段兼容：Codex MCP 使用 `meta.rawType=mcpToolCall`；Claude MCP 沿用标题中的 `mcp__` 前缀。展示模型同时识别两者，特殊工具种类仍由卡片分支保护。此识别不引入原生事实协议。

示例：`execute + title=/bin/zsh -lc 长脚本 + complete` → “运行了命令”；`execute + meta.description=检查插件包 + running` → “检查插件包”及进行中状态；`read + title=README.md` → 保留可读文件标题。原始命令与结果不变。来源：`ToolCallCard`、两种适配器已有 ToolCall 字段。

失败、拒绝、取消、中断和未知状态需要可见文字，不能只靠颜色。可展开行支持 `aria-expanded` 与 `aria-controls`，无详情记录不呈现虚假的展开动作。

### 2.2 编排层

```mermaid
flowchart LR
  T[既有工具时间线] --> C[ToolCallCard 既有数据及状态]
  C --> K{普通工具?}
  K -->|是| M[旧字段展示模型]
  M --> H[轻量摘要行]
  K -->|否| L[现有特殊卡片]
  H -->|点击| D[既有详情渲染与按需加载]
```

现状：工具项逐条进入同一组件，标题、图标和整行边框具有较强视觉权重。

变化：仅普通工具切换到轻量行；状态、请求、输出与详情保持既有控制流。摘要色沿用主题次级文字，图标使用单色 SVG，展开箭头跟随短摘要而非固定在容器最右侧。按钮至少 24px 高，长文本单行省略，焦点可见。

普通工具默认收起，已展开普通工具不会因完成事件关闭；用户 shell 的默认展开例外不改。`SessionActivity` 不改动，既有计时在浏览器回归中验证。现有失败/缺失详情机制不在 F1 重写，其完善归 F5。

### 2.3 挂载点清单

- `SessionViewer` 的既有 `ToolCallCard` 公共渲染入口：原入口保留，由卡片内部选择普通工具轻量头部。
- `ToolCallCard` 的普通工具摘要头部：挂入共用展示模型与轻量组件；移除此分支可恢复原卡片。
- 中英文词典：新增轻量行的通用摘要与状态文案。

### 2.4 推进策略

1. 静态结构：轻量头部与局部样式可独立渲染，未挂入旧组件。
2. 计算节点：旧字段展示模型与本地化摘要完成，有输入输出证据。
3. 状态接入：普通工具接入，特殊工具和详情流程保留，完成状态不关闭主动展开。
4. 联调验收：组件浏览器验证、两种 Agent 事件驱动、计时回归、主题窄宽度与截图；回写文档。

### 2.5 结构健康度与微重构

当前 `ToolCallCard` 约千行且包含详情渲染，不适合继续加入独立摘要职责。新增计算模块放在 services，轻量头部与 CSS 放在 components/stream；这些目录已有相同职责文件。无既存 compound convention。

本次不做微重构：不搬迁原有详情和通用图标，不重组目录；新职责新文件，原卡片只新增一个选择分支。共享 `renderToolIcon` 还被工具栏使用，本次不改变它。

## 3. 验收契约

- S1：Codex/Claude 的普通工具开始与完成 → 轻量行正常显示，默认无日志，状态准确。
- S2：长命令与 Unicode 标题 → 不撑宽侧栏；完整命令/输出可在既有详情中查看。
- S3：用户展开工具后完成 → 保持展开；键盘可开关，aria 状态同步。
- S4：有远程详情的工具 → 折叠时不请求，点击后请求并显示内容。
- S5：用户 shell、文件修改、子任务、提问 → 原有分支和内容保留。
- S6：已等待与最近更新计时 → 运行中继续每秒更新，工具开关不重置，既有会话生命周期测试通过。
- S7：亮暗主题、320/375/720 宽度 → 无横向溢出，文字对比与点击区域符合 roadmap 基线。
- S8：反向检查 → 不改后端、SDK、分组、正文、输入区、SessionActivity 计时。

## 4. 与项目级架构文档的关系

完成后新增范围明确的 `ui-tool-activity` 现状文档，记录共用头部、旧字段计算和保留的特殊分支；不写 F2–F7 尚未实现的能力。`compact-tool-activity` requirement 在 F1 验收后更新为 current，范围仅单项活动阅读与详情。
