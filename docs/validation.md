# 验证记录

## 0.1.23 正式发布（2026-09-18）

- 发布焦点：跨 Agent 共用每轮文件变更追踪、文件清单与 `+/-` 统计、inline diff、IDEA 原生左右 Diff、关联文件 `HEAD` 对比、Windows 路径/行号导航修复，以及会话标题栏用户消息摘要入口。Agent 原生会话、工具、提示词、权限和协议保持不变。
- Go 相关包、TypeScript、178 项前端回归（另有 3 个直接导入 `.ts` 的测试在系统 Node v22.22.3 下单独复跑通过；全量命令在 nvm Node v22.14.0 下出现仅限直接 `.ts` 导入的环境性失败）、Gradle 测试/配置校验和完整 runtime 冒烟通过。
- 最终发布审查后收紧本地鉴权：`IDE_AGENT_TOKEN` 头部仅允许 IDEA 原生 Diff 弹窗使用的本轮 artifact 和关联文件 Git compare 两个只读 GET 接口，普通 API 仍必须使用 JCEF 私有 cookie；错误 token、嵌套路径和普通 API 带 token 均拒绝。补齐 Git compare 的本地路径白名单，并重新执行相关 Go 测试、完整 runtime 冒烟、Gradle 测试/Verifier 和正式产物构建。
- Plugin Verifier 覆盖 IC/IU 2024.1、2024.2、2024.3 与 IU 2026.3 EAP 共 7 个目标，全部 `Compatible`，无 deprecated/internal API 提示；日志 `build/reports/release-0.1.23-hardening-final-gradle.log`。
- 最终产物在 `build/releases/0.1.23/`：四个平台 ZIP 各 177 个条目、Marketplace 通用 ZIP 180 个条目，均无重复、完整性通过；macOS arm64/amd64 runtime 为 Mach-O `arm64`/`x86_64`、最低 macOS 12.0 且 ZIP 可执行位 `0755`；平台包各含一个预期 runtime，通用包含四个 runtime；版本 `0.1.23`、`since-build="241"`、无 `until-build`。包核验为 `build/reports/release-0.1.23-hardening-package.json`。
- SHA-256 见 `build/releases/0.1.23/SHA256SUMS.txt`：Windows amd64 `6cf0caf2b494662107f9cbe641c27fabe44c7d066b5940ebc9aef7a3918a2c9c`，Windows arm64 `d2a6c92df7168e55ab8016f6fef3014b4b08860c6469ad955bfc47f844081226`，macOS arm64 `d363896994d31216bbe000f6f2736258cc93f0c9079afbead928abea30283235`，macOS amd64 `74eeede5a85be962d2342d154fc112d1867706aaa99835fd57ca6f97e1ff1d06`，Marketplace 通用包 `d3551b1d6b50bc0d548d833ba90e0458d6d708ba9619083b36fb95c141ee9ffc`。

## 0.1.22-local.22 会话标题栏与摘要入口（2026-09-18）

- 移除输入区上方的“周限 / 重置”指示，Plan Mode 状态保留，composer 不再为悬浮状态指示预留额外空间。
- “四横线”用户消息摘要按钮移动到 IDEA 会话标题栏右上角；点击后在标题栏右下方弹出摘要列表，选择条目滚动定位到对应用户消息。该按钮不再与文件行 `+/-` 统计或底部操作重叠。
- TypeScript、真实 Chromium 本轮差异测试、IDE Chrome/语音/关联文件对比回归、Gradle `test verifyPluginProjectConfiguration --offline` 与 Impeccable UI detector 均通过。浏览器测试覆盖中英双语、420px/900px、摘要弹出与跳转、文件行统计不被打开/对比按钮遮挡。
- 交付 `build/local-packages/idea-ai-agent-0.1.22-local.22-windows-amd64.zip`，SHA-256 为 `d662f1529c104cc562ec229dc129ef28f719ca614dacf16f7665aa5f63d0648b`。ZIP 完整、177 个条目、无重复、仅一个 Windows AMD64 runtime，版本 `0.1.22-local.22`，最低 build 241。未 commit、push、创建 Release 或上传 Marketplace。

## 0.1.22-local.21 原生 Diff 直达与鉴权修复（2026-09-18）

- “本轮修改”文件行直接显示打开与原生对比两个图标；`+/-` 统计固定在按钮左侧且不收缩，文件名负责截断，不会被图标遮挡。文件名点击仍展开 inline diff。
- 修复 IDEA 原生弹窗 401：本地 access 中间层和 turn-diff/Git compare API 均接受插件启动时生成的私有 runtime token；浏览器会话仍继续使用一次性 bootstrap cookie。`IDE_AGENT_TOKEN` 仅由 IDEA 随机生成并传给子进程，用户零配置。
- Go 相关包、TypeScript、两个真实 Chromium 交互测试、Gradle 测试与配置校验、Impeccable detector、完整 runtime 冒烟均通过。冒烟用真实本地服务验证原生 dialog 请求不再返回 401，并覆盖页面 Diff、打开文件、历史恢复和关闭。
- 交付 `build/local-packages/idea-ai-agent-0.1.22-local.21-windows-amd64.zip`，SHA-256 为 `f8eb8665cecb6b3c2655219a68b08e0d08bf4cea81bc8dd3c29e7604c422672f`。ZIP 完整、177 个条目、无重复、仅一个 PE32+ x86-64 runtime，版本 `0.1.22-local.21`，最低 build 241。未 commit、push、创建 Release 或上传 Marketplace。

## 0.1.22-local.20 Diff 操作审查修复（2026-09-18）

- 审查发现关联文件 `HEAD` 对比把 `git cat-file -e` 的任意失败都当作“HEAD 中不存在”，Git 故障可能被误判为新增文件。改为 `git ls-tree HEAD -- <path>`，仅空输出表示文件不在 HEAD，其他 Git 错误正常返回；补充重命名文件使用旧路径作为 HEAD 侧的回归。
- “本轮修改”文件行右侧的直接原生对比图标 tooltip 从“展开差异”修正为“在 IDEA 中对比”，与实际行为一致；文件名点击仍展开 inline diff。
- Go 相关包、TypeScript、两个真实 Chromium 交互测试、Gradle `test verifyPluginProjectConfiguration --offline` 与 Impeccable UI detector 均通过。最终 Windows AMD64 包重新构建并核验 ZIP 完整、177 个条目、无重复、仅一个 PE32+ x86-64 runtime、版本 `0.1.22-local.20`、最低 build 241。
- 交付 `build/local-packages/idea-ai-agent-0.1.22-local.20-windows-amd64.zip`，SHA-256 为 `5ab9275d63f72e9f3973bc5a4ebd9b1fa576c393ac2afdef098aad5a5266a254`。未 commit、push、创建 Release 或上传 Marketplace。

## 0.1.22-local.19 本轮 Diff 原生按钮直达（2026-09-18）

- “本轮修改了 X 个文件”卡片的每个文件行右侧新增直接可见的原生对比图标按钮；点击立即发送 `compareTurnDiff` 并打开 IDEA 原生左右 Diff 弹窗，不需要先展开文件详情。文件名点击仍展开 inline diff，两个操作互不影响；详情里的原按钮保留。
- TypeScript、真实 Chromium 本轮差异交互测试和 Gradle `test --offline` 通过；Impeccable UI detector 返回空结果。测试覆盖按钮在展开前可见、点击只触发原生对比、展开操作和打开文件行为。
- 交付 `build/local-packages/idea-ai-agent-0.1.22-local.19-windows-amd64.zip`，SHA-256 为 `eff094b7079bb67719205d4dc8a003ef126bc2c1d9688afa992e83e6191c19ea`。ZIP 完整、177 个条目、无重复，仅包含一个 PE32+ x86-64 runtime；插件版本 `0.1.22-local.19`，最低 build 241。未 commit、push、创建 Release 或上传 Marketplace。

