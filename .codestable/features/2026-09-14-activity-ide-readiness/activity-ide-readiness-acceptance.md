---
doc_type: feature-acceptance
feature: 2026-09-14-activity-ide-readiness
status: partial
summary: 浏览器组合验证、本地包、原生回归和真实 Codex 历史通过，Claude 超时及 IDEA/JCEF 实机交互待完成
tags: [tool-activity, readiness, ide, validation]
---

# F7 IDEA 就绪验证记录（未全部验收）

日期：2026-09-14。关联 [批准方案](activity-ide-readiness-design.md) 与 [清单](activity-ide-readiness-checklist.yaml)。用户已批准整体方案；当前 main，全部 F1–F7 修改尚未提交推送。F7 保持 in-progress，本报告不是整体通过声明。

## 1. 接口契约核对

- [x] 复用现有 ActivityTimeline/ToolCall/activityDetails；F7 不增加 UI 调试入口或产品依赖。
- [x] Codex 0.154 实测暴露包装与内层命令 ID 不同。importer 保留 wrapperTool/wrapperInput；usecase 在有同 nativeTurnId 的 live commandExecution 时不再插入执行包装层。不用命令相似度、时间接近或猜测 ID 合并。
- [x] exec 结果数组中带 chunk_id/exit_code 的 input_text 原生执行信封可证明失败；单纯 Script completed 不覆盖内层退出码。原始 wrapperInput 保留，不执行 JavaScript。
- [x] 新增两项 Go 回归覆盖包装 provenance、退出码失败、JSON 误判保护、同轮去包装、其他轮次/工具保留、重复同步和输入不变。
- [x] 流程图各节点对应实际 Web/Go/Kotlin 检查、包构建和原生 CLI 脚本。IDEA 节点仅启动尝试，不等于完成 JCEF 验证。

## 2. 行为与决策核对

- [x] 两项计时的来源、会话隔离、累计、最近更新和完成撤除保留，重点回归与完整 App smoke 已通过。
- [x] 16 个 width/theme/zoom 组合保持正文层级、活动省略、失败可见及键盘展开；无生产 CSS 修改。
- [x] 完整 App smoke 的四个旧 fixture 补齐 POST /sync 和 activity_history_version=1；活动文字样例提供原生 description。修复的是模拟契约，未为了通过测试改动提问/恢复业务。
- [x] 当前源码生成 macOS arm64 本地预览包，版本维持 0.1.13，不改正式发布链接。
- [x] 原生调用只在 .tools 下的空白 Git 测试项目执行：读 README、printf 和预期 exit 7；未调用其他 Agent 分工、未编辑用户项目或登录配置。
- [x] 挂载点 rg 核对：activity-readiness.test.mjs、smoke-activity-native.mjs、四个 smoke fixture、codex importer/import_activity、usecase/import_activity 和相应 Go 测试。移除 F7 测试脚本不会留下生产入口；生产修复属于既有导入链路。

## 3. 验收场景核对

| 场景 | 结果 | 实际证据 |
| --- | --- | --- |
| S1 / V01–V05 浏览器部分 | 通过 | 320/375/480/720 × light/dark × CSS zoom 100%/150%；Tab/Enter/Space、aria-expanded、焦点、无横向溢出；活动文字对比 6.06–7.16:1，入口高度至少 24px |
| S2 / V06 | 通过，未声称更快 | 1000 条，闭合分组与同版开放逐项 UI 的同机交替对照；闭合零详情请求/日志 DOM；纯分组日志 getter 回归保证不扫描日志 |
| S3 / V07 | 通过 | 1 MiB/8192 行日志，3 次更新正文完全相等，无全量重复拼接；scrollTop=50 保持；收起后 4 秒无轮询 |
| S4 / V08 | 通过 | 全 Web 145 项 + readiness 4 项，相关 Go 包与最终 Codex/API 修复回归，Kotlin 21 项、TypeScript、构建和完整 App smoke |
| S5 / V09 真实 IDEA/JCEF | 未完成 | IDEA 2025.1.2 隔离 config/system/plugins 启动，日志确认载入 0.1.13；未取得 JCEF 可操作页面；macOS 录屏未授权；缓存 IC 2024.1 启动退出 137，原因未确认 |
| S6 / V10 Codex | 通过 | codex-cli 0.154.0，真实调用约 21.8 秒；2 成功+1 失败；页面打开历史、再次完整 /sync 后恰好原 3 ID/状态，详情正常且完成计时撤除；截图为浏览器承载真实会话 |
| S6 / V10 Claude | 未完成 | Claude Code 2.1.270；auth status 报 loggedIn=true；真实 adapter 请求 180 秒无终态后停止。尚不能判断登录有效性、模型服务连通性或适配器初始化的具体原因 |
| S7 本地交付 | 通过（预览包） | ZIP、平台、版本、sha256、包内 runtime 与被测二进制哈希一致；未安装到用户现用 IDEA、未发布 |

