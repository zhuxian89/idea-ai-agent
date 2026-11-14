# 独立后端计划与进度

更新于 2026-11-14。新增内置 Antigravity CLI（源码与测试完成，未打包）。Windows 更新修复及相关回归通过，0.1.27 Windows x64 插件已重打并替换 GitHub Release，匿名下载校验通过；用户反馈“完美解决了”，本次实际更新故障验收通过。修复源码、测试与交接记录随本次提交同步至 `main`；全新 Windows 环境首次安装及自启动注册待实机验收。

## 内置 Antigravity CLI（2026-11-14，源码与测试完成，未打包）

Google Antigravity CLI（`agy`，ACP 协议）已作为内置 agent 加入 `runtime/agents.json` 末尾，与 codex 一样由项目提供，不开放用户自行添加；末尾位置不改变现有默认 agent。安装/更新命令取自官方脚本原文（下载核对，未执行）。图标、显示名、未登录时的"需要登录"识别已同步。

**验证范围（源码层）：** 新增 Go 4 条、前端 4 条回归；Go 全量、前端 314/314、`tsc`、`vite build` 通过；Kotlin 全量 99 条中 0 失败，4 条跳过（2 条需 Windows，2 条需升级运行时）；旧库迁移门禁通过。真实 `agy` 识别为已安装，未登录时 API 返回的 `error` 为 `Authentication required`，界面归类为"需要登录"。Windows 运行时 PATH 已补 `LOCALAPPDATA\agy\bin`。变异测试确认守卫与 Windows 路径断言会失败。

**既有失败（非本次引入）：** 设置 `IDE_AGENT_UPGRADE_TEST_RUNTIME` 后，`RemoteHostTest` 与 `RuntimeCacheTest` 各 1 条在未改动的 HEAD 上同样失败（测试临时可执行文件 `Permission denied`；插件包缺少 `idea-agent-darwin-arm64`）。本次未修复。

**独立后台 0.1.28（已发布）：** 源码提交 `038fe16` 已推送 `main`；GitHub [standalone-v0.1.28](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.28) 仅含 macOS arm64 包 `local-ai-agent-0.1.28-macos-arm64.tar.gz`（SHA-256 `3433caa6cf356aa58806c5a0b13c349e856bd73e38287f7888fa1dd2380acb02`），匿名下载校验一致。插件“检查更新”可从 0.1.27 升级到 0.1.28。其他平台未发布，仍为 0.1.27。插件 `0.1.27-local` 包内容已是最新，未出 local.2。

**安装包：** Mac 插件测试包 `build/local-packages/idea-ai-agent-0.1.27-local-macos-arm64.zip`（SHA-256 `76a2470967d760c3c6c545c27ff49904f92810bceb5d5d800b36472e2c85ccaa`），已生成，**未安装**到本机（IDEA 与 local-ai-agent 后台运行中，需用户确认）。Windows 包与独立包未生成。