## 0.1.22-local.18 关联文件 HEAD 对比（2026-09-18）

- 会话底部“关联文件”保持文件名点击后在 IDEA 打开；仅 IDEA 运行时且当前文件存在 Git worktree 变更时，在右侧新增“与 HEAD 对比”按钮。按钮通过只读本地 token 接口读取 `HEAD` 与当前工作区内容，并用 IDEA 公共 `DiffManager` 打开原生左右对比弹窗；支持修改、新增、删除和二进制标记，单侧大小上限 2 MiB。历史 commit range 统计不显示该按钮，浏览器模式不显示。
- Agent 适配器、协议、原生工具、提示词和权限未修改。Git 读取复用 root/repo/task worktree 路径解析；工作区读取使用 `os.OpenRoot`，API 仅接受本地 runtime token。新增修改/新增/删除/二进制、task worktree、路径解析和 HTTP token 回归；前端测试验证 compare 按钮只发送 `compareGitFile`，文件名点击仍走打开文件。
- `go test ./server/internal/gitview ./server/internal/api/usecase ./server/internal/api`、TypeScript、真实 Chromium 关联文件交互测试、Gradle `test verifyPluginProjectConfiguration --offline` 均通过；Impeccable UI detector 返回空结果。构建日志包含在 Gradle 本地输出中。
- 交付 `build/local-packages/idea-ai-agent-0.1.22-local.18-windows-amd64.zip`，SHA-256 为 `eef1b9fb06bae18f386fce2c09c271df45e70f79b29ca68ae081d8381eb36dff`。ZIP 完整、177 个条目、无重复，仅包含一个 PE32+ x86-64 runtime；插件版本 `0.1.22-local.18`，最低 build 241。包核验记录为 `build/reports/related-file-git-compare-package.json`。未 commit、push、创建 Release 或上传 Marketplace；Windows IDEA 原生 Git 左右 Diff 弹窗等待用户实测。

## 0.1.22-local.17 Turn Diff 审查修复与 Verifier 清零（2026-09-17）

- 修复审查发现的 7 项问题：artifact 读取使用 `os.OpenRoot` 并强制十六进制 blob 名和大小/manifest 上限；Finish 阶段增加 64 MiB 累计预算并正确回写 Partial；轮前 dirty 文件恢复到索引版本不再漏报；补丁与 artifact 复用同一份前后内容；新增/删除文本文件提供 IDEA 原生对比入口；左右视图正确解析空白行和 `++` 开头代码；2026.3 语音凭据改用真实四参数 `CredentialAttributes` 构造器并保留 2024.1 五参数回退。Agent 适配器、工具、提示词、权限和原生请求结构未修改。
- 新增路径越界、dirty 恢复、Partial、新增/删除 artifact 入口和 Diff 前缀回归。`go test ./server/internal/turndiff ./server/internal/api/usecase -count=1`、TypeScript、Diff 模型测试和真实 Chromium 本轮差异页面测试通过；Gradle 58 项测试与构建通过。Verifier 覆盖 IC/IU 2024.1、2024.2、2024.3 与 IU 2026.3 EAP 共 7 个目标，全部 Compatible 且无 deprecated/internal API 提示，日志 `build/reports/turn-diff-verifier-local17.log`。
- 交付 `build/local-packages/idea-ai-agent-0.1.22-local.17-windows-amd64.zip`，SHA-256 为 `b809135cf028551a94e97516ecc970fa027ecf3cc6306ccb011825fd931744b0`。ZIP 完整性检查通过，仅包含一个 PE32+ x86-64 runtime，插件版本 `0.1.22-local.17`、最低 build 241。未 commit、push、创建 Release 或上传 Marketplace；Windows IDEA 原生左右 Diff 弹窗等待用户实测。

## 0.1.22-local.14 Windows 本轮差异采集修复（2026-09-17）

- local.13 的前端完成同步和文件点击已生效，但 Windows 大项目仍缺少本轮差异卡片。服务端原快照每回合前后全量读取项目文件且各 3 秒超时，失败后静默降级；`Z:` 等目录还可能触发 Git 所有权检查。本轮改为干净已跟踪文件记录 Git 索引对象，仅回合前 dirty/untracked 文件读取内容，结束时只比较候选变更文件；单阶段预算提高到 10 秒，并为当前观察目录显式启用只读 `safe.directory`。
- 保持公共会话旁路观察，不修改 Agent 适配器、原生工具、提示词、权限或协议。`turndiff` 和 `api/usecase` 回归通过，覆盖已有 dirty/staged、未跟踪、新增、删除、重命名、二进制、CRLF、回合中提交、工作树隔离、Codex 命令修改和 Claude/ACP 公共路径；新增 Capture 只保存 dirty/untracked 字节的断言。所有权场景按观察目录传递 slash 格式 `safe.directory`，待 Windows 实机验证。
- Gradle `test verifyPluginProjectConfiguration buildPlugin --offline` 通过并交叉构建 Windows amd64，日志为 `build/reports/turn-diff-windows-local14-build.log`。最终 ZIP 177 个条目、无重复、完整性检查通过，仅包含一个 PE AMD64 运行程序，报告为 `build/reports/turn-diff-local14-package.json`。
- 交付 `build/local-packages/idea-ai-agent-0.1.22-local.14-windows-amd64.zip`，SHA-256 为 `a5df643ab760ad318e92388bf8af7c2c6cf5015061cf6705a3aae26af4b17fd6`。用户已在 Windows IDEA 实测确认 `README.md` 本轮卡片显示 1 个文件、`+53` 统计和展开 diff。未 commit、push、打标签、创建 Release 或上传 Marketplace。

## 0.1.22-local.13 Windows 回复文件链接导航修复（2026-09-17）

- 复现 `Z:/.../README.md` 被 Markdown 的 URL 过滤器当作不支持的协议清空，旧组件渲染 `href=""`，点击导致页面重新加载。无 session 参数时表现为进入新会话，从历史重新进入后则刷新当前会话；并非 Agent 主动创建了新会话。旧代码复现日志为 `build/reports/markdown-windows-link-red.log`。
- 公共 Markdown 组件在过滤前保留可识别的盘符路径、file URI 和文件行号引用，兼容正反斜杠及 Markdown 编码的反斜杠。空链接不再触发页面导航；文件点击使用既有 IDEA 打开桥接，保留原来的 HTML sanitizer 和协议过滤。没有改动 Agent 适配器、工具、Prompt、权限或协议。
- TypeScript、Vite 生产构建及 12 项相关前端测试通过。完整生产 App 覆盖 Codex 原生 diff、Codex 命令修改兜底、Claude 公共兜底；在有／无 session 参数时各连续点击两次 README 链接，均只有预期打开文件消息、地址不变且无导航。diff 卡片展开、原有打开按钮、下一轮迟到响应保护、重载和 replay 回归通过。日志为 `build/reports/markdown-windows-link-{regressions,web-build,live}.log`，截图为 `build/reports/turn-diff-live-*.png`。
- Gradle `test verifyPluginProjectConfiguration buildPlugin --offline` 通过，58 项 JUnit 测试零失败，版本为 `0.1.22-local.13`，默认正式版本仍为 `0.1.22`。最终 ZIP 完整且无重复条目，仅含 Windows AMD64 程序，最低 IDEA build 241、无最高版本限制；160 个前端文件与最终构建一致，JS 内容散列文件名与完整页面验证时一致。运行程序和 81 个插件 class 均与 local.12 逐字节相同。核验见 `build/reports/markdown-windows-link-package.json`，构建日志为 `markdown-windows-link-windows-build.log`。
- 交付 `build/local-packages/idea-ai-agent-0.1.22-local.13-windows-amd64.zip`。验证在 macOS Chromium／模拟会话传输完成，Windows IDEA 实机文件打开待用户测试；沿用前文已记录的 Claude 既有 race 边界。仅本地打包，未 commit、push、打标签或发布 Release／Marketplace。

