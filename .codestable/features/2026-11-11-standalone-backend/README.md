# 独立后端计划与进度


## 当前状态（2026-11-28）

- **本机测试包 `0.1.69-local.7`（`macos-arm64`）已构建并排程升级到本机已装的 `0.1.69-local.6`（2026-11-28；以 `result.txt` 为准，写入前不得记为已安装）。** 内容为多 Agent 详情页顶栏精简与快捷切换改造：去掉 `.collab-detail-head` 右侧难理解的权限盾牌/锁（`.collab-detail-permission`）与无文字状态圆点（`.collab-model-dot`），在窄屏/手机端（`isNarrow`）替换为「三个横线」运行列表抽屉按钮（`≡`，`aria-label="运行列表"`），支持从阶段对话详情页一键拉出侧栏切换其他协作对话、新建协作或返回单聊，无需先退回卡片页。
  - **已验证**：`tsc --noEmit`、`vite build`、`collab-quick-mode`（含手机详情页直点 `≡` 打开/收起侧栏断言）、`collab-meeting` 与 `collab-edit-models` 全部通过；隔离环境 `go vet ./server/...`、`kanban` 全量与 `-race TestTaskStoreSnapshotMigration` 通过（日志 `go-tests.log`）；`verify-release-assets.mjs` 全部 6 个 `macos-arm64` 附件与三份 SHA-256 通过（305 网页文件、零 `/mindfs-assets/`）；`verify-package-install.mjs` 临时 HOME 4/4 通过。回滚源为已装并验证通过的 `0.1.69-local.6` 构建，`upgrade.py --check` 预检通过（10 项目，Relay `bound=True connected=True`）。
  - **未验证**：升级结果（待独立 launchd 任务 `dev.ideaagent.standalone-upgrade-0169-local7` 落盘 `result.txt`）；装后手机真机实测详情页一键切对话与软键盘/Relay 入口。[升级目录](../../../build/reports/standalone-0.1.69-local.7-live-upgrade/) · [验证记录](standalone-backend-implementation.md#0169-local7-本机测试包与本地升级2026-11-28)

- **本机测试包 `0.1.69-local.6`（`macos-arm64`）已安装并验证通过（2026-11-28），现作为 `0.1.69-local.7` 升级回滚源。** `result.txt`（`2026-11-28T12:04:02+08:00`）确认 `0.1.69-local.6 installed and verified at http://127.0.0.1:7441; 10 existing projects readable; binary, /api/collab/templates, and web assets match the build; Relay state verified.`。内容为修复手机端回复元信息栏（`.mindfs-assistant-meta`）折成两行的问题。[升级目录](../../../build/reports/standalone-0.1.69-local.6-live-upgrade/) · [验证记录](standalone-backend-implementation.md#0169-local6-本机测试包与本地升级2026-11-28)

- **本机测试包 `0.1.69-local.5`（`macos-arm64`）已安装并验证通过（2026-11-28），现作为 `0.1.69-local.6` 升级回滚源。** `result.txt`（`2026-11-28T11:34:17+08:00`）确认 `0.1.69-local.5 installed and verified at http://127.0.0.1:7441; 10 existing projects readable; binary, /api/collab/templates, and web assets match the build; Relay state verified.`。内容为「手机端远程网页工作台 5 阶段纯样式优化及第 01 轮审核 R1–R7 与两处生产 CSS 打包层叠修复」。真机复测暴露回复元信息栏折成两行，已在 `0.1.69-local.6` 修复。[升级目录](../../../build/reports/standalone-0.1.69-local.5-live-upgrade/) · [验证记录](standalone-backend-implementation.md#0169-local5-本机测试包与本地升级2026-11-28)

- **手机端远程网页工作台纯样式优化及第 01 轮审核 R1–R7 交付复测（源码完成，前端构建、生产 CSS 实包校验、自动化浏览器回归、Go 资源与旧库迁移验证全部通过；已打入本机测试包 `0.1.69-local.5` 并排程升级，真机与经 Relay 实机待验收）。**
  - **源码完成**：严格限定在 `html[data-remote-ui="1"][data-device="phone"]` 与 `.remote-phone` 作用域内完成 5 个阶段手机端视觉/排版升级（4px 间距网格、8/12/16px 三档嵌套圆角、11–20px 六档整数字阶、44/40/36px 三档触控热区、安全区单变量契约、单聊两行输入区、消息气泡与审批卡去红调统一、多 Agent 协作与会议页对齐），并在第 01 轮审核与最终交付核验中完成 R1–R7 及两处生产打包层叠冲突修复：协作/会议页全量可编辑控件统一 `16px`（覆盖内联字号、`<input type="number">` 与非 `[data-narrow="1"]` 场景）、补齐 `.idea-permission-select` 与 `.idea-permission-menu` 手机尺寸/弹性收缩规则（兼顾 `CollabRunModelsModal` 实际手机调用与 `ActionBar` 防御约束）、裁决弹窗 `@media (max-width: 640px)` 提升选择器至 `.collab-modal.meeting-decision-modal`（显式重置 `max-width`/`max-height`/`border`/`border-radius: 0`，避免生产包中后置 `CollabShell.css` 的 `.collab-modal` 覆写窄屏全屏圆角与高度）并保留文档预览弹窗 `.collab-modal-body.collab-modal-body--file` 的零内边距、提问卡自定义输入框激活/聚焦态与卡片边框/头部/图标统一改用主题强调色与静谧表面、输入区内边距与角标归入 4px 网格且以 `calc(var(--rp-r-row, 12px) - 1px)` 表达同心圆角、以及多 Agent 入口角标新增 `--rp-wait-badge-bg` / `--rp-wait-badge-fg` 确保全主题 WCAG AA 对比度（`5.02:1–8.26:1`）。
  - **已验证**：`tsc --noEmit`（0 报错）、`vite build`（`runtime/web/dist` 共 305 文件、0 处 `/mindfs-assets/`）、前端回归 `action-queue` / `remote-phone` / `remote-design` / `session-project-hierarchy` / `workspace-sidebars-browser` / `native-interactions`（32/32）、`remote-entry-build`（4/4）、`collab-quick-mode` & `collab-meeting`（2/2，使用最终构建产物）、基于最终生产 CSS 包（`dist/assets/index-*.css`）的 R1–R7 与桌面隔离 Playwright 专项校验（320/390/800px 零溢出与层叠验证通过）、以及隔离环境下 `TestFrontendAssetsStayWithBackend`、`kanban` 全量与 `-race TestTaskStoreSnapshotMigration` 全部通过。
  - **安装包 / 待真机验收**：已构建本机测试包 `0.1.69-local.5` 并排程升级（公开正式包与 IDEA 插件包尚未重新发布）；以下真机项自动化环境无法替代，需装包后实机确认：iPhone Safari / PWA、iOS App（`WKWebView`）与 Android Chrome 的软键盘弹起/收起手感、`--mindfs-safe-area-bottom` 动态清零/恢复与 `16px` 输入防自动缩放、320px 实机视觉与经 Relay 入口访问核验。[验证记录](standalone-backend-implementation.md#手机端远程网页纯样式优化及第-01-轮审核修复2026-11-28)

- **本机测试包 `0.1.69-local.4`（`macos-arm64`）已安装并验证通过（2026-11-28），现作为 `0.1.69-local.5` 升级回滚源。** `result.txt`（`2026-11-28T10:19:53+08:00`）确认 `0.1.69-local.4 installed and verified at http://127.0.0.1:7441; 10 existing projects readable; binary, /api/collab/templates, and web assets match the build; Relay state verified.`。内容为上述「开大会引文误判根因修复、引文问题保留立场、待确认单列、裁决流程审查 9 条修复」。
  - **已验证**：`collab`（`-race`）、`api`、`kanban` 与旧库迁移竞态、`go vet` 通过（日志 `go-tests.log`）；打包后校验和三份 OK，程序 arm64，网页 305 文件、零 `/mindfs-assets/`，包内含 `decision-error` 样式，在线入口与源码一致；`verify-package-install.mjs` 在临时 HOME 通过。回滚源为本机 `0.1.69-local.3` 构建，程序与网页和已装版本逐字节一致；`upgrade.py --check` 预检通过（10 个项目，Relay 已绑定并连接）。
  - **未验证**：用真实会议实机验证引文误判不再出现、待确认显示、裁决弹窗；已存入协作库的旧结果需「单成员重试」或开下一轮才会重新计票。[升级目录](../../../build/reports/standalone-0.1.69-local.4-live-upgrade/)

- **开大会「引文与正文不匹配」大量误判：根因已确认，三项改动加一轮裁决流程审查修复，源码完成，Go 竞态与旧库迁移、前端回归通过；尚未打包安装，需随下一个本机包升级后实机确认。** 根因：后台用 `strings.Contains(turn.Body, quote)` 逐字节比对，claude 抄引文时把正文里的行内代码反引号当排版去掉，句子没变，整票被判「未确认」并计入分歧。证据：从 Claude 本地会话记录（`~/.claude/projects/.../9f304567-….jsonl`）取到当场原始输出，9 条引文 8 条「只有 Markdown 标记不同」，与协作库存的结果完全一致；过滤器随机分块 2000 次原样还原正文，后台存的正文与交付文件逐字一致，排除了过滤器和正文缺失。现存 3 场会议中该原因 33 次全部来自 claude。证据与复现脚本在 `build/reports/quote-mismatch-diagnosis/`。用该场会议真实正文与 claude 真实控制块回放：未确认 8→0（7 同意、1 反对、1 修订），修复审查问题后复测不变。
  - **① 引文忽略 Markdown 排版标记**：`locateMeetingQuote` 逐字比对失败时忽略反引号和成对的 `**` 再比，命中则存正文里的原文片段。单个 `*` 是内容（乘号、指针、通配符），不忽略（审查发现首版把 `2*3` 错判成 `23`，已修）。
  - **② 引文有问题不再让整票作废**：互评里的同意、反对，引文缺失或对不上时保留立场并加提醒，被拒绝的引文存 `rejected_quote` 并写入「共识与分歧」文档；提案、修订和无理由的异议仍按原规则判未确认。上一轮表态自己带引文问题时，不再用它顶替本轮新交的理由和出处，成员沉默时也不清掉未解决的提醒。
  - **③ 「待确认」单列**：没有人反对、只是有成员没有有效表态的议题，页面、汇总、提示和文档都标「待确认」（蓝色），不算分歧；「是否全员同意」判定不变；单议题选方案沿用原判定（后端文档与页面一致）。
  - **裁决流程审查（9 条，逐条核实，全部成立并已修）**：①裁决草稿改按弹窗实际展示并提交的那一轮归属（详情接口分两次读取，并发时 `run.round` 可能差一轮）；②旧格式（无版本/发言编号）采纳时，后台取与弹窗相同的那一段原话（先提案再各立场），不再可能采纳同成员的反对意见；③请求在途时冻结弹窗所有选择与输入（大会与快速模式）；④见②下的回退修正；⑤弹窗按具体立场去重，同一成员有可采纳提案时其未确认互评仍显示，提案人的默认同意不单独成卡；⑥成员中途换 Agent 后，裁决与汇总文档的署名取发言当时的 Agent（新增 `agent` 字段，旧数据回退当前配置）；⑦见①；⑧提交失败的原因显示在弹窗内（`role="alert"`），手机全屏弹窗不再挡住；⑨单议题不再被后端标成「待确认」。另修一个自查发现的问题：弹窗开着时数据变化（成员重试致引文失效），被选方案不再可采纳，这一条不再显示「已处理」、不会被提交。
  - **验证**：`collab`（`-race`）、`api`、`kanban` 与旧库迁移竞态、`go vet` 通过；新增端到端用例 `meeting_decision_flow_test.go`（三成员真实走完提案、互评、裁决，含 9 种非法裁决被拒且不改变状态、下一轮待确认补齐变共识且反对不丢）与 `meeting_quote_test.go` 共 11 项，竞态下连跑 8 至 15 次稳定；`collab-meeting` 浏览器回归新增待确认分开显示、选择失效、提交失败显示在弹窗、提交中冻结、同成员未确认互评不被遮挡；`meeting-decisions` 2 项；网页全量 422 项中仅 `document-preview`、`plugin-trust` 两项既有失败（Node 22.9 无法加载 `.ts`）。
  - **已知未做 / 待作者确认**：详情接口读取运行与会议轮次仍非同一事务（前端已按展示的那一轮归属草稿，后端未改）；「缺理由而未确认的互评若带有效引文，是否允许被采纳」存在规则冲突（现有测试明确允许采纳缺标题的未确认提案），未改；成员署名只对解析出的立场写入发言时的 Agent，自动生成的默认立场仍用当前配置；**已存入协作库的旧结果不会自动重判**，需「单成员重试」或开下一轮；尚未打包安装，也没有用真实 Agent 跑过会议。
  - **① 引文忽略 Markdown 标记**：`locateMeetingQuote` 逐字比对失败时忽略反引号和星号再比，命中则存正文里的原文片段。用该场会议真实正文与 claude 真实控制块回放，未确认 8→0。
  - **② 引文有问题不再让整票作废**：互评里的同意、反对，引文缺失或对不上时保留立场并加提醒（`Issue`），引文不采纳，被拒绝的引文存入新字段 `rejected_quote` 并写入「共识与分歧」文档供排查；提案和修订（引文承载方案原文）、没有理由的异议仍按原规则判未确认；同版本同立场的重述有瑕疵时仍沿用上一轮有引文有理由的表态。
  - **③ 「待确认」从「分歧」中单列**：没有人反对、只是有成员没有有效表态的议题，页面、汇总、本轮提示和「共识与分歧」文档都标「待确认」（蓝色），不再算分歧；后台「是否全员同意」判定不变，下一轮仍会追问没表态的成员；单议题选方案沿用原判定。
  - 验证：`collab`（`-race`）、`api`、`kanban` 及旧库迁移竞态通过，`go vet` 通过；新增 `meeting_quote_test.go` 5 项；`collab-meeting` 回归新增「待确认 / 分歧」分开断言并通过；网页全量 420 项中仅 `document-preview`、`plugin-trust` 两项既有失败（Node 22.9 无法加载 `.ts`）。**已存入协作库的旧结果不会自动重判**，需用「单成员重试」或开下一轮。未做：被拒绝引文的差异比对；「按现有同意通过」（现有裁决已可采纳被多数同意的方案，未新增）。

- **修复开大会裁决弹窗漏显「未确认」成员的问题（源码完成，`tsc`、开大会浏览器回归与 390px 手机截图验证通过；尚未重新打包安装，本机当前仍运行已验证通过的 `0.1.69-local.3`）。** 原因：`MeetingDecisions.tsx` 头部统计未计入 `unconfirmed`，且列表过滤只保留带 `quote` 的立场（后端 `adopt` 仅允许采纳带原话的立场），导致未确认且无有效原话的成员（如「引文与正文不匹配」「本轮未对该版本表态」「成员漏答此条」）在裁决卡片里消失。改动：裁决弹窗标题下方补齐 `N 未确认` 统计；将未被可采纳选项覆盖的成员（含无有效原话的未确认成员）展示为虚线只读状态卡，明确标注「未确认」「无有效原话 · 不可采纳」和具体未确认原因，并提供「展开理由和出处」查看其检查说明与已核实出处；可采纳卡片存在提醒 `issue` 时也直接展示。验证：`tsc --noEmit`、`vite build`、`collab-meeting.test.mjs`（新增 3 成员 2 同意 + 1 未确认手机视口断言）及 390px 截图核对通过。[验证记录](standalone-backend-implementation.md#开大会裁决弹窗显示未确认成员2026-11-28)

- **本机测试包 `0.1.69-local.3`（`macos-arm64`）已安装并验证通过（2026-11-28）。** `result.txt` 确认 `0.1.69-local.3 installed and verified at http://127.0.0.1:7441; 10 existing projects readable; binary, /api/collab/templates, and web assets match the build; Relay state verified.`。 在 local.2 基础上新增：手机端单聊左侧会话抽屉对齐多 Agent 侧栏并移除底部「全部会话」、单聊抽屉与多 Agent 列表删除二次确认（`ConfirmDialog`）、手机端抽屉左滑关闭/打开收起键盘/搜索一键清空/热区放大与安全区避让、以及真删除时后端彻底清理 `.mindfs/turn-diffs` 与 `.mindfs/runs/<runID>` 整树及全轮次/零时间戳发言会话。
  - **已验证**：隔离环境 `go test ./server/internal/kanban`、`-race TestTaskStoreSnapshotMigration`、`agent/acp`、`turndiff`、`collab`、`api/usecase`、`TestFrontendAssetsStayWithBackend` 与 `go vet` 全部通过；`tsc --noEmit`、`remote-phone`（6/6）、`collab-quick-mode`、`collab-meeting` 回归与四主题/确认弹窗截图通过；打包后 `verify-release-assets.mjs` 全部 6 个 `macos-arm64` 附件（305 网页文件、零 `/mindfs-assets/`、包内含 `mindfs-confirm-dialog` 与 `remote-phone-group-head` 样式）通过；`verify-package-install.mjs` 在临时 HOME 隔离安装通过。
  - **回滚源**：已装的 `0.1.69-local.2` 构建（`build/standalone/0.1.69-local.2/`），程序与网页和已装版本逐字节一致；`upgrade.py --check` 预检通过（`0.1.69-local.2`，10 个项目，Relay 已绑定并连接）。
  - **未验证**：升级结果、装后手机实机观感与真删除磁盘清理效果。[升级目录](../../../build/reports/standalone-0.1.69-local.3-live-upgrade/)

- **单聊手机抽屉与多 Agent 列表补齐删除二次确认、手机端触控体验打磨，并在真删除时彻底清理关联文件（源码完成，Go 竞态与旧库迁移、前端浏览器回归与截图验证通过；尚未重新打包安装）。** ① 前端新增通用主题弹窗 `ConfirmDialog.tsx`，单聊手机抽屉（`PhoneSessionDrawerList`）与多 Agent 列表（`CollabShell` / `CollabRunList`）点击 `×` 均先弹出二次确认弹窗（写明会一并清理关联记录、交接文档与变更快照，取消不删、确认后删除），同步补齐开大会转快速模式运行中隐藏删除按钮的判断。② 手机端专项打磨：单聊与多 Agent 左侧抽屉统一支持**左滑手势关闭**、打开抽屉自动收起输入法键盘、搜索框增加一键清空 `×`、列表底部避让 Home Indicator 安全区；放大手机端触控热区（新建按钮 ≥44px、筛选胶囊/删除/加载更多/全局模板按钮 ≥36px、项目折叠头 ≥40px、确认弹窗按钮手机下等宽 44px）。③ 后端彻底清理关联磁盘文件：`turndiff.DeleteSessionArtifacts` 在 `usecase.DeleteSession` 删除单聊及子会话时同步删除 `.mindfs/turn-diffs/<snapshotID>/` 变更快照目录；`collab.RemoveRunDir` 在 `DeleteRun` 与 `deleteMeeting` 时安全整树移除 `.mindfs/runs/<runID>/`（覆盖所有轮次、元数据与额外子目录，严格拒绝对符号链接越界追踪）；修复 `DeleteRun` 覆盖全部 `1..run.Round` 轮次阶段会话与返回目录清理错误，修复 `deleteMeeting` 去除 `!turn.At.IsZero()` 过滤以清理中断/未落时间戳的发言会话。验证：隔离环境 `go test -race -count=1 ./server/internal/turndiff ./server/internal/collab ./server/internal/api/usecase ./server/internal/kanban`、`-race TestTaskStoreSnapshotMigration`、`go vet` 通过；`tsc --noEmit`、Vite 生产构建、`remote-phone`（6/6，含触控热区与搜索清空断言）、`collab-quick-mode`（含手机抽屉热区与二次确认断言）、`collab-meeting` 回归与暗/亮截图通过。待验证：打包升级后真实手机左滑关闭、键盘收起、真删磁盘清理与真机观感。[验证记录](standalone-backend-implementation.md#删除二次确认与关联文件清理2026-11-28)

- **手机端单聊左侧会话抽屉对齐多 Agent 侧栏并移除底部「全部会话」（源码完成，类型检查、浏览器回归与四主题截图验证通过；尚未重新打包安装，需随下一个本机包升级后实机确认）。** 新增 `PhoneSessionDrawerList.tsx`，将 `RemotePhoneShell` 点击左上三条横线弹出的左侧抽屉改为与多 Agent 一致的结构：顶部为「＋ 新建会话」按钮、状态筛选胶囊（全部 / 待处理 / 进行中）与搜索框；列表按项目分组（当前项目置顶并标「当前」，显示待处理角标与数量，可折叠，左侧缩进竖线，超过 6 条折叠为「还有 N 条」并支持按项目加载更多；空的其他项目不占位，当前项目空时明确提示；非运行中会话带删除按钮）；移除底部「全部会话」按钮（仍可通过右上项目页底部导航进入完整会话页）。同步修正 `useSessionSidebarModel.tsx` 中当前项目 `totalCount` 计算与 `useAppBootstrap.ts` 手机端启动时加载跨项目会话组。验证：`tsc --noEmit`、Vite 生产构建、`remote-phone.test.mjs`（6/6，含按项目分组、筛选、折叠、搜索、新建、非运行项删除、超 6 条折叠与无「全部会话」按钮断言）及 `remote-design`、`remote-entry-build`、`session-project-hierarchy`、`action-queue`（19/19）通过；390×700 视口下浅色、深色、草地、苔藓四主题截图核对通过。待验证：打包升级后真实手机多项目数据加载、跨项目分页加载与实机观感。[验证记录](standalone-backend-implementation.md#手机端单聊会话抽屉对齐多-agent2026-11-28)

- **本机测试包 `0.1.69-local.2`（`macos-arm64`）已构建并排程升级到本机已装的 `0.1.69-local.1`（2026-11-27；以 `result.txt` 为准，写入前不得记为已安装）。** 在 local.1 基础上新增：多 Agent 全局模板弹窗「快速模式 / 开大会」标签、记录列表按项目分组并标注类型且可直接打开其他项目的记录、输入框上方排队消息条重做。
  - **已验证**：隔离环境 `go vet`、`go test ./server/internal/kanban`、`-race TestTaskStoreSnapshotMigration`、`agent/acp` 通过（本包相对 local.1 无 Go 代码改动）；打包后三份校验和 OK，程序 arm64，网页 305 文件、零 `/mindfs-assets/`，包内含 `action-queue` 与 `collab-run-group` 样式，在线入口与源码一致；`verify-package-install.mjs` 在临时 HOME 通过。网页测试 419 项（含新增 `action-queue`）仅 `document-preview`、`plugin-trust` 两项既有失败（Node 22.9 无法加载 `.ts`）。
  - **回滚源**：已装的 `0.1.69-local.1` 构建（`build/standalone/0.1.69-local.1/`），程序与网页和已装版本逐字节一致；`upgrade.py --check` 预检通过（10 个项目，Relay 已绑定并连接）。
  - **未验证**：升级结果、装后实机页面（模板标签、记录列表跨项目、排队消息条）。[升级目录](../../../build/reports/standalone-0.1.69-local.2-live-upgrade/)

- **输入框上方的排队消息条重做（源码完成，类型检查与网页测试通过；尚未打包安装，需随下一个本机包升级后实机确认）。** 原因：手机宽度下队列条固定左右缩进 31px，而输入框那一行只有「手机且非 IDE 工作台且非远程手机」才有两侧按钮，其余布局（含远程手机、IDE 工作台）队列条比上方状态卡和下方输入框窄一圈；三个操作图标各是各的（红色粗线垃圾桶、彩色渐变铅笔、细小回车箭头）。改动：缩进条件与输入框行一致；队列条与状态卡、输入框同宽同圆角，样式移到 `actionQueue.css` 并全部取主题变量；左侧加「排队 / 排队 N」小标签；编辑、删除、立即发送、保存、取消统一成同一套线性图标，悬停有底色，删除悬停变红，立即发送用强调色，手机上按钮 36px；新增 `action.queueLabel` 文案（中英）。功能不变（编辑、保存、取消、删除、立即发送）。验证：`tsc --noEmit` 通过；用真实构建的 CSS 在 500px 宽测试页截图核对深色、浅色、草地（含编辑态）；新增 `tests/action-queue.test.mjs` 2 项；网页全量 419 项（含新增）中仅 `document-preview`、`plugin-trust` 两项既有失败（Node 22.9 无法加载 `.ts`）。待验证：真实排队场景（需一个运行中的会话再追加消息）、IDE 工作台与远程手机实机观感、苔藓主题。

- **多 Agent 全局模板弹窗分标签、记录列表按项目分组并标注类型（源码完成，类型检查与网页测试通过；尚未打包安装，需随下一个本机包升级后实机确认）。** ① 全局模板弹窗顶部「快速模式 / 开大会」两个标签，各自读取、保存、设默认和删除，打开时停在当前发起页的模式，在另一个标签点「应用」会切到该模式并套用选中模板，编辑中禁止切标签。② 记录列表新增 `CollabRunList.tsx`：所有项目的协作记录按项目分组（当前项目在最上并标「当前」，另有等你处理的数量和记录数，每组超过 6 条折叠），每条带类型标签（快速 / 大会 / 大会 → 快速），状态改写成纯进度文字；当前项目没有记录时明确写「「X」暂无协作记录」，其他项目的记录仍可见，点其他项目的记录会先切项目再打开；其他项目读取失败时显示原因和重试，不当成没有记录。卡片样式对齐单聊会话列表，新增各主题的 `--cb-violet` 作类型色。验证：`tsc --noEmit` 通过；`collab-meeting`、`collab-quick-mode` 回归通过（旧断言按新行为更新，新增跨项目打开与类型标签断言）；网页全量 417 项中 415 通过，`document-preview`、`plugin-trust` 为 Node 22.9 无法直接加载 `.ts` 的既有失败。待验证：真实多项目数据下的加载耗时（每个项目一次请求）、其他项目记录随运行事件实时更新、草地与苔藓主题下实机观感。

- **本机测试包 `0.1.69-local.1`（`macos-arm64`）已构建并排程升级到本机已装的 `0.1.68`（2026-11-27；以 `result.txt` 为准，写入前不得记为已安装）。** 内容为工作区未提交改动的合集：ACP 上下文占用修复、多 Agent 页面五个外观主题适配（深色与单聊同色、跟随系统深色、草地、苔藓）、多 Agent 侧栏底部复用单聊页脚（电脑状态、「从公网访问」、版本号；新增 `SidebarServiceFooter`、`RelayActionButton`）。
  - **已验证**：隔离环境 `go test ./server/internal/kanban`、`-race TestTaskStoreSnapshotMigration`、`agent/acp`、`go vet` 通过；打包后校验和三份均 OK，程序为 arm64，网页 305 文件、零 `/mindfs-assets/`，新配色与页脚样式在包内，在线入口与源码一致；`verify-package-install.mjs` 在临时 HOME 通过（半途失败可重试、全新安装、记录供 IDEA 发现、覆盖已有安装被拒绝）。网页测试 417 项中 413 通过：`document-preview`、`plugin-trust` 因 Node 22.9 无法直接加载 `.ts`（首轮全量即失败，与本次无关），`idea-chrome` 全量中失败一次、单独重跑 23 项全过，原因未查。
  - **回滚源**：公开 `standalone-v0.1.68` 的 macOS arm64 包，已核对程序与网页和已装版本逐字节一致，放在 `build/standalone/0.1.68/`。升级脚本只读预检（`upgrade.py --check`）通过：已装 0.1.68、10 个项目、Relay 已绑定并连接。
  - **未验证**：升级结果、装后的实机页面（多 Agent 五个主题与侧栏页脚）；真实登录自启、Relay 登录聊天仍待实机。[升级目录](../../../build/reports/standalone-0.1.69-local.1-live-upgrade/)

- **ACP（含 `agy` CLI / Antigravity）上下文窗口占用修复及第 01 轮最终交付复测已完成（源码完成、真实 `agy 1.5.18` 载荷核验与隔离 Go 竞态/旧库迁移/构建测试通过；尚未重新打包安装）。**
  - **源码完成**：`runtime/server/internal/agent/acp/process.go` 移除 `PromptResponse.Usage.TotalTokens`（轮内累计消耗）对上下文占用的覆盖及 `TotalTokens == 0` 守卫，仅采纳有效 `SessionUsageUpdate`（`Used >= 0 && Size > 0`），并在未注册回调时先记录会话状态；拆分会话级 `contextWindow` 与单轮 `turnContextWindow`（`session.go` `UpdateTypeMessageDone` 透传本轮快照），使 Prompt 失败、取消或单轮无 `usage_update` 时保留会话最新有效占用，同时避免将上一轮快照误标到未上报的新回复。
  - **验证通过**：在隔离临时目录抓取真实 `agy 1.5.18 acp` 两轮多步工具调用载荷，证实 `usage_update.used` 为单次当前上下文占用（`10373 -> 10553 -> 10859 -> 11008`，第 2 轮 `11121`），而 `PromptResponse.usage.totalTokens` 为轮内累计和（`42793 = 10373+10553+10859+11008`）；隔离 `HOME`/`IDE_AGENT_DATA_DIR`/`IDE_AGENT_REMOTE_HOST_DIR`/`MINDFS_AGENTS_CONFIG` 后通过 `agent/acp`（`-race -count=10` 与 `-race -count=1 -v` 全 16 项）、`agent/codex`、`agent/claude`、`session`、`api/usecase`、`kanban` 全量与旧库迁移 `-race` 测试、`agent` 包 `TestShippedRegistry|TestAntigravity`，以及 `go vet ./server/internal/agent/acp/...` 与 `go build ./server/...`。
  - **未验证 / 待完成**：`server/internal/agent` 同包内依赖本地回环建连的 `relay_models_test.go` 与 `update_check_test.go` 在无网络沙箱下未执行；尚未重新构建或安装独立后台/插件发行包，装包后的 MindFS 页面 `agy` 长会话实机验收待完成。[验证记录](standalone-backend-implementation.md#acp-上下文窗口占用修复第-01-轮审核回应2026-11-27)

- **独立后台 `0.1.68` 已正式发布并成为默认安装版本 + IDEA 插件 `0.1.27` 已同版本更新全平台附件（2026-11-27，均走 CI 一次性通过）。**
  - **独立后台 `0.1.68`**（构建自 `8af5254`，`version.txt` 切换提交 `1a0a3a0`）：包含开大会（多模型群聊讨论）、运行中更换模型/权限与单成员重试、快速模式逐条裁决弹窗、桌面/平板状态栏对齐手机端、以及 Markdown 统一默认预览与切换。经 `release-standalone.yml` `mode=formal`（[Run 45948732023](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45948732023)）通过旧库迁移与 `-race` 迁移测试、全量 Go 测试、413 项前端测试、六平台 24 附件静态门禁、Linux 隔离安装与 systemd 自更新、macOS arm64 隔离安装、真实 Windows PowerShell 5.1 安装/升级/自更新与公开下载验证、24 个公开附件匿名逐字节回读与无参数默认在线安装验证；旧 `standalone-v0.1.67` 已归档快照至工作流产物后下架（Git 标签保留）。[0.1.68 正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.68)
  - **IDEA 插件 `0.1.27` 同版更新**（基于 `1a0a3a0`）：经 `release-plugin.yml` `mode=formal` + `replace_existing=true`（[Run 45950291098](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45950291098)）构建 5 个插件 ZIP 与 `SHA256SUMS.txt`，通过旧库迁移与竞态测试、全量 Go 与前端测试、Gradle 测试、静态门禁、`macos-latest` 与 `windows-latest` 双端内嵌后台 305 个 HTTP 网页资源逐字节核验，以及真实 Windows PowerShell 5.1 对三个 Windows/通用包针对 `0.1.68` 的安装器验证；替换前快照已归档至工作流产物，6 个公开附件匿名回读逐字节一致，继续保持 GitHub `Latest`。**已装 `0.1.27` 的用户需从磁盘重装 ZIP 并重启 IDEA。** [插件下载](https://github.com/zhuxian89/idea-ai-agent/releases/tag/v0.1.27) · [发布记录](standalone-backend-implementation.md#0168-正式发布与插件-0127-同版更新2026-11-27)

- **快速模式「分歧拍板」步骤卡精简并改用开大会同款逐条裁决弹窗（含快捷批量填充与只读回看）。** 步骤 4 卡片不再内联平铺所有分歧详情与双栏对比，仅保留单行摘要与按钮（待裁决显示 `N 条分歧待裁决` +「去裁决 / 继续裁决」，已完成显示 `已裁决 N 条分歧` +「查看裁决」），点击卡片本身仍保持原有选中并查看右侧对话细节的行为。新增 `QuickDecisions.tsx` 复用 `MeetingDecisions` 的进度条与单选卡片弹窗，提供「全部按审核改 / 全部保留现状」快捷填充；裁决完成后点「查看裁决」打开同款只读弹窗回看每条拍板结论与补充说明。已通过 `tsc --noEmit`、Vite 生产构建及 `collab-quick-mode.test.mjs`、`collab-meeting.test.mjs` 回归与桌面截图核对；尚未重新打包安装。

- **桌面与平板网页状态栏统一做成与手机一致（源码完成，前端构建、回归测试及后端资源/旧库迁移门禁通过；尚未重新打包安装，Chrome 经 Relay 15 分钟长驻打字卡顿现场复测待实机确认）。** 桌面与平板远程网页（`RemoteShell` 及 `CollabShell` 桌面分支）不再在整块对话区 `.remote-center` 或 `.collab-detail-body` 外层套大框流光，改为与手机完全一致：在输入框上方挂载独立的状态栏宿主 `.remote-status-activity.remote-glow-frame` 承载单份 `SessionActivity`（覆盖运行、等待回答、断线、恢复、完成、失败，单行防跳动并支持键盘打开/提交回答弹窗）；流光/呼吸灯默认开启（`breathe`），桌面设置菜单保留「Agent 状态框流光」配置入口与弹窗，可随时开关或调整效果、配色和速度；协作运行卡、会议发言卡与状态点与手机共用同一套流光配置。`tsc --noEmit`、Vite 生产构建（305 个网页文件、零 `/mindfs-assets/`）、`remote-design`（9/9）、`remote-phone`（5/5）、`session-activity-lifecycle`（7/7）、`activity-reactions`（12/12）、`approval-activity`（3/3）、`remote-entry-build`（3/3）、`collab-meeting`、`collab-quick-mode`、`TestFrontendAssetsStayWithBackend`（24/24）及 `kanban` 全量与 `-race` 旧库迁移门禁全部通过。[验证记录](standalone-backend-implementation.md#桌面和平板网页状态栏对齐手机)

- **开大会三项体验与流程改进（共识与分歧可折叠、仅主模型生成正式计划、一键否决全部议题按作者方向生成）。** ① 共识与分歧卡片（`.meeting-summary`）顶部改为折叠切换按钮，超过 3 条时默认折叠为单行摘要条，3 条及以内默认展开，随时可一键展开/收起；② `advanceMeeting` 在 `meetingPlan` 完成后直接写入 `05-正式计划.md` 并进入 `meetingReady`，不再调度其他成员执行 `meetingConfirm`（保留旧历史运行中的 `meetingConfirm` 兼容路径）；③ `MeetingActionInput` 新增 `override_all` 与 `MeetingRound.AuthorOverride`，前端对齐操作栏与裁决弹窗顶部均提供「否决全部，按我方向 / 一键否决所有议题」入口，作者填写方向后直接写入 `第XX轮/作者裁决.md` 并由主笔直接按该方向生成正式计划（含 `## 作者方向（已否决全部议题）`）。已通过隔离环境 `go test -race -count=1 ./server/internal/collab ./server/internal/api`、`tsc --noEmit`、Vite 生产构建及 `collab-meeting.test.mjs` 浏览器回归与亮/暗色桌面/手机截图核对；尚未重新打包安装或进行真实 Agent 实机验收。

- **开大会后续互评只处理剩余分歧。** 成员可省略同版本的有效立场。同版本同立场的重述有引文或理由瑕疵时，继续用原票并显示提醒。编号无法识别时提示成员核对，明确提交的有效立场继续计票。全员对齐后可直接生成正式计划。第 01 轮交付复测通过三包 Go 竞态、TypeScript、Vite 生产构建和两项 Chrome 回归。真实 Agent 验收和打包安装待完成。[验证记录](standalone-backend-implementation.md#会议互评收口第-01-轮最终交付)

- **多 Agent 对话详情页统一接入单聊同款外壳（状态栏、对齐与流光呼吸灯），成员对话展示标准 `ActionBar`，且开大会出计划与结束后底部追问框常驻。** `CollabShell` 对话详情区在手机端接入 `PhoneActivityHostContext` + `.remote-phone-thread` + `.remote-phone-composer` + `.remote-phone-activity.remote-glow-frame`，桌面端也已按上方 2026-11-27 调整改为与手机一致的 `.remote-status-activity.remote-glow-frame`（不再在整块 `.collab-detail-body` 外层套大框流光）；移除 `meetingSessionStep` 隐藏 `composerView` 的限制，底部 `MeetingComposer` 在计划与结束后保持常驻并打通后端追问（未 `@` 默认主笔结合正式计划作答）。`go test -race ./server/internal/collab`、`tsc --noEmit`、Vite 生产构建及 `collab-meeting`、`collab-quick-mode` 回归通过；尚未重新打包安装。

- **Markdown 统一支持默认预览与「预览 / 源码」原地切换（覆盖项目文件与开大会/快速模式文档弹窗）。** 修复 `FileViewer` 扩展名归一化（原开大会弹窗传入无前导点的 `ext: "md"` 及大写 `.MD` 会回退为纯源码），在 `FileViewer` 顶栏为 `.md` / `.markdown` 增加「预览 / 源码」切换（默认预览），并让开大会与快速模式交接文档弹窗共用 `FileViewer`。`tsc --noEmit`、Vite 生产构建及 `collab-meeting`、`collab-quick-mode`、`remote-access`（16/16）全部通过；尚未重新打包安装。

- 「开大会」可在「讨论方式」选择「单议题」或「多议题」，会议模板可以保存此设置。单议题把不同解法放在一个问题下，全员支持同一方案时达成共识，有分歧时由发起人选定方案。旧会议及未设置讨论方式的模板按多议题处理。源码、后端竞态测试和浏览器回归已完成，尚未打包安装。[验证记录](standalone-backend-implementation.md#会议讨论方式)

- **开大会互评借鉴 tarobird 群聊讨论的三点（`go test ./server/internal/collab ./server/internal/api/... -race` 与 `tsc --noEmit` 通过；未构建安装包、未用真实 Agent 实机）。** ① 立场变短：互评提示词要求同意 1–2 句、反对不超过 300 字，后台在引文对照原文之后截断保存（提案引文 800、立场引文 160、检查/风险/理由 300、标题 80 字，超出以「…」标明，完整内容见原文文件）。② 第 1 轮互评封住：成员只拿到公开提案和条目清单，不再拿到前序成员的互评与按成员生成的版本索引，仍为串行；对第 1 轮互评新增「读过他人互评」检测（沿用提案阶段的 `blind_reads`），第 2 轮起仍共享互评以便针对分歧反驳；这是提示与检测，不是沙箱。③ 修订版取代旧版本：页面、`03-共识与分歧.md` 和裁决弹窗只显示/可采纳最新版本，不再显示 v1/v2 标签与「N 份修订」；每轮条目在数据库中只存当前提案和当前表态。旧会议加载协作库时迁移，已经裁决采纳的原话随裁决保留。已知后果：第 1 轮互评封住后，若有人提修订版，其余成员没看到新版本，该条会显示「本轮未对该版本表态」，需再讨论一轮或由作者裁决。待验证：实机看修订版是否明显变少、同意发言是否变短。 [旧版本清理记录](standalone-backend-implementation.md#会议条目修订替换旧版本)

- **开大会新增「只要方案，结束会议」（`go test ./server/internal/collab -race` 通过，`tsc --noEmit` 通过；未构建安装包、未实机）。** 正式计划核对完（`ready` 阶段）后，除「确认并开始实现」外新增 `finish` 会议动作：会议标记为已完成、不创建快速模式运行，方案保留在 `05-正式计划.md`；已结束的会议不能再 `implement`。前端在该阶段多一个次要按钮，结束后显示「会议已结束，没有进入实现」并保留查看正式计划入口。新增测试 `TestMeetingFinishKeepsPlanWithoutImplementation`。待验证：实机点一次，确认运行列表里该会议显示为已完成、方案文档能打开。

- **开大会互评规则调整（源码完成，`go test ./server/internal/collab -race`、`./server/internal/api/...` 通过；未构建安装包、未实机）。** 互评保持串行；提案人对自己提出的版本自动记为同意（`alignMeetingItems`，提案本身有问题时不自动同意），互评提示词不再要求回应自己的提案；「同意」不再强制填写检查内容与剩余风险（只需一句依据，`parseMeetingPositions` 去掉该校验）；提示词要求提出修订版要极其慎重（默认不提，仅有可用出处证明的具体缺陷且能解决时才提，其余用 disagree 交作者裁决），目前只在提示词层约束，没有后端硬限制。同步更新 `meeting_test.go`、`meeting_improvements_test.go` 的旧断言并新增 `meeting_author_vote_test.go`。待验证：真实 Agent 实机跑一场会议确认修订版确实变少、同意卡片不再被标成缺依据。

- **裁决弹窗重做为一次一条（仅过 `tsc --noEmit`，未跑测试/构建/实机）。** 手机上全屏，顶部显示「第 n / N 条」与逐条进度条（可点选跳转，已处理变绿），每条只显示标题和 3 类选择（采纳某成员方案 / 自己写 / 暂不决定）的单选卡片，原话默认折 4 行，理由与出处点「展开」才显示；底部固定「上一条 / 下一条」，处理完最后一条后变为「生成正式计划」，有遗漏时显示「去处理第 N 条」。取代上一版每条平铺的长列表。待验证：390 px 与桌面截图、`collab-meeting` 中旧裁决下拉框/按钮断言需同步、实机走通到生成正式计划。

- **裁决弹窗与 3 人模型栏再改（仅过 `tsc --noEmit`，未跑测试/构建/实机）。** 裁决弹窗改为在每张立场卡底部直接「采纳这个方案」，每条下方只留「自己写说明 / 暂不决定」并显示当前裁决摘要，选中卡片高亮；裁决入口仍只在互评完成、已有共识与分歧后出现。模型栏 3 位及以下成员均分宽度、不再横滑，390 px 下芯片内改为上下两行（图标与序号在上，模型名在下）。待验证：390 px 与桌面截图确认 3 人模型名不被截断过多，`collab-meeting`/`collab-edit-models` 中关于横滑与裁决下拉框的断言需同步。

- **开大会支持提前裁决（仅改前端，仅过 `tsc --noEmit`，未跑测试/构建/实机）。** 后端 `plan` 动作本就接受任意轮次的逐条裁决，原先只是前端在「最后一轮或出现僵持」前不显示按钮；现在一轮讨论完成后只要还有分歧就显示「提前裁决」。裁决弹窗把下拉框改为单选按钮（采纳某成员 / 自己写说明 / 暂不决定），标题显示分歧条数，底部显示「已处理 x/N」。待验证：`collab-meeting` 回归中关于裁决入口与下拉框的断言、390 px 弹窗截图、实机走一遍提前裁决到生成正式计划。未做：一轮讨论中途（成员还没发言完）直接裁决，需要后端放开 `plan` 的阶段限制。

- **开大会页面瘦身已改源码（仅过 `tsc --noEmit`，按用户要求未跑回归测试、未构建、未实机）。** 议题改显示在顶栏标题（点顶栏文档图标看 `00-会议议题.md`），暂停/检查进度并继续挪到顶栏右侧；去掉状态行、议题横条、顶部「作者」卡与轮次下拉（轮次以进度条旁「第 N/M 轮」小字显示）；「本轮交接」收成默认折叠的「交接材料 N」；模型栏去掉 💬 图标，成员芯片整体可点；发言卡去掉「发言详情」图标，仅保留重试，发言中的卡在状态胶囊后显示已用时。待验证：`collab-meeting`、`collab-edit-models` 等回归断言需同步（仍引用旧入口），390 px 与桌面截图，实机确认首屏能看到发言中的卡。

- **开大会与快速模式界面视觉精修已完成（待随下次打包实机验收）。** 开大会成员发言卡已对齐快速模式步骤卡（只显示成员与状态、无正文预览、无展开/收起全文，点整卡直接进入对话框并高亮选中态）；转入快速模式后的「会议」折叠卡移除右侧多余图标并按步骤卡尺寸全宽对齐；同步重做「共识与分歧」卡片、立场详情、逐条裁决弹窗、一体化底部输入卡、轮次折叠条与交接文件 chip、流程进度线、模型栏角标/自适应铺开、快速模式右侧「阶段详情」折叠栏与分歧拍板核实徽章，并修复 `.collab-re-review-textarea` 未定义 CSS 变量 `--cb-bg`。已通过 `tsc --noEmit`、生产构建与 `collab-meeting`、`collab-edit-models`、`collab-quick-mode`、`collab-skill-picker` 回归及亮/暗色桌面与 390 px 截图核对；安装包尚未重新构建。

- **运行中修改模型第 04 轮交付复测通过。** 两种模式共用单行模型栏，详情标题与模型同行。交付阶段补齐快速模式详情头的状态圆点。五人会议在桌面和 390 px 下通过单行高度、横滑及会话切换验证。9 个 Go 包竞态、看板全量与旧库迁移、TypeScript、生产构建和 6 项前端回归通过。安装包、真实 Agent 换模型与实机验收待完成。 [验证记录](standalone-backend-implementation.md#运行中修改模型第-04-轮最终交付)

- **运行中修改模型第 03 轮交付复测通过。** 开大会复用快速模式卡片与呼吸灯，模型栏直接显示成员配置。换模型后，已记录 Agent 的历史发言保留原执行模型或「默认模型」。Go 竞态、看板旧库迁移、TypeScript、生产构建和 6 项前端回归通过。本轮安装包、真实 Agent 换模型和实机验收待完成。 [验证记录](standalone-backend-implementation.md#运行中修改模型第-03-轮最终交付)

- **运行中修改模型第 02 轮交付复测通过。** 快速模式步骤卡片显示单行状态，阶段内容和清理回执可在对话页查看。Go 竞态、看板旧库迁移、TypeScript、生产构建和 6 项前端回归通过。包含本轮卡片变更的安装包和实机验收待完成。 [验证记录](standalone-backend-implementation.md#运行中修改模型第-02-轮最终交付)

- **快速模式与开大会运行中修改模型已随 `0.1.66-local.20` 安装到本机。** 升级回执记录了 9 个既有项目、协作模板接口、网页资源和 Relay 的验证结果。 [升级回执](../../../build/reports/standalone-0.1.66-local.20-live-upgrade/result.txt)

- **开大会收口改进第 01 轮最终交付复跑通过。** 暂停中止尚未登记的发言，等待活跃发言返回，并保留未交付正文供查阅。撰写提示约束过渡语，大小写不同的版本号归入同一版。Go 竞态、旧库迁移、TypeScript、生产构建和 5 项前端回归通过。真实 ACP 与 Claude 中断、盲评读取和权限待验收，纯讨论归档入口与缺出处是否计票待作者确认。 [最终验证](standalone-backend-implementation.md#开大会收口改进第-01-轮最终交付)

- **`0.1.66-local.18`** 新增大会成员权限选择和单成员重试。源码及 Go 竞态、看板旧库迁移和浏览器回归已通过。macOS arm64 包已构建并升级到本机，9 个既有项目、网页资源及 Relay 连接已核验。[验证记录](standalone-backend-implementation.md#0166-local18-大会成员权限与重试)
- **`0.1.66-local.17`（`macos-arm64`）已由 local.18 接替。** local.17 本机包通过构建、Go 竞态、旧库迁移、9 项前端回归、静态门禁与隔离安装。热升级回执确认 9 个项目、二进制、模板接口、网页资源及 Relay 状态。 [本机包记录](standalone-backend-implementation.md#0166-local17-开大会与最新多模型协作本机包) · [热升级回执](../../../build/reports/standalone-0.1.66-local.17-live-upgrade/result.txt)
- **开大会第 02 轮最终复跑通过。** R1 至 R6 复核通过，R7 的回归在隔离副本中复现了旧判定的误报，当前版本通过。会议专项竞态连续 5 次、9 个 Go 包竞态、旧库迁移、TypeScript、生产构建及 5 项前端回归通过。Codex 返回 401，Claude 提示未登录，真实双 Agent 首轮读取待验收。 [验证记录](standalone-backend-implementation.md#第-02-轮交付复跑)

- **开大会第 01 轮审核交付完成（2026-11-26）。** 复跑确认未确认提案和历轮作者补充进入交接材料，修复盲评读取的备份文件误报和搜索完成事件漏报。Go 竞态、旧库迁移、TypeScript、生产构建及 5 项前端回归通过。两个真实 Agent 的首轮提示已核对，实际读取待登录恢复后验收。 [验证记录](standalone-backend-implementation.md#开大会第-01-轮审核修复与验证)

- **独立后台 `0.1.67` 已正式发布并成为默认安装版本。** 六平台 24 个公开附件已逐字节核验，Windows PowerShell 5.1 公开下载和默认在线安装通过。旧独立后台 Release 已归档快照后下架，Git 标签保留。[下载](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.67) · [CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45741877391)

- **IDEA 插件 `0.1.27` 已同版本更新，继续保持 GitHub Latest。** 5 个 ZIP 和校验文件通过公开回读比对，macOS 与 Windows 内嵌后台资源及 Windows PowerShell 5.1 安装器检查通过。已装 `0.1.27` 的用户需从磁盘重装 ZIP 并重启 IDEA。[下载](https://github.com/zhuxian89/idea-ai-agent/releases/tag/v0.1.27) · [CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45743210857)

- **本机已升级至 `0.1.66-local.16`。** 快速模式合并逐条回应时过滤控制块，最终报告补齐已记录的测试命令。已核验 9 个既有项目、模板接口、网页资源和 Relay。[验证记录](standalone-backend-implementation.md#0166-local16-快速模式交接文档)

- API 测试进程默认隔离 Agent 和后台配置路径，Web Push 密钥测试显式使用自己的临时数据目录。[修复与验证记录](../../issues/2026-11-26-runtime-test-isolation/runtime-test-isolation-fix-note.md)

- **本机已升级至 `0.1.66-local.15`。** 快速模式即时更新阶段，当前卡片可检查进度并继续。主模型的原生权限档位随模板保存，在手机和桌面回显。运行圆点随流光设置明暗呼吸。已核验 9 个既有项目、网页资源与 Relay。[验证记录](standalone-backend-implementation.md#0166-local15-协作进度与模板权限)

- **本机已升级至 `0.1.66-local.14`。** 网页快速模式的运行卡片和列表状态点共用单聊流光配置，跟随开关、样式、颜色和速度。浏览器回归、旧库迁移和隔离安装通过，已核验 9 个项目、网页资源和 Relay。[验证记录](standalone-backend-implementation.md#0166-local14-快速模式共用流光设置)

- 快速模式第 02 轮已恢复旧 Skill 单行简介的读取，并校正版本顺序和 R3 出处。交付复跑通过 11 个 Go 包的竞态测试、Skill 简介和看板旧库迁移专项、TypeScript 检查及 4 项前端回归。真实双模型流程、安装包、Windows 与手机实机待验收。[审核与验证记录](standalone-backend-implementation.md#第-02-轮逐条回应与验证)

- **本机已升级至 `0.1.66-local.13`。** 快速模式点「再审一轮」后可补充文字、上传多个文件或图片，再启动下一轮。意见与附件路径进入本轮审核材料。最终包浏览器回归、后端竞态、旧库迁移和隔离安装通过，已核验 9 个既有项目、网页资源和 Relay。[验证记录](standalone-backend-implementation.md#0166-local13-再审补充意见与附件)

- **`0.1.66-local.11` 本机测试包已由 local.13 接替。** 修复快速模式 4 处交接文档问题并加固阶段流程控制：移除指令文件中 `mindfs-control` 外层的四反引号围栏；按工具调用边界切分聊天实时流与落盘交付正文（过滤掉阶段交付文档开头的工具等待过渡语，同时保留聊天完整流）；移除 `02-审核意见.md` 与单轮 `03-逐条回应.md` 尾部对正文的重复拼接；修正第 3 步首次执行误标“继续补齐”、保留第 2 步审核续跑的已有正文、未产生有效审核控制块时不提前输出 `阶段交付路径`、阶段回合取消时透传 `context.Canceled` 暂停状态机而不误推进下一步、以及 Claude 只读审核禁用 `run_in_background` 异步子任务防止提前结轮。`go vet`、四包 `-race`、`kanban` 全量与 `-race` 旧库迁移门禁、8 项前端与浏览器回归、`macos-arm64` 6 附件及 305 网页文件静态门禁、临时 HOME 隔离安装与 `upgrade.py --check` 预检全部通过，已调度独立 `launchd` 任务从 `local.10` 热升级至 `local.11`（回执写入 `build/reports/standalone-0.1.66-local.11-live-upgrade/result.txt`）。[验证记录](standalone-backend-implementation.md#0166-local11-快速模式交接文档清理与阶段流程控制加固2026-11-26)

- **`0.1.66-local.10` 本机测试包已由 local.13 接替。** 收敛快速模式 `02-审核依据.md` 体积（从 1,300+ 行压回约 40 行）：移除跨 Agent 全局规则文件的自动扫描与内联（避免不同 Agent 全局规则冲突），以项目根目录 `AGENTS.md` 路径作为唯一共享规范引用；模板勾选的 Skill 改为仅输出“名称 + 简介 + 路径索引”（不再内联 `SKILL.md` 全文，审核时按需读取），同时带入前端 `CollabSkillPicker` 分类/全选交互与同步修正后的说明文案。`go vet`、`collab` / `api` `-race`、`kanban` 全量与 `-race` 旧库迁移门禁、10 项前端与浏览器回归、`macos-arm64` 6 附件及 305 网页文件静态门禁、临时 HOME 隔离安装与 `upgrade.py --check` 预检全部通过；本机已从 `local.9` 热升级至 `local.10`（`http://127.0.0.1:7441`，9 个项目、二进制、`/api/collab/templates`、网页资源与 Relay 状态均已核验）。[验证记录](standalone-backend-implementation.md#0166-local10-审核依据去内联精简与-skill-分组选择2026-11-26)

- **`0.1.66-local.9` 本机测试包已由 local.13 接替。** 在保留原生对话区实时正文输出与步骤卡片原样的基础上，于每个成功完成的阶段回复末尾重新追加 `阶段交付路径：<相对路径>`（通过 `ControlStreamFilter.CompletionSuffix()` 与 `usecase.StreamCompletionSuffixer`，在回合成功且有正文时实时推送并保存至会话记录；回合取消/失败不输出，且不污染 `.mindfs/runs/` 交付文档正文）。`go vet`、`collab` / `api/usecase` / `api` `-race`、`kanban` 全量与 `-race` 旧库迁移门禁、`macos-arm64` 6 个附件及 305 网页文件静态门禁、临时 HOME 隔离安装及 `upgrade.py --check` 预检全部通过；本机已从 `local.8` 热升级至 `local.9`（`http://127.0.0.1:7441`，9 个项目、二进制、`/api/collab/templates`、网页资源与 Relay 状态均已核验）。[验证记录](standalone-backend-implementation.md#0166-local9-阶段对话末尾恢复阶段交付路径提示)

- **`0.1.66-local.8` 本机测试包已由 local.13 接替。** 撤销 `local.7` 把正文塞进步骤卡片的改动，步骤卡片恢复原样，新阶段输出继续按 `ControlStreamFilter` 实时推送并保存至原生对话区。`collab` / `api/usecase` / `api` 竞态测试、最终包 7 项浏览器回归、6 个 `macos-arm64` 附件及 305 网页文件静态门禁、临时 HOME 隔离安装通过；本机已从 `local.7` 热升级至 `local.8`（`http://127.0.0.1:7441`，9 个项目、二进制、网页资源与 Relay 状态已核验）。页面交互验收以当前版本为准。[验证记录](standalone-backend-implementation.md#0166-local8-步骤卡片还原与原生对话区显示)

- `0.1.66-local.7` 恢复快速模式阶段正文的实时显示与会话保存，已交付的正文直接显示在步骤卡片。服务端竞态测试、看板旧库迁移、最终包浏览器回归与隔离安装通过，本机已升级，已打开既有第二轮运行并核对四张阶段卡的正文。

- 本机已安装 `0.1.66-local.6`，9 个既有项目和 Relay 连接验证通过。手机单聊左上三横线打开左侧会话列表，标题只显示名称。快速模式按轮次进行文件交接，支持手动复核。[本机验证记录](standalone-backend-implementation.md#0166-local6-手机会话列表与快速模式手动复核)

- **本机 macOS arm64 独立后台测试包 `0.1.66-local.3` 生成并热升级进入实机测试（2026-11-25，未提交、未公开发布）。**
  - 包含多模型协作“快速模式（一写一审一轮）”完整实现、自审与 Codex 交叉审核修复，以及按实机反馈将入口移至顶栏正中央并改名「多Agent模式」、补齐 `CollabShell` 手机灵动岛（`--mindfs-safe-area-top`）与底部安全区及现有 App 顶栏按钮复用（详见 [多模型协作计划与进度](../2026-11-25-agent-group/README.md)）。
  - **已验证：** `kanban` 旧库迁移与 `-race` 迁移测试、`TestFrontendAssetsStayWithBackend` 通过；前端 `tsc`、生产构建（305 个网页文件、零 `/mindfs-assets/`）与 18 项浏览器回归（含 `1440px` 顶栏正中央坐标核验、`59px/34px` 灵动岛与 Home Indicator 安全区及 `44x44` 触控区核验）全部通过；最终产物 `build/standalone/0.1.66-local.3/` 通过 `verify-release-assets.mjs --targets macos-arm64 --skip-build-info`、`verify-package-install.mjs` 临时 HOME 隔离安装验证及 `upgrade.py --check` 预检，经独立 `launchd` 任务热升级至 `http://127.0.0.1:7441`（[升级结果](../../../build/reports/standalone-0.1.66-local.3-live-upgrade/result.txt)）。
  - **未做：** 仅构建本机 `macos-arm64` 本地测试包（未构建其余五平台、未改 `scripts/standalone/version.txt`、未发 GitHub Release、未重打 IDEA 插件包）；后续实机验收以当前版本为准。
- **独立后台 0.1.65 正式发布并成为默认安装版本 + IDEA 插件 0.1.27 同版本更新全平台附件（2026-11-25）。**
  - **独立后台 0.1.65**：包含 ACP 握手 `Terminal: false` 修复、Windows Job Object 子进程树与文件锁释放（含等待子进程内核句柄进入终止信号态）、Codex 空闲释放后 `thread/loaded/list` 卸载确认与整进程重启跳过逐会话等待、以及按当前绑定的本地 `api-providers.json` 为 Claude 与 Codex 动态补全模型列表。经分支 `standalone-0.1.65` 触发 `release-standalone.yml` `mode=formal`（[Run 45538561445](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45538561445)），六平台 24 个附件通过旧库迁移与竞态测试、Go 与 405 个前端测试、静态门禁、Linux 隔离安装与 systemd 自更新、macOS arm64 隔离安装、真实 Windows `acp` 进程树与文件锁测试（`TestWindowsACPProcessTreeCleanup`）及 PowerShell 5.1 安装/升级/自更新与公开下载验证；快进合入 `main`、`scripts/standalone/version.txt` 升为 `0.1.65`、公开无参数默认在线安装核验通过，旧 `standalone-v0.1.64` 已归档快照至工作流产物后下架（Git 标签保留）。[0.1.65 正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.65)
  - **IDEA 插件 0.1.27 同版更新**：基于 `7d8ae9b` 触发 `release-plugin.yml` `mode=formal` + `replace_existing=true`（[Run 45540134877](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45540134877)），5 个插件 ZIP 与 `SHA256SUMS.txt` 通过旧库迁移与竞态测试、Go 与前端测试、Gradle 测试、静态门禁、`macos-latest` 与 `windows-latest` 双端内嵌后台 305 个 HTTP 网页资源逐字节核验，以及真实 Windows PowerShell 5.1 对三个 Windows/通用包针对 `0.1.65` 的安装器验证；替换前快照已归档至工作流产物，6 个公开附件匿名回读逐字节一致，继续保持 GitHub `Latest`。**已安装 0.1.27 的用户需从磁盘重装 ZIP 并重启 IDEA。**[插件下载](https://github.com/zhuxian89/idea-ai-agent/releases/tag/v0.1.27) · [验证记录](standalone-backend-implementation.md#0165-正式发布与插件-0127-同版更新2026-11-25)
- **独立后台一键转正与 IDEA 插件全自动发版 CI（2026-11-25，源码已推送 `main`，`release-plugin.yml` 云端全流程实跑通过）。**
  - **独立后台 `release-standalone.yml` 补齐云端公开与转正闭环**：新增 `mode`（`draft` / `prerelease` / `formal`），支持从 `standalone-<版本>` 或 `main` 触发；`formal` 在云端自动完成快进合并 `main`、公开预发布、匿名重新下载 24 个公开附件逐字节比对（`scripts/standalone/verify-public-release.mjs`）、Windows PowerShell 5.1 公开下载验证、更新提交 `scripts/standalone/version.txt`、轮询不带参数的 `raw.githubusercontent.com` 连续 8 次读到新版本（`scripts/standalone/wait-online-version.mjs`）并验证默认无参数安装、归档旧版元数据快照后下架旧 `standalone-v*` Release（保留 Git 标签与插件 `Latest`）。
  - **新增 IDEA 插件全自动发版流水线 `release-plugin.yml`**：`package-plugin.mjs` 增加 `--online` / `CI` 自动联网支持；新增 `scripts/plugin/` 下的 `plugin-plan.mjs`、`plugin-release-notes.mjs`、`verify-plugin-assets.mjs`（6 附件、SHA-256、JAR 版本、安装脚本与 BOM、四平台二进制架构头与 `vcs.modified=false`、305 网页文件与零 `/mindfs-assets/`）、`verify-builtin-runtime.mjs`（跨平台隔离启动内嵌后台并逐字节校验 305 个 HTTP 网页资源）。云端串联 `ubuntu-latest` 构建门禁、`macos-latest` 与 `windows-latest` 双端内嵌后台 HTTP 验证、真实 Windows PowerShell 5.1 对三个 Windows/通用插件包的验证，支持安全草稿（已存在正式版时用 `plugin-draft-v<版本>`）与正式版发布/同版本替换（`replace_existing=true` 自动留存快照并匿名回读 6 个公开附件）。
  - **已验证：** 全部 4 个工作流 `actionlint` 零告警；`scripts/standalone/` 与 `scripts/plugin/` 共 18 个单测通过；`release-plugin.yml` 已在 GitHub Actions 端到端实跑通过（[Run 45530752471](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45530752471)，约 6 分钟跑完 5 个作业并生成 `plugin-draft-v0.1.27` 安全草稿，验证后已留存快照并删除测试草稿，未影响线上 `v0.1.27`）。`release-standalone.yml` 的 `formal` 新分支作业已在本地实跑全部底层脚本，待下次发正式独立包时在云端直跑。
- **IDEA 插件 0.1.27 已同版本更新全平台附件（2026-11-25）。** 从干净工作树 `0a67550` 构建 `macos-arm64`、`macos-amd64`、`windows-amd64`、`windows-arm64` 与通用包 `idea-ai-agent-0.1.27.zip` 及 `SHA256SUMS.txt` 共 6 个附件并更新 `v0.1.27`（继续保持 GitHub Latest）。已通过 Gradle 单测、四平台内置后台 `vcs.modified=false` 与架构头检查、macOS arm64 内置后台隔离启动及 305 个网页资源 HTTP 逐字节核验、真实 Windows PowerShell 5.1 对三个候选 Windows/通用插件包的安装器提取与 `0.1.64` 公开下载验证，以及上线后 6 个公开附件匿名回读逐字节比对。**已安装 0.1.27 的用户需从磁盘重装 ZIP 并重启 IDEA。**[插件下载](https://github.com/zhuxian89/idea-ai-agent/releases/tag/v0.1.27) · [Windows 5.1 候选包 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45525046280) · [验证记录](standalone-backend-implementation.md#0164-正式发布与插件-0127-同版更新2026-11-25)
- **独立后台 0.1.64 已正式发布并成为默认安装版本（2026-11-25）。** 包含 Agent 配置页单 Agent「重启」按钮、选择模型菜单「刷新模型」与「重启」单行合并及刷新统一先重启再探测、以及前后端超大文件按职责模块化拆分。六平台共 24 个附件从 `7bf9df4` 干净检出构建并通过全部静态门禁、Linux 隔离安装与 systemd 自更新、macOS arm64 与 Rosetta x64 隔离安装、Windows PowerShell 5.1 安装/升级/失败恢复/计划任务自更新及插件公开下载验证；24 个公开附件匿名回读与构建逐字节一致；`version.txt` 切到 `0.1.64` 后连续 8 次读到新值，macOS arm64 与 Rosetta x64 默认在线安装逐字节一致。旧独立后台 Release `0.1.60`、`0.1.61` 已归档快照后下架，Git 标签保留，插件 `v0.1.27` 保持 Latest。本机当前仍运行 `0.1.63` 本地测试包，可在远程页面或用固定命令升级到 `0.1.64`。[0.1.64 正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.64) · [构建验证 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45520963423) · [Windows 公开下载 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45523740204) · [验证记录](standalone-backend-implementation.md#0164-正式发布与插件-0127-同版更新2026-11-25)

- **选择模型界面单行按钮与全 Agent 刷新统一重启（2026-11-24，源码已更新，未公开重新发包）。** 将选择模型菜单中的「刷新模型」与「重启」合并到同一行（移除 `AgentRestartAction.tsx`）；所有 Agent 的「刷新模型」统一走重启接口再等待重新探测，中英文悬停与完成提示均写明会中断进行中的对话。独立后台与插件内置后台共用 `runtime/web/src`，后续打插件包会自动带入。
  已验证：前端 `tsc --noEmit` 与相关 3 个测试文件（`agent-model-refresh.test.mjs`、`agent-lifecycle-restart.test.mjs`、`agent-model-refresh-browser.test.mjs`，5/5）通过；本机已构建 macOS arm64 本地测试包（版本号沿用 `0.1.61`）并升级运行于 `http://127.0.0.1:7441`（[本机部署](../../../build/reports/standalone-0.1.61-live-upgrade/result.txt)）。
  **未做：** GitHub 公开的 `standalone-v0.1.61` Windows 预发布包不含本次改动；未重新发布多平台独立包或重打 IDEA 插件包；英文界面与最窄菜单宽度、以及界面交互效果待实机确认。
- **独立后台 0.1.61 测试预发布，仅 Windows x64（2026-11-24）。** 插件 Agent 配置页与选择模型界面增加单 Agent「重启」按钮（复用网页版已有的重启接口，前端改动，后端未改）。提交 `9973b35`，已快进合并 `main`；`version.txt` 仍为 0.1.60，0.1.60 未下架，Release 为预发布且不占 latest。
  已验证：干净克隆构建（`vcs.modified=false`）；包内网页 305 个文件、无 `/mindfs-assets/`、含新按钮脚本；GitHub Actions 在 Windows PowerShell 5.1 验证包内安装脚本通过；匿名下载 4 个附件与构建产物逐字节一致；`kanban` 迁移测试与 race 测试通过。
  **未做：** macOS、Linux、Windows ARM64 包；用公开在线入口安装验证；真实 Windows IDEA 里看到按钮；转正（改 `version.txt` 并下架 0.1.60）。独立后台模式的界面来自独立包，所以插件包里的同一改动在独立模式下不会生效，只有内置模式会。

- **大文件拆分与前端核心拆解（可维护性，2026-11-24，源码完成，本机已升 0.1.62 测试包，未提交、未公开发布）。** 只搬家、不改行为，用编译器工具按依赖图完成，语句原文逐字移动。
  - Go：15 个超大文件按职责拆成同包新文件（`http.go`、`usecase/session.go`、`ws.go`、`appcontext.go`、`gitview.go`、`probe.go`、`kanban/service.go`、`stream_hub.go`、`update/service.go` 等），现无超过 1100 行的 Go 文件。
  - 前端：`App()` 原为 6100 行的单个函数、371 条顶层语句。依赖图无环，只有 2 处向后引用。按功能域拆成 36 个 hook（`src/app/workbench/`），`App.tsx` 从 6743 行降到 509 行，只剩“调用 hook、解构、最终 JSX”。每个 hook 的输入类型由前面 hook 的返回类型推导（`ReturnType<typeof useX>`），依赖关系在类型里可见。`FileTree()` 从 2149 行降到 300 行：14 个 hook 与 8 个子组件在 `src/components/fileTree/`。`SessionViewer`、`SessionList`、`ActionBar`、`services/session.ts` 的类型、辅助函数、子组件各自成模块。
  - 效果顺序：75 个有副作用的语句（effect 与自定义 hook 调用）按功能域归位后顺序有变化，工具逐对检查是否共享 ref、setter 等可变对象，共享的逐个读代码判断，已记录的 8 处均为只读或仅注册监听。`FileTree` 里两个会先后设置同一菜单状态的 effect 保持了原顺序。
  - 验证：Go 35 个包与 `HEAD` 逐声明、逐行比对一致，`vet`、30 个包测试、`kanban` 迁移竞态测试、六平台交叉编译通过；前端类型检查、生产构建、整套 405 个网页测试通过；`scripts/smoke-runtime.mjs` 真实后台加真实浏览器的 12 项冒烟通过（运行时需清掉继承来的 `IDE_AGENT_REMOTE_HOST_DIR`、`MINDFS_STATIC_DIR`、`IDE_AGENT_DATA_DIR`，否则会撞已装服务的数据锁）。六个按源码文本匹配的测试改为读取新文件位置，断言内容未变。本机 macOS arm64 已从 `0.1.61` 升级到 `0.1.62` 测试包，原地址 `http://127.0.0.1:7441`、8 个项目、二进制/网页资源及 Relay 状态均核验通过（[本机部署](../../../build/reports/standalone-0.1.62-live-upgrade/result.txt)）。
  - **第二轮（2026-11-25）：** 重构工具进了仓库（`scripts/refactor/`，含说明）。`useAppFoundation` 里只被单个 hook 使用的 6 个 ref 挪回各自的 hook（`fileEditStore` 放进 `useFileViewerState`，不放进会被条件渲染的组件，否则重新挂载会丢未保存的编辑）。3 个返回 JSX 的 hook 改成组件（`components/workbench/` 的 `SelectedSessionView`、`WorkspaceView`、`SessionSidebar`），派生数据留作 `useSessionSidebarModel`，纯函数 `slashCommandResultForSession` 提到 `app/slashCommandResults.ts`。`useProjectSidebarModel` 返回的是给 `FileTree` 用的渲染函数（render props），保留。重构前基线标签：`pre-refactor-20261124`。
  - **整包 `*Api` 透传的评估：** 304 个 `xApi` 参数共读取 1013 个字段，中位数每个参数只读 2 个，71% 不超过 3 个，已无完全没用到的参数（新拆出的两个文件里删掉了 8 个）。依赖本身是细的，只是传得宽。试过把 `Deps` 收窄成 `Pick<...>`：能编译，但每个字段要在 `Pick` 和解构里各写一遍，要手工保持一致，不减少真实依赖，不采用。真正的解耦（让各域自己订阅事件，而不是 `useWorkspaceEvents` 一个路由器依赖 18 个域）是接口设计，有事件顺序风险，有具体痛点再做。
  - **重渲染的评估：** 用 `render-bench.mjs` 在重构前基线和现在的代码上测同一个 App 级状态更新（视口宽度切换）：基线每次中位 8.3–9.0ms（p90 约 18ms），现在 5.7–7.4ms（p90 约 12ms），没有退步。这是近乎空项目的开发构建，不代表流式输出时的真实负载；没有性能痛点，不做状态下沉。
  - **验证：** 类型检查、生产构建、整套 405 个网页测试通过；`smoke-runtime` 12 项通过。
  - **未做：** 在真实 IDEA 与手机上手点验证；`useSessionList`（527 行）、`useActionHandlers`（594 行）、`usePlugins`（426 行）等单个 hook 仍偏大；`useWorkspaceEvents` 依赖 18 个域；`useProjectSidebarModel` 的 render props 未改成组件。

- **独立后台发版流水线（2026-11-25，源码完成，GitHub Actions 全平台端到端验证通过，主分支未提交）。** `.github/workflows/release-standalone.yml`：手动触发，`targets` 可只出一个或几个平台。流程：计划（版本号、分支等于 `standalone-<版本>`、目标、发布说明校验，拒绝已存在的版本）→ 门禁（迁移测试、`-race` 迁移测试，可选全量 Go 与网页测试）→ 打包并跑静态门禁 → 隔离安装（Linux x64、macOS Apple Silicon）、Linux systemd、Windows 5.1（含计划任务自更新）→ 生成草稿预发布并核对草稿里的文件与已验证的逐字节一致。**不会公开发布。**
  新增脚本（`scripts/standalone/`）：`verify-release-assets.mjs`（静态门禁：附件齐全、校验、架构头、干净构建、脚本逐字节一致与 BOM、网页等于 `dist` 且无 `/mindfs-assets/`、自解压归档一致、在线入口一致）、`verify-package-install.mjs`（隔离 HOME 与 `XDG_RUNTIME_DIR` 里安装最终包，只用 `--defer-start`）、`release-notes.mjs`、`release-plan.mjs`，各有单元测试。
  本地与云端验证：本地干净克隆构建六平台与单平台门禁、`actionlint`、macOS 隔离安装通过；基于 `8a0bb0e` 的隔离分支完成 GitHub Actions 六平台全量验证（[Run 45517283091](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45517283091)），`plan`、`gates`（含迁移与 `-race`、Go 全量、405 个网页测试）、`package`（24 个附件与全部静态门禁）、`verify-linux-install`、`verify-linux-systemd`、`verify-macos-install`、`verify-windows`（PowerShell 5.1 安装/升级/恢复与计划任务自更新）、`draft`（草稿预发布创建与 24 个附件回读逐字节核验）8 个作业全部通过。测试草稿快照见 [ci-0.1.64-test-draft.json](../../../build/reports/ci-0.1.64-test-draft.json)，验证后草稿与临时测试分支已清理，云端实跑修掉的 6 处环境与脚本问题已同步回主工作区。[验证记录](standalone-backend-implementation.md#独立后台自动化发版流水线云端验证2026-11-25)
  **注意与未验证：** GitHub `workflow_dispatch` 需等 `.github/workflows/release-standalone.yml` 合入默认分支 `main` 后才能在界面或命令行按分支手动触发（主工作区因含未提交重构改动暂未提交）；macOS 真实服务启动与升级、Windows 真实登录自启，以及 Linux/Windows ARM64 与 macOS Intel 实际运行仍只做静态门禁；本机测试包的编号规则尚未定。

## 此前状态（2026-11-23）

- **独立后台 0.1.60 已正式发布并成为默认安装版本（2026-11-23）。** 修复手机和网页网络不稳时反复断开重连（指数退避、连接稳定 10 秒才恢复），会话列表恢复项目缩进与引导线并暂不显示子会话，版本行改为一行低饱和对勾，展开运行中详情后「回到底部」按钮正确出现，移除输入框连接圆点，iOS App 回前台续期登录。六平台 24 个附件匿名下载回验与本地构建逐字节一致，Windows PowerShell 5.1、Linux x64 systemd、macOS 两种架构的隔离升级及旧库迁移检查通过。固定在线入口已实装验证，0.1.59 Release 已归档下架，Git 标签保留。[0.1.60 正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.60) · [验证记录](standalone-backend-implementation.md#0160-正式发布)
- **本机已从 0.1.60-standalone.5 升级到 0.1.60 正式版。** 原端口可访问，7 个项目可读，Relay 已重连。运行程序和实际返回的网页资源与公开包一致。[本机部署](../../../build/reports/standalone-0.1.60-live-upgrade/result.txt)
- **网页直接更新独立后台**随 0.1.52 同版换包上线。macOS、Linux、Windows 支持网页调用固定安装脚本。更早的构建可用固定安装命令升级后使用这个入口。[0.1.52 测试记录](../../../build/reports/release52-web-update/final-ci.log)
- **独立后台 0.1.51** 修复了手机键盘弹出后遮住输入框的问题，经 iPhone 实机验收后发布。Hostdzire-linux 节点的实际升级状态待核实。
- **0.1.51 同版重打包已发布**。Relay 公网项目页可检查独立后台更新，电脑和平板在侧栏底部，手机在「更多」。24 个公开附件均已回读验证。按用户要求，本机继续运行此前的 0.1.51 构建，后续单独升级。[正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.51)
- **IDEA 插件 0.1.27** 已在 GitHub 同版本更新四个平台和通用包。内置后台及远程网页更新已随包发布。已安装 0.1.27 的用户需从磁盘重装并重启 IDEA。[插件下载](https://github.com/zhuxian89/idea-ai-agent/releases/tag/v0.1.27)
- **IDEA 插件 0.1.28-local.1 macOS arm64 本地测试包**已安装到本机。最终 ZIP 的内置后台通过启动、旧会话和网页资源验证。本机实测切到内置模式及切回独立模式后，均能从远程网页发送消息。[插件 ZIP](../../../build/local-packages/idea-ai-agent-0.1.28-local.1-macos-arm64.zip)
- **0.1.49 macOS arm64 本地测试包**将手机呼吸点换成 Agent 状态框的边框流光。「更多 → 外观」提供与网页相同的开关、四种效果、配色、自定义颜色、速度、预览与恢复默认。最终包通过 Chrome 和 WebKit 手机视口验证。本机已升级，原地址、7 个项目与网页资源验证通过。用户确认手机流光试用通过。[安装包](../../../build/standalone/0.1.49/local-ai-agent-0.1.49-macos-arm64.sh)
- **0.1.48 macOS arm64 本地测试包**给手机输入框上方的 Agent 状态栏加入呼吸点。活动状态为工作时播放，开启系统减少动态效果时显示静态点。本机已升级，原地址、7 个项目和随包网页资源验证通过。手机消息已正常送达，待确认 iPhone 上的动效表现。[安装包](../../../build/standalone/0.1.48/local-ai-agent-0.1.48-macos-arm64.sh)
- **0.1.47 macOS arm64 本地测试包**将电脑和平板的「手机扫码连接」和「从公网访问」改为中性色细描边入口。扫码继续指向当前页面。通过隔离安装和相关浏览器回归，本机部署见 `build/reports/standalone-0.1.47-live-upgrade/result.txt`。[安装包](../../../build/standalone/0.1.47/local-ai-agent-0.1.47-macos-arm64.sh)
- **0.1.46 macOS arm64 本地测试包**将手机「更多」的设置集中展开，主题、语言、排序、设备类型和开关可直接操作，需要输入的操作直接打开对应表单。手机用输入框上方的活动状态，边框呼吸灯用于电脑和平板。通过 Chrome、WebKit 和隔离升级验证，待 iPhone Safari 实机试用。本机部署结果见 `build/reports/standalone-0.1.46-live-upgrade/result.txt`。[安装包](../../../build/standalone/0.1.46/local-ai-agent-0.1.46-macos-arm64.sh)
- **0.1.45 macOS arm64 本地测试包**加入手机网页全屏对话、会话卡片、快速切换、项目导航、设备选择及授权底部面板。Chrome 和 WebKit 的触屏窗口验证通过，待 iPhone Safari 实机验收。本机部署见 `build/reports/standalone-0.1.45-live-upgrade/result.txt`。[安装包](../../../build/standalone/0.1.45/local-ai-agent-0.1.45-macos-arm64.sh)
- **0.1.44 macOS arm64 本地测试包**将顶栏 Agent 配置入口改为居中弹窗，文件栏收起时也可使用。最终包通过隔离升级，本机上线后用户反馈网页和平板正常。[安装包](../../../build/standalone/0.1.44/local-ai-agent-0.1.44-macos-arm64.sh)
- **0.1.43 macOS arm64 本地测试包**修正远程网页三栏底色、普通窗口底边和文件菜单裁切。隔离安装与本机升级通过，原地址可读取 7 个项目。[安装包](../../../build/standalone/0.1.43/local-ai-agent-0.1.43-macos-arm64.sh)
- **0.1.42 macOS arm64 本地测试包**已在本机升级成功。原地址可访问，7 个项目可读取。升级结果见 `build/reports/standalone-0.1.42-live-upgrade/result.txt`。远程桌面和平板增加会话卡片、顶栏常用操作和默认开启的工作状态呼吸灯。已在隔离安装中验证从 0.1.41 升级、读取原项目与会话、更新失败恢复。手机新外壳和设备手动指定安排在第二批。[安装包](../../../build/standalone/0.1.42/local-ai-agent-0.1.42-macos-arm64.sh) · [验证记录](standalone-backend-implementation.md#远程网页第一批与-macos-0142-本地测试包)
- 独立后台与插件独立发版。发包流程、验证门槛和“只保留一个正式版”的规则见根目录 [AGENTS.md](../../../AGENTS.md) 的《独立版发包规则》。
- 0.1.39 包含：Agent 配置按 Agent 导出与导入、Linux `-bind` 与安装后显示绑定链接、Linux systemd 开机自启、不同目录同名项目、远程单文件 HTML 预览、Codex 刷新自动升级、完整重启，以及安装与升级失败后的自动恢复。验证证据见 [implementation](standalone-backend-implementation.md)。

## 已确认的约束

- 独立优先只作用于远程模块。远程停止、启动失败或认证失败，只影响远程功能；插件界面、聊天和其他本地功能继续工作。
- 一个多项目入口，继续使用当前界面和动态表情。关闭 IDEA 后仍可通过现有 Relay 使用。
- 未安装独立版时保留原插件内置后端。独立版可选安装，远程面板检测服务后提供一键安装入口。独立版只提供后台程序和脚本安装升级，不增加桌面应用或图形安装器。
- 聊天与附件原位读取，保留项目 `.mindfs` 和 home 元数据、旧远程清单、Relay 绑定及历史配置。同一目录只注册一次。
- 聚焦当前功能，不恢复钱包、充值或任务看板。
- 网页资源随各自安装包发布，不依赖 Relay 部署相同版本的前端，见 AGENTS.md。

## 待验证与待决定

- **Agent 装完仍显示“需要安装”（源码已改，未打包，未提交）**：用户在 Windows 上点击 Agent 安装按钮装 Claude Code，官方安装器把程序放进 `%USERPROFILE%\.local\bin` 并提示它不在 PATH 里；后台只用自己进程的 PATH 查找（`agent/probe.go`），独立后台的 PATH 是安装时的快照，所以找不到。已改为后台启动时把用户目录（Windows：`.local\bin`、`%APPDATA%\npm`、`%LOCALAPPDATA%\agy\bin`；macOS：`~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`；Linux：`~/.local/bin`、`/usr/local/bin`）追加到 PATH 末尾（`agent/userpath.go`，在 `app/server.go` 创建 Agent 池前调用），目录尚不存在也加入，保持用户原有顺序。测试覆盖“启动后才装进 `~/.local/bin` 的程序能被探测到”，去掉修复后该测试失败；**未在 Windows 实机验证**。同一条输出里的 `鈥�` 乱码未处理：官方引导脚本本身是纯 ASCII，这些符号由它下载的 `claude` 程序打印，是哪一层把 UTF-8 当 GBK 读还没定位，需要 Windows 环境复现。
- **左下角电脑状态（源码完成，未打包，未提交）**：左侧栏左下角、“手机扫码连接”按钮上方显示这台电脑的 CPU 与内存（圆环、数字，点开是详情与最近一分钟走势），手机上不显示，读取失败时不显示；设计稿 `docs/design/system-monitor-v1`。后端新增 `GET /api/system/stats`（`runtime/server/internal/sysstats`）和依赖 `gopsutil/v4 v4.26.5`（选这个版本是因为新版会把 `go.mod` 的 Go 要求从 1.25 抬到 1.26），许可证文本已加入独立包与插件运行时的 `licenses/`。Go 全量测试、前端类型检查和 12 项新测试通过；用打好的 macOS 包在隔离实例里经 Chromium 验证了位置、展开收起、轮询频率、四种主题和 iPhone/Pixel 隐藏。**未验证**：经 Relay 的公网页面、Linux 与 Windows 上的实际读数、真实 Safari。
- **root 运行的后台无法启动 Claude Code（源码已改，未打包）**：Claude Code 在 uid 0 下拒绝 `--allow-dangerously-skip-permissions` 和 `bypassPermissions`，后台等不到初始化响应，报 `initialization failed: context deadline exceeded`。已改为后台以 root 运行时给 Claude Code 补环境变量 `IS_SANDBOX=1`（`runtime/server/internal/agent/claude/native_options.go`），用户已在 Linux root 环境确认该变量有效。单元测试通过；用真实 root 进程的测试在 macOS 上跳过，未在 Linux root 容器或真机用我们的包复验。`IS_SANDBOX` 是 Claude Code 未文档化的开关，升级 Claude Code 后可能失效。
- Windows 实机：全新安装的计划任务、登录自启和重启接入。GitHub Actions 已在 Windows PowerShell 5.1 验证包内安装脚本、计划任务注册、升级与失败恢复，但不含真实登录。
- Linux ARM64 和 Windows ARM64 已核对 0.1.59 的可执行文件架构与安装包内容，实际运行待验证。Linux x64 的 systemd 自更新及 macOS x64 的 Rosetta 隔离安装已通过。
- Codex 刷新自动升级和独立后台完整重启：自动化与隔离验证通过，真实升级刷新与 IDEA 多项目重连待用户验收。
- 聊天运行时与远程包的资源及生命周期隔离方案待确认：当前升级仍会停止共享 Core，且必须同时保证远程故障不影响本地聊天、IDEA 关闭后远程继续可用。不采用未经批准的项目抢锁和远程只读限制。
- **“回到底部”按钮在展开运行中详情后不出现（2026-11-23）：修复已随 0.1.60 发布并安装到本机，整套网页测试 404 个全通过，手机效果待确认。** 此前 `activity-detail-lifecycle` 的两个子测试及汇总失败。
  二分定位到 `5b650ae`（11-17）：它有意把按钮改为“离底部超过 120px 才显示”，但 `pauseForActivityReading` 只在点击瞬间量一次距离，展开后内容变高（实测离底 204px）没有重新计算，按钮一直隐藏到下次滚动或新消息。
  修复：`SessionViewer.tsx` 用 `ResizeObserver` 观察内容容器，内容高度变化时重新计算；仅在“暂停跟随”时更新，跟随中的流式输出仍由原滚动逻辑处理，避免按钮闪烁。两个原有子测试未改，修复后直接通过。
  排查中的两个错误已更正：`--test-name-pattern` 在此 Node 版本下不会筛掉子测试，据此得出的“单独跑通过”是空跑；二分用的临时工作树里 `git checkout HEAD` 指的是旧提交。最终用“按名字跳过的临时副本 + git bisect”隔离验证。
- **版本行对勾改为低饱和细对勾（2026-11-23）：** 原来是饱和度 0.59 的实心绿色圆加白对勾，深色下太鲜艳；现在去掉圆底，只留细对勾，颜色是绿色与次要文字色按 40% 混合，随主题变化。新增深浅两个主题的测试量实际颜色（饱和度 ≤ 0.4、形状为对勾）。
- **会话列表恢复项目缩进与引导线、放大项目名并暂时隐藏子会话（2026-11-23）。** 自动化测试通过，已随 0.1.60 发布并安装到本机，手机效果待确认。
  原因：`remoteDesign.css` 与 `remotePhone.css` 把项目下会话的缩进和左侧引导线清零，卡片与项目标题贴同一条左边，看不出归属。现在恢复缩进，2px 引导线挂在项目箭头下，打开的会话所在项目的线为强调色；项目间距 10 → 18px；项目名 14 → 15px 加粗（手机 16px）。仅改远程侧栏和手机页，IDE 里的列表未动。
  子会话（“运行中 · N / 已结束 · N”分组）通过 `sessionHierarchy.ts` 的 `setChildSessionsVisible` 默认隐藏，逻辑未删；`workspace-sidebars` 测试夹具把它打开以保留子会话覆盖。代价：缩进使卡片变窄，标题更早被截断；正在查看的若是子会话，列表里没有它也没有高亮。
  验证：新增 `session-project-hierarchy.test.mjs`（侧栏、手机各 2 项，对修改前代码全部失败）；整套网页测试 402 个中 399 通过，失败的 3 个是此前就有的 `activity-detail-lifecycle`。
- **公网页版本行改为一行（2026-11-23）。** 版本号后面显示低饱和细对勾，“检查更新”在行尾，“已是最新版本”保留为悬停提示与读屏文字。自动化测试通过，已随 0.1.60 发布并安装到本机。
  有新版本或出错时仍单独一行。放得下就一行，窄到放不下时按钮折到下一行右侧，版本号不截断。验证：真实样式、深色主题渲染确认；测试覆盖 320、433px 一行，以及 190px 兜底；对应 `standalone-latest-browser.test.mjs`。
- **远程频繁重连（P0，2026-11-23）。** 页面采用退避重连，自动化测试通过，已随 0.1.60 发布并安装到本机。实际卡顿时的重连表现和触发源待核实。
  证据：07:10–08:02 手机页面 WebSocket 反复开关，100 次连接中 67 次不到 15 秒（中位数 7 秒），多数是页面自己关闭；Relay 同期对 `/n/<节点>/` 返回 502/504，
  与节点日志 `stream failed: connection reset` 逐分钟吻合（07:13 为 62 对 62，07:34 为 68 对 67）；那 25 分钟 `/api/auth/me` 一直 200，没有登录、退出或跳转节点列表，隧道本身没有重连。
  页面侧三处互相放大（`runtime/web/src/services/session.ts`）：看门狗每 3 秒在连接为空时直接 `reconnectNow()`，绕过退避；失败不断重新打开 10 秒“快速重连窗口”，间隔恒为 1 秒；探活超时只有 2 秒，慢路径上掐掉健康连接。
  修复：新增 `services/reconnectPolicy.ts`，真正的指数退避（1、2、4、8、15、30 秒，带抖动），连接保持 10 秒才算恢复，握手超时随失败逐次放宽（5、8、12、20 秒），只对静默 15 秒以上的连接探活且超时 10 秒，
  回前台或发送消息时立即重试（3 秒内只响应一次），页面登录检查每 30 秒最多一次。
  验证：新增 13 个测试（`reconnect-policy.test.mjs`、`session-reconnect.test.mjs`，假 WebSocket 加假时钟）；同样场景对修复前代码：10 分钟 121 次连接尝试、抖动 5 分钟 100 次、健康连接被探测和掐断，5 项失败；新代码 10 分钟不超过 25 次。
  整套网页测试 395 个中 392 通过；失败的 3 个都在 `activity-detail-lifecycle.test.mjs`，用 git 原版代码复跑结果相同，是此前就有的失败，未处理。
  **未定案：** 是什么让 Relay 到节点的流成批卡住（约每 20 分钟一次，每次 1–2 分钟），候选是 Mac 经 Clash Verge 到 Relay 的路径、Relay 隧道转发、节点写隧道三处，现有日志分不开。
  08:07–08:18 的端到端探测（每 2 秒请求公网节点页）326 次无一卡顿，说明卡顿是间歇性的，一段平稳不能证明已解决。
- Antigravity 登录后完整对话、工具调用及权限确认的自动化验证待补充。
- 真实后台和插件的安装、升级与重启由用户操作，不用手动脚本绕过面板升级验收。

## 接手约定

先读本入口，再读 [checklist](standalone-backend-checklist.yaml) 与 [设计](standalone-backend-design.md)。每个步骤和失败都同步记录；代码、测试、包、发布分别报告，后续代码有改动时重新标明待验证范围。

不动 `.lithe/`，不使用 `git add .`；新增源码和测试须显式加入 Git，防止 `commit -a` 漏掉依赖。
