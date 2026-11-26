# 多模型协作（快速模式 + 群组讨论）：计划与进度

## 当前状态（2026-11-26）

- 本机测试包 `0.1.66-local.14` 已安装。网页快速模式的运行卡片和列表状态点共用单聊流光设置。[验证记录](../2026-11-11-standalone-backend/standalone-backend-implementation.md#0166-local14-快速模式共用流光设置)

- 本机测试包 `0.1.66-local.13` 已安装。快速模式第 5 步支持按文件查看原回合差异，也可在「再审一轮」里补充文字、文件或图片，作为下一轮只读审核材料。[验证记录](../2026-11-11-standalone-backend/standalone-backend-implementation.md#0166-local13-再审补充意见与附件)
- 快速模式使用项目内中文文件交接，作者在阶段对话中实时阅读正文和历史回复，成功完成的阶段对话末尾附 `阶段交付路径：<相对路径>`。`02-审核依据.md` 引用项目 `AGENTS.md` 和模板勾选的 Skill 索引，由审核员按需读取。

- **阶段：多模型协作“快速模式（一写一审一轮）” Q0、Q1、Q2、Q3 源码、自审修复、Codex 交叉审核 7 项问题修复，以及顶部居中「多Agent模式」入口与手机灵动岛/Home Indicator 安全区适配均已完成；本机 macOS arm64 独立后台已升级至本地测试包 `0.1.66-local.3`（`http://127.0.0.1:7441`）进入实机测试（2026-11-25）。**
- 流程约定（作者 2026-11-25）：讨论 → 出计划 → 作者审核 → 出界面设计文档与 HTML 原型 → 作者确认交互 → 实施 → 实现完成后再 review。
- **实现顺序：先做快速模式，再做完整群组**（作者说快速模式是最常用的）。
- 界面设计：[ui-design.md](ui-design.md) + 可交互原型 [ui-prototype.html](ui-prototype.html)（2026-11-25 确定方向：**独立协作界面外壳、单聊零侵入，但内部对话/活动块/输入框/模型权限选择器等零件全部复用现有组件**；左运行列表、中卡片流自动跟随+呼吸灯、右 `SessionViewer + SessionActivity + ActionBar`，支持宽度拖拽与手机两层）。
- 设计文档：
  - [quick-mode-design.md](quick-mode-design.md)：快速模式（一写一审一轮），先做。
  - [group-design.md](group-design.md)：完整群组讨论（盲评、互评、结论文档），后做。
  - [ui-design.md](ui-design.md)：界面与交互设计文档（覆盖快速模式、群组讨论、全局模板与三端自适应）。
  - [ui-prototype.html](ui-prototype.html)：零依赖交互式 HTML 界面原型（浏览器直接打开即可点选体验）。
  - [q0-findings.md](q0-findings.md)：Q0 前提实测记录（CLI 只读实测、本机全局规则与 Skill 盘点、会话与进程池底座核实）。
- 原先放在群组计划“步骤 A”里的底层修复（ACP 握手、Windows 进程树、Codex 两项、中转站模型补全）：据会话记录已另行做完并随独立后台 0.1.65 发布，之后又有本机 0.1.66 测试包改动。本文档没有逐项核对代码，状态以 `.codestable/features/2026-11-11-standalone-backend/README.md` 为准。
- **模板**（作者 2026-11-25）：参与的模型组合用全局模板配置，选模板后直接说任务，可临时修改并一键保存；规则写在 [quick-mode-design.md](quick-mode-design.md) 4.7，两个模式共用。
- 另一个 Agent 此前在重构 `usecase/`、`session/`、`web/src/components/` 等文件；实现开始前按当前代码结构重读相关文件。

## 下一步

1. 作者在本地或测试包体验快速模式（`⚡ 协作` 入口、全局模板、五阶段文档交接、分歧拍板、右侧复用单聊干预）并进行代码 review。
2. 快速模式验收稳定后，再推进完整群组讨论的“步骤 0：验证核心前提（防盲从流程）”。

## 进度清单

快速模式：
- [x] 作者审核计划（2026-11-25 通过）
- [x] 作者确认界面设计与 HTML 原型（2026-11-25 通过，[ui-design.md](ui-design.md) / [ui-prototype.html](ui-prototype.html)）
- [x] Q0：验证前提（2026-11-25 完成，见 [q0-findings.md](q0-findings.md)；作者确认统一注入全局编码准则 + 模板指定 Skill，跳过手工试跑）
- [x] Q1：底座（2026-11-25 源码完成 + 验证通过：`go vet` 与 `go test -race -count=1 ./server/internal/collab ./server/internal/agent/... ./server/internal/session`、`go test -count=1 ./server/internal/api/usecase ./server/internal/kanban`、`go test -race -count=1 ./server/internal/kanban -run TestTaskStoreSnapshotMigration` 全部通过；覆盖三协议 `ReadOnly` 门禁、单聊会话列表与搜索隔离、`mindfs-control` 流式过滤、`.mindfs/runs/` 交接文档与行号核验、全局准则与 Skill 注入、全局模板快照与可用性校验、临时库 `session-list.db` 旧库与缺列幂等升级）
- [x] Q2：流程（2026-11-25 源码完成 + 验证通过：`go vet ./server/internal/collab ./server/internal/api ./server/app ./server/cmd/...`、`go test -race -count=1 ./server/internal/collab`、`go test -race -count=1 ./server/internal/api -run TestHTTPCollab` 及 `mindfs-server` 编译全部通过；验证不可用模型显式拦截、五阶段交付文档流转、缺项阻塞放行、空说明或解析失败按分歧兜底、部分裁决拦截、测试失败如实记录且严格一轮不自动返工、过程文档清理与 HTTP 接口闭环）
- [x] Q3：界面（2026-11-25 源码完成 + 验证通过：`corepack pnpm run typecheck`、`corepack pnpm run build` 产出 305 个网页文件且零 `/mindfs-assets/` 引用；`node --test tests/collab-quick-mode.test.mjs tests/remote-entry-build.test.mjs tests/menu-controls.test.mjs` 全部通过，覆盖单聊 `⚡ 协作` 待处理角标与返回单聊隔离、全局模板默认套用与下线模型标红禁发、Markdown 交付文档预览、分歧并排裁决完整性门禁、过程文档清理、右侧 100% 复用 `SessionViewer + ActionBar`，以及桌面浅/深色、IDEA 工具窗口、手机两层导航截图核验；`go test -race -count=1 ./server/internal/api` 与 `kanban`/`collab` 临时库迁移门禁全部通过；安装包尚未生成）
- [x] 快速模式代码自审与回归（2026-11-25 完成：修复进程重启残留 `running` 恢复与 `PauseRun` 同步收敛、阶段 3 缺漏条目增量补齐合并、阶段 1 跨暂停人工干预 `turndiff` 快照持久化、`SkillPaths` 与出处软链越界拦截、`R10+` 条目编号生成、只读会话 WebSocket `/plan` 拦截与单聊列表冗余重拉清理；补齐单测并复跑 Go / DB 迁移 / 前端构建 / Playwright 全部通过）
- [x] Codex 交叉审核 7 项问题修复与手机端入口验收（2026-11-25 完成：按 `runId` 隔离分歧裁决草稿、阶段写库失败立即终止并报错防重跑、工作者序号与 `done` 通道消除“暂停后立即继续”丢请求竞态、`.mindfs/runs/` 全链路 `Lstat` + `EvalSymlinks` 禁软链且清理改用 `os.Remove`、审核控制块强制要求显式 `items` 数组、阶段 3 增量补齐保留上一轮 `03-response.md` 正文并附合并汇总、空单聊进入协作再退出不残留阶段会话或 URL 参数，并在真实 `RemotePhoneShell` 验证手机入口；`collab` / `session` / `api` `-race`、`kanban` 迁移门禁、前端构建与 Playwright 全部通过）
- [x] 本机 macOS arm64 独立后台 `0.1.66-local.2` 测试包生成与热升级（2026-11-25 完成：生成 `build/standalone/0.1.66-local.2/` 安装包与自解压脚本，通过 `verify-release-assets.mjs` 静态门禁、305 个网页文件与零 `/mindfs-assets/` 引用校验、`verify-package-install.mjs` 临时 HOME 隔离安装与失败恢复验证，以及 `upgrade.py --check` 本机预检；通过独立 `launchd` 任务热升级 `~/Applications/LocalAIAgent` 从 `0.1.66-local.1` 到 `0.1.66-local.2`，升级结果写入 `build/reports/standalone-0.1.66-local.2-live-upgrade/result.txt`；未改 `version.txt`、未公开发布、未重打 IDEA 插件包；iOS App 直接经 `WKWebView` 加载后台网页无需更新）
- [x] 实机反馈修复：入口移至顶部正中央并改名「多Agent模式」+ 手机灵动岛与底部安全区适配（2026-11-25 完成：移除会话侧栏角落入口，将「多Agent模式」胶囊入口移至桌面/平板 `RemoteTopBar` 顶部正中央、手机 `RemotePhoneShell` 聊天页顶栏及 IDEA 顶栏；`CollabShell` 接入 `--mindfs-safe-area-top` / `env(safe-area-inset-top)`、`--mindfs-safe-area-bottom` 与 `--mindfs-viewport-height`，移动端抽屉、顶栏、底部滚动区与弹窗全面避让灵动岛与 Home Indicator，并复用现有 App 的 `PanelToggle` 与 `44x44` `.remote-phone-icon` 按钮规范；通过 18 项前端与安全区回归、Kanban 旧库迁移门禁，并构建热升级本机 `0.1.66-local.3`，见 `build/reports/standalone-0.1.66-local.3-live-upgrade/result.txt`）

完整群组（快速模式之后）：
- [x] 作者审核计划（2026-11-25 通过）
- [ ] 步骤 0：验证核心前提（防盲从流程）
- [ ] 步骤 B：群组底座增量
- [ ] 步骤 C：讨论流程
- [ ] 步骤 E：界面

每完成一步，在这里记录：源码完成、验证通过各自的状态和证据；后续代码有改动时重新标明待验证范围。