## 0.1.22-local.12 本轮 diff 实时页面同步（2026-09-17）

- 修复公共页面完成事件漏接：`App` 原先收到 `session.done` 仅更新 pending 和会话列表元信息，不读取后端完成落盘的 `exchange_aux`；实时分支也不消费 `turn_diff`，导致正常流式回复后看不到本轮 diff。结束时现通过既有历史接口读取最终记录，不注入或改写 Agent 原生事件。
- 本轮 diff 卡片属于聊天时间线，位于对应回复下方，与原“关联文件”区域独立。无需恢复文件列表区域。延迟返回的完成读取有回合版本和 pending 检查，不能覆盖下一轮正在生成的回复；重放的完成通知不触发循环读取，开始前已有的历史请求不能替代完成后读取。
- 使用实际构建的完整 App、HTTP 会话数据及 WebSocket 事件复现：修复前结束后 README 卡片数量为 0（`build/reports/turn-diff-live-red.log`），修复后显示卡片和 diff。此前仅用落盘数据直接挂载 `SessionViewer` 的测试未覆盖此实时同步环节。
- TypeScript 检查与 11 项相关前端回归通过；完整页面覆盖 Codex 命令修改兜底／原生 diff、Claude 公共兜底、连续回合迟到响应、IDEA 打开文件桥接、重载及 replay 不循环。证据为 `build/reports/turn-diff-live-{regression,final}.log` 和 `turn-diff-live-*.png`。另用临时 Go overlay 验证“还原本轮前已修改的 README”仍产生本轮差异，日志为 `turn-diff-restore-probe.log`。
- Gradle `test verifyPluginProjectConfiguration buildPlugin --offline` 构建 Windows amd64、版本 `0.1.22-local.12` 通过；默认正式版本仍是 `0.1.22`。本轮仅追加页面同步修复和测试，所有 Agent 适配器均未修改。macOS 上的浏览器／模拟传输验证不等同于 Windows IDEA 实机验证；沿用 local.11 已记录的 Claude 既有 race 限制。
- 最终包 `build/local-packages/idea-ai-agent-0.1.22-local.12-windows-amd64.zip` 完整性、无重复条目、版本及 PE AMD64 检查通过，仅含一个平台程序，160 个前端文件与最终构建一致。Windows 服务程序和 81 个插件 class 均与 local.11 逐字节一致，确认这次交付只改变前端和版本元信息。核验记录为 `build/reports/turn-diff-live-package.json`。
- 仅交付 Windows x64 本地 ZIP；未 commit、push 或发布 Release／Marketplace，用户实机验收待完成。

## 0.1.22-local.11 本轮 diff 跨 Agent 共用（2026-09-17）

- 移除公共 `SendMessage` 中只对 `codex` 采集工作区基线的限制，所有走该会话流程的 Agent 共用文件比较、差异合并、持久化及现有前端展示。Codex、Claude 和 ACP 适配器未修改，原生请求、工具及事件保持原样；采集范围和限额沿用 local.10。
- 新增真实 SDK／传输层加模拟进程的 Claude、任意名称 ACP Agent 回归：修复前两者均缺失 diff，修复后均能从重新创建的会话管理器读取本轮差异，第二轮不重复显示旧差异；非 Git 项目仍正常返回原生回复，不伪造原生 diff 事件。测试不调用模型 API。
- `turndiff`、`api/usecase`、`agent/codex`、`agent/claude`、`agent/acp` 相关 Go 包全部通过，日志为 `build/reports/turn-diff-shared-go.log`；首次复现日志为 `build/reports/turn-diff-shared-red.log`。本次未改动前端，复用 local.10 已通过的浏览器验证。
- 额外 `-race` 检查未通过：Claude 连续回合会在 `SendMessage` 与结果消费之间并发重置 `sawMessageText`。通过 Go overlay 使用 HEAD 的原始公共会话文件（完全不含本次 diff 采集），在非 Git 项目仍复现相同竞态，确认不是本次新增。原生适配器保持未修改，另记为 `.codestable/issues/2026-09-17-claude-turn-state-race/claude-turn-state-race-report.md`；两次日志分别为 `turn-diff-shared-race.log`、`turn-diff-shared-baseline-race.log`，不能表述为全部并发检查通过。
- Gradle `test verifyPluginProjectConfiguration buildPlugin --offline` 通过。`build/local-packages/idea-ai-agent-0.1.22-local.11-windows-amd64.zip` 完整性、无重复条目及版本检查通过，仅有一个 Windows AMD64（PE `0x8664`）程序；程序和 160 个前端文件与最终构建逐字节一致。包核验记录为 `build/reports/turn-diff-shared-package.json`。
- 仅生成 `0.1.22-local.11` Windows amd64 本地测试包，正式默认版本仍为 `0.1.22`；未 commit、push 或更新 Release／Marketplace。Windows 实机验收待用户完成。

## 0.1.22-local.10 本轮 diff 命令修改兜底（2026-09-17）

- 修复 Codex 通过 `exec_command` 调用补丁执行器时仅产生 `commandExecution`、没有原生 `turn/diff/updated` 导致文件列表缺失的问题。插件在发送前读取工作区基线，结束后比较文件内容并保存到该轮辅助记录；不改动 Agent 工具列表、Prompt、权限、原生协议或运行参数，也不修改真实 Git index/HEAD。
- 原生事件流保持不变。最终展示使用已完整观察到的文件前后差异，保留未覆盖文件的原生 diff；同一文件混合原生补丁和命令修改时只展示一项。界面注明可能包含同期手动修改。新基线只对安装后在插件中执行的回合生效，不能追溯还原历史回合的缺失基线。
- 采集范围为当前 Git 项目／工作树中已跟踪及未被忽略的未跟踪常规文件，排除 `.mindfs`、`.git` 和符号链接；需要可调用的 Git。单文件上限 2 MiB、单次快照内容 32 MiB、枚举文件 20,000 个、diff 输出 4 MiB，单阶段预算 3 秒（不代表阻塞文件系统调用有硬截止时间）。跳过文件时标记范围不完整；采集失败保留原生结果，不阻止原生对话。
- Go 相关包 `turndiff`、`api/usecase`、`session`、`agent/codex` 回归通过；覆盖已有 dirty/staged 内容、新增/删除/重命名、中文和空格路径、CRLF、二进制、回合中提交、跨轮隔离、工作树路径、采集上限、失败降级及混合修改去重。命令回合端到端测试走实际 SDK 和会话持久化，模拟 App Server 只返回命令事件，并核对模型、思考强度、权限参数；相关 race 检查通过。
- TypeScript 检查通过。5 项 diff 前端测试通过，真实 Chromium 使用 Go 端到端测试落盘的结果检查文件列表、展开 `-1/+1` diff、IDEA 打开文件桥接及重新加载，覆盖 420px 中文深色／900px 英文浅色；截图和日志在 `build/reports/turn-diff/`、`build/reports/turn-diff-*.log`。
- Gradle `test verifyPluginProjectConfiguration buildPlugin --offline` 通过。交付包 `build/local-packages/idea-ai-agent-0.1.22-local.10-windows-amd64.zip` 完整性及无重复条目检查通过，仅包含一个 Windows AMD64（PE `0x8664`）运行程序；程序与 160 个前端文件均与最终构建逐字节一致。包内版本为 `0.1.22-local.10`、最低 IDEA build 为 241，无最高版本限制。包核验记录在 `build/reports/turn-diff-package.json`。
- 仅交付 Windows amd64 本地测试 ZIP，版本 `0.1.22-local.10`；Gradle 默认正式版本仍为 `0.1.22`。Windows 程序由 macOS 交叉编译，实机安装与实际 Codex/PowerShell 回合等待用户验证；本次未推送源码或更新 GitHub Release／Marketplace。

