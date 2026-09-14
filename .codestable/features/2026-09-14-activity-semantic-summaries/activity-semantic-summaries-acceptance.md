---
doc_type: feature-acceptance
feature: 2026-09-14-activity-semantic-summaries
status: completed
summary: F3 共用语义摘要贯通活动行与底部名称，中英文、命令降级、原始详情和两项会话计时通过验证
tags: [tool-activity, frontend, i18n, acceptance]
---

# F3 统一语义摘要与运行提示验收报告

阶段：阶段 3（验收闭环）。日期：2026-09-14。关联[已批准方案](activity-semantic-summaries-design.md)。沿用用户整体批准及本轮“继续”的授权，仅完成 F3。

## 1. 接口契约核对

- [x] `buildToolActivityView(call, context)` 保留原接口与稳定 key，新增实际 preview 输出；原 `ActivityFactsV1` 和服务端协议不变。
- [x] Codex execute/read action 与 Claude read/相同 action 均显示“读取 README.md”；操作事实不被摘要改写。search(query,path) 显示“在 src 中搜索 activity”。
- [x] 原生描述优先于旧描述、动作和命令；MCP 优先已有可读名称，再 server/tool、单项名称或旧 MCP 标题，最后通用文案。
- [x] 简单 npm test 显示“运行 npm test”，复杂脚本保守显示“运行脚本”；预览最多 100 个码点，完整原文仍在详情。
- [x] SessionActivity 新增可选 root/session/path 上下文，只供同一展示入口使用。原计时 props 和状态归属不变。
- [x] 方案流程图的事实/语言输入、共用投影、两处名称和独立详情/计时在生产代码均有落点。

## 2. 行为与决策核对

- [x] `toolActivitySummary.ts` 独立承载描述、动作、MCP、命令与旧字段降级；`toolActivity.ts` 保留事实校验和视图编排职责，未向 App 或适配器追加逻辑。
- [x] 摘要无网络/执行能力，不读取 output/content 正文；旧 JSON input 有 32 KiB 上限，损坏/过大输入降级。只去除可靠的简单 shell 预览包装，未新增 shell 求值器。
- [x] 普通 list 纳入轻量头部；修改/任务外层名称使用共用摘要，单文件不重复堆叠文件名。原 diff、任务详情、用户 shell 默认展开与原命令头部保留。
- [x] SessionActivity 只替换当前工具名称，按工具/语言/路径 memoize；每秒时钟、累计起点、lastEventAt、优先级、结束显隐均沿原实现。仅工具名称省略，其他状态提示保持原显示规则。
- [x] 反向核查实际 `rg` 搜索 `buildToolActivityView / buildActivitySummary / toolSummary / session-activity-tool-summary`，所有生产引用位于设计 §2.3。词典、list 分支及外层名称变化也在声明范围内。
- [x] 拔除推演：恢复 F2 展示投影及原 Card 外层名称、移除底部名称接线/上下文/专属省略样式、新摘要模块和词条，即回到 F2。无数据迁移、注册器、服务端引用或额外请求残留。
- [x] 不提前实现 importer 回填、分组、详情请求生命周期或正文/输入区重设计；没有持久化中文/英文摘要。

## 3. 验收场景核对

| 场景 | 可观察证据与结果 |
| --- | --- |
| S1 描述/双 Agent | 计算用例和浏览器覆盖相同事实的 Codex/Claude，同一中英文摘要；已有描述保持原文并高于动作/旧描述。通过。 |
| S2 语义目录 | 读/目录/搜索/网页/抓取/修改/任务/MCP 的有信息与缺省用例通过；多个已知动作显示操作数，显式空或未知动作保守降级；旧 MCP 仅有标题时仍保留名称。 |
| S3 命令/原文 | 简单包装、多行 Python、heredoc、PowerShell、嵌套 shell、替换表达式、复合命令和不完整引号用例通过；浏览器展开查看原命令/输出，收起请求数为 0，不从 failed 推断业务结果。 |
| S4 本地化/路径 | 中英文目录、超过 100 个码点的 Unicode、相似根路径前缀、POSIX 根目录与 Windows 盘符/驱动器根通过；切换语言后 key 和展开状态不变。 |
| S5 名称/优先级 | 实际卡片和底部同时显示“读取 src/app.ts”，语言切换后同时变为 Read；断连→待回答→发送→恢复→工具原优先级通过，审批、提问、用户 shell、diff、子任务详情回归通过。 |
| S6 两项计时 | 语言切换时 Elapsed 10s / Last update 10s；输出后累计 15s / 最近 5s；换工具和重绘后累计 20s / 最近 5s。既有会话切换、重挂载、后台事件/重放、新轮次、缺最近时间、分钟/小时边界和结束显隐回归通过。 |
| S7 浏览器/构建 | 亮暗 × 320/375/720px 无横向溢出、头部至少 24px、原有对比度/键盘/详情检查通过；0 毫秒与 1.25 秒可读，Claude 缺耗时省略。TypeScript 和生产构建通过。 |
| S8 边界 | 抛错 getter 验证摘要不读取大 output/detail，冻结输入未被修改；生产引用、git diff、文档状态检查确认 F4–F7 未启动。通过。 |