**尚未完成：** 真实登录后的对话、工具调用与权限确认未验证；官方文档未给出登录步骤，未添加登录链接。实现与证据见 [implementation](standalone-backend-implementation.md#内置-antigravity-cli-接入2026-11-14源码与测试完成未打包)。

## Windows 更新修复（2026-11-13，已重打发布）

用户已授权重打 `0.1.27` Windows x64 插件并替换 GitHub Release 对应包。PowerShell 5.1/pwsh 下载回归 2/2、相关 Kotlin 回归 6/6（均无跳过）、kanban 全量、旧库迁移 race、类型检查、生产构建和插件配置检查通过；原生 5.1 下载真实 GitHub 后台包及 SHA-256 通过。完整安装用例首轮继承 PowerShell 7 模块路径，导致 5.1 缺 `Get-FileHash`；仅修正测试环境后复跑通过。

用户从后台 `0.1.26-standalone.13` 更新 `0.1.27`，页面显示 `Input length = 1`。本机 `remote/logs/install.log` 确认下载 GitHub ZIP 时，Windows PowerShell 报 `MaximumRedirectExceeded`；插件再按 UTF-8 读取 GBK 错误日志，解码异常覆盖了下载错误。失败在下载阶段，尚未调用包内安装器替换后台。

源码已改为直接读取 HTTP 响应处理跳转，保留逐跳 HTTPS 检查与五次请求上限；Windows 启动命令在加载安装脚本前设置 UTF-8。完整任务差异正确性与兼容复核 `Review: PASS`，包含测试环境和 Windows SQLite 连接清理修正；code-simplifier 检查无进一步简化。

Windows x64 新包仅换入新构建插件 JAR，322 个 ZIP 条目、143 个 class、版本和 PE 架构通过核对，其余内容（含 304 个网页文件及运行程序）逐字节保持一致。JAR 其他资源差异仅为换行和构建环境元数据。SHA-256：`8d1c18752f1c4ad8bed605311fe01e8b9be77a7b080c4c030e1a0ae18dcd6094`；报告 `build/reports/windows-0.1.27-package.json`。

GitHub `v0.1.27` 的 Windows x64 ZIP 与 SHA256SUMS 已替换，原生 Windows PowerShell 5.1 匿名下载两资产并核对本地字节和 SHA-256 通过。其余 4 个 ZIP 的资产 ID、哈希与更新时间均保持原值，Release 标题仍为 `0.1.27`；报告 `windows-0.1.27-release-verification.json`、日志 `windows-0.1.27-public-plugin.log`。用户已确认 Mac 实测正常，并确认安装[新 Windows x64 包](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.27/idea-ai-agent-0.1.27-windows-amd64.zip)后本次更新故障解决。首次安装共用同一下载与日志修复，临时包回归覆盖下载、校验、解压、安装记录和延后启动参数；真实首次自启动注册尚待新环境实机验收。实现与原始失败见 [implementation](standalone-backend-implementation.md#windows-27-插件重打与发布2026-11-13已发布)。

## 全部源码同步（2026-11-13）

全部 197 个工作区改动文件（含原 11 个未跟踪文件）已提交为 `fd897a2`；远端安装入口提交 `5718d70` 已正常合并，`0b95c3a` 已推送 main，原本地 8 个提交全部保留。前端类型检查与 Git 空白检查通过。本轮同步源码与交接资料，未重新打包；已发布标签和程序包保持原样。

## 当前交付：0.1.27

插件与独立后台统一 `0.1.27`，已发布至 GitHub，未发布插件市场。未代操作真实安装或重启。

- [插件包](https://github.com/zhuxian89/idea-ai-agent/releases/tag/v0.1.27)：Windows x64/ARM64、Mac Apple Silicon/Intel 及通用 ZIP，共 5 包。
- [独立后台与安装脚本](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.27)：Windows/macOS/Linux x64 与 ARM64 六平台；macOS/Linux 另有单文件安装器，Windows 和 Unix 均提供固定版本在线脚本。
- [Windows x64 插件直接下载](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.27/idea-ai-agent-0.1.27-windows-amd64.zip)。本地目录 `build/releases/0.1.27/` 和 `build/standalone/0.1.27/`。

首次发布时：310 项前端、97 项 Kotlin、Go 后端全量、11 项安装脚本及两项旧库必检通过；11 个程序包的 304 网页文件一致，5 插件包的 142 个 class 一致；架构、版本、指南与安装器一致性、原生 ARM64 签名通过。30 个公开资产匿名 HTTP 200 且 SHA-256 与本地一致；前端和新旧插件真实查询类在六个平台均发现 `0.1.27`。报告 `build/reports/release-0.1.27-*.json` / `.log`。本次 Windows x64 重打后的验证与 class 变化见顶部记录。

旧插件和后台过渡测试 Release 共 11 个、本地过渡文件或目录共 84 项已删除；保留市场正式版本 `0.1.26` 及更早包，28 个本地正式文件哈希未变。GitHub 旧测试标签作为源码引用保留，测试安装包与 Release 已删除。用户要求所有发布标题只显示版本号，历史与新版本统一整理；包和更新说明保留。

独立模式网页来自后台，需在远程设置升级后台至 `0.1.27` 才能显示最新界面。Windows 实机安装升级及本版真实 IDEA 接入仍由用户验收。此前 `.26/.18`、`.16` 等版本是历史验证记录，相关过程和证据保存在 implementation；下载入口已统一到本版本。

## 市场历史版本补录（已完成）

用户明确市场历史序列为 `0.1.20–0.1.26`，日期分别为 2026-09-15（.20/.21）、09-17（.22）、09-19（.23）、10-29（.24/.25）、11-01（.26）。GitHub 原先缺 `.24/.25`，现已按各自发布提交补录，两版各 5 个原始 ZIP 与原 SHA256SUMS 保持一致，12 个公开资产匿名 HTTP 200/哈希一致。7 个版本的市场日期写入说明，标题仅版本号；GitHub 自身显示本次归档的上传时间。`0.1.27` 继续作为最新版，未发布市场。报告 `build/reports/market-history-*.json` / `.log`。

## 固定安装入口修正（已完成）

固定入口已发布到 main（提交 `5718d70`），macOS/Linux：`https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/install.sh`；Windows：同目录 `install.ps1`。每次运行自动读取 `scripts/standalone/version.txt`，目前为 `0.1.27`；指定版本参数仍可使用。后续发布后台时同步发布该版本元数据，用户安装/升级命令保持不变。

在线附件默认锁版已移除并更新 `.27` 的两脚本及各自校验文件（4 资产）；固定 URL/版本标记均匿名 HTTP 200 且与源码一致，4 在线资产 HTTP 200/哈希一致。12 项安装脚本测试无跳过，覆盖 Shell/PowerShell 同一脚本连续读取新版本；真实固定入口均选中 `.27` 并下载、校验、解压真实 Mac ARM64/Windows x64 包，最后安装调用用桩截断，未操作本机服务。证据 `build/reports/stable-installer-*.json` / `.log`。指南和 Release 说明已使用固定地址。

此前 main 仅发布入口脚本、版本元数据与指南 4 文件；本轮将其他源码、打包器去锁版与测试补充一并提交并同步，状态见顶部源码同步记录。

## 已确认的约束

- 独立优先只作用于远程模块。远程停止、启动失败或认证失败，只影响远程功能；插件界面、聊天和其他本地功能继续工作。
- 一个多项目入口，继续使用当前界面和动态表情。关闭 IDEA 后仍可通过现有 Relay 使用。
- 未安装独立版时保留原插件内置后端。独立版可选安装，远程面板检测服务后提供一键安装入口。独立版只提供后台程序和脚本安装升级，不增加桌面应用或图形安装器。
- 聊天与附件原位读取，保留项目 `.mindfs` 和 home 元数据、旧远程清单、Relay 绑定及历史配置。同一目录只注册一次。
- 聚焦当前功能，不恢复钱包、充值或任务看板。

## 本轮版本调整记录

最初按沿用 Mac `.26` 和后台 `.18` 补其他插件平台；四包生成后用户改为统一 `0.1.27` 全平台交付并清理过渡包，已按最新指示完成。首次全量前端测试因执行目录错误出现 ENOENT，改在 `runtime/web` 复跑 310/310；详细过程见 implementation。

## 当前实现

### 生命周期隔离问题核对（2026-11-12）

- 最新现场：已按用户要求执行 `-stop`，Gateway 原 PID `79110` 退出、`host.json` 移除；Core 同一 PID `78880`、状态接口 HTTP 200。用户随后反馈插件表现正常，停止远程的真实插件验收通过；升级和卸载仍未验证。本轮按要求提供 `.15` 供用户自己从插件升级。
- 两条必须同时成立：IDEA 关闭后远程仍可聊天；独立远程停止、升级或故障不影响 IDEA 本地聊天。用户明确禁止擅自升级，不使用子代理；本轮仅诊断和更新交接文档。
- IDEA 在独立模式直连 Core。普通 `-stop` 只停 Gateway；Shell/PowerShell 安装器另调用 `-stop-core`，`-unregister` 也停止 Core 并移除两端自启。因此普通远程停止与升级/卸载的影响不同。
- 本机 Core/Gateway 均通过 `/control/status` 确认为 `.14`，PID 分别为 `78880` / `79110`；卸载未完成。本轮没有安装、卸载、降级、重启或改动生产源码，保留用户的面板升级测试环境。
- 建议保持唯一会话写入进程，将聊天运行时的程序资源、启动和更新归属与可选远程包分开；远程生命周期不管理聊天进程。需要修订安装目录、运行中版本保留和卸载规则，不能只删停止命令或更名。
- 上一轮提出的“按项目抢锁、IDEA 使用时远程禁止发消息”未获批准，也不是满足两条要求的必要条件。现有会话缓存与序号计算使跨进程轮流写入需要额外设计，本轮不引入该方案。
- 证据和待验证场景见 [implementation 的生命周期核对](standalone-backend-implementation.md#远程与本地聊天生命周期核对2026-11-12)。

### 侧栏与会话菜单实施（2026-11-12，源码和验证完成）

用户已确认 `docs/design/remote-workspace-v1/preview.html` 并要求开始实现。按菜单服务接入、侧栏结构与样式、真实交互验证三个步骤推进。中间聊天区布局与样式保持原样；本轮源码和验证状态独立记录，安装包仍为 .23/.13。

- 两侧项目/会话主名称统一 13px，子代理名称 12px、辅助信息 11px；项目分组默认展开，运行子代理默认展开，结束组默认收起，选中子会话及运行中的嵌套分支保持可见。保留分页、搜索和原会话操作。
- 菜单新增复制 ID/日志路径、接力包、当前会话定时任务；接力包追加已有草稿，错误原位显示。固定会话调度兼容旧 JSON，已删除的绑定会话执行时报错，不创建替代会话。
- 23 项相关浏览器用例、类型检查、生产构建及 scheduled/api/usecase/api 三个 Go 包通过；日志路径保护路由另有运行测试。双主题 8 组侧栏文字均达到 4.5:1，手机抽屉互斥及定时任务弹窗层级通过。
- App 的 main 属性、输入区全部 style 属性与全局 CSS 和实施前一致。本轮新增文件已显式 Git 跟踪；未打包、安装或重启当前后台。报告：`build/reports/remote-workspace-implementation-checks.json`，截图：`output/playwright/remote-workspace-implemented/`。

### MindFS 会话菜单复用核对（2026-11-12）

- [源码对比结果](session-menu-reuse-review.md)：置顶/同步/重命名/删除已具备；可移植复制 ID、复制日志路径、会话接力包和当前会话定时任务。后两项需配套日志路径接口、草稿追加或固定会话调度支持。
- 本轮为可行性核对，生产组件和预览未修改。中间聊天区布局与样式保持原样。

### 远程工作区双主题设计预览（2026-11-12）

- 最新预览已统一项目名和主会话名为 13px、普通 500/选中 600 字重；分组及子代理名 12px。1600/1100/390px 下字号一致，中间计算样式和位置不变，双主题截图已更新。

- 用户要求中间聊天区保持原样；已在预览中补充 4 个运行中、3 个完成子代理的紧凑列表。右侧项目及运行列表默认展开，完成列表默认收起，支持手动折叠。中间 DOM、计算样式及位置一致；本轮 13 项定向浏览器检查通过，生产组件未改。

- 预览位于 `docs/design/remote-workspace-v1/preview.html`，整理左右侧栏并提供浅色、深色、系统主题；生产界面未修改。
- [预览说明与设计图](../../../docs/design/remote-workspace-v1/README.md)已完成。1600×1000 桌面及 390×844 手机的双主题、菜单与侧栏已检查；搜索、折叠、选中、模型选择、系统主题、减少动态效果和离线打开通过。
- 已修正浅色选中行时间文字对比度；每种主题检查 11 组文字颜色，最低为浅色 4.79:1、深色 4.94:1。生产样式未改，安装包版本不变。

### 远程网页样式评估（2026-11-12）

- 按用户指定的 ui-ux-pro-max 检查 .13 实际网页，覆盖 390px 手机和 1440px 桌面深色布局。正文 15px/26.25px 已可读，优先改进小触控按钮、输入区图标辨识、手机导航及消息辅助信息层次。
- [评估与优化顺序](remote-web-style-review.md) 已按用户桌面截图修正：模型菜单、工具折叠和项目分组已经具备，保留现有布局；优先考虑小字对比度和大屏阅读宽度，手机触控单独评估。生产样式未修改。
- 用户继续要求检查左右侧栏后，已补充专项方案：优先右侧会话分组、行布局和子会话展示，再统一左侧项目导航、标签及选中状态。运行中子会话保持可见，保留三栏与动态表情；建议不再局限于字号。

### Mac 本机后台升级（2026-11-12）

<!-- mac-backend13-status -->本机后台 .13 已运行；重复执行的临时更新任务已移除。14:05:56–14:08:09 连续 121 次检查无错误、无 Relay 断连，Gateway/Core PID 保持不变。插件仍为 .13，正式登录自启正常。

- 用户选择“先只更新后台”，IDEA 插件维持本机 `.13`。此前正常退出 IDEA 返回“用户已取消”，CUA 返回 `cgWindowNotFound`，插件文件未替换。
- macOS 插件 `.23` 已生成，97 项 Kotlin、两项旧库必检、304 网页文件、26 表情和 ARM64 架构通过；该包尚未安装或发布。后台使用已发布并验证的 `.13`。
- 旧后台、插件与配置备份在 `~/Library/Application Support/LocalAIAgent/upgrade-backups/20261112-local23-135529/`。当前 Codex 由旧 Core 启动，因此交给独立进程停止、安装、启动和检查；结果写入 `build/reports/mac-backend13-live-upgrade.json`。
- 此次 `launchctl submit` 临时更新任务未在完成后注销，被系统重复执行，反复调用 `/control/stop`。已移除 `dev.ideaagent.upgrade.backend13.1794463174`，核对无遗留 updater 进程；正式 Core/Gateway 登录自启保持启用。此前转发 API 的 Relay 观测不准确，本轮使用 Gateway `/control/relay-status` 确认连接。

### 远程面板与检查更新（2026-11-12，`.23/.13` 已发布）

- 首页只显示当前项目、二维码、访问操作与设置；运行方式、后台版本、项目、暂停访问与折叠维护进入设置。首次检测、安装、重启续接与未启动状态沿用真实流程。
- IDEA 内的独立后台版本行始终保留“检查更新”，进入设置自动检查 GitHub Releases；有新版可点“更新并重启”，检查失败与安装失败原位显示。旧后台网页使用简洁原生入口，新网页不显示外部更新横幅。
- 初次安装及更新不再固定目标版本，按数字版本与当前系统选择含包及校验文件的 Release，包含现有 standalone 测试 Release。浏览器直接使用独立版时，也能检查版本和查看新版；自动下载安装仍由 IDEA 提供。
- 最终前端 31 项、相邻入口 9 项，Kotlin 97/97（0 跳过）、Go 远程/独立状态定向、类型检查及生产构建通过。中文/英文、深浅色、375px/桌面截图与旧网页原生窄屏检查完成。
- Windows 插件 `.23` 和六平台后台 `.13` 已发布至 [测试 Release](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.26-standalone.13)。打包前两项旧库必检通过；7 包的架构、304 个网页文件、26 个动态表情和安装脚本核对通过。26 个资产匿名 HTTP 200，字节及 SHA-256 与本地一致。
- 从最终 Windows 插件提取的真实版本查询类已通过公网发现 `.13`，并判断 `.12` 可升级；前端选择器对公开 Release 响应在六个平台均选中 `.13`。
- 证据：`build/reports/remote-v3-*`，截图 `output/playwright/remote-access-implemented/`。新增实现文件已显式 Git 跟踪。本机真实 IDEA 与后台未更新；Windows 原生完整升级待验收。

### 远程访问 HTML 原型（2026-11-12，预览完成）

- 单文件预览位于 `docs/design/remote-access-v3/preview.html`，可离线打开。首页只展示项目、二维码与访问入口；设置集中运行方式、检查更新、项目与故障排查。
- 可切首次使用、已连接、未启动、启动失败、网络中断与暂停状态；安装、登录、升级为明确标注的模拟操作。服务未就绪时不展示访问入口，从设置返回或切换项目仍保留原故障状态。
- Playwright 验证安装到登录、版本更新、暂停恢复、模式切换、项目链接与二维码、关闭重开及故障恢复；1160px 深色与 375px 浅色截图已检查，无横向溢出，最终控制台无错误或警告。截图在 `output/playwright/remote-access-v3/`。
- 当前交付为设计预览，生产 UI 与 Release 检测未改动，未生成新包。

### 本轮修改串到后续回答（2026-11-12，源码与验证完成）

- 截图的 15 文件、+187/-42 对应历史 seq=271；下一轮 seq=273 落盘为 12 文件、+290/-23，并未保存重复 diff。
- 前端 `buildBaseTimeline` 用消息条数推算没有 seq 的流式回答，历史编号存在缺口时会取到上一轮的辅助记录。真实会话去重后 269 条对应最后 seq=271，新回答被推算成 271；已改为只按消息自带的持久化 seq 关联历史辅助记录。
- 修复前两项单元回归和浏览器回归均复现重复卡片；修复后 39 项定向回归全部通过、0 跳过，涵盖连续多轮、流式多段回答、无修改轮、后续新修改、刷新历史及相邻消息功能。类型检查和生产构建通过，日志与真实历史回放证据为 `build/reports/turn-diff-ownership-*`。
- 新浏览器测试已显式 Git 跟踪。修复已纳入 .22/.12 并发布；本机正在运行的服务未更新。

### 本轮修改修复包（2026-11-12，`.22/.12` 已发布）

- [Windows x64 插件 .22](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.12/idea-ai-agent-0.1.26-local.22-windows-amd64.zip)、[macOS ARM64 插件 .22](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.12/idea-ai-agent-0.1.26-local.22-macos-arm64.zip)。独立 .12 六平台包与固定版本安装入口一同发布。
- 39 项前端定向回归、95 项 Kotlin、两项旧库检查、类型构建通过；8 包的架构、304 个网页文件、26 个表情和安装源一致；28 个 Release 资产匿名 HTTP 200、逐字节与 SHA-256 一致。报告 `turn-diff-packages.json`、`turn-diff-public-assets.json`。
- 用户随后要求收简界面和动态检查 Release。当前包仍为固定 .12 升级目标；后续先完成新方案再发插件，Windows IDEA 完整升级仍待实机验证。

### 插件内更新（2026-11-12，`.21` 已发布）

- [Windows x64 插件 .21](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.11/idea-ai-agent-0.1.26-local.21-windows-amd64.zip)。远程入口读取已安装程序版本，较旧时在插件原生区域显示“更新并重启 IDEA”；旧后台网页也能使用，不依赖远程服务运行状态。
- 点击后调用同源安装器下载校验、升级和启动后台 .11，成功后正常重启 IDEA 并回到原项目远程设置；无需终端或手动解压。更新会重启后台，界面提示先完成当前回复。失败显示详情与重试，下载校验失败保留旧版；同版或更高版不下载、不降级。
- Kotlin 95/95、0 跳过，更新与原生按钮行为、两项旧库检查、类型检查和生产构建通过。中英文窄宽 Swing 离屏预览完成，Windows IDEA 完整点击更新重启流程待实机验证。
- ZIP 与校验文件已匿名 HTTP 200 下载，字节/哈希一致。包内 .11 安装源、原生更新类/入口、304 个网页文件及 26 个表情资源核对通过；报告 `in-plugin-update-{package,public}.json`，日志 `in-plugin-update-*.log`。新增源码与测试已显式 Git 跟踪，工作区未提交。

### Windows 服务启动与面板状态（2026-11-12，`.20/.11` 已发布）

- 用户日志确认远程入口等待 Core 超时，Core 后续持续返回 API 200。已在 PowerShell Legacy 模式复现空参数丢失，真实 Core 因 `open --notify-script` 退出；改为 `--agent-config=<值>` / `--notify-script=<值>`，空值可正确传递。超时错误指向 core.log。
- 远程服务未运行时显示“启动服务”和启动详情，健康后再显示连接/绑定入口。启动错误在未就绪期间保留，Windows 长路径自动换行。
- [Windows x64 插件 .20](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.11/idea-ai-agent-0.1.26-local.20-windows-amd64.zip)；[独立后台 .11 PowerShell 入口](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.11/install.ps1)。新装面板固定 .11；已有 .10 用脚本升级，保留原安装目录、项目和聊天记录。
- 安装器 11/11（含 Legacy 模式真实 Core 启动、健康检查与停止）、Kotlin 94/94、远程面板最终 9/9、CLI/backend/race、两项旧库检查、类型检查与生产构建通过。新增 PowerShell 用例首轮把控制接口 mode 当成描述符 mode，修正断言后通过。本轮未重跑前端全量。
- 六平台包、304 个网页文件、26 个表情资源、原生架构、安装脚本和版本核对通过；26 个 Release 资产匿名下载 HTTP 200、与本地字节和 SHA-256 一致；公网原 PowerShell 默认 .11 入口定向测试 1/1 通过。报告 `remote-start-{packages,public-assets}.json`，日志 `remote-start-*.log`。Windows 原生启动、IDEA、计划任务和重启登录待复验。

### 安装后的下一步（2026-11-12，`.19` 已发布）

- 已安装、选择已保存但尚未切换时，显示“重启 IDEA 并继续”和“稍后重启”。正常重启 IDEA 后，原项目自动打开远程设置；其他项目不消费续接标记，只续接一次。
- Kotlin 94/94、远程面板 9/9、Bridge 17/17、两项旧库必检、类型检查与生产构建通过。Bridge 首次因执行目录错误未运行，改为从 `runtime/web` 执行后通过；本轮未重新跑前端全量。
- [Windows x64 插件 .19](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.10/idea-ai-agent-0.1.26-local.19-windows-amd64.zip) 已发布至现有 `.10` prerelease，ZIP 与校验文件匿名下载 HTTP 200、逐字节与 SHA-256 一致。322 项、304 个网页文件、26 个表情资源、Windows x64 PE、续接代码和同源安装脚本核对通过。独立安装源继续使用已发布 `.10`。
- 日志与报告为 `build/reports/restart-continue-*`。Windows 原生 IDEA 重启续接待实机验证。

### 面板检测与一键安装（2026-11-12，`.18/.10` 已发布）

- [Windows x64 插件 .18](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.10/idea-ai-agent-0.1.26-local.18-windows-amd64.zip)。选择独立服务时检测安装/运行状态，已安装复用；未安装直接点按钮，插件后台运行同源安装脚本，显示安装中与错误，支持失败重试。
- 安装器下载校验后登记程序与登录自启，保留当前聊天，不启动第二个数据服务。安装完成保存独立偏好，全部 IDEA 退出后重启应用选择；随后才展示远程连接、测试及二维码。使用方式收为一行，点“更改”返回选择。
- Windows/macOS/Linux x64 与 ARM64 的 `.10` 安装资产均已发布；插件从固定版本下载。在线 `install.ps1` 和 `install.sh` 也固定 `.10`，macOS/Linux 提供单文件离线 `.sh`。
- Kotlin 93/93、安装器 10/10、远程面板最终 9/9、类型构建、旧库必检和真实 macOS launchd 生命周期通过。前端全量首轮 299 通过，1 子用例及其父测试因状态切换瞬时定位失败；调整为先等待旧控件隐藏后，远程面板 9/9 通过。
- 26 个资产匿名 HTTP 200、字节/哈希一致。公网原 PowerShell 固定版本/延后启动参数测试通过；公网原 Shell 在隔离 HOME 中实际下载并安装 macOS ARM64 .10，创建两个自启配置、未启动数据/远程进程，注销清理通过。Windows EXE、IDEA 和计划任务仍待 Windows 实机测试。
- 报告 `build/reports/one-click-{packages,public,public-native-installer}.json`；日志 `one-click-*.log`。当前真实安装与远程诊断未操作，新增源码/测试已显式 Git 跟踪。


### 首次选择与重启切换（历史 `.17/.9`）

- [Windows x64 插件 .17](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.9/idea-ai-agent-0.1.26-local.17-windows-amd64.zip)；[独立版 .9 PowerShell 安装脚本](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.9/install.ps1)，支持 x64/ARM64。
- 首次打开远程面板确认内置/独立服务，之后随时保存修改。保存保留当前页面和聊天，退出全部 IDEA 后再启动应用选择；其他 IDEA 实例仍在使用时保持当前模式。
- 切回内置会停止独立两端、移除登录自启并保留安装记录；切回独立恢复自启和后台。按物理目录复用原项目身份和元数据位置。远程设置失败只在面板显示，本地仍可启动登录。
- 未安装独立版时显示安装指引，Windows 复制正式 .9 命令。安装前退出 IDEA；脚本在数据锁空闲后认证停止仍驻留的内置入口，不再等待其 30 秒空闲退出。
- 前端全量 301/301，远程面板补充回归 9/9；Kotlin 全量 92/92、0 跳过；Go 后端全量、相关 race/vet、Windows 目标 vet、安装脚本 7/7、固定 .9 入口定向与两项旧库必检通过。macOS 隔离 launchd 验证两种方式的停启和自启移除/恢复；未操作真实本机安装。
- 包内 304 个网页文件、26 个表情和 Windows PE 核对一致。8 个资产匿名公网 HTTP 200、字节/哈希一致。报告 `build/reports/backend-mode-{packages,public}.json`，日志 `backend-mode-*.log`。源码未提交，本轮新增源码/测试已显式加入 Git；Windows 原生 IDEA、计划任务与重启登录待实机测试。


### Windows 配套插件（历史 `.16`）

- [Windows x64 插件正式下载](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.8/idea-ai-agent-0.1.26-local.16-windows-amd64.zip)，配套独立版 `.8`。IDEA 使用“从磁盘安装插件”选择 ZIP；插件 Windows 安装命令指向已发布的 `.8` 正式 URL，浏览器测试验证了实际复制内容。
- 包含当前独立后端接入、远程故障隔离、缓存保留等 review 修复，以及当前网页资源。
- 本轮前端全量 301/301、Kotlin 88/88，0 失败、0 跳过；类型检查、生产构建、插件配置、kanban 全量与旧库迁移 race 通过。打包测试使用当前源码编译的本机 runtime，未运行 Windows IDEA。
- ZIP 322 项、Windows x64 PE、304 个网页文件和 26 个表情核对通过。ZIP 与校验文件已匿名公网下载，HTTP 200、与本地产物字节和 SHA-256 一致。报告 `build/reports/windows-local16-{package,public}.json`，日志 `windows-local16-*.log`。

### Windows 自动安装与正式测试入口（历史 `.8`）

- 正式入口：[https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.8/install.ps1](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.8/install.ps1)。PowerShell 运行 `irm <该地址> | iex`，自动选择 x64/ARM64，下载校验、解压、沿用原目录安装或升级、配置当前用户登录自启并启动后台。
- Core/Gateway 分别由计划任务管理，异常退出后恢复；停止远程保留 Core。原地安装也先停止两端，升级保留端口与原数据。
- 安装/任务脚本 7/7、补充默认目录全新安装、CLI/backend race/vet、Windows 目标 vet、两项强制旧库迁移检查通过；前端类型检查与构建、包内入口和项目添加浏览器 8/8 通过。
- 两种架构的 ZIP/PE、304 个网页文件和 26 个表情资源已核对。6 个公开资产匿名请求均为 HTTP 200，与本地产物逐字节一致，SHA-256 一致。公网下载回的原脚本在 PowerShell 中通过默认版本、下载、校验和安装调用测试（使用隔离测试包）。
- 本机为 macOS：安装行为使用真实本机 Go CLI，计划任务 cmdlet 使用替身，Windows 原生 EXE/任务注册/重启登录仍待用户实机测试。报告 `build/reports/windows-standalone8-{package,public,release}.json`，日志 `windows-installer-*.log`、`windows-login-regression.log`、`windows-standalone8-*.log`。
- Release 为 prerelease，标签指向远端 main `6d6d9e8`；测试产物来自本地 `b426c37` 工作区的未提交改动，发布说明已注明。仅发布独立版资产，当前真实服务未替换。

### macOS 常驻与单文件安装（2026-11-12，已验证并打包）

- 一次运行 `.sh`，自动解压、识别安装目录、停止旧进程、替换程序、注册用户 LaunchAgent 并启动。后续升级运行新版脚本即可。
- Core/Gateway 分别由 launchd 管理。登录后自动启动，异常退出恢复；手动停止远程会保持停止，本地 Core 继续运行。注销删除两端自启配置。
- 真实 launchd 回归覆盖两端 SIGKILL 恢复、端口保留、手动启停、升级、原地安装、按登录方式加载保存的作业和注销；CLI/backend race、vet 通过。
- Shell/PowerShell 安装测试 5/5、两项强制旧库检查通过。`.7` 单文件包在临时 HOME 中完成新装、真实 `.6` 升级及重复升级，端口和原数据保留。
- 已移除桌面应用与 DMG；`.7` 提供 `.sh` 与 tar.gz。报告 `build/reports/macos-standalone7-installer.json`；日志 `login-service-*.log`。
- 本轮验证使用隔离安装，未重新启动用户电脑或替换当前服务；macOS 按用户登录自启。此段是 `.7` 的 macOS 验证；Windows 后续状态见上节。


### 远程频繁重连排查（2026-11-12）

- **17:14 用户要求停止采集，排查暂停。** 17:12 重开的诊断代理 PID 69554 已退出，Core remote 原入口 127.0.0.1:51477 已恢复；该轮未收到浏览器诊断，未要求继续刷新。Core/Gateway 原 PID 不变、控制接口和远程页面均为 200，页面已不注入脚本。根因尚未定案，当前没有运行中的诊断任务。
- 17:08 复核完整采样，已捕获 13:06:25 的真实前台主动关闭：探测等待 2000 ms，未记录前台线程延迟；对应 ping 未到达 Core 观测边界。故障期间同一条本机连接的原生控制心跳持续正常，页面随后尝试 39 次连接、约 170 秒后恢复。故障范围缩小到 Core 之前的传输链路，本机连接器与其上游尚待区分；不能定案为 Core 业务处理卡顿。证据 `build/reports/reconnect-incident-review-20261112.json`。
- 首轮临时代理于 13:18:44 自动恢复原入口并退出；退出导致当时的代理连接重建一次，约 2 秒后恢复。现运行的是其他升级工作安装的 `.13`，14:18、14:24、15:39 仍有远程关闭日志，不能宣称早上的偶发问题已修复。仍缺本机连接器流接收与转发边界的分段证据，按用户要求停止继续采集；云端不改动。
- 用户确认一直在前台，08:56:40 刷新仅暂时恢复；新页面 09:07 起再次断连，09:12–09:14 多次复发，截图与日志已保存。Core/Gateway 自 07:30 持续运行。旧页面 15 次关闭符合“3 秒探测 + 2 秒超时”的节拍，直接触发路径强烈指向前端探测超时，延迟来源待确认。
- 按用户要求自行诊断，09:18:44 已接入临时本机观测代理，未重启 Core/Gateway。工具位于 `scripts/diagnostics/reconnect/`，保持原连接参数，记录前端探测、主动关闭、页面线程延迟及 Core 两个方向的心跳。用户 09:22 刷新后，手机端诊断已加载；正常浏览器往返约 320–350 ms，Core 约 0.2 ms，捕捉到前台线程延迟约 1.2 秒，尚待与真实断连对应。
- 历史代理 PID `1476`，采样窗口为 09:18:44–13:18:44；日志 `~/Library/Application Support/LocalAIAgent/remote/diagnostics/reconnect-20261112T091844/events.jsonl`，启动信息 `build/reports/reconnect-observer-live.json`。停止与恢复方法见工具 README。原描述符备份仅当前用户可读；云端无改动。
- Go 转发与日志隐私测试/race、到期/停止/新 Core 描述符保护三项验证通过；Playwright CLI 验证正常连接、迟到回复、前台线程阻塞及刷新上传通过。未修改产品连接行为、未生成新安装包；根因尚未确认。

### Review 修复（2026-11-12，源码与验证完成）

- 四项修复已完成：缓存清理保留活进程所用目录，进程退出后可回收；旧项目按物理目录复用原 ID、路径和元数据位置；PowerShell 使用源包 CLI 依次停止 Gateway/Core 再替换程序；旧单进程分支、冗余模式开关和专属状态已删除。
- 目录身份共用逻辑放在 26 行的 `fs/root_identity.go`，安装行为测试单独放在 `scripts/standalone/package-install.test.mjs`。缓存策略留在 `RuntimeCache`，生产文件 147 行；没有扩展 `app/server.go` 承载这些职责。
- 最终 Go 后端全量、相关 race/vet、两项强制旧库迁移通过；Kotlin 强制复跑 88/88、0 跳过；Shell/PowerShell 安装 5/5、0 跳过；Windows x64 交叉编译通过。PowerShell 包内测试在 macOS 使用真实本机 Go CLI，完整 Windows EXE 运行仍待 Windows 环境验证。
- Kotlin 首轮定向 11 项中 1 项失败：复制的系统 `sleep` 被 macOS 终止，未进入缓存断言；改为真实 Core 后通过。修复与日志见 [修复记录](../../issues/2026-11-12-standalone-review-fixes/standalone-review-fixes-fix-note.md)。本轮未提交、未重新打包或更新本机安装，当前 `.15/.6` 包不含修复。

### 整体 review（2026-11-12，四项发现已修复）

- 已按全局与项目 AGENTS 审查未提交的独立后端功能，覆盖 Core/Gateway、IDEA 接入、旧数据、前端与安装升级。报告见 [独立后端整体审查](../../audits/2026-11-12-standalone-backend-review/index.md)。以下为审查时发现与验证，后续修复见上一节。
- 两条 P1：插件缓存淘汰会删除活 Core 所用的程序和网页；旧注册表保存 alias 路径时，再打开真实路径会登记成两个项目。两者均在临时环境复现。
- 两条 P2：Windows 安装到新目录会漏停旧 Gateway，却停止 Core；生产代码仍保留无调用的旧单进程 Standalone 分支。Windows 脚本路径已静态确认，其后续 CLI 状态在 macOS 真实进程中复现为“显示运行中、浏览器 503”；完整 Windows 安装未执行。
- 本轮 Go app/backend/remotehost/独立 CLI/kanban 五包通过，强制旧库迁移 race 通过；安装测试 3 通过、1 PowerShell 跳过。日志与探针见 `build/reports/standalone-review-*`。本轮未重跑前端、Kotlin 全量，原版本的通过记录保留其原有范围。

### 项目添加入口恢复（2026-11-12，源码与验证完成）

- 按用户要求恢复当前仍支持的空白项目、本地目录选择、GitHub 导入；补回 Windows 盘符和路径输入。IDEA 内继续由 IDE 管理项目。
- 首轮前端全量在沙箱内执行为 130 通过、53 失败，失败包含 Chrome Mach 端口权限拒绝和监听端口 `EPERM`；沙箱外复跑被会话中断，未取得最终结果。初版定向浏览器 3/3、类型检查、生产构建及目录/独立模式后端定向检查通过。
- 补查确认首次添加项目时没有聊天 WebSocket，GitHub 导入改用任务状态查询；功能恢复时前端全量 301/301（含项目添加浏览器 7 项）、类型检查、生产构建、相关 Go 模块全量及无 WebSocket 导入 HTTP/race 测试通过。
- 生产构建的实际 App 已确认空项目列表中的三个入口可用，390px 目录弹窗深浅色与空白项目表单检查通过，无横向溢出；页面 API 使用隔离数据。说明已更新到 `docs/standalone.md`。日志见 `build/reports/project-add-*.log`，截图见 `output/playwright/project-add-*.png`。
- 本次未重新打包；已有 `.15/.6` 包不包含本次恢复。
- 按用户可维护性要求，将目录浏览和 GitHub 导入拆成独立组件，主组件由 279 行降为 115 行，目录组件 111 行、导入组件 87 行；合并本地/空白项目的登记请求，移除目录数据的冗余转换。拆分后类型检查、项目添加浏览器 7/7、生产构建及 diff 检查通过；上述 301 项与样式截图属于拆分前验证。复验日志为 `build/reports/project-add-refactor-*.log`。

独立版由两个职责明确的进程组成：

| 对象 | 职责与生命周期 |
| --- | --- |
| 本地数据服务 `core.json` | 复用现有多项目 AppContext、会话和 UI，持有排他 `backend.lock`。IDEA 直接连接；远程入口启停不更换其令牌、不终止会话。 |
| 独立远程入口 `host.json` | 管理 Relay、浏览器入口和远程启停，持有 `host.lock`。通过认证的内部连接转发到本地数据服务，不直接写项目历史。 |
| 插件启动 | 按保存的使用方式选择；未确认时有独立安装则默认独立，否则内置。独立模式用插件携带的程序启动或复用本地数据服务，不依赖远程入口状态。 |
| 远程面板 | 错误、忙碌状态和启停结果在面板内更新，保留 JCEF 页面。断开时显示启动按钮。 |
| 端口 | 记录上次实际绑定地址；启动、重启沿用该地址，显式 `-addr` 优先。 |
| 更新与卸载（已确认缺陷，待修订） | 当前安装更新停止两端以替换程序，`-unregister` 停止两端并移除安装记录，会中断本地聊天。普通 `-stop`/`-restart` 只控制远程。 |

旧设计中“IDEA 主界面直接连接远程入口，远程不可达就阻止插件启动”的约定已作废。源码和配套包必须一起升级；`.3` 仍是把本地数据与远程入口放在同一进程的旧测试版。

## 取消额外配对，兼容现有 Relay

- 浏览器不再握手、索取配对密钥或请求项目访问授权；远程链接直接指向节点/项目。
- 云端协议与现有服务保持原样，不影响其他客户端。当前 Relay 的登录保护列表和绑定，节点地址可直接访问已开放项目；本地进程间管理令牌与写入排他锁保留。
- Go 后端全量、相关 race/vet、Relay 云端全量与相关 race、两项强制旧库迁移检查通过。Kotlin 87/87，0 跳过。新包真实 HTML 已通过普通节点/项目/本地入口验证，304 个网页文件一致，签名与 DMG 完整性通过。`.6` 包内脚本在临时环境完成全新安装、真实 `.3` 升级及重复升级，原目录、端口与数据保留；报告 `build/reports/macos-standalone6-installer.json`。前端全量最终复跑 294/294，0 失败、0 跳过。
- 首次全量前端发现旧发布入口测试仍要求配对，现已更新；另有一次表情减弱动画截图比较失败，单独复跑 13/13 通过。证据见 `build/reports/relay-login-*.log` 和 `relay-login-package.json`。
- 用户明确云端不能更新，已撤回 mindfs/cloud 的全部四项修改；无云端部署前提。`.6` 已重打包；首次安装因旧 OpenCode 清理超过停止时限中止，确认旧进程退出后继续安装。

## `.5` 安装体验验证（历史，图形入口已取消）

- DMG 双击安装器；包内安装脚本复用原安装目录，更新后自动启动，安装 `~/Applications/Local AI Agent.app`。
- 应用窗口提供打开界面、启动远程、停止远程按钮；关闭窗口保留后台服务。
- 临时 HOME / 发现目录中完成全新安装、真实 `.3` 升级、重复升级；自定义目录、旧端口、项目元数据保留；停止远程后本地 API 可用。
- CLI 测试、race、vet 通过；Shell 安装测试 3 通过，PowerShell 1 跳过（本机未安装）。两项强制旧库迁移检查通过。
- Swift 优化编译、ad hoc 签名校验、DMG 完整性、包内资源核对通过。本机无 Developer ID，测试包未公证。
- CUA 多次返回 `cgWindowNotFound`；诊断构建确认 AppKit 窗口已创建且可见。实际按钮点选尚未完成，不能记为 GUI 流程通过。
- 上述临时环境验证证据见 `build/reports/simple-installer-*.log`、`build/reports/macos-standalone5-installer.json`；本机真实升级另见下一节。

## 本机真实升级（2026-11-12）

- 按用户要求使用已校验的 `.5` 压缩包内 `install.sh`，将 `/Users/hongweizhang/Applications/LocalAIAgent` 中的 `.3` 升级为 `.5`，安装 `~/Applications/Local AI Agent.app`，保留 `http://127.0.0.1:7441`。
- 首次安装在停止旧服务时超过 10 秒：旧服务等待 Cursor ACP 子进程清理。确认旧 PID 已退出、描述符删除及锁释放后，再次执行原脚本成功；未修改程序源码或重新打包。
- 远程入口 PID `31367`、本地数据服务 PID `31368` 的实际运行版本均为 `.5`，加载原安装目录的程序。两端网页登录、健康检查、项目列表和会话 `1794228634-8aa7dc4189ca` 读取通过，Relay `connected=true`。
- `projects.json`、`registry.json`、Relay 与浏览器身份文件、指定会话文件的升级前后 SHA-256 一致。升级前配置备份在 `~/Library/Application Support/LocalAIAgent/upgrade-backups/20261112T065050`。
- 本轮重新执行两项强制 kanban 旧库迁移检查，均通过；安装后的应用签名校验通过。
- 用户从 Relay 首页点击节点后出现配对引导。已核实公网身份与旧配置一致，使用现有配对密钥经真实 Relay 完成 E2EE 握手并解密读取 3 个项目；此为旧配对链路的历史验证，随后用户明确取消该流程。证据：`build/reports/relay-browser-authorization-20261112.json`。
- 本机 IDEA 插件仍为 `0.1.26-local.13`，配套 `.14` 尚未安装；IDEA 接入待验证；原生按钮验收已随管理应用移除而取消。完整证据：`build/reports/standalone-live-upgrade-20261112T065050.json` 与同名 `.log`。

## `.14/.4` 回归基线

| 检查 | 结果 |
| --- | --- |
| 真实 CLI 进程 | 远程重启、关闭、端口冲突、错误令牌期间，本地登录、会话读写、Agent 列表和原 WebSocket 连接可继续使用；端口保持、旧数据读取及注销通过。 |
| Relay 集成 | 临时 Relay + WebSocket/yamux → 新远程入口 → 数据服务；旧书签跳转、E2EE 握手和项目查询通过，远程控制接口被拒绝。 |
| 前端 | 299/299 通过，0 跳过；远程面板定向 9/9 通过，包含启停状态、错误显示及保持同一对话框。 |
| Kotlin | 87/87 通过，0 跳过；包含真实 LocalRuntime 在远程安装程序缺失、描述符损坏/删除时的启动和重连。最终包验证通过，0 失败、0 跳过。 |
| Go 全量 | 首轮任务调度用例执行次数断言失败；定向复跑 5 次及 `go test -p 2 ./server/... -count=1` 全量复跑通过。相关最终 CLI 与 Relay 用例通过。 |
| Go race / vet | app、backend、remotehost、api、独立 CLI 的 race 通过；相关 vet 通过。 |
| 旧库升级 | `go test ./server/internal/kanban -count=1` 和 `go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1` 均通过。 |
| 安装脚本 | 2 通过、1 跳过；本机没有 PowerShell。 |
| 真实 IDEA 安装新版 | `.14/.4` 回归阶段未操作真实服务；2026-11-12 已完成独立版 `.5` 本机升级，IDEA 配套插件 `.14` 仍待安装验证。 |

日志均位于 `build/reports/remote-isolation-*.log`。具体命令和失败记录见 [implementation](standalone-backend-implementation.md)。

## 安装包

当前仅使用顶部链接的 `0.1.27` 插件与独立后台。校验和见 [SHA256SUMS.txt](SHA256SUMS.txt)，安装步骤见 [独立服务指南](../../../docs/standalone.md)。历史过渡包已按用户要求清理，历史验证证据继续保留。

## 未提交代码审查（2026-11-12）

对工作区全部未提交改动做了审查（Go 后端与远程、Kotlin、安装脚本与前端分别审，发现逐条对着代码核实，不直接采信子代理的严重度）。

**用户已确认的决定，不再作为缺陷：**

| 决定 | 说明 |
| --- | --- |
| 远程经 Relay 不再端到端加密 | 用户故意改的。`server.go` 的共享核心不再装载 E2EE，测试断言“无需浏览器配对”。**README 与 `docs/standalone.md` 若仍写“端到端加密”需要改正，尚未处理。** |
| 远程浏览器可添加任意目录 | 用户已确认。 |
| Core 与 Gateway 拆成两个进程；插件在独立安装不可用时用自带程序启动本地核心 | 用户已确认。 |

**本轮已修复（均先写复现、再修、再做变异检查）：**

| 问题 | 修复 | 验证 |
| --- | --- | --- |
| `installation.json` 指向已删文件时，插件无法重装（在下载前就抛错退出） | `StandaloneInstaller.kt` 新增不抛异常的 `isInstalled`，首次安装的早退改用它 | `StandaloneInstallerTest` 新增陈旧记录场景；换回原写法则失败 |
| 重复 `-install` 把 launchd / 计划任务里的自定义启动参数重置为默认 | `login_service_darwin.go` 读回已保存的 `ProgramArguments`；`login_service_windows.go` 读回任务 JSON 的 `Arguments`。仅 gateway 任务；core 参数固定 | `login_service_args_test.go`（darwin）；去掉读回分支则失败。Windows 仅交叉编译与 vet，**未在 Windows 实机运行** |
| CLI 带相对路径启动托管服务，launchd 工作目录不同导致指向错误位置 | `cli.go` 新增 `resolveUserPaths`，把 `-agent-config`、`-notify-script`、项目目录在入口处转为绝对路径 | `cli_paths_test.go`；`cli_relative_path_darwin_test.go` 用真实二进制与临时 HOME 读回 plist，去掉修复则失败，并确认临时 launchd 任务已卸载 |
| 下载脚本允许重定向到 HTTP（校验和随压缩包一起走，降级后可被篡改） | `install.sh` 增加 `--proto =https --proto-redir =https`；`install.ps1` 逐跳检查重定向目标 | 用本地重定向服务实测：加限制后 curl 报 `Protocol "http" disabled (in redirect)`，不加则跟随；PowerShell 辅助函数在生产模式下拒绝 http 地址。真实 GitHub 下载经核对为 HTTPS→HTTPS 一跳，不受影响 |

安装脚本的 HTTPS 限制只在没有设置 `LOCAL_AI_AGENT_DOWNLOAD_BASE_URL` 时启用；设置该变量是测试用的显式本地覆盖。

**核实后不修或暂缓：**

| 问题 | 结论 |
| --- | --- |
| `-stop-core` 与 Core 启动之间的极窄竞态（`core.json` 尚未发布时误报停止成功） | **试修后撤回。** 缺陷属实（我写了复现并确认失败），但直觉上的修法——`core.json` 缺失时等待数据锁——会让“切回内置模式”卡住 10 秒：内置项目进程持**共享锁**，同样会让它阻塞（已用探针实测）。要正确修需要一个能区分“Core 正在启动”和“内置进程持共享锁”的信号，例如 Core 在拿数据锁之前先写一个启动标记。这超出“好修就修”，暂缓，复现测试保留在 `/tmp/stop_test.go.held`。 |
| 更新中途失败后重试误报成功；`install.sh` 无回滚（`rm -rf web` 后复制失败会留空目录） | 用户决定**放到后面，另订方案**。方向：装到临时目录并校验后原子替换。 |
| 远程准备两条命令合计可超过本地启动 45 秒超时 | 用户决定不处理。 |
| 本地界面在共享核心下的 Relay 状态 | 已确认**不是缺陷**：用探针实测，本地请求返回 `bound=false no_relayer=true`，远程请求返回网关的真实状态；本地面板的远程状态来自 `/api/idea/remote`，`no_relayer=true` 在本地页只会隐藏公网入口按钮，而独立本地页的该按钮由 `standaloneLocal` 单独控制。 |

**回归结果（本轮修复之后）：** Go 全套通过，`vet` 与 `gofmt` 干净（`agent/claude`、`agent/codex`、`tlsutil` 三个文件的 gofmt 问题在 HEAD 即存在，与本轮无关）；`-race` 在 `app`、`cmd`、`backend`、`api` 通过；两条强制旧库迁移检查通过；Windows 交叉编译通过。Kotlin 97/97，0 跳过（用 IDEA 自带 JBR 21，设置 `IDE_AGENT_UPGRADE_TEST_RUNTIME`）。前端 319/319。安装脚本测试 4/4，**含此前一直被跳过的 PowerShell 用例**（本机下载便携 PowerShell 7.5.4 到 `/tmp/local-ai-agent-pwsh/` 运行，未安装到系统）。

**尚未审查：** 侧栏改造的主体 `SessionList.tsx`（约 700 行删改，需逐项核对置顶、重命名、删除、多选、搜索、子会话展开等是否被无意丢掉），以及 `install.sh`/`install.ps1` 的版本参数与 `rm -rf` 目标保护、`HandoffPackDialog`、GitHub 导入前端、`bootstrap.ts`。负责这部分的子代理在上一个会话中途被停止，本轮已重新启动，结果出来后补记。

## 下一步

0. Antigravity 内置接入：在已登录的 agy 上验证 `session/new`、对话、工具调用与权限确认；决定是否打包，打包后核对安装包内 `agents.json` 含 antigravity 条目。另：`RemoteHostTest`、`RuntimeCacheTest` 在设置升级运行时后的既有失败待升级链路负责人处理。
1. 用户从 GitHub 安装 `0.1.27` 插件，在远程设置自行升级后台到 `0.1.27`；验证 Windows 实机安装、插件升级和最新界面。
2. 聊天运行时与远程包资源归属的生命周期修订仍待确认，当前升级仍会停止共享 Core；普通停止远程已由用户实测通过。
3. 真实后台和插件的安装、升级与重启继续由用户操作，不用手动脚本绕过面板升级验收。

## 接手约定

先读本入口，再读 [checklist](standalone-backend-checklist.yaml) 与 [设计](standalone-backend-design.md)。每个步骤和失败都同步记录；代码、测试、包、发布分别报告。

保留用户的会话设置改动：`SessionViewer.tsx`、`useSessionStream.ts`、locale 与 `sessionSettingsChange` 服务和测试；不动 `.lithe/`，不使用 `git add .`。新增源码和测试须显式加入 Git，防止 `commit -a` 漏掉依赖。