## 0.1.22 语音输入与文件变更（2026-09-16）

- 2026-09-17 在功能验收完成后保持版本号 0.1.22 重新生成最终包；功能代码和四个平台运行程序未变，只更新插件 JAR 中的中英双语 Marketplace 描述、源码/问题反馈/隐私政策链接，以及适合 40px Marketplace 展示和 16px IDEA 工具窗口侧边栏的同款机器人矢量图标。侧边栏版本取消容易在小尺寸下糊成同心圆的内框，改用放大的头部轮廓、天线和实心眼睛，并分别适配浅色、深色主题。四个单平台包和一个通用包均重新计算 SHA-256。
- 更新后的插件描述 XML 解析通过；通用包包含四个目标架构运行程序，单平台包各只包含对应程序，五个包的公共文件逐项一致且无重复 ZIP 条目。Plugin Verifier 再次检查 IC/IU 2024.1、2024.2、2024.3，六个目标全部 `Compatible`；2024.3 的既有 `CredentialAttributes` 弃用提示不影响兼容性。

- `node scripts/test-runtime.mjs` Go 全套通过；TypeScript 类型检查和 `node --test --test-concurrency=1 tests/*.test.mjs` 的 179 项前端测试通过，无失败、跳过或取消。
- Kotlin/IDEA 测试 58 项通过；正式版本 `test buildPlugin verifyPluginProjectConfiguration --offline` 通过。语音测试覆盖录音控制器的取消/迟到结果、各供应商请求构造、凭据隔离、配置表单、配置测试面板和供应商展示。
- 正式前端和 macOS arm64 本地运行时执行完整 `scripts/smoke-runtime.mjs` 通过，覆盖启动鉴权、Agent 发现、会话和草稿、权限提问、主题窄栏、历史恢复、活动计时与服务退出。浏览器未出现未捕获错误或远程服务请求。
- 四个原生程序使用 `CGO_ENABLED=0` 构建并核对 PE/Mach-O CPU 类型；两个 macOS 程序最低系统版本均为 12.0。四个单平台安装包各包含一个对应程序；Marketplace 通用 ZIP 包含全部四个程序。五个包的插件 JAR、前端、配置、许可证等公共文件逐字节一致，ZIP 完整性及无重复条目检查通过。
- 通用 ZIP 内版本为 0.1.22，包含图标、更新说明、`since-build="241"`，没有最高版本限制。五个安装包 SHA-256 记录在 Release 附件 `SHA256SUMS.txt`。
- 最终通用 ZIP 经 Plugin Verifier 验证，IC/IU 2024.1、2024.2、2024.3 六个目标全部 `Compatible`。2024.3 仍报告 `CredentialAttributes` 构造器弃用提示，不影响二进制兼容性。
- 本轮验证运行于 macOS arm64，其他架构完成交叉编译与静态检查；未在 Windows/Intel 实机安装，也未使用真实麦克风或供应商凭据发起识别请求。用户此前对腾讯云/硅基流动的效果反馈不能替代跨设备测试。

日志：`build/reports/release-0.1.22-{go,web,build,build-final,smoke,package,verifier}.log`；产物：`build/releases/0.1.22/`。

## 0.1.21 Windows 更新文件锁修复

- 插件不再直接启动安装目录中的 `idea-agent-windows-*.exe`。启动前会把当前操作系统与 CPU 对应的程序及公共 runtime 文件复制到 IDEA system cache 的完整内容 SHA-256 目录，其他平台程序不会复制。
- 缓存发布使用同一缓存根目录下的临时目录和原子目录移动；并发测试验证多个项目同时初始化时只复用一份已带完成标记的缓存。runtime 内容变化会生成新目录，不覆盖旧版本。
- `DynamicPluginListener.beforePluginUnload` 与 `AppLifecycleListener.appWillBeClosed` 会同步停止所有活动服务：先发送正常关闭命令并等待，必要时强制终止并再次等待。回归测试实际启动独立 Java 子进程，验证关闭函数返回时进程已经退出。
- Kotlin/IDEA 测试共 30 项通过，项目配置检查、插件构建与 Plugin Verifier 通过。通用 ZIP 对 IDEA 社区版和旗舰版 2024.1、2024.2、2024.3 六个目标均返回 `Compatible`；最低 build 为 241，没有 `until-build`。
- 0.1.20 本身仍直接从插件目录运行服务，因此一个已经运行的 0.1.20 在 Windows 上首次更新到 0.1.21 时，仍可能需要退出 IDEA 并在任务管理器结束旧进程。安装 0.1.21 后，后续更新不再依赖手动结束进程。

## 0.1.20 四架构与 Marketplace 通用包验证

- Windows x64、Windows ARM64、macOS Apple Silicon、macOS Intel 四个单平台 ZIP 均只包含对应运行程序；通用 ZIP 包含全部四个运行程序。四个单平台包的其余 176 个文件逐项 SHA-256 一致。
- 二进制格式检查通过：两个 Windows 程序分别为 PE32+ x86-64 与 AArch64；两个 macOS 程序分别为 Mach-O x86_64 与 arm64，最低 macOS 版本均为 12.0。通用包约 31 MB。
- 通用包内插件版本为 0.1.20，包含插件图标和英文 Marketplace 描述；兼容范围只设置 `since-build="241"`，没有 `until-build`。
- Plugin Verifier 1.410 对通用 ZIP 的 IDEA 社区版与旗舰版 2024.1、2024.2、2024.3 六个目标全部返回 `Compatible`。Kotlin/IDEA 测试、项目配置检查和隔离外部 Relay 配置后的 Go 全量测试通过。
- 构建与验证在 macOS arm64 主机完成。Windows 与 macOS Intel/Windows ARM64 程序使用 Go 的 `CGO_ENABLED=0` 交叉编译并检查文件格式，没有在对应实体设备上完成安装测试。

## 0.1.17 发布源码验证

- Codex、Claude、共用表单校验、session 与 Codex SDK 全套相关 Go 测试及 race 检查通过；Claude SDK 原生交互协议测试和原生 usecase 回归通过。日志为 `build/reports/native-interactions-*-tests.log`。
- 覆盖 2,048 条事件积压后的有序交付、启动响应前的完成事件、请求 ID 与并发去重、取消、表单校验失败后重试、权限范围，以及未知 Claude dialog 取消。
- TypeScript 和真实 Chromium 原生交互／回答确认链路共 4 项测试通过；已检查 375px 移动端、900px 中文深色截图。详情见 `.codestable/issues/2026-09-14-native-interactions/native-interactions-fix-note.md`。
- 发布构建日志目录为 `build/reports/release-0.1.17/`，平台 ZIP 与校验清单目录为 `build/releases/0.1.17/`。Windows 为交叉编译；本轮原生交互测试使用模拟协议，没有付费模型调用。

## 0.1.16 发布源码验证

- 当前文件入口：26 项 Kotlin/IDEA 平台测试与 23 项桥接/浏览器测试通过，覆盖多文件切换后取激活标签页、右击文件、原有未保存代码片段、菜单注册、草稿保留和窄栏主题。日志为 `build/reports/file-context*`。
- 回复信息：Codex、session、API/usecase Go 测试通过，原生 JSONL → 历史补录 → 磁盘重开保持每条回复的 effort/Context，重复同步幂等；实时保存覆盖 Codex/Claude、零值和快照隔离。流事件回归验证下一轮没有 usage 时不会沿用上一轮 Context。
- 元数据、活动历史、缓存迁移及会话活动浏览器测试共 11 项通过；已查看 375px 中文浅色和 900px 英文深色截图。TypeScript、运行时构建和完整 App 冒烟通过，原有计时、后台回复、会话切换与模型发现回归通过。日志与截图位于 `build/reports/reply-metadata*`。