实际验证命令（`runtime/web/`）：

```sh
node --test tests/activity-summary.test.mjs tests/activity-facts.test.mjs tests/tool-activity.test.mjs tests/session-activity.test.mjs tests/session-activity-lifecycle.test.mjs tests/session-activity-time.test.mjs tests/session-stream-lifecycle.test.mjs tests/question-delivery.test.mjs tests/approval-activity.test.mjs
node --test --test-name-pattern='^compact tool activity preserves details, interaction and the session clock$|view projection handles' tests/tool-activity.test.mjs
node --test tests/activity-summary.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vite/bin/vite.js build
```

相关 **44 项用例分次通过，无跳过**：最后完整回归中的其他 32 项通过；工具套件的过时英文断言修正后，上述定向命令实际运行该套件全部 12 项并通过。初次审批 SSR 夹具缺少新模块，已改为加载真实摘要与 i18n，3 项审批用例通过；没有用替身绕开新行为。最后补充旧 MCP 名称和路径根边界后，6 项摘要用例及类型/生产构建再次通过。

工具浏览器套件仍运行两种 Go 适配器的 `TestNativeActivityFixtures`，消费实际映射 JSON；本阶段未改 Go/SDK，不重复 F2 的全包测试。构建保留既有第三方 zod PURE 注释和大 chunk 提示，[最后构建日志](../../../build/reports/activity-semantic-summaries/build.log)已保存。

肉眼核验：[双 Agent 亮色对照](../../../build/reports/activity-semantic-summaries/light-comparison.png)、[暗色对照](../../../build/reports/activity-semantic-summaries/dark-comparison.png)、[320px 原生状态与耗时](../../../build/reports/activity-semantic-summaries/dark-native.png)、[320px 长文本](../../../build/reports/activity-semantic-summaries/light-320.png)。对照图由两个真实组件夹具截图并排组成，列名是测试说明；不是完整产品界面截图。

Impeccable detector 运行一次，唯一发现是 `index.css` 已有 Inter 字体使用警告；`git show HEAD:runtime/web/src/index.css` 确认其在本次前已存在。本需求保留原界面字体，该审美提示不引入全局换字体改动。新增摘要和名称接线无检测发现。

验证边界：真实 React 卡片/Markdown/i18n/流 hook/service，父层 exchanges 由夹具提供；未运行完整 App + HTTP + 双 CLI，未执行 IDEA/JCEF 联调。

## 4. 术语一致性

- [x] 原生事实、语义摘要、命令预览与完整详情职责分明；operation 不随摘要变化。
- [x] 固定 UI 文案本地化，已有描述/命令/查询保持原文；不生成“测试通过”“修复完成”等业务结论。
- [x] 单项工具 durationMs 与底部累计等待/最近更新保持独立名称与来源。

## 5. 架构归并

- [x] [ui-tool-activity](../../architecture/ui-tool-activity.md) 实际写入摘要优先级、受限输入处理、两处调用关系、文件/任务外层及底部名称 memoization，补充源码锚点与变更日志。
- [x] [架构索引](../../architecture/ARCHITECTURE.md) 更新为 F1–F3 现状；未描述尚未实现的历史回填/分组/新详情机制。

## 6. requirement 回写

- [x] [compact-tool-activity](../../requirements/compact-tool-activity.md) 保持 current 和原始愿景，补充一致的可辨认摘要、本地化及保守脚本说明；两项计时与特殊交互要求保留，新增 F3 日志。
- [x] [VISION](../../requirements/VISION.md) 同步实际已完成能力。

## 7. roadmap 回写

- [x] `activity-semantic-summaries` 从 in-progress 改为 done，关联 feature 一致；主文档、items 与矩阵说明同步，F1/F2 维持 done、F4–F7 维持 planned。
- [x] 7 个阶段唯一且依赖无环，整体 63 项矩阵仍为完整路线契约；没有将真实 CLI/IDEA 或后续阶段标为通过。
- [x] checklist 的 4 个 steps 为 done、8 个 checks 为 passed；YAML/frontmatter、链接和改动格式验证通过。

## 8. attention.md 候选盘点

没有新增需要沉淀为长期项目规则的环境信息。已有 main 开发约定继续保留；不将一次夹具更新或已有字体提示写为全局要求。

## 9. 遗留

- 下一阶段 F4：原生历史、缓存与实时显示的一致性及可靠归属。新详情生命周期、连续分组分别留在 F5/F6。
- 无可靠输入的旧记录仍使用通用摘要或旧标题，不推断缺失动作；本阶段不补写历史事实。
- F7 仍需真实双 CLI 和 IDEA/JCEF 的组合验证；本阶段只交付浏览器及固定协议证据。
- 代码在 main 工作区，F1–F3 尚未提交、推送、安装或发布。