性能口径：同机 Chrome 的当前 UI，开放尾段逐项为基线，闭合尾段分组为对照。6 轮交替顺序，剔除首轮，DOM 提交后一帧时间中位数逐项 **128.8 ms**、分组 **131.3 ms**；DOM 节点从 **11048** 到 **1051**。这是同版本的场景对照，不是改造前后基准，不据此宣称 CPU 渲染加速、固定帧率或绝对响应阈值。

运行命令及日志（证据根目录 `build/reports/activity-ide-readiness/`）：

- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`：typecheck.log。
- `ACTIVITY_CAPTURE=0 node --test tests/*.test.mjs`：web-regression.log，145 项；新增 readiness 另跑 readiness.log，4 项。
- `node scripts/test-runtime.mjs ./server/internal/agent/codex ./server/internal/agent/claude ./server/internal/agent/types ./server/internal/session ./server/internal/api/... -count=1`：go.log；Codex 实测修复后的相关 4 包重跑 codex-fix.log。
- 使用 IDEA 内置 JBR21：`./gradlew test --rerun-tasks`，kotlin-tests.log，21 项；`./gradlew buildPlugin`，final-package-build.log。
- `node scripts/smoke-runtime.mjs --delivery-only`：final-package-smoke.log，覆盖选择提交、模型/权限、消息/计时、原生壳桥接模拟、主题与退出。名字中的 native 是桥接模拟，不能当 JCEF 实测。
- `node scripts/smoke-activity-native.mjs`：首次真实双 CLI 尝试；native-cli.json 保留初次 Codex 历史问题及 Claude 超时。
- `node scripts/smoke-activity-native.mjs --codex-only`：修复后的新项目真实 Codex 再测，native-codex.json/native-codex.log；`--recheck --codex-only` 仅恢复该会话，不再次调用模型。

肉眼已检查 `light-320-150.png`、`dark-480-150.png` 和修复后的 `codex-native-history-browser.png`。F6 六张截图沿用；新截图不伪装为 IDEA 实机截图。

## 4. 术语一致性

ActivityTimeline、ActivityGroup、ToolCall 和 ActivityFactsV1 沿用；新增 importedCodexWrappedExecFailed、wrapperTool/wrapperInput 在设计补充中定义并 rg 核查，无新产品命名或用户流程。native CLI 与 browser/JCEF 三类证据严格区分。

## 5. 架构归并

ui-tool-activity 实际补入外层包装与内层命令命名空间差异、同轮 live 命令优先、包装退出码信封纪律及环境验证边界。无新的 UI 模块/网络服务。生产挂载仍在现有 codex importer → usecase → session；不需要架构总入口新增模块。

## 6. requirement 回写

compact-tool-activity 保持 current 和原愿景；补入同轮原生包装不重复显示、当前仅 Codex 实测通过、Claude/JCEF 未通过的边界。两项计时用户故事不变。

## 7. roadmap 回写

items 与主文档、acceptance-matrix 同步 F7 in-progress，feature 指向本目录。F1–F6 done 不变。**未完成 V09/V10，不能改 F7 done**；剩余工作仍属于一个阶段，没有新增 F8。

## 8. attention.md 候选盘点

JDK 默认可能为 8；本次使用 IDEA 内置 JBR21 启动 Gradle。当前无 pnpm 命令但依赖已安装，既有 build-runtime.mjs 使用 Node 直接调用 Vite。记录在本报告，不改用户已经确认的 main 开发约束。

## 9. 遗留

1. IDEA/JCEF：需要可操作的 IDE 项目窗口，完成真实亮暗主题、100%/150%、键盘/焦点、剪贴板和滚动。截图工具预检报告 macOS 未授予录屏；没有自动审批拒绝，未改系统权限。由本阶段启动的隔离 IDE 已退出，用户原有 IDEA PID 72883 保持运行。
2. Claude：已登录标志不能证明模型请求可用。保留 180 秒超时记录，恢复可响应的 CLI 会话后补 V10；当前不宣称 Claude 实测通过。
3. 无可靠内层 ID 的 exec 包装历史不能补全同轮漏失的内层命令。当前采用保守去包装，不按脚本相似度拼身份；独立导入和不同轮次仍保留。已有受污染的测试会话留下问题证据，不迁移用户历史。
4. 同机性能结果减少 DOM，不证明更快；没有添加虚拟化或全量缓存。
5. 本地包为预览，未完成完整 IDEA/JCEF 和双 CLI 联合验收，不作为正式发布包。

包：`build/local-distributions/idea-ai-agent-0.1.13-activity-preview-macos-arm64.zip`；大小 10527160 字节；SHA-256：`9f7d817e958e592c8f5cbb11f67ae6d87071657adf6fa3a090dfcd2ff2470aec`。详情见 `build/reports/activity-ide-readiness/package.json`。

## 后续发布授权

2026-09-14 用户明确要求 push 并生成新的 release 包。发布目标为 0.1.14，包含当前已验证能力及修复；本节更新先前“未提交/未发布”的阶段状态，保留原验收事实。发布不代表 Claude 或 IDEA/JCEF 的未完成检查通过，F7 继续 in-progress。发布信息见 [0.1.14 说明](../../../docs/releases/v0.1.14.md)。