发布构建及兼容检查证据保存在 `build/reports/release-0.1.16/`，平台 ZIP 与 SHA-256 清单位于 `build/releases/0.1.16/`。沿用 Mac arm64 和 Windows amd64 发布目标；Windows 交叉编译与 IDEA/JCEF 实机验收边界不变，不将自动化检查视为真实安装验收。输入/输出 Token 和缓存命中率按用户要求暂缓。

## 0.1.15 发布源码验证

- Agent/API/usecase Go 回归通过；新增启动测试验证自动识别和失败退出等待状态，Windows Agent 测试包与完整运行时交叉编译通过。
- 模型刷新服务覆盖旧快照、多次事件合并、catalog 隔离及错误恢复。旧源码在同一回归中失败，见 `build/reports/agent-discovery-baseline.log`。
- 状态文字、菜单和重启交互 20 项浏览器测试通过；320px 中文浅色、375px 英文深色及长名称/错误无横向溢出。完整 App 模型发现、连接恢复、消息与工具状态冒烟通过，见 `build/reports/agent-status-labels-smoke.log`。
- 消息布局与活动分组 16 项回归通过，覆盖两个 Agent、375px/1080px、短文/长文/图片和操作栏。旧布局在 1080px 视口内停于 `854.390625px`，修复后贴齐 `1064px` 内容边界。日志位于 `build/reports/session-message-layout-*.log`。
- TypeScript 检查通过。Kotlin 实现没有修改，Java 17 / IDEA build 241 基线保持不变。

0.1.15 构建与包内应用检查记录保存在 `build/reports/release-0.1.15/`，安装包位于 `build/releases/0.1.15/`。Windows 与 IDEA/JCEF 实机验收边界不变；详细修复记录见 `.codestable/issues/2026-09-14-agent-model-startup/` 和 `.codestable/issues/2026-09-14-user-message-alignment/`。

## 0.1.14 发布源码验证

本版发布工具活动 F1–F6 与 F7 已验证的修复，沿用本机 macOS arm64/JBR21 环境；发布不代表 F7 所有实机检查通过。

- F7 前端基线 145 项与新增 readiness 4 项通过，TypeScript 通过；16 组宽度/亮暗/100%–150% 布局、键盘/焦点、1000 项同机对照与 1 MiB 连续日志均有证据。
- Codex、Claude、通用 Agent 类型、session、API/usecase 相关 Go 包通过；Codex 实测发现的包装重复与失败误判修复后，Codex、session、API/usecase 已再次通过。
- Kotlin 21 项通过，构建与项目配置校验通过。0.1.14 Plugin Verifier 在本机缓存 IC 2024.1（241.14494.240）返回 Compatible，其他 IDEA 目标本次未重跑。F7 完整包内应用 smoke 覆盖提问提交、模型/权限、消息/排队、两项计时、后台会话恢复及主题桥接。
- 真实 Codex 0.154：三次独立调用（读取 README、成功命令、预期 exit 7），完整历史同步前后保留 3 个原 ID、2 成功/1 失败；真实会话的浏览器详情与默认收起验证通过。最后的 runtime 二进制重读原生会话再次通过。
- Claude Code 2.1.270 虽报告已登录，实际 adapter 请求在 180 秒内未返回终态。IDEA/JCEF 的主题、缩放、剪贴板、焦点与滚动未完成实机验收；系统录屏权限未授予。Windows 为 Mac 交叉编译，未验证 Windows 实机安装。

上述功能证据在 `build/reports/activity-ide-readiness/`，完整记录见 [F7 部分验收](../.codestable/features/2026-09-14-activity-ide-readiness/activity-ide-readiness-acceptance.md)。0.1.14 发布构建、打包冒烟、Plugin Verifier 与平台文件/校验值记录在 `build/reports/release-0.1.14/`；发布产物为 `build/releases/0.1.14/` 的 Mac arm64、Windows x64 ZIP 和 SHA256SUMS.txt。新版本号仅在插件 manifest 层变化，F7 待验收项目继续保留。


## 0.1.13 发布源码验证

本轮在 macOS arm64、IDEA 自带 JDK 21 环境验证：

- 前端 `node --test --test-concurrency=1 tests/*.test.mjs`：86 项通过；TypeScript 类型检查通过。旧主题测试补齐持久化桥接依赖，并断言启动主题不会写入用户偏好；活动栏测试在安装模拟时钟后向前暂停，避免繁忙环境下倒退时间。
- `node scripts/test-runtime.mjs` 全量服务端测试通过。首次并发检查中，未改动的任务调度测试偶发出现重复执行计数；该用例单独连续 10 次通过，随后全量服务端复查通过，保留首轮与复查日志。
- `./gradlew test verifyPluginProjectConfiguration -x buildRuntime --offline` 通过，覆盖原生命令、配置持久化、编辑器上下文、运行环境与本地端点。
- 异步选择题相关 SDK/Adapter/Session/Usecase 回归通过；新增异步选择题测试通过 Go race 检查。
- 完整页面受控冒烟覆盖选择卡片与提交确认、运行中会话模型/权限、原生按钮、消息队列、活动栏恢复和重连；本地已通过。发布包构建后再次从对应发布源码运行冒烟。

源码验证日志在本地 `build/reports/release-0.1.13-*.log`，具体异步问题修复记录见 `.codestable/issues/2026-09-14-async-question/`。Windows 安装包为 Mac 交叉编译产物，不能将编译及包结构检查视为 Windows/IDEA 实机验证。

环境：Windows amd64、开发 JDK 21、Go 1.26.5、Node.js 20.18.1、pnpm 12.4.1。

## 消息同步与等待状态（0.1.8，未发布）

- `go test ./server/internal/api -run '^TestDelivery' -count=1` 首次三项失败：重连只收到完成通知而没有空队列、晚到广播重新带回已出队的消息、发送者收不到正式用户消息。改为按会话串行发布当前队列快照、重连回传空队列、正式消息回传发送者后通过。
- 独立审查首轮指出运行中工具被显示层统一改成完成，以及停止读取的 WebSocket 客户端可能无限占用队列发布锁。分别改为仅对结束的历史整理工具状态，并为界面 WebSocket 写入设置 5 秒上限、移除写失败连接。Agent 任务本身仍无新增超时。
- 新增 `TestDeliveryStalledClientCannotBlockQueueForever`，用真实本地 TCP/WebSocket 缩小收发缓冲区并停止读取，修复前 7 秒内无法释放发布锁而失败；修复后广播返回、失败连接移除、新连接可以重放空队列。最终 `go test ./server/internal/api -count=1` 整包通过。
- TypeScript 类型检查通过。`node --test tests/session-activity.test.mjs tests/question-delivery.test.mjs tests/native-defaults.test.mjs` 五项通过，涵盖执行中/结束历史的工具状态、原生默认参数和用户回答确认；不调用真实模型。
- 打包浏览器测试先复现缺少等待状态，随后在运行工具标签处失败，证实原显示层提前结算普通工具。修复后 `node scripts/smoke-runtime.mjs --delivery-only` 通过正式用户消息、重放去重、思考/工具状态、65 秒无事件提示、队列清空及结束状态撤除；375px 截图为 `build/reports/ide-message-activity.png`。日志为 `build/reports/0.1.8-delivery-ui-green.log`。
- Windows `buildPlugin --offline` 通过；保持 IDEA 2024.1 SDK、Java 17 字节码基线，本轮没有修改 Kotlin 代码。用户中断了后续完整 UI 重跑，因此该次 `0.1.8-ui-final.log` 只有启动部分，不作为完整检查通过的证据。

本轮没有运行真实 Codex / Claude 模型，Mac IDEA/JCEF 仍需实机验证。测试清理时 `.tools/runtime-smoke-pmi1fX` 被占用，后续清理被自动审批以 `blocked by policy` 拒绝；目录暂时保留。本地测试包未提交或发布 GitHub Release。

## 原生权限选择与文件粘贴（0.1.7，未发布）

- 新增用例先确认 Codex / Claude 缺少权限选项，浏览器在旧资源上无法粘贴普通文件（`build/reports/0.1.7-paste-red.log`）。权限沿用现有 `mode` 字段传入两个原生适配器，插件默认最高权限，明确保存的选择继续保留。
- `go test ./server/internal/agent/codex ./server/internal/agent/claude -run 'TestNative|TestOpenSessionInherits|Test.*Question|Test.*Answer|Test.*Permission' -count=1` 通过。覆盖原生权限选项、最高权限降回普通权限、非法模式拒绝、计划模式保留，以及原有用户询问/回答回归；没有调用真实模型。
- Claude 真实构造器与传输参数测试发现 SDK 将 `AllowDangerouslySkipPermissions` 映射为立即启用的 `--dangerously-skip-permissions`。修复为 `--allow-dangerously-skip-permissions` 后，普通、最高权限及计划模式用例均通过；当前权限通过 `--permission-mode` 明确选择。
- TypeScript 类型检查通过，`node --test tests/native-defaults.test.mjs tests/question-delivery.test.mjs` 四项通过。`node scripts/smoke-runtime.mjs` 检查实际 Windows 打包资源：普通文件粘贴/移除、Codex / Claude 默认最高权限、手动降权、切换模型不重置权限；原有工具栏提示、弹窗布局、配置、安装、重启、历史、明暗主题和 375px 窄窗检查均通过。日志为 `build/reports/0.1.7-ui-green.log`。
- 独立审查冻结的生产代码和回归测试，结论为通过，无 blocking / important 问题。审查基线为 `c801ca89c968d49151b6f55ed38fa41991f7e326`，差异 SHA-256 为 `0456dadaa5fc5068c7b34dd0d99cd4d107880092599dc584fbfae4b16c7f3db1`。之后仅修正浏览器测试中 Agent 按钮的定位方式并补充说明文档。
- Windows `buildPlugin --offline` 通过。首次构建遇到 Node 内存不足，停止本次 Gradle 后台进程后，以 Node 4 GB 上限和 Gradle 768 MB 上限完成顺序构建。0.1.7 ZIP 完整性通过，18 个插件 class 与已通过六个 IDEA 2024 兼容目标检查的 0.1.6 逐项相同，仍为 Java 17 字节码、最低 IDEA build 241；本轮没有重复运行六个目标的 Plugin Verifier。报告为 `build/reports/0.1.7-plugin-artifact.json`。

- Mac arm64 / amd64 顺序交叉编译通过，三个最终 ZIP 完整性通过。两个 Mac 包各自的 168 个共用文件与 Windows 测试包逐项 SHA-256 相同，Mach-O 架构匹配，最低 macOS 12.0；报告为 `build/reports/macos-0.1.7-{arm64,amd64}-artifact.json`，安装包与 SHA-256 清单位于 `build/local-packages/`。

浏览器合成的文件粘贴已通过，尚未验证 Mac Finder 或 IDEA 项目树的系统剪贴板。真实 CLI、Mac IDEA/JCEF 仍需用户本机验收；启动时短暂白色区域按用户要求暂不处理。本轮仅生成本地测试包，没有创建 GitHub Release。

## Claude 默认模型启动与界面交互修复（0.1.6，未发布）

- 在原有 `TestNativeCLIFlagsAndArguments` 中补上真实 `claudeagent.NewClient` 调用，修复前得到与用户截图一致的 `invalid configuration for Model: model must be specified`。原测试绕过构造器，因而没有发现该错误。
- 保留固定版本 `fc2d6ef2e3eb` 的第三方 Claude SDK 根 Go 源码、测试及许可证，构建改为本地替换。逐文件比较确认生产源码只有 `client.go` 一处校验变更：允许空模型，由既有传输层省略 `--model`，让 CLI 自行解析默认配置；未改变 SDK 的其他默认值或权限、会话校验。
- `go test ./server/internal/agent/claude -run 'TestNative|Test.*Question|Test.*Answer|Test.*Permission' -count=1` 通过。回归经过真实构造器和传输层，再由记录器截获进程启动；验证默认模型不覆盖、显式模型原样传递、附加参数和工作目录保留、权限与 effort 的非法值仍拒绝、原生询问仍等待用户。SDK 自带的选项及定向传输参数测试通过。Claude 整包在 Windows 仍有下文已记录的 Unix 路径样例失败。
- 浏览器测试先在旧打包资源上失败，确认三个可见悬停提示缺失、历史/配置再次点击不收回、模型列表按钮被输入区遮挡，日志为 `build/reports/0.1.6-ui-red.log`。修复后 `node scripts/smoke-runtime.mjs` 通过：悬停/键盘焦点提示及 Esc 关闭、历史/配置双击切换、Agent 列与模型列折叠后横向位置不变、错误详情切换、打开弹窗时缩窄到 375px、主题及焦点恢复；此前配置/安装/重启/草稿/历史检查也通过，日志为 `build/reports/0.1.6-ui-green.log`。
- TypeScript 类型检查、前端原生默认值与重启检查通过；`buildPlugin test verifyPluginProjectConfiguration --offline` 通过，7 项 JUnit 测试零失败。最终 Web 调整后重新构建并重跑上述浏览器检查。
- 最终 `verifyPlugin --offline` 通过，IC/IU 2024.1、2024.2、2024.3 六个目标均 `Compatible`，包含新增 IDEA 原生标题栏动作。日志为 `build/reports/0.1.6-plugin-verifier.log`。
- Windows x64、Mac arm64、Mac amd64 三个 ZIP 均通过完整性检查；两个 Mac 包各自 168 个共用文件与 Windows 测试包逐项 SHA-256 相同。Mach-O 架构匹配，最低 macOS 12.0；运行时均包含 Claude SDK 许可证，插件版本为 0.1.6、最低 IDEA build 241、Java 17 字节码。报告为 `build/reports/macos-0.1.6-{arm64,amd64}-artifact.json`，安装包及 SHA-256 清单位于 `build/local-packages/`。

以上没有运行真实 Claude 模型或安装器。Windows 浏览器检查不能替代 Mac 实机上的 Claude 登录、真实会话和 IDEA/JCEF 原生工具栏检查。本轮未提交、推送、打标签或创建 Release。

## 聚焦 Agent 的界面与本地安装流程（0.1.5，未发布）

插件改为聊天、聊天历史、Agent 配置与安装三个视图，移除项目列表、任务看板及独立文件/Git 管理面板。配置页优先展示 Codex、Claude Code 和已安装的 Agent，其他未安装项默认折叠。复用原有配置表单、命令会话和原生交互组件；没有修改 Agent 执行适配器或 SDK。

- 修复项目尚未加载时就能点击安装的问题：初始化期间说明正在连接当前 IDEA 项目，并禁用安装/更新。配置页显示 CLI 识别结果和具体错误，重启请求受理后继续通过原有状态事件更新卡片。
- 原来的列表刷新只读缓存，缺失 CLI 默认每五分钟检查一次；现在访问完整配置列表立即检查可执行文件是否存在。新增 Go 用例覆盖运行期间安装、移除，以及刷新保留原生模型、版本和运行错误。检查不启动 CLI 或模型。
- Mac 启动环境保留 shell PATH 优先顺序，并补充 `.local/bin`、`.hermes/node/bin` 和 Homebrew 目录；Windows 补充用户 `.local/bin` 与 npm 全局目录。目录尚不存在时也保留搜索路径，覆盖 IDEA 运行期间的新安装。Kotlin 用例验证路径含空格、优先顺序、去重、原环境不被修改，以及替身 CLI 的子进程查找。
- `node scripts/smoke-runtime.mjs` 通过：视图切换保留草稿、核心配置表单、已安装/未安装、连接错误、重启目标及失败重试、刷新错误恢复、历史回复/模型/推理强度/上下文元信息、375px/430px 和明暗主题。安装入口实际运行临时项目内的 `echo test-only`，验证流式输出、退出码 0、会话结束及重新打开配置页后的检测状态；不执行真实安装器、不写 Agent 配置、不调用模型。日志为 `build/reports/ide-workbench-smoke.log`，截图前缀为 `build/reports/ide-workbench-`。
- TypeScript 类型检查、原生默认配置与生命周期前端检查通过。定向 Go 的安装识别、IDE 本地接口、令牌环境及配置切换用例通过；日志为 `build/reports/ide-workbench-go.log`。
- `buildPlugin test verifyPluginProjectConfiguration verifyPlugin --offline` 通过：7 项 JUnit 测试零失败，IC/IU 2024.1、2024.2、2024.3 六个目标均 `Compatible`。日志为 `build/reports/ide-workbench-plugin.log`。
- 安装命令与 [Codex 官方文档](https://learn.chatgpt.com/docs/codex/cli)、[Claude Code 官方文档](https://code.claude.com/docs/en/setup)核对一致。真实下载、用户网络/登录及 Mac 上的 IDEA/CLI 运行仍需要本机验收；测试不代表这些外部步骤已完成。
- Windows、Apple Silicon、Intel Mac 三个最终 ZIP 在 `build/local-packages/`，SHA-256 清单为同目录 `SHA256SUMS.txt`。两个 Mac 包通过 Mach-O 架构检查，最低 macOS 为 12.0；各自 167 个共用文件均与通过浏览器检查的 Windows 包逐项 SHA-256 相同。报告为 `build/reports/macos-0.1.5-arm64-artifact.json` 与 `macos-0.1.5-amd64-artifact.json`。最后的界面折叠调整再次通过类型检查和打包浏览器检查，插件 JAR 没有变化。

本轮按用户要求仅保留本地代码和测试 ZIP，未提交、推送、打标签或创建 GitHub Release。

## Agent 管理入口（0.1.4）

同目录 MindFS 的 `FileTree.tsx` 已有配置添加、配置切换重启、安装更新弹层，本插件也保留了相同服务接口和 App 回调。本次补足默认收起侧栏时的可发现入口，增加识别状态及列表刷新，并让管理界面显示请求错误。

- 新增的打包浏览器检查先在旧前端失败，报找不到 `Agent management` 按钮；日志为 `build/reports/agent-management-red.log`。
- `node scripts/smoke-runtime.mjs` 通过。受控 `/api/agents` 和 `/api/agents/restart` 响应验证菜单入口、配置选择、重启目标与忙碌禁用、失败重试、识别状态，以及刷新确实重新请求后端、显示错误并可重试。接口保持原有形状；没有运行真实 CLI、安装器、配置写入或模型调用。
- 430px、375px 工具窗口及明暗主题检查通过，未出现页面未捕获错误或独立远程服务请求。截图为 `build/reports/agent-management-menu.png`、`agent-management-dark.png`、`agent-management-light.png` 和 `agent-management-375.png`；日志为 `build/reports/agent-management-smoke.log`。
- TypeScript 类型检查、`agent-lifecycle-restart.test.mjs` 和 `project-tree-refresh.test.mjs` 通过。前者的旧英文断言已更新为原有的 `Agent config switch & restart`，其余交互断言保留。
- 插件构建、5 项 JUnit 测试及项目配置检查通过；Plugin Verifier 对 IC/IU 2024.1、2024.2、2024.3 六个目标均返回 `Compatible`。日志为 `build/reports/agent-management-build.log` 和 `build/reports/agent-management-verifier.log`。
- 原生 CLI 及 Mac 实机验证边界仍见下文；新增入口复用原有后端，没有改动检测、进程重启或配置存储逻辑。

## macOS CLI 检测修复（0.1.3）

现场：Mac 终端通过 `/bin/zsh` 能找到 `~/.hermes/node/bin/codex` 和 `~/.local/bin/claude`，插件的 Agent 列表却为空。旧的 `ProcessBuilder` 只继承 IDEA 进程环境，没有使用 IDEA 恢复的 shell 环境；Go 的 `exec.LookPath` 因而可能判定 CLI 未安装，`/api/agents` 默认会过滤这些记录。[JetBrains 的环境加载说明](https://youtrack.jetbrains.com/articles/SUPPORT-A-1727)解释了桌面启动与终端环境的差异。

- `RuntimeProcessTest` 的两个回归用例在旧行为下均失败：子进程报 `The runtime did not inherit the terminal environment`，配置用例没有收到 shell 的 `PATH`。红色日志为 `build/reports/mac-cli-red.log`。
- 修复使用公开的 `EnvironmentUtil.getEnvironmentMap()`，为本地服务设置完整 shell 环境，再覆盖插件的数据目录、静态目录和本次访问令牌。不执行额外 shell 脚本，不硬编码用户安装目录，不改 Agent 权限或模型选项。
- 回归测试在包含空格的临时目录中创建 `.hermes/node/bin` 和 `.local/bin`，实际启动 Java 子进程查找并执行 Codex、Claude 和 Node 替身；测试同时验证 CLI 配置继承、插件专属环境覆盖和共享 shell 环境不被修改。没有调用真实 CLI 或模型。
- `test buildPlugin verifyPluginProjectConfiguration verifyPlugin --offline` 通过，5 项 JUnit 测试零失败，IC/IU 2024.1、2024.2、2024.3 六个目标均 `Compatible`。日志为 `build/reports/mac-cli-0.1.3-build.log`。
- 既有 `go test ./server/cmd/idea-agent -run '^TestIDETokenNotInherited$' -count=1` 通过，插件访问令牌仍在启动 CLI 前从环境移除。
- Windows 回归验证了环境传递和子进程查找；尚未在用户 Mac 上完成真实 IDEA 与 CLI 验证。若 IDEA 自身加载 shell 环境失败，仍需查看 IDEA 的 `EnvironmentUtil` 日志排查 shell 初始化。

## 原生能力修复（0.1.2）

问题清单及每项定向测试见 [native-agent-compatibility.md](native-agent-compatibility.md)。新增测试先复现了推理降级、隐式模型/权限覆盖、用户回答提前报告成功、重复回答阻塞、worktree 禁用以及编辑器内容截断，再验证修复结果。

会话记录的既有 `TestManagerMarkPendingAskUserAnsweredMergesAnswers` 在本轮暴露 Windows 临时 SQLite 清理失败，已为该测试添加 `Manager.Shutdown` 清理，原有答案合并断言保留。

定向 Go 测试、4 项前端协议/默认配置测试及 TypeScript 类型检查已通过。最终构建的 3 项 Kotlin 测试、六个 IDEA 2024 目标的 Plugin Verifier 和打包浏览器冒烟均通过；同一 ZIP 覆盖 IC/IU 2024.1、2024.2、2024.3，未出现未捕获页面错误或独立远程服务请求。

独立审查指出子会话事件并发和取消/答案接收交错两处问题；新增受控测试先复现后修复。同一独立审查者完成第二轮复核，代码候选树 `47d78c238eb2aad7f3f128187b4a4269814cc860` 通过，没有 unresolved 或新增 blocking/important；随后仅补充本验证记录。

最终 `test buildPlugin verifyPluginProjectConfiguration verifyPlugin --offline` 返回退出码 0，日志为 `build/reports/native-0.1.2-build.log`。最终安装包重新运行 `node scripts/smoke-runtime.mjs`，本地入口、Git 项目 worktree 按钮、上下文草稿、明暗主题、窄窗口、服务退出均通过。ZIP 包含第三方 Codex SDK 的 MIT 许可证。

## macOS 安装包（0.1.2）

- 从干净的 `v0.1.2` 提交 `3a02a6bb56740899675f4fcf38c82b600753cded`，在 Windows 设置 `GOOS=darwin`、`GOARCH=arm64/amd64`，分别执行 `buildPlugin --offline`。两次构建均退出 0；日志为 `build/reports/macos-arm64-build.log` 和 `build/reports/macos-amd64-build.log`。
- 两个 ZIP 各只包含对应架构的 `idea-agent-darwin-*`，没有残留 Windows 或另一架构的服务。解析 Mach-O 头确认 64 位可执行格式及 CPU，最低 macOS 均为 `12.0.0`；Go 构建信息确认 `CGO_ENABLED=0`、正确的目标平台和提交、`vcs.modified=false`。
- 每个包除平台服务之外的 167 个文件均与已发布 Windows 包逐项 SHA-256 相同，包括通过六个 IDEA 2024 目标兼容检查的插件 JAR、Web 前端、配置和许可证。未改动 Agent 实现。
- ZIP SHA-256：Apple 芯片包 `614e1c08ef5333e41e80ccf9ef680ce70265db46c9d399d63263967fd6ef7abf`；Intel 包 `c12bf91a90db7f3950b74ebb5df4478bfb620b112e62a91d4850d88e3b1d3f65`。
- 这是交叉编译和安装包静态校验结果，尚未在 macOS 上运行 IDEA、本地服务或真实 Agent。

## IDEA 2024 兼容性（0.1.1）

构建基线已从 IDEA 2025.3 降到 IDEA Community 2024.1（build `241.14494.240`）；插件最低 build 为 `241`。业务项目的 JDK 8 配置不受影响，插件使用 IDEA 自带的运行环境。

- `test buildPlugin verifyPluginProjectConfiguration` 通过，JUnit 2 项测试零失败。
- 用 IDEA 2024.1 自带的 JBR `17.0.10+8-b1207.12` 和其 Kotlin 标准库直接运行同一组 JUnit 测试，2 项均通过。
- 检查 ZIP 内的全部 14 个插件 class 文件，均未超过 Java 17 的 major version `61`；编译类的 Kotlin metadata 为 `[1,9,0]`，包内插件描述文件为 `since-build="241"`、版本 `0.1.1`。
- `test buildPlugin verifyPluginProjectConfiguration verifyPlugin --offline` 通过。JetBrains Plugin Verifier 1.410 对同一个 `idea-ai-agent-0.1.1.zip` 的六个目标均返回 `Compatible`，没有内部、实验性、弃用或待移除 API 使用报告。

| IDEA 版本 | 平台 build | 社区版 | 旗舰版 |
| --- | --- | --- | --- |
| 2024.1 | `241.14494.240` | Compatible | Compatible |
| 2024.2 | `242.20224.300` | Compatible | Compatible |
| 2024.3 | `243.21565.193` | Compatible | Compatible |

最终日志为 `build/reports/idea2024-verifier-supported-api.log`，逐目标报告在 `build/reports/pluginVerifier/`。这验证了插件的二进制/API 兼容性，实际 IDEA 窗口及 Agent 操作的验证边界见下文。

校验期间修正了两处问题：显示名称改为 `Local AI Agent` 以满足插件描述文件规则；启用 JVM 默认接口方法，避免 Kotlin 为 `ToolWindowFactory` 自动生成对内部方法的委托，并选用 `JBCefJSQuery.create(JBCefBrowserBase)` 公共重载。没有屏蔽校验项或降低失败级别。

Java 版本与平台版本对应关系、Kotlin 标准库选择依据见 [JetBrains 平台版本表](https://plugins.jetbrains.com/docs/intellij/build-number-ranges.html)和 [Kotlin 支持说明](https://plugins.jetbrains.com/docs/intellij/using-kotlin.html)。

## 已有功能验证

- Kotlin 编译、JUnit 地址及文件路径边界测试、插件 ZIP 打包。
- TypeScript 类型检查和 Vite 生产构建。
- Go 本地入口测试：子进程不继承 IDE 凭据；Host、Origin、Cookie 校验；项目管理限制及禁用的独立服务接口。
- 0.1.1 的项目绑定检查覆盖全部 worktree；0.1.2 恢复会话和任务 worktree，保留项目注册约束，测试检查两项工作隔离且不更换 IDEA 项目。
- 本地运行冒烟：中文和空格项目路径、清除旧项目注册、当前项目会话接口、静态资源、主进程关闭后退出。
- Chrome 无头浏览器：实际加载打包资源、编辑器上下文进入草稿、明暗主题同步、430px 工具窗口布局、无未捕获页面错误。使用空 Agent 配置，未发起模型请求，观察到的 Relay/远程配置服务请求为零。
- 原有 Agent、ACP、Codex 包回归；应用包回归跳过下述已复现的原仓库 Windows 失败项。
- `server/internal/api` 整包测试通过；`server/internal/kanban` 的 18 个测试在 Windows 清理临时 SQLite 文件时失败，详见下表。

## 原仓库已存在的失败项

以下失败均在未修改的同级 MindFS 仓库复现，未通过删除测试或修改原有功能隐藏：

| 测试 | Windows / 原仓库结果 |
| --- | --- |
| `TestLocalCLITokenStoreWritesSinglePrivateFile` | Windows 文件权限返回 0666，断言要求 Unix 0600。 |
| `TestAutoAddExternalProjectRootsSkipsGitWorktrees` | 外部项目路径测试得到 0 个根，期望 1 个。IDE 入口已关闭此自动发现。 |
| `TestClaudeProjectDirNameMatchesClaudeCodeOnDiskEncoding` | Unix 路径样例在 Windows 被转换为带盘符的路径。 |
| `agent-lifecycle-restart.test.mjs` | 源码文案已为 `Agent config switch & restart`，测试仍匹配旧字符串 `Switch and restart Agent config`。 |
| `server/internal/kanban` 的 18 个用例 | 清理临时目录时 `task-kanban.db` 仍被占用。以 `TestTaskCreateWorktreeIsTaskScoped` 在原仓库定向复现同样的清理失败；该包代码未作修改。 |

因此没有声称原仓库的完整测试套件全部通过。`session-list-merge.test.mjs` 已通过。

## 尚需实际使用验证

- 在真实 IDEA 的 JCEF 工具窗口中启动、关闭和重新打开项目；浏览器冒烟不能替代这一环节。
- 使用本机已登录的 Codex / Claude Code 完成一次真实写文件、审批、取消和历史恢复流程。当前验证没有调用付费模型，也没有更改本机 CLI 登录状态。
- macOS 的 IDEA 启动、服务退出及 Agent 实际运行；Apple 芯片和 Intel 安装包已完成上述交叉编译与静态校验。Linux 构建与运行尚未验证。

Vite 的上游大 chunk 与 `zod` 注释警告，以及 Kotlin 编译器对 1.9 语言级别的弃用提示未阻止构建。保留 1.9 语言/API 基线用于适配 IDEA 2024.1 的标准库。
