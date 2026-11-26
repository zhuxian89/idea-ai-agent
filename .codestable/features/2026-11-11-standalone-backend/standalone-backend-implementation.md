# 网页直接更新独立后台（2026-11-20）

浏览器确认更新后，独立后台另起进程运行固定在线安装脚本，传入页面上确认的版本。Linux 的 systemd 服务使用独立的临时单元，Windows 使用一次性计划任务，macOS 使用独立进程。安装脚本负责下载、校验、安装和重启。后端保存更新状态与安装日志，页面重连后读取新版本并刷新。既有 Relay 节点链接沿用节点访问规则，跨站网页不能通过浏览器提交更新。旧版 0.1.52 需要先用固定安装命令装入同版新包，后续新版本才有网页更新入口。

Go 更新状态机竞态、API、服务和 Relay 测试通过，Kanban 旧库全量与迁移竞态通过。前端类型检查、生产构建及 13 项更新回归通过。联调发现 Relay 会改写 Origin、首屏读取更新状态早于初始化、重启断开后会自动跳转节点列表。已修复并在 macOS ARM64 最终包通过真实隔离 Relay 桌面和手机视口复测。覆盖摘要校验失败、原服务持续运行、网页重试、重启重连、新版显示及刷新循环。

Linux x64 在 Ubuntu systemd 完成 API 触发更新并保留原端口。Windows x64 在真实 PowerShell 5.1 完成包内安装、失败恢复和计划任务触发的自更新。两种架构均通过包和脚本检查。[最终包 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44768700115)

2026-11-21 同版发布。从干净提交 `5282f85` 构建六平台包，延续原 Release 与标签，替换 20 个变更附件。24 个公开附件匿名回读逐字节一致。用公开固定安装命令把隔离的旧 0.1.52 升级到新构建，端口保留，更新接口可用。旧附件、日志和校验记录在 `build/reports/release52-web-update/`。

# 公网扫码与独立版版本显示（2026-11-18）

0.1.40 的公网页面沿用了需要请求本机 `/api/idea/remote` 的弹窗。经 Relay 访问时该接口返回 404，左下角的版本查询也因此失败。

公网页面直接用当前浏览器地址生成二维码，保留节点、项目与会话路径。弹窗仅显示二维码和关闭按钮。独立后台将运行中的版本号写入 HTML，前端直接读取。本机页面仍通过原有远程访问弹窗处理登录、绑定和设置。

Chromium 回归在节点路由验证了版本文本、二维码内容和关闭行为，确认未请求管理接口。远程访问与网页编辑回归 13 项通过。Go API、app 回归，网页类型检查与生产构建，以及 Kanban 旧库全量和迁移竞态检查均通过。

[macOS 0.1.41 测试版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.41)从 `e9890f8` 的干净克隆构建，两架构均为 `vcs.modified=false`。核对了两个压缩包与自解压安装器的摘要、架构、安装脚本、网页资源和内嵌归档。ARM64 最终包在临时 HOME 新装并绑定隔离 Relay，验证了节点页版本、二维码内容、网页 JS/CSS 的实际 HTTP 200、同包升级及升级失败后恢复原端口。首轮隔离浏览器启动未找到临时 HOME 下的 Chromium，指定现有 Chromium 缓存路径后通过。8 个公开附件均匿名下载并逐字节核对，公开固定入口显式安装 0.1.41，检查了本机 HTML 版本和 JS/CSS 并注销临时服务。默认安装仍为 0.1.39，0.1.41 预发布只含 macOS 附件。证据在 `build/reports/release41-macos/`。

## 独立后台 0.1.41 正式发布（2026-11-18）

用户确认 macOS 测试版可用后，将同一标签转为[正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.41)。沿用 macOS 两架构的原附件，从相同干净提交 `e9890f8` 补齐 Linux、Windows 和在线入口。24 个附件逐字节比对与 SHA-256 通过；包内脚本、文件架构、305 个网页资源及自解压归档均通过。Kanban 旧库全量和迁移竞态复跑通过。

Linux ARM64 和 x64 在隔离 Alpine 容器验证新装、升级、故障后恢复原端口和文件。公开固定入口在 Linux ARM64 容器和临时 macOS HOME 下显式安装 0.1.41 通过。Windows x64 的最终包在真实 Windows PowerShell 5.1 验证首次安装、计划任务注册、升级与故障恢复。Windows 下载工作流验证实际公开包和 SHA-256。Windows ARM64 核对了架构、归档和相同的包内脚本。[Windows 安装包 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44326559566) · [公开下载 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44327017495)

源码快进合入 `main`，默认安装版本通过 `689383d` 升为 0.1.41。公开入口连续返回新默认版本后，下架 0.1.39 和 0.1.40，保留源码标签。仓库 latest 仍指向插件 v0.1.27。验证记录在 `build/reports/release41/`。

# Linux 安装后显示绑定链接（2026-11-18）

Linux 包内安装脚本在后台启动成功后调用已安装程序的 `-bind`。新节点的绑定 URL 是终端最后一行，已有绑定显示节点 URL 与状态。延迟启动跳过绑定。单独的绑定步骤失败时仍保留安装成功状态，并输出原始错误和带实际路径的重试命令。

Debian 13 ARM64 隔离 Relay 验证了新装显示 URL、等待确认时再次查询取得相同链接、完成绑定后重装显示原地址、暂停节点保持暂停、延迟安装与禁用 Relay 的行为。第一次验证遇到 systemd 拒绝安装路径中的单引号；修复 ExecStart 的可执行文件启动方式，并支持重装时替换先前无法加载的 unit。包含单引号的路径与从 0.1.37 原位升级均已通过最终包验证。

正式构建提交 `b3f823e`。旧库全量和迁移 race 通过；两个 Linux 架构的 305 个网页资源、程序版本、源码提交、10 个公开附件及固定入口显式选版下载均已校验。默认正式版仍为 0.1.35。记录在 `build/reports/release38-linux/`。

## 安装代码审查（2026-11-18）

用户在 Linux 真机确认 0.1.38 自启动。审查的 7 项问题已在源码修复，每项先写能复现的用例，确认在旧代码上失败再修；未打包、未发布。

| 问题 | 修复 | 验证（隔离目录/临时 HOME） |
|---|---|---|
| 升级中途失败，旧后台不再启动；复制中途失败还会留下半个安装 | `install.sh`、`install.ps1` 先把新文件复制到 `.upgrade` 暂存，成功后逐项移动到位；失败时清理暂存并用安装目录里的程序重新启动后台 | Shell 用例在旧脚本上失败、新脚本通过；macOS 与 Linux busybox `sh` 复现“缺文件→旧网页和程序不变、调用序列 `-stop -stop-core -no-browser`”；PowerShell 7.4.6（macOS）同样通过 |
| 首次安装注册失败后再装提示“已安装” | `-install` 在服务注册成功后才写安装记录；延迟启动的首次安装失败时脚本删除刚复制的程序 | macOS 用例（`~/Library` 为文件时注册失败，无安装记录）；Shell 与 PowerShell 失败后重试用例 |
| Linux 重装丢失上次保存的代理和 API Key | 重装时环境里缺少的变量沿用环境文件中的旧值，环境里有的以新值为准 | Linux ARM64 容器内运行 `TestLinuxServiceReinstallKeepsSavedEnvironment` |
| 新增：安装记录不再先创建数据目录，Linux 首次安装写环境文件会失败 | 写环境文件前先创建数据目录 | Linux ARM64 容器内 `TestLinuxServiceFirstInstallCreatesDataDirectory` |
| macOS/Windows 升级后 `-no-browser` 覆盖已保存的网关参数（如 `-no-relayer`） | 无命令行覆盖项的普通启动沿用已注册的参数，三个平台一致 | macOS 通过真实 CLI 与 launchd（临时 HOME）的 `TestPlainStartKeepsSavedGatewayArguments`，旧代码失败；Windows 仅编译与 vet 通过 |
| Windows 下载脚本清理临时目录失败会盖掉真正的安装错误 | 清理改为 `-ErrorAction SilentlyContinue` | 源码改动，未单独复现 |
| `-Prefix` 以反斜杠结尾可绕过用户目录保护；插件读安装日志遇非 UTF-8 字节会抛解码异常 | 比较前去掉末尾反斜杠；日志按替换字符解码（`installLogTail`） | 日志用例已加并通过；反斜杠只改源码，macOS 上的 PowerShell 不识别 `\` 路径，未单独复现 |

回归：Go `cmd`、`backend`、`remotehost` 包通过，Windows 与 Linux 交叉 vet 干净；`scripts/standalone` 下 Shell、PowerShell 和延迟安装用例共 12 项通过；Kotlin `StandaloneInstallerTest` 通过。

**未验证**：Windows PowerShell 5.1 没有运行过修改后的 `install.ps1` 和 `download.ps1`，按 AGENTS.md 在真实 5.1 验证前不得替换公开附件。Linux 真机 systemd 没有复跑修改后的环境文件与暂存逻辑。没有生成安装包，修复内容不在任何已发布版本里。`StandaloneRelease.kt` 取“全部 Release 中最高版本”，Linux 预发布 0.1.36 至 0.1.38 会被 Linux 上的插件视为可更新版本，而脚本默认仍是 0.1.35，是否保留待用户决定，本轮没有改。

## 独立后台 0.1.39 正式发布（2026-11-18）

三个平台统一升到 0.1.39，包含安装审查的全部修复，已作为[正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.39)发布，标签指向提交 `a37b956`。`scripts/standalone/version.txt` 改为 0.1.39，两条固定安装命令不指定版本时默认安装 0.1.39；仓库的 latest 标记仍留给插件发布 v0.1.27，既有 Windows 工作流依赖它。随后按用户要求只保留这一个独立后台发布：0.1.35 至 0.1.38 的 Release 已下架，发布前的元数据快照在 `build/reports/release39-withdraw/`，Git 源码标签保留。0.1.39 的发布说明写明了 macOS、Linux、Windows 的安装、升级、Linux 绑定和手动安装方式。公开包从该提交的独立克隆构建，程序构建信息为 `vcs.modified=false`。先前工作区构建的本地测试包作废。

| 包 | SHA-256 |
|---|---|
| `local-ai-agent-0.1.39-linux-amd64.tar.gz` | `94d87b1c350a56eed385ddff43a8fecfec410463bc60165366789cc2520aaa72` |
| `local-ai-agent-0.1.39-linux-arm64.tar.gz` | `3aa72223264a8a3a28398df4781c9c8b6126ca4b995ca4e93aaad6e0762ea158` |
| `local-ai-agent-0.1.39-windows-amd64.zip` | `5710b0fab41364b3db843f993cc377b729424970e06d10b4cb7f775afbe183e9` |
| `local-ai-agent-0.1.39-windows-arm64.zip` | `49f091149c15e6d5d501d7fc0a71e103249d926fd2686388a008ed4e46ff7ef6` |
| `local-ai-agent-0.1.39-macos-arm64.tar.gz` | `9d4df228e4cb8648988e18ebbe448057e665fc3972c075de9f00c165d1710a8b` |
| `local-ai-agent-0.1.39-macos-amd64.tar.gz` | `866e9b22af4750517e811f3a4636e436be1916bfaa9bcfd933c0ace2ce785d36` |

**核对**：24 个公开附件匿名重新下载，与构建产物逐字节一致，12 个校验文件通过；架构、包内脚本与源码一致、PowerShell 脚本 BOM、305 个网页文件、无 `/mindfs-assets/` 引用、四个自解压安装器内嵌归档均已检查；公开的 `download.ps1` 与源码一致。

**Windows PowerShell 5.1（GitHub Actions，windows-latest）**：新增 `Windows standalone package` 工作流和 `scripts/standalone/verify-windows-standalone-package.ps1`，下载草稿发布中的 Windows x64 包并核对 SHA-256，在 5.1 下用真实 `local-ai-agent.exe` 运行包内 `install.ps1`：首次安装、计划任务注册、重复首装被拒、`-Prefix` 以反斜杠结尾的用户目录被拒、升级后服务运行、缺文件的升级失败后恢复原服务且无暂存残留，全部通过。既有 `Windows installer` 工作流在同一提交上通过（5.1 下验证 `download.ps1` 与真实下载）。

**公开入口端到端**：macOS arm64 通过固定在线入口 `--version 0.1.39` 在临时 HOME 新装并再次升级，端口不变，注销后 launchd 无遗留。macOS、Linux 失败升级恢复此前分别在临时 HOME 和 Alpine 容器验证。

**未验证**：真实 Windows 机器上的登录自启（CI 只验证了任务注册与服务启动）和 Windows ARM64、macOS amd64、Linux amd64 的实际运行（只核对了架构）；Linux 真机 systemd 没有用 0.1.39 复跑开机自启。插件检测升级取所有发布中的最高版本，Linux 预发布 0.1.36 至 0.1.38 也会被当作可更新版本，是否改成只取正式版仍待决定。

# Linux 服务器开机自启（2026-11-18）

源码提交 `7f18b85`，Linux 0.1.37 预发布。root 安装使用系统级 systemd，普通用户使用用户服务与 lingering。二者分别托管 Core 与网关，异常退出后独立恢复。普通用户缺少 lingering 授权时输出管理员命令。未运行 systemd 时安装器说明状态并继续原有后台启动。

Debian 13 ARM64 隔离虚拟机用正式 0.1.36 包绑定本地测试 Relay，再用最终 0.1.37 包原位升级，保留路径和端口。关机再开机后，普通用户状态为 lingering，四个服务均为 enabled、active。测试 Relay 在新 boot ID 收到原节点 WebSocket，随后查询显示 connected。还验证了终止 Core 或网关后各自恢复、手动停止保持停止、重启与重复安装保留参数、注销清理注册，以及挂载命名空间隔离下的无 systemd 后台启动。第一次核对无人登录时，测试误将 systemd manager 会话当作用户登录，随后检查 logind 的 State=lingering，确认没有交互登录。

后台与 CLI 回归、旧库全量与迁移 race、网页类型检查、生产构建通过。干净 checkout 交叉编译两种架构，核对 ELF、版本、源码提交、配置与每包 305 个网页文件；10 个公开附件匿名下载，逐项核对 SHA-256。固定入口显式指定版本在两个模拟架构完成下载校验；ARM64 最终包另在上述真实 Linux 虚拟机安装运行。证据位于 `build/reports/linux-service/` 和 `build/reports/release37-linux/`。

# Linux 独立后台 0.1.36 测试版（2026-11-18）

基于源码提交 `a2929f3` 从干净 checkout 交叉构建 Linux amd64 与 arm64。旧库 Kanban 全量及迁移 race、Go API 全量与配置导入导出专项 race、网页类型检查及生产构建通过。解包核对 ELF 架构、嵌入版本、Go 源码提交、安装器、Agent 定义，以及两个包各 305 个网页文件。单文件安装器内嵌 tar.gz 与公开压缩包一致。

[预发布](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.36) 的 10 个附件匿名下载 HTTP 200，逐项比对本地和 GitHub SHA-256。固定在线安装入口指定 0.1.36 后在两个模拟 Linux 架构下完成真实下载、校验和解包，安装步骤由测试桩接管。默认正式版仍为 0.1.35，真实 Linux 安装与功能验收待用户测试。验证记录位于 `build/reports/release36-linux/`。

# 导入 Agent 备份后直接切换（2026-11-18）

## 按 Agent 导出当前配置（2026-11-18）

- 文件侧栏提供「导出 Agent 配置」和「导入 Agent 配置」。导出页只列出已安装的 Agent，支持多选。只有一个时默认选中，多个时由用户选择。下载完成关闭导出页。
- 后端读取选中 Agent 的当前文件和该 Agent 的环境配置。Codex 支持 config.toml、auth.json、配置引用的供应商密钥变量、环境请求头，以及本机 CODEX_HOME。所有条目使用已有 v1 归档格式。没有可导出内容时指明 Agent，整次请求不生成残缺文件。旧版分类导出接口和归档导入仍可使用。
- Go API 全量、导入导出 race、前端类型和生产构建通过。390 px Chromium 通过两个隔离 Core 及项目路径转发实测多选 Codex 和 Claude、下载一个 JSON、导入并切换，核对目标配置及测试凭据；单 Agent 预选、空归档报错通过。证据位于 `build/reports/current-agent-export/`。
- 默认 WebKit 在本机项目转发测试中勾选 Agent 超时。关闭 Service Worker 后，多选导出、导入、切换及凭据核对通过。手机 Safari 默认环境仍待验收。
- 全量前端回归 327/331 通过，失败项在 HEAD 基线上复现，涉及会话滚动测试及远程入口测试临时目录中的 favicon.svg。首次运行缺少 Playwright Chromium headless shell，补齐后重新执行。当前改动尚未打包发布。

用户报告目标节点导入成功后「暂无可切换配置」。用 0.1.35 最终包复现空备份归档导出和导入均返回成功，以及非空 Codex 备份导入后在 Claude 切换页为空。切换接口按 Agent 查询。本次证据来自隔离归档，用户原文件内容待核对。

导入成功返回实际备份的名称、ID 和所属 Agent。页面可直接打开对应 Agent 的切换页并预选备份，缺少该 Agent 时显示安装提示。导入的备份在用户确认切换后才写入配置文件。无备份可导出或文件只有空备份时显示明确提示。

窄屏 Chromium 经项目路径转发连接两个隔离 Core，确认真实备份导入后能直接选中，完成切换后目标配置文件与环境变量均已写入。目标缺少 Agent 和空归档场景通过。Go API 全量与导入导出竞态、前端类型与生产构建、相邻浏览器回归通过。记录在 `build/reports/config-transfer-backups/`，源码待发版。

# 独立后台 0.1.35 正式发布（2026-11-18）

从干净的源码提交 `85bbb41` 构建 macOS、Windows 和 Linux 的 x64 与 ARM64。24 个公开附件重新下载返回 HTTP 200，逐项核对包内资源、SHA-256 与 GitHub 摘要。固定安装入口在六个平台拉取并校验 0.1.35，安装环节由隔离桩接管。现有插件与网页的更新检查均找到 0.1.35。

Go API、Core 与 Relay 相关回归、旧库全量与迁移竞态、前端和安装器测试通过。最终 Mac ARM64 包在本地和转发入口各核对 87 项实际网页资源，窄屏 Chromium 使用两个隔离后台验证实际导出、导入、取消和确认覆盖。

标签推送触发的自动验证曾尝试下载尚未公开的 0.1.35，返回 404。正式候选流程核对 Windows 双架构包、x64 程序版本和公开 0.1.34 安装下载，发布后真实 Windows PowerShell 5.1 下载并验证 0.1.35。两次验证均通过。[候选验证](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44288729185) [公开验证](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44288991565)

0.1.34 Release 已下架，抽查原下载地址返回 404。发布后重新核对网页与现有插件的更新发现。证据位于 `build/reports/release35/`。

# Agent 配置导出与导入（2026-11-18）

复用 MindFS `060f507` 的对话框、`mindfs-user-config` v1 格式及文件写入与回滚流程。文件侧栏可导出和导入 Agent 配置备份、API 供应商资料、API Key、自定义 Agent 和 Shell。API Key 和自定义命令由用户主动勾选。MindFS 归档可选择其中的 Agent 相关配置。

无重复时直接写入，有已有项时先返回是否需要覆盖确认。确认后合并新配置并覆盖匹配项，取消时不会发送第二次写入请求。导入的 Agent 备份可在「Agent 配置切换」中使用，配置文件目的地按目标用户的主目录解析，切换前显示目标路径供确认。自定义 Agent 和 Shell 导入后重启后台生效。

Go API 全量、配置导入导出竞态回归、前端类型检查和生产构建通过。配置回归覆盖无重复直接导入、确认前零写入、确认后覆盖、无关供应商保留、备份路径迁移和选择使用。已随独立后台 0.1.35 发布。

两个隔离 Core 经过带项目路径的本机转发，验证实际 JSON 下载、上传、无重复直接导入、取消和确认覆盖。桌面与 390 px 窄屏 Chromium 通过，窄屏 WebKit 关闭 Service Worker 后通过。WebKit 默认开启 Service Worker 时导出 POST 中断，HTTP 和 HTTPS 隔离入口均复现，线上 Safari 待验证。证据位于 `build/reports/config-transfer/`。

# 独立后台 0.1.34 正式发布（2026-11-18）

按用户要求，固定 macOS/Linux 与 Windows PowerShell 在线安装命令。每次发版提升独立版本并构建六平台。新版本公开下载与升级验证通过后下架旧独立 Release。

此前 Windows `irm | iex` 接收到 BOM 字符，导致 PowerShell 解析参数声明失败。固定地址现返回 ASCII 入口，入口读入并移除下载器文本开头的 BOM，再执行原下载器。下载器保留原字节及 UTF-8 BOM，正式插件 JAR 内脚本与其逐字节一致。Gradle 资源配置验证通过。未替换正式插件的六项附件。

独立后台 0.1.34 发布标签指向 `f20e70b`，包含 Linux `-bind`。六平台 24 个公开附件 HTTP 200，下载字节、SHA-256 与 GitHub 摘要一致。旧库全量与迁移 race、Go CLI/API/Relay、前端 17 项及安装脚本 10 项回归通过。Mac ARM64 包隔离启动后，本地和转发入口各 87 个网页资源与包内字节一致。真实 Windows PowerShell 5.1 候选及发布后验证通过，最终 x64 程序返回 0.1.34，公开 Windows 归档摘要通过。候选绑定链接状态在隔离 Relay 验证，Linux 实机绑定待验收。

发布后两条固定入口针对六个平台选择并校验 0.1.34，安装最后一步使用测试桩。已有插件和网页更新选择 0.1.34。候选分支自动 CI 在 0.1.34 尚未公开时下载遇到 404，采用已公开 0.1.33 验证候选下载链路，公开后 0.1.34 复核通过。验证记录见 [Windows 5.1 候选](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44265385924) 和 [发布后复核](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44265830885)。

旧独立后台 0.1.27、0.1.30、0.1.31、0.1.32、0.1.33 的 5 个 Release 已下架，原 Release API 和抽检附件下载均返回 404。Git 源码标签保留。发布前后快照、附件摘要和固定入口证据位于 `build/reports/release34/`。

# Linux 远程绑定命令（2026-11-18）

在独立后台增加 `-bind`。命令通过现有本地网关控制接口查询绑定状态。首次发起绑定后输出 Relay 登录地址并退出，网关继续接收确认。再次运行复用待确认链接，已绑定时显示节点名称、地址和连接状态。Linux 安装后打印带实际路径的可复制命令。独立后台尚未运行时，命令提示先启动。

隔离服务配合模拟 Relay 验证首次输出链接、重复查询、授权后 WebSocket 上线、节点地址和暂停状态。安装器回归通过。首次测试运行缺少 `pwsh`，加入本机便携 PowerShell 后 8 项全部通过。用 Linux 分支安装桩核对自定义目录含空格、引号和美元符时可直接复制命令。Linux x64 和 ARM64 交叉编译通过。记录位于 `build/reports/standalone-bind/`，尚未生成或发布安装包。

# Linux 独立后台 0.1.33 补发（2026-11-18）

从发布标签 `fdcc1a4` 的独立 checkout 构建 Linux amd64 和 arm64。首次 linked worktree 构建缺少 Go VCS 元数据，改用完整 checkout 重打，两个 ELF 均记录正确提交和 `vcs.modified=false`。解包核对架构、版本、各 305 个网页文件、安装脚本和 SHA-256。单文件安装器的内嵌归档与对应压缩包逐字节一致。

旧库全量及迁移 race、API、Agent、独立后台 CLI、前端类型检查和远程入口浏览器回归通过。Linux 实机安装待验收。GitHub 新增 10 项附件均匿名下载 HTTP 200，字节与本地和 GitHub 摘要一致。原有 Windows 两项附件 ID 和摘要一致。更新检测在 Linux 双架构均选中 0.1.33，固定在线安装入口的默认版本仍为 0.1.33。验证记录位于 `build/reports/release33-linux/`。

# 独立后台无响应时从 IDEA 切回内置（2026-11-18）

IDEA 启动或重新连接本地聊天失败后，仅在独立数据进程仍独占数据且本地状态探测遇到网络错误时显示原生“切换到内置模式”。认证失败、仅远程入口中断、陈旧的连接文件或其他内置项目的共享锁不会触发这个按钮。检查与恢复命令由插件自带的程序执行，无需更新用户的独立安装。

点击保存一次恢复请求并重启 IDEA；沿用原有的多实例切换锁，最后一个旧 IDEA 退出之后才执行。先关闭远程入口，再关闭数据进程；如果已注册的进程无响应，调用本机服务管理器停止它，等待数据占用释放。关不掉时显示关闭失败，安装记录与项目数据保留。首次 macOS 隔离测试发现服务注销返回后进程尚未退出，改为等待原数据锁释放后复测通过。

插件回归 97 项通过、4 项受现有 Windows/升级运行时环境限制跳过。已验证原生按钮点击后以内置后台打开同一项目并完成本地认证、另一个 IDEA 持有租约时推迟处理，以及仅远程故障时仍可聊天。Go 启动器和后台模块测试通过，覆盖认证错误、陈旧记录、共享及独占写入和停止失败。macOS 隔离冻结旧版 0.1.32 的数据进程后，插件随包程序识别故障，关闭数据与远程入口两项登录服务，逐字节保留独立安装记录，并以内置模式打开项目（HTTP 303 完成本地登录）；Windows x64 启动器已交叉编译，Windows 实机故障恢复待验收。证据在 `build/reports/embedded-recovery/`。本轮只交付源码，无新安装包或 Release。

# Windows x64 本地包 0.1.33 / 0.1.27（2026-11-18）

按用户要求独立后台升至 0.1.33，插件保持 0.1.27，生成 Windows amd64 本地包供手工替换。证据目录 `build/reports/release33/`。未发布 GitHub、提交推送或安装/重启用户实际服务。

| 产物 | SHA-256 |
| --- | --- |
| `build/standalone/0.1.33/local-ai-agent-0.1.33-windows-amd64.zip` | `c2de7bebf408b23f5f6c0ed14eda2e883a98e9db105420c451317b8e403aa21d` |
| `build/local-packages/idea-ai-agent-0.1.27-windows-amd64.zip` | `d790d5f46c2db4913cc2093342e158364f4f2bc963048d20a669fd930365391b` |

插件通过 `node scripts/package-plugin.mjs local win --version 0.1.27 --verify` 构建。独立包按现有打包布局以版本链接参数构建 EXE，Windows 缺 zip 命令，因此用 `package-windows.py` 归档；在插件构建后重新复制同一 dist。`verify-packages.py` 从最终 ZIP 解出并检查 PE 架构、EXE/JAR 版本、安装器源码/BOM、305 个网页文件。临时隔离启动最终程序，Core PID 37048 → 44280、令牌改变，网关地址及项目身份保留；独立 Core、独立网关、转发、插件内置本地四入口各 305 个 HTTP 资源与包内字节一致。报告 `package-verification.json`。

Agent 全量（含模拟旧版本升级）、SDK、backend、CLI 重启生命周期/停止失败回归通过。kanban 全量与 `TestTaskStoreSnapshotMigration` race 两项门禁通过。前端定向回归、类型检查和生产构建通过。Gradle 测试共100项，98通过、2项运行时升级条件跳过，0失败；`kotlin-summary.json` 保留具体跳过名称。实际 IDEA 多项目重连与真实 Codex 模型显示待用户安装验收。

API `TestApprovalTerminalEventsUpdateTaskWaitingWithoutHidingOtherQuestions` 在功能断言结束后因 SQLite 文件未关闭导致临时目录清理失败；app `TestLocalCLITokenStoreWritesSinglePrivateFile` 因 Windows 返回0666而非Unix0600失败。两项均用 HEAD 源码 overlay 复现，日志 `api-baseline-cleanup.log`、`app-baseline-permission.log`；其余 API/app 测试通过，未记为全量通过。

最终插件 ZIP 经真实 Windows PowerShell 5.1.26100.9818 验证脚本字节及 UTF-8 BOM，下载公开0.1.32并验证摘要成功；默认及ANSI936跳转回归2/2通过（`windows51-final-plugin.log`）。0.1.33仅在本地，未把公开0.1.32下载记为0.1.33线上验证。补充下载回归在5.1/7及两种读取方式共4项通过。安装组合初轮因缺少sh/which/zip失败；使用构建目录内基于Windows tar的zip工具后，5.1暴露显式空 `PROCESSOR_ARCHITEW6432` 会清空架构值的问题。测试改为省略该变量，保留ARM64场景显式赋值；再为测试子进程指定原生5.1模块目录，解决混用PowerShell7模块路径导致Get-FileHash不可用。最终Windows安装回归2/2通过、无跳过，覆盖版本重新读取、x64/ARM64选择、摘要失败、DeferStart与安装失败传播（包安装步骤用临时桩）。Shell三项未在本机验证，不计通过；真实计划任务与登录自启不在本轮隔离验证中。

Review: PASS。完整源码修改沿用下述任务基线兼容审查；新增安装测试修正仅恢复原生x64的环境语义，ARM64输入仍在各自用例覆盖。code-simplifier复核无安全简化，未追加重构。测试修正不进入安装包，最终产物字节不受影响。

# 刷新模型自动更新 Codex 进程（2026-11-18）

用户明确要求“刷新模型”自动比较旧版本并重启，不再要求用户额外确认。保留前一项独立后台完整重启修复，模型刷新只替换需要升级的 Codex 运行资源。

SDK 在 initialize 成功后保存 `userAgent`，通过只读方法暴露当前进程身份，不通过新的 `--version` 覆盖这个快照。Pool 在显式 `ProbeOne` 前比较该身份中的版本与配置中的 CLI 版本命令；仅本机版本更新时移除旧 Codex 运行会话并关闭客户端，然后原探测链路创建新客户端、发布模型状态。比较与替换串行处理。其他协议、同版本和较旧的磁盘版本不重启；尚未初始化的客户端由正常探测启动。版本未知、读取失败或关闭失败均返回错误并结束 pending 状态。

原版本检测调用保留失败时返回空字符串的接口行为，新增带错误结果的内部读取函数供刷新使用。模型数据结构、顺序、隐藏标记与默认值映射沿用原逻辑。运行会话释放后，后续对话通过持久化 AgentSessionID 恢复；正在进行的 Codex 对话会被中断，提示已同步。

`model_refresh_test.go` 使用测试程序的隔离子进程模拟 `--version`、initialize、model/list、config/read 和 thread/unsubscribe，启动时固定模型目录。覆盖 0.164.0 → 0.169.1 后自动出现新模型、同版不重启、磁盘较旧不重启、版本不可识别报错、保留其他 Agent、再次刷新不重复关闭新客户端。夹具不调用真实 Codex 或付费模型。

Review: PASS（静态）。以本会话初始干净工作区及已授权的完整重启修改为基线，检查 SDK 身份快照、版本读取、Pool 资源释放、ProbeOne 成功/失败状态和实际会话 AgentSessionID 恢复调用链。0.164.0 → 0.169.1 会替换；同版、磁盘更旧均保留；无法读取版本时返回错误，不报告刷新成功。code-simplifier 检查无进一步安全简化，未追加行为改写。

验证状态：Agent全量（含自动升级模拟协议）、SDK与API探测回归通过，已纳入本地33/27包。API既有Windows清理失败及实际Codex验收边界见本轮打包记录。格式化产生的一处任务外空行清理已恢复。

# 独立后台完整重启（2026-11-18）

现象：配置测试可见 `gpt-6.2-astra`，聊天刷新仍不可见；用户更新 Codex 后，插件“重新启动”未替换旧 app-server。

现场证据：Core PID 42588 自 09:18:25 运行，Codex PID 7608 于 09:18:26 启动，其 code-mode 子进程使用 0.164.0 发布目录。磁盘 codex.exe 的 `--version` 返回 0.169.1，SHA-256 与 0.169.1 daemon 可执行文件一致。用户点击重启后，网关换为 PID 31560（09:48:16），Core 与 Codex PID/启动时间均未变。

根因：`manageStandalone` 调用 `-restart`，CLI 原分支只停止网关；重新启动网关时 `EnsureCore` 发现现有 Core 健康即返回。插件完成事件原先也只通知按钮刷新，不重新读取 Core 地址与令牌。用户已明确要求将“重新启动”改为完整后台重启。

实现：`-restart` 在网关停止后复用 `stopLocalCore`，等待 Core 数据锁释放并卸载登录服务，之后原启动流程创建新 Core/网关。Core 退出通过 `agentPool.CloseAll` 关闭常驻 Agent。Core 停止失败立即返回原错误。`-stop` 仍只停止网关。插件成功事件让所有独立模式项目调用现有 `start()` 重读连接，内置模式保留当前界面；提示说明中断进行中的对话、保留历史记录，完整重启等待上限从仅网关的 25 秒调整为 90 秒。

此前 `resolveProbePool` 隔离改动及对应测试已撤回。当前回归更新 `TestStandaloneProcessLifecycle`：Core PID/令牌改变、旧 WebSocket 关闭、新连接读写已有会话、重复重启、端口和项目数据保留；新增 `TestStandaloneRestartStopsOnCoreFailure` 覆盖网关已停而 Core 停止失败。Kotlin 新增 `reconnectReadsReplacedCoreAddressAndToken`，检查 Core 地址与令牌更换后重读描述文件，保留原项目身份。

Review: PASS（静态）。以任务开始时的干净工作区为基线，核对 `runCLI` 重启/停止/卸载分支、Core 数据锁和 Agent 关闭顺序、插件完成事件及 `LocalRuntime.start` 的地址/令牌重读路径；授权行为变化是重启中断当前对话，停止远程入口仍保留 Core。code-simplifier 复核无进一步安全简化，未追加源码改写。

验证状态：CLI重启生命周期/停止失败、backend与Kotlin重连回归通过；最终独立包隔离实测Core PID/令牌更换且身份保留。两包已构建，旧库迁移及Windows最终包验证通过。实际IDEA多项目及Codex验收待用户替换；app既有Windows权限断言失败见本轮打包记录。

# 独立后台 0.1.32 与 Windows 插件测试包（2026-11-18）

[独立后台 0.1.32](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.32) 的源码标签指向 `4fb3c44`。六平台共 24 个附件经公开地址下载，均与本地产物和 GitHub digest 一致。六个后台程序对应此源码提交，所有包内的 305 个网页文件与本次构建逐一匹配。解包运行 macOS ARM64 后，本地和转发入口各 87 个资源请求成功并匹配包内字节。固定安装脚本与默认版本文件已在线核对，正式 0.1.27 插件发现 Windows 可从 0.1.31 更新到 0.1.32，前端及插件对六个平台均选中 0.1.32。

Windows x64 插件测试包基于已核对 GitHub 摘要的正式 0.1.27 ZIP 替换网页资源。网页目录以外全部 14 个条目的内容及权限一致，JAR 内版本为 0.1.27。测试包 SHA-256 为 `6e3d39277816c222e331873ba8e6aad3318e017096fa5513ed4fada75b3050a4`。正式插件 Release 的六个资产 ID 和摘要均与发布前一致。

旧库全量和迁移 race、API 全量、前端定向 17 项、安装器本机 7 项通过。Windows 测试 ZIP 解包后的网页入口浏览器回归通过。首次 Gradle 离线构建因本机缺少 foojay 插件依赖中止，恢复依赖后插件配置验证通过，Gradle 的 test 任务命中缓存。Windows 实机从 IDE 安装测试包留给用户验收。

发布前候选分支的常规 CI 在新附件尚未公开时请求 0.1.32，得到 404。随后使用[候选工作流](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44211671771)核对最终插件 ZIP、独立后台双架构和 0.1.32 x64 程序，PowerShell 5.1 的公开下载测试使用当时的 0.1.31。发布后的[复核工作流](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44211930569)使用同一插件 ZIP，通过真实 Windows PowerShell 5.1 下载公开 0.1.32 并校验 SHA-256，5.1 与 7 的跳转回归通过。CI 返回的测试 ZIP 与本地交付文件逐字节一致。常规 push CI 查询正式插件时遇到 GitHub API 匿名限流 403，提交 `95c4985` 将元数据查询改为使用工作流凭据，[主分支复跑](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44212139678)通过。完整证据位于 `build/reports/release32/`。

# 远程单文件 HTML 预览（2026-11-18）

远程文件查看器为 `.html`、`.htm` 及 MIME 为 `text/html` 的文本文件显示「源码 / 预览」。完整 UTF-8 文件复用当前内容，分段读取或其他文本编码通过现有项目文件接口读取完整文本。预览在允许执行脚本的独立沙箱中运行内嵌 CSS、SVG 和 JavaScript。返回源码时保留原查看器和滚动位置。

用独立临时项目、真实文件接口和生产网页构建，经本地项目路径转发，打开截图中 7 KiB 的 `pelican-bike.html` 副本。Chromium 与 WebKit 在 430 px 宽度下显示整幅画面，车轮的旋转角度随时间变化，切回源码后保留滚动位置。两个浏览器均在临时副本上完成编辑、保存、退出，预览和磁盘均读到保存的内容，预览中的按钮响应点击。截图和运行记录位于 `build/reports/single-html-preview-{chromium,webkit}.png` 与 `single-html-preview-real.log`。

类型检查、生产构建、网页资源归属 Go 回归通过。远程查看器、文档预览、缓存和生产入口定向测试 17 项通过。新增覆盖单文件零额外请求、内嵌脚本交互、分段文件完整读取、读取错误后重新切换以及跨文件状态。首次自动点击偶发落在刚出现的 iframe 元素上，事件记录显示子页面未收到点击。用例改用键盘激活页内按钮，工具栏仍用真实点击切换。缓存用例曾从仓库根目录执行而找不到源码，按 `runtime/web` 工作目录重跑通过。本轮未生成或发布安装包。

## 远程网页第一批与 macOS 0.1.42 本地测试包

- 远程桌面和平板共用顶栏、两侧开关和会话卡片。Agent 配置、多项目会话和主题沿用原操作，Git、工作树和关联文件移至文件菜单。左右互换后，卡片样式跟随会话栏。对话边框默认使用呼吸效果，根据 Agent 的工作状态亮灭，效果、颜色、速度保存在本机浏览器。
- 产物在 `build/standalone/0.1.42/`。锁定依赖构建当前前端，本地干净克隆 `6fd4e18` 构建 macOS arm64 后台，Go 记录为 `vcs.modified=false`。自解压包内嵌的归档与 tar.gz 相同，SHA-256 校验通过。305 个网页文件随包分发，包内安装脚本与源码逐字节一致。
- 上次隔离验证沿用了基线 Core，返回的是 0.1.41 的入口资源。在独立 HOME、安装目录和服务注册目录重新安装 0.1.41，再直接运行 0.1.42 自解压脚本。安装器找到已有安装目录，两个版本各自返回与包内文件逐字节一致的 JS、CSS、manifest、Service Worker 和图标。同版覆盖升级及故意缺文件后的旧服务恢复均通过。
- Chrome 和 WebKit 在最终安装上打开原项目与会话，验证顶部主题、多项目、项目工具、侧栏收放及互换。`?ide=1` 使用插件入口。普通旧库和 race 迁移测试、后台配套资源测试通过。浏览器日志及安装证据见 `build/reports/standalone-0.1.42-macos-ui/`。
- 前端全量回归使用最终包的静态目录运行，338 项中通过 335 项。两个“回到最新消息／恢复自动跟随”的滚动断言在 0.1.41 基线同样失败，连同父测试共计 3 项。新增的 7 项远程 UI 检查与成品 Relay 节点、项目资源入口检查均通过。
- 本次为第一批本地试用，正式安装入口仍指向 0.1.41。手机新外壳和设备手动指定属于第二批。

### 0.1.42 本机升级

用户授权升级正在使用的 0.1.41。当前 Codex 进程由独立后台 Core 启动，Core 重启时会断开本轮连接。由 macOS 后台任务在短暂延迟后执行同一份已验证的安装器，并独立验证版本、原本地地址、项目目录和网页资源。升级或启动验证失败时尝试恢复 0.1.41。实际完成状态与安装日志记录在 `build/reports/standalone-0.1.42-live-upgrade/`。

实际本机验证通过。安装器完成 0.1.41 → 0.1.42，原地址 `http://127.0.0.1:7441` 继续提供 7 个原有项目，入口 JS、CSS 和 Service Worker 与包内字节一致。launchd 在成功后重新调度临时任务，旧版本预检阻止了再次安装。已卸载该临时任务并核对 0.1.42 仍在运行。

### 0.1.43 短窗口和远程布局

0.1.42 的对话面板使用独立的浅色阶，外壳按照 `100dvh` 计算高度，文件菜单未限制高度。在 1060 × 530 的窗口中复现了菜单伸到 839 px。0.1.43 统一三栏基础底色，使用应用同步的可见视口高度，底部留出 4 px 或底部安全区。文件菜单按打开位置限制高度，支持菜单内滚动和键盘 End 到最后一项。

前端类型检查和 17 项相关浏览器测试通过。Chrome 和 WebKit 从实际安装的 0.1.43 验证 1060 × 530 下菜单最后一项可达，对话底边在视口内，模拟 Agent 工作时底边存在发光像素。最终包校验及 0.1.42 → 0.1.43 隔离升级、同版升级、缺文件恢复、Relay 路径回归和旧库迁移测试通过。证据见 `build/reports/standalone-0.1.43-macos-ui/`。本机运行的 0.1.42 与正式入口 0.1.41 保持当前状态。

用户已授权本机从 0.1.42 切换到 0.1.43。使用 `RunAtLoad=true`、`KeepAlive=false` 的一次性 macOS LaunchAgent 延迟运行，完成安装及原地址、项目与 JS/CSS/Service Worker 校验后退出并清除临时任务。升级失败尝试恢复 0.1.42。实际状态见 `build/reports/standalone-0.1.43-live-upgrade/result.txt`。

本机 0.1.43 更新成功，原地址和 7 个项目可读取，网页资源与测试包一致。一次性升级任务已卸载。用户试用反馈顶栏 Agent 配置入口在文件栏弹出，界面位置待修正。

### 0.1.44 顶栏 Agent 配置

顶栏直接打开原配置流程的居中模态窗口，左右栏维持已有开关状态。通过关闭按钮、Esc 或配置切换成功关闭时，焦点返回顶栏入口。文件菜单继续使用栏内面板。

相关前端 19 项测试通过，包含收起文件栏、选择配置、发送切换请求和关闭后焦点回到顶栏。最终包在 Chrome、WebKit 的 1060 × 530 窗口通过位置、Esc 和焦点验证。0.1.43 → 0.1.44 隔离升级、同版升级、缺文件恢复、Relay 资源入口、SHA-256、旧库迁移和 race 检查通过。最终包有 305 个网页文件，后台源码基于干净克隆的 `6fd4e18`。证据见 `build/reports/standalone-0.1.44-macos-ui/`。用户授权本机部署，0.1.43 → 0.1.44 由一次性 LaunchAgent 执行，安装后验证原地址、7 个项目和随包资源。部署结果见 `build/reports/standalone-0.1.44-live-upgrade/result.txt`。

### 0.1.45 手机网页第二批

- 浏览器按设备信号和屏幕短边识别手机、平板和电脑，可在设置里手动选择。电脑缩窄窗口保留电脑布局。IDEA 内嵌和原生壳保留各自入口。
- 手机将对话、会话、项目和更多做成全屏页面，对话页收起底部导航。快速切换用现有会话列表，默认展开当前项目。最近消息来自已有的会话正文或搜索结果。会话状态依赖已有的待回复标记及当前浏览器收到的授权和失败事件。
- 活动状态放在输入框上方。正在等待的请求用原有表单和提交过程，在底部面板显示。过长的命令详情默认显示三行，展开后内部滚动，保留复制。项目页从文件菜单进入 Git、工作树和关联文件，消息操作仍在原来位置。
- 25 项相关前端测试通过。最终包用 Chrome 和 WebKit 验证 320、390 像素手机竖屏、横屏、平板和窄屏电脑，检查会话卡片、选择、快速切换和设备设置。最终包的 Relay 资源入口、旧库迁移、SHA-256、隔离升级及失败恢复通过。验证输出在 `build/reports/standalone-0.1.45-macos-ui/`。
- 按此前本机部署约定，0.1.44 → 0.1.45 使用一次性 LaunchAgent 升级。后台保持 0.1.41 的源码逻辑。部署状态见 `build/reports/standalone-0.1.45-live-upgrade/result.txt`。iPhone 真机键盘和 Safari 安全区待试用。

### 0.1.46 手机「更多」

- 手机「更多」展示后台连接和版本、Agent、通知、文件与会话、外观、设备类型及可用的安装和节点入口。主题、语言、排序和设备类型可直接选择。项目菜单保留 Git、工作树和关联文件入口。
- Agent 等需要输入或确认的操作直接打开对应表单，关闭后回到「更多」。新增 Agent 配置调用现有备份接口。手机输入框上方显示活动状态，电脑和平板提供边框呼吸灯及其设置。
- 修正手机页脚 JSX 后类型检查通过。通过 25 项相关前端测试及最终包 Relay 入口测试。最终包以干净克隆的 `6fd4e18` 构建 macOS arm64 后台，并用锁定依赖构建当前网页。305 个网页文件随包提供，SHA-256 和自解压归档匹配。0.1.45 → 0.1.46 隔离升级、同版升级、缺文件恢复、旧库迁移和 race 检查通过。测试脚本中对 macOS 包的 Windows 安装脚本检查已移除，macOS 包核对 `install.sh`。
- 最终包用 Chrome、WebKit 验证手机竖屏、横屏及电脑、平板。核对「更多」的直接设置、表单关闭后仍停留在本页、手机无呼吸灯设置和电脑呼吸灯。截图与日志在 `build/reports/standalone-0.1.46-macos-ui/`。
- 本机安装前检查确认 0.1.45 服务和 7 个项目。沿用一次性 LaunchAgent 部署并验证 0.1.46，结果见 `build/reports/standalone-0.1.46-live-upgrade/result.txt`。iPhone Safari 实机待试用。

### 0.1.47 网页扫码入口

- 电脑和平板侧栏底部的扫码及公网访问入口使用中性色细描边，悬停和键盘焦点提供反馈。公网二维码继续编码当前页面的完整地址，本机入口打开原公网访问设置。
- 27 项相关前端测试和最终包 Relay 入口测试通过。最终包的 Chrome、WebKit 隔离安装验证覆盖电脑、平板和手机，并确认本机公网访问入口可用键盘打开。Relay 项目页的截图验证使用本地模拟接口，补齐节点与项目响应之后通过扫码弹窗检查。截图和日志见 `build/reports/standalone-0.1.47-macos-ui/`。
- 0.1.46 → 0.1.47 隔离升级、同版升级、缺文件恢复、SHA-256、305 个网页文件及旧库迁移和 race 检查通过。本机安装前检查确认 0.1.46 服务和 7 个项目，部署结果见 `build/reports/standalone-0.1.47-live-upgrade/result.txt`。

### 0.1.48 手机 Agent 工作状态呼吸点

- 手机输入框上方的状态栏使用已有工作状态显示呼吸点。光晕在点的周围缓慢起伏，系统减少动态效果时保留静态点。等待用户授权、结束和离线等状态沿用已有提示。
- 23 项相关前端测试和最终包 Relay 入口测试通过。手机会话测试实际切换等待授权与工作状态，验证动画启停和减少动态效果。旧库迁移及 race 检查通过。最终包和本机部署记录分别位于 `build/reports/standalone-0.1.48-macos-ui/` 和 `build/reports/standalone-0.1.48-live-upgrade/`。
- 最终包在 Chrome、WebKit 的手机视口验证状态点的亮暗变化，减少动态效果和等待授权时的样式符合预期。0.1.47 → 0.1.48 隔离升级、同版升级、缺文件恢复及网页资源一致性检查通过。iPhone Safari 实机待试用。
- 本机已升级到 0.1.48，复核原地址、7 个项目和网页资源一致。收到用户的手机测试消息，呼吸点实机观感待用户确认。

### 0.1.49 手机 Agent 状态框流光

- 手机把网页同款边框流光放在输入框上方的 Agent 状态框上，沿用网页的启停条件、效果和本地浏览器配置。「更多 → 外观 → Agent 状态框流光」打开相同的设置面板。
- 25 项相关前端测试及最终包 Relay 入口测试通过。Chrome、WebKit 最终包验证覆盖 320、390 像素手机竖屏及横屏，检查边框位置、呼吸亮暗、四种效果、颜色含自定义、速度、开关、恢复默认及减少动态效果。电脑和平板的边框回归通过。
- 0.1.48 → 0.1.49 隔离升级、同版升级、缺文件恢复、305 个网页文件与 SHA-256 验证通过。旧库迁移与 race 检查通过。记录见 `build/reports/standalone-0.1.49-macos-ui/`，本机部署见 `build/reports/standalone-0.1.49-live-upgrade/result.txt`。用户确认手机流光试用通过。
- 补跑 IDEA 网页入口、宿主界面和指令桥接等前端回归，共 49 项通过。插件与独立版使用同一套网页源码，IDEA 工具窗口仍通过 `ide=1` 使用原布局。本次部署的是独立版测试包，插件 ZIP 的 IDEA 实机验收留待插件发包。[回归日志](../../../build/reports/standalone-0.1.49-macos-ui/idea-regression.log)

### IDEA 插件 0.1.28-local.1 macOS arm64 本地包

- `local mac --verify` 构建通过。包内插件版本、macOS arm64 可执行文件和 305 个随包网页文件核对通过。JAR 中的 macOS 安装脚本和带 UTF-8 BOM 的 Windows 安装脚本与源码逐字节一致。本次交付 macOS 本地测试包，正式 Windows 包的 PowerShell 5.1 验证待发包时执行。
- 从最终 ZIP 提取内置后台，在隔离目录按 IDEA 启动参数运行。后台读取了复制来的 5 个旧会话，并返回与 ZIP 一致的网页资源。Chrome 和 WebKit 均从 IDEA 布局的历史列表打开了已有会话。真实 IDEA 实例中的服务切换与使用本机 Agent 续聊待用户验收。
- Gradle 主测试 98 项通过，后续使用最终 ZIP 的 arm64 运行时补跑 `RemoteHostTest` 和 `RuntimeCacheTest` 各一项，均通过。两项 Windows 专属测试在 macOS 跳过。旧库迁移与 race 检查通过。日志见 `build/reports/plugin-0.1.28-local.1-macos/`。[插件 ZIP](../../../build/local-packages/idea-ai-agent-0.1.28-local.1-macos-arm64.zip)
- 用户授权安装到本机。通过 IDEA 启动安装流程替换插件并重启，启动日志确认加载 0.1.28-local.1，315 个安装文件与 ZIP 一致。旧插件已备份，安装后 IDEA 起初使用独立后台 0.1.49。[安装结果](../../../build/reports/plugin-0.1.28-local.1-macos/installation/result.txt)
- 用户切换到内置模式后从远程网页发送测试消息，消息已收到。当前会话由 IDEA 启动的插件内置运行时处理，后台模式记录为 `embedded`。
- 用户切回独立模式后再次通过同一会话发送消息，确认消息由独立运行时处理。后台模式记录为 `standalone`，0.1.49 原地址及 7 个项目可读，随包网页资源匹配。

### 0.1.50 远程网页关联文件入口

- 0.1.49 的对话底部关联文件行只在手机布局隐藏。0.1.50 将隐藏条件扩展至所有远程网页布局，关联文件仍从「项目工具」访问。IDEA 内嵌页面沿用原关联文件展示，设计稿已同步移除电脑对话里的重复入口。
- 15 项相关前端测试和最终包 Relay 入口测试通过，覆盖内嵌文件打开及原生比较、远程对话隐藏。用含关联文件旧会话的隔离项目验证最终包，Chrome、WebKit 均能从项目工具打开对应文件列表。设计稿验证「本轮修改」和关联文件菜单可用。
- 0.1.49 → 0.1.50 隔离升级、同版升级、缺文件恢复、305 个网页文件与 SHA-256 校验通过。旧库迁移与 race 检查通过。本机独立后台部署见 `build/reports/standalone-0.1.50-live-upgrade/result.txt`。

### 0.1.50 正式发布与 IDEA 插件 0.1.27 附件更新

- 用户确认 macOS 测试通过，指定独立后台 0.1.50、插件沿用 0.1.27。两套正式包从干净的 `d2f0a1f3e724` 构建。独立后台 24 个公开附件及插件 6 个公开附件均匿名下载回读，逐字节与构建产物一致。插件 `v0.1.27` 继续作为 GitHub Latest，原标签保留，更新附件的构建提交已写入发布说明。
- macOS arm64 与 amd64（Rosetta）、Linux arm64 与 amd64（容器）通过最终包首次安装、同包升级及缺文件恢复。Windows x64 最终包通过 PowerShell 5.1 首次安装、计划任务注册、升级和失败恢复。在同一 Windows 环境逐一提取并执行了 x64、ARM64 和通用插件 ZIP 中的真实 5.1 安装脚本。独立后台 Windows ARM64 包通过架构、脚本及附件核验。[独立后台 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44515358245) · [插件安装器 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44515358657)
- 旧库迁移和 race 检查通过。独立后台 0.1.50 的公开安装入口验证通过。`version.txt` 更新后连续四次读回 0.1.50，Linux ARM64 使用固定命令默认安装 0.1.50 成功。旧 0.1.41 Release 的元数据已存档，Release 下架后 Git 标签仍可读取。证据位于 `build/reports/release50/`。[独立后台正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.50) · [插件正式附件](https://github.com/zhuxian89/idea-ai-agent/releases/tag/v0.1.27)

### 0.1.51 手机键盘遮住输入框

- Hostdzire-linux 远程对话在手机弹出键盘后看不到输入框。随包远程网页入口此前没有监听可见视口。用 0.1.50 正式资源模拟仅可见高度从 795 缩至 432 像素，输入区底边仍停在 795 像素。新入口监听可见视口尺寸及偏移，复用已有计算，内置页面和原生布局使用原有路径。
- 新包的 Chrome 回归验证键盘弹出、视口偏移与收回。WebKit 手机竖屏和横屏模拟中，输入框始终在可见区内，焦点和草稿保留。35 项相关前端回归、最终包 Relay 入口和旧库迁移检查通过。记录见 `build/reports/standalone-0.1.51-keyboard/`。
- Linux x64、ARM64 本地测试包已通过架构、SHA-256、自解压归档和 305 个网页文件校验。本机 Docker 守护进程无响应，Linux 隔离安装待补。Hostdzire-linux 未升级，iPhone 真机待复测。
- macOS arm64 测试包使用同一套已验证的网页资源，隔离环境中通过 0.1.50 → 0.1.51 升级、同包升级及缺文件恢复，保留原项目。按用户要求升级本机独立后台，确认 0.1.51 在原地址运行、7 个项目可读、实际返回的网页资源与测试包一致。iPhone 截图显示 `mac-idea` 对话输入框在键盘上方。键盘上沿的「完成」属于 iOS 输入工具栏。[本机升级结果](../../../build/reports/standalone-0.1.51-live-upgrade/result.txt)

### 0.1.51 正式发布

- 用户确认 iPhone 实机测试通过。六个平台安装包从干净的 `09ba412065ca` 构建，305 个网页文件与验收用测试包逐字节一致。正式包远程入口浏览器检查和 Go 旧库迁移、迁移 race 检查均通过。
- macOS arm64、macOS x64（Rosetta）及 Linux x64、ARM64 已通过最终包隔离安装、同包升级和缺文件失败后的恢复。Windows x64 最终包通过 Windows PowerShell 5.1 安装、计划任务注册、升级和失败恢复。Windows ARM64 通过架构和附件检查。[Linux CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44544663266) · [Windows CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44544658691)
- 正式版 24 个公开附件均匿名下载并与构建产物逐字节比较。macOS 固定安装入口指定 0.1.51 安装通过，Windows PowerShell 5.1 用插件安装脚本下载公开的 0.1.51 并校验摘要通过。验证记录位于 `build/reports/release51/`。[正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.51) · [Windows 公开下载 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44545129610)
- 默认版本提交 `c2f6d87` 已推送。公网固定版本入口连续四次读到 0.1.51，macOS 临时 HOME 使用固定命令默认安装通过。旧 0.1.50 Release 元数据归档后下架，Git 标签保留。插件 `v0.1.27` 继续作为 GitHub Latest。

### 0.1.51 Relay 公网更新检查

- 在公网项目页的独立后台版本旁增加「检查更新」。电脑和平板放在侧栏底部，手机放在「更多」。页面自动读取固定安装入口的正式版本，有新版时提供发布页链接。当前版本来自后台 HTML，检查只读取公开版本文件，扫码弹窗继续使用当前地址。
- 最终网页包在 Chrome 和 WebKit 中验证了三个尺寸的自动检查、手动检查、新版提示、错误反馈及扫码入口。Go 旧库迁移、迁移 race 和网页资源归属检查通过。macOS arm64 与 x64、Linux arm64 与 x64 的首次安装、同包升级和失败恢复通过。Windows x64 最终包通过真实 PowerShell 5.1 验证。[平台验证](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44550871123)
- 按用户要求沿用 0.1.51。新附件从干净提交 `5f09ada4b69e` 构建，20 个内容变化的附件已替换，另外 4 个安装入口及摘要与原附件一致。全部 24 个公开附件逐字节回读通过。现有标签保留，发布说明记录实际构建提交。公开固定安装命令在隔离 macOS 环境中将旧 0.1.51 升级至新构建，原端口保持可用。本机实际安装仍为原 0.1.51，待单独升级。验证记录位于 `build/reports/release51-repack/`。[正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.51)

### 0.1.59 手机顶栏和会话切换

- 对话顶栏的会话入口用三横线，标题压为单行。快速切换从项目分组改为跨项目列表，等你回答的会话和运行中会话排在前面，行内展示项目、状态和当前项。
- 用 0.1.58 最终包复现首屏更新检查返回 `api_not_ready`。节点查询现等待页面连接就绪，旧节点的 404 仍走公开版本文件。手机壳回归、Bark 和相关 Go 接口检查通过。旧库迁移和迁移 race 检查通过。
- macOS arm64 本地测试包通过 SHA-256、内嵌归档和 305 个网页文件校验。Chrome 与 WebKit 用包内网页验证 Relay 节点和项目入口、更新检查、手机键盘视口变化及加载失败提示。WebKit 在 320 和 390 像素竖屏、780 像素横屏验证快速切换。[浏览器回归](../../../build/reports/standalone-0.1.59-macos-ui/browser-regressions.log) · [快速切换预览](../../../build/reports/standalone-0.1.59-macos-ui/quick-switch.png)
- 隔离环境从 0.1.58 升级到 0.1.59，同包重装和缺文件时恢复均通过，原项目和端口保留。本机升级预检确认 0.1.58 在运行，7 个项目可读且 Relay 已连接。升级任务核对版本、项目和网页资源，失败时恢复 0.1.58。[隔离验证](../../../build/reports/standalone-0.1.59-macos-ui/isolated-install.log) · [部署结果](../../../build/reports/standalone-0.1.59-live-upgrade/result.txt)
- 本机 0.1.59 已在原端口运行，7 个项目可读，二进制、网页资源和 Relay 状态核对通过。[部署结果](../../../build/reports/standalone-0.1.59-live-upgrade/result.txt)

### 0.1.59 正式发布

- 六个平台从 `7c6b7f0` 的干净克隆构建。24 个公开附件匿名回读与本地归档及 GitHub SHA-256 逐字节一致。各包包含 305 个配套网页文件，macOS arm64 的网页资源与本机试用包逐字节相同。[公开附件核验](../../../build/reports/release59/public-verification.json)
- Go 全量测试、Bark 与更新接口的 race 检查、旧库迁移和迁移 race 检查通过。Chrome 相关前端回归 29 项和 WebKit 包内入口回归 3 项通过。macOS arm64 和 Rosetta x64 从 0.1.52 升级、同包重装及缺文件后的恢复均保持原项目与端口。[前端回归](../../../build/reports/release59/frontend-final.log)
- Windows x64 最终 ZIP 在 PowerShell 5.1 中通过首次安装、升级、失败恢复和计划任务自更新。Linux x64 通过 systemd 自更新。Windows 下载器另以 PowerShell 5.1 从正式 Release 下载了 0.1.59 并校验 SHA-256。[最终包 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44889651701) · [Windows 公开下载 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/44889920956)
- `33c5dd5` 将固定安装入口切到 0.1.59。公开版本文件连续三次返回新版本，macOS 从固定入口在隔离环境默认安装 0.1.59，网页和节点版本查询接口验证通过。0.1.52 Release 已归档下架，Git 标签保留。插件 `v0.1.27` 为 GitHub Latest。[默认安装验证](../../../build/reports/release59/macos-public-default.log) · [0.1.52 快照](../../../build/reports/release59/standalone-v0.1.52-before-withdraw.json)

### 0.1.60-standalone.1 本机升级

- 本机 0.1.59 的实际包重现了输入框圆点。新 macOS arm64 包移除圆点，增加 App 前台续期并修正断线后的登录跳转判断。归档、SHA-256、包内网页、旧库迁移和迁移 race 检查通过。[浏览器回归](../../../build/reports/standalone-0.1.60-standalone.1-macos-ui/browser-regressions.log)
- 0.1.59 → 0.1.60-standalone.1 隔离升级、重装和缺文件恢复通过。本机升级后核对端口、7 个项目、二进制、网页资源和 Relay 状态。用户在 iPhone 上确认圆点消失。[隔离验证](../../../build/reports/standalone-0.1.60-standalone.1-macos-ui/isolated-install.log) · [本机部署](../../../build/reports/standalone-0.1.60-standalone.1-live-upgrade/result.txt)

### 0.1.60 正式发布

- 六个平台从 `6985545` 的干净克隆构建（Go 构建信息 `vcs.modified=false`，前端依赖 `corepack pnpm install --frozen-lockfile`）。最终包 112 项检查通过：24 个附件齐全、SHA-256 文件一致、六个程序的格式与架构正确且与同提交同参数重新编译逐字节一致、包内安装脚本与源码逐字节一致、Windows 脚本带 UTF-8 BOM、每包 305 个网页文件且无 `/mindfs-assets/` 引用、四个自解压安装器内嵌归档与对应压缩包一致、在线入口与源码一致。[检查记录](../../../build/reports/release60/package-verification.log)
- 24 个公开附件匿名回读，与本地构建和 GitHub 记录的 SHA-256 三方一致。[公开附件核验](../../../build/reports/release60/public-verification.json)
- Go 全量测试、旧库迁移（含 race）、Bark 与更新接口的 race 检查通过；干净克隆中前端整套 404 个全部通过，用最终包里的网页跑 Relay 入口回归 4 项通过。[前端](../../../build/reports/release60/frontend-final.log) · [迁移](../../../build/reports/release60/go-migration.log)
- macOS arm64 与 Rosetta x64 在临时 HOME 中从公开的 0.1.59 升级、同包重装、缺文件失败后恢复及空前缀首次安装均通过，端口和用户数据保留。公开的固定在线入口显式指定版本、以及不带版本参数的默认安装，在两种架构下都装上 0.1.60 且程序和网页与构建逐字节相同；x64 安装器在 Rosetta 下运行并断言所装程序为 x86_64。验证期间本机正在运行的服务没有被触碰。[arm64](../../../build/reports/release60/macos-arm64.log) · [x64](../../../build/reports/release60/macos-amd64.log) · [公开入口](../../../build/reports/release60/macos-public-online.log) · [默认安装](../../../build/reports/release60/macos-public-default.log)
- Windows x64 最终 ZIP 在 PowerShell 5.1 中通过首次安装、升级、缺文件失败后服务恢复和计划任务自更新；Linux x64 最终包通过 systemd 自更新。Windows 下载器另以 PowerShell 5.1（5.1.26100.33822）从正式 Release 下载 0.1.60，覆盖重定向与错误处理并校验 SHA-256。[最终包 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45095798420) · [Windows 公开下载 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45096399235)
- `3068757` 将固定安装入口切到 0.1.60。不带参数的固定地址连续八次读到新值后才验证默认安装，节点的版本查询接口返回 0.1.60。0.1.59 Release 已归档下架，Git 标签保留。插件 `v0.1.27` 仍是 GitHub Latest，`releases/latest` 指向插件。[0.1.59 快照](../../../build/reports/release60/standalone-v0.1.59-before-withdraw.json)
- 11 月 23 日 11:14，本机从 0.1.60-standalone.5 升级到公开下载并校验过的 0.1.60 macOS arm64 包。原端口、7 个项目和 Relay 绑定验证通过，Relay 已重连，运行程序与实际提供的网页资源和公开包一致。[本机部署](../../../build/reports/standalone-0.1.60-live-upgrade/result.txt)
- **未验证：** Windows 计划任务的真实登录自启（CI 只覆盖安装脚本、计划任务注册、升级和自更新）；Windows ARM64、Linux ARM64 和 macOS x64 的真机运行（Windows 与 Linux 只核对了程序架构，macOS x64 经 Rosetta 验证）。
- 验证中两处自己的错误已更正：版本号检查最初依赖构建信息里的 `-ldflags`，去符号构建不记录它，改为与重新编译逐字节比较；默认版本最初用带随机参数的请求轮询，会绕过安装器实际读取的缓存地址，改为读安装器使用的原始地址。

### 独立后台自动化发版流水线云端验证（2026-11-25）

- 在基于 `8a0bb0e` 的隔离测试分支上运行 `.github/workflows/release-standalone.yml`，六平台全量验证通过（[Run 45517283091](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45517283091)）：`plan`、`gates`（`kanban` 迁移与 `-race`、发版脚本单测、Go 全量测试、Playwright Chromium、前端类型检查与 405 个网页测试）、`package`（6 平台共 24 个附件、工作树干净检查、`verify-release-assets.mjs` 全部静态门禁）、`verify-linux-install`、`verify-linux-systemd`、`verify-macos-install`、`verify-windows`（Windows PowerShell 5.1 首次安装/升级/失败恢复与计划任务自更新）、`draft`（生成草稿预发布 `standalone-v0.1.64` 并重新下载 24 个附件逐字节比对 SHA-256）8 个作业全部绿灯。
- 云端实跑定位并修复 6 处问题，均已同步回主工作区：`kanban/service_test.go` 13 处异步调度等待预算由 2s 放宽至 10s；`gates` 运行前端测试前安装 `playwright chromium`；`activity-detail-lifecycle.test.mjs`、`activity-history.test.mjs`、`activity-segment-grouping.test.mjs` 显式传入 `locale: 'zh-CN'` 避免 Ubuntu Runner 默认英文环境导致断言失败；`verify-linux-systemd` 补拷 `.tar.gz.sha256` 供 `verify-linux-self-update.py` 校验；`release-plan.mjs` 增加分支名必须等于 `standalone-<版本>` 校验；`verify-package-install.mjs` 创建独立 `XDG_RUNTIME_DIR` 与 `DBUS_SESSION_BUS_ADDRESS`，避免 Linux Runner 连接宿主机真实 `systemd --user`。
- 测试生成的草稿预发布元数据留存于 [ci-0.1.64-test-draft.json](../../../build/reports/ci-0.1.64-test-draft.json)（确认 `isDraft: true`、`isPrerelease: true`、24 个附件及自动发布说明无误），随后已删除测试草稿、远端/本地测试分支与临时工作树，未触碰现有正式版 `0.1.60`、`0.1.61` 预发布与插件 `v0.1.27`。

### 0.1.64 正式发布与插件 0.1.27 同版更新（2026-11-25）

- 从提交 `7bf9df4` 经 `release-standalone.yml` 干净检出构建六平台共 24 个附件（[构建验证 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45520963423)）：`kanban` 旧库迁移与 `-race` 迁移测试、发版脚本单测、Go 全量测试、前端类型检查与 405 个网页测试、`verify-release-assets.mjs` 全部静态门禁、Linux x64 隔离安装与 `systemd` 自更新、macOS arm64 隔离安装、Windows PowerShell 5.1 首次安装/升级/缺文件恢复与计划任务自更新全部通过。macOS Intel 包另在本机 Rosetta 下通过 `verify-package-install.mjs` 隔离安装验证（[macos-amd64-rosetta.log](../../../build/reports/release64/macos-amd64-rosetta.log)）。
- 公开 `standalone-v0.1.64` 后，匿名重新下载全部 24 个公开附件，与 CI 构建产物及 GitHub SHA-256 三方逐字节比对一致（[public-verification.json](../../../build/reports/release64/public-verification.json)）。Windows PowerShell 5.1 使用已发布的 `v0.1.27` 插件包下载公开的 `0.1.64` 验证通过（[Windows 公开下载 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45523740204)）。
- 提交 `5765c9e` 将 `scripts/standalone/version.txt` 切到 `0.1.64`，Release 取消预发布并更新正式安装说明，保持 `--latest=false`（`releases/latest` 仍指向插件 `v0.1.27`）。轮询不带参数的 `raw.githubusercontent.com/.../version.txt` 连续 8 次返回 `0.1.64` 后，在隔离 HOME 中分别验证 macOS arm64 与 Rosetta x64 的无参数默认在线安装，所装程序与构建产物逐字节一致（[arm64 默认安装](../../../build/reports/release64/macos-public-default-arm64.log) · [x64 默认安装](../../../build/reports/release64/macos-public-default-amd64.log)），验证全程未触碰本机正在运行的服务。
- 旧独立后台 Release `standalone-v0.1.60`、`standalone-v0.1.61` 元数据快照已归档至 `build/reports/release64/`（[0.1.60 快照](../../../build/reports/release64/standalone-v0.1.60-before-withdraw.json) · [0.1.61 快照](../../../build/reports/release64/standalone-v0.1.61-before-withdraw.json)）后下架，对应 Git 标签保留。
- IDEA 插件沿用 `0.1.27` 从干净工作树 `0a67550` 构建四个平台包与通用包共 6 个附件：Gradle 单测与配置校验通过；四个平台内嵌后台 `vcs.modified=false`；macOS arm64 内嵌后台在隔离环境启动并通过 `/api/dirs` 与全部 305 个网页资源 HTTP 逐字节比对且无 `/mindfs-assets/` 引用（[内置后台验证](../../../build/reports/plugin27-0164/local-builtin-verification.log)）；三个 Windows/通用候选插件包经 GitHub Windows PowerShell 5.1 实跑通过安装器提取、BOM 校验与 `0.1.64` 公开下载验证（[Windows 5.1 候选插件 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45525046280)）。留存替换前快照（[v0.1.27 快照](../../../build/reports/plugin27-0164/v0.1.27-before-replace.json)）后更新 `v0.1.27` 正式附件并保持 `Latest`，匿名回读 6 个公开附件与本地构建逐字节一致（[插件公开回读核验](../../../build/reports/plugin27-0164/public-verification.json)）。
- **未验证：** Windows 计划任务真实登录自启；Linux ARM64、Windows ARM64 真机运行；macOS Intel 物理机运行（已通过 Rosetta 验证）。

### 独立后台一键转正与插件发版流水线补齐（2026-11-25）

- 扩展 `.github/workflows/release-standalone.yml` 支持 `mode=draft|prerelease|formal`，新增 `scripts/standalone/verify-public-release.mjs` 与 `wait-online-version.mjs`：把快进合并 `main`、公开 Release、云端匿名回读全部附件逐字节核验、Windows PowerShell 5.1 公开下载验证、更新 `version.txt`、CDN 缓存收敛等待与无参数默认安装验证、旧独立版快照归档与下架全部收进 GitHub Runner。
- 适配 `scripts/package-plugin.mjs`（支持 `--online` 及 `CI` 环境自动联网解析 Gradle 依赖），新增 `.github/workflows/release-plugin.yml` 与 `scripts/plugin/`（`plugin-plan.mjs`、`plugin-release-notes.mjs`、`verify-plugin-assets.mjs`、`verify-builtin-runtime.mjs` 及对应单测）：覆盖干净检出构建 5 个插件 ZIP + `SHA256SUMS.txt`、静态门禁、`macos-latest` 与 `windows-latest` 双端内嵌后台 305 个 HTTP 资源逐字节校验、真实 Windows PowerShell 5.1 三包验证、安全草稿与正式版发布/同版本替换及公开回读校验。
- 本地验证：4 个 GitHub Actions 工作流经 `actionlint` 检查零告警；发版与门禁脚本单测全部通过；对真实 `build/releases/0.1.27/` 运行 `verify-plugin-assets.mjs` 与 `verify-builtin-runtime.mjs`（`macos-arm64` 包与通用包），并对线上公开 `v0.1.27` 与 `version.txt` 运行 `verify-public-release.mjs`、`wait-online-version.mjs` 全部通过。
- 云端验证：提交推送 `main`（`bd48c79`、`712ff0f` 修正在 `windows-latest` 默认 PowerShell 下读取 `$env:VERSION` 并升级 `setup-java@v5`）后，触发 `release-plugin.yml` 草稿验证全绿通过（[插件 CI Run 45530752471](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45530752471)）：`gates-and-package`（4m49s）、`verify-macos-builtin`（22s）、`verify-windows`（1m10s，PowerShell 5.1 三包验证 + Windows x64 内嵌后台 305 个 HTTP 资源校验）、`publish`（15s，生成 `plugin-draft-v0.1.27` 并回读比对 6 个文件）。测试草稿快照留存于 [ci-plugin-draft-v0.1.27.json](../../../build/reports/plugin27-0164/ci-plugin-draft-v0.1.27.json) 后已删除，线上 `v0.1.27`（`Latest`）与 `standalone-v0.1.64` 完好未动。

### 0.1.65 正式发布与插件 0.1.27 同版更新（2026-11-25）

- 修复并收敛 4 项运行时问题：ACP 握手改为 `Terminal: false`（`acp/process.go`）；Windows ACP 进程管理改用 Job Object 并在 `Close()` 返回前等待作业内全部已捕获子进程内核句柄进入终止信号态，保证异常或主动关闭后文件锁立即释放（`acp/process_windows.go`，首次云端运行 [Run 45537113687](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45537113687) 在真实 Windows 上捕获 `ActiveProcesses == 0` 早于子进程地址空间回收完成的问题后于 `60f5290` 修复验证通过）；Codex 启动传 `-c thread_unload_delay_secs=0` 并在单会话 `Close()` 轮询 `thread/loaded/list` 确认卸载，整进程重启走 `discardSessionsForAgent` 跳过逐会话等待（`codex/session.go`、`agent/pool.go`）；`preferences.Store.ApplyAgentDefaults` 复用统一的 `APIProvider` 读写按当前绑定 ID 动态追加 Claude/Codex 中转站保存的模型，不污染 `Prober` 原生模型缓存（`preferences/api_providers.go`、`api/agent_api_provider.go`、`api/usecase/session_runtime.go`）。`thread/fork` 经本机 `codex 0.169.1` 隔离实测正常返回 `turns`，未改动 SDK。
- 独立后台 `0.1.65` 从 `60f5290`（`standalone-0.1.65`）触发 `release-standalone.yml` `mode=formal` 全绿通过（[独立后台 CI Run 45538561445](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45538561445)）：旧库 `kanban` 迁移与 `-race` 迁移测试、Go 全量与 405 个前端测试、六平台 24 个附件静态门禁、Linux 隔离安装与 systemd 自更新、macOS arm64 隔离安装、真实 Windows `TestWindowsACPProcessTreeCleanup`（`close`/`cancel`/`wrapper-exit`）及 PowerShell 5.1 安装/升级/计划任务自更新、公开匿名回读 24 个附件逐字节比对、Windows PowerShell 5.1 公开下载验证、提交 `7d8ae9b` 更新 `scripts/standalone/version.txt` 为 `0.1.65` 后无参数默认在线安装核验通过；旧 `standalone-v0.1.64` 快照归档至工作流产物 `withdrawn-standalone-releases-0.1.65` 后已下架，Git 标签保留。[0.1.65 正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.65)
- IDEA 插件 `0.1.27` 从 `7d8ae9b`（`main`）触发 `release-plugin.yml` `mode=formal` + `replace_existing=true` 全绿通过（[插件 CI Run 45540134877](https://github.com/zhuxian89/idea-ai-agent/actions/runs/45540134877)）：旧库迁移与 `-race` 测试、Go 全量与前端测试、Gradle 测试、5 个插件 ZIP + `SHA256SUMS.txt` 静态门禁、`macos-latest` 与 `windows-latest` 双端隔离启动内嵌后台逐字节校验 305 个 HTTP 网页资源、真实 Windows PowerShell 5.1 对三个 Windows/通用插件包针对 `0.1.65` 的安装验证；替换前快照归档至工作流产物 `plugin-replaced-snapshot-0.1.27`，更新 `v0.1.27` 保持 `Latest` 并完成 6 个公开附件匿名回读逐字节核验。已安装 `0.1.27` 的用户需从磁盘重装 ZIP 并重启 IDEA。[插件 Release](https://github.com/zhuxian89/idea-ai-agent/releases/tag/v0.1.27)
- **仍待真机确认范围：** Linux/Windows ARM64 与 macOS Intel 物理机运行、macOS 真实服务升级与 Windows 真实登录自启。

### 0.1.66-local.3 本机独立测试包（顶部正中「多Agent模式」与手机灵动岛适配，2026-11-25）

- 在 `0.1.66-local.2` 基础上按实机反馈完成两项修正：移除会话侧栏角落入口，改为桌面/平板 `RemoteTopBar` 顶栏正中央、手机 `RemotePhoneShell` 聊天顶栏及 IDEA 顶栏展示「多Agent模式」胶囊按钮；`CollabShell` 接入 `--mindfs-safe-area-top`、`--mindfs-safe-area-bottom` 与 `--mindfs-viewport-height`，移动端顶栏、抽屉、底部滚动区与弹窗完整避让灵动岛和 Home Indicator，并复用现有 App 的 `PanelToggle` 与 `44x44` `.remote-phone-icon` 顶栏按钮规范。
- `kanban` 旧库迁移与 `-race` 迁移测试、`TestFrontendAssetsStayWithBackend`、前端 `tsc`、生产构建（305 个网页文件、零 `/mindfs-assets/`）与 18 项浏览器回归通过；重新打包 `build/standalone/0.1.66-local.3/` 并通过 `verify-release-assets.mjs`、`verify-package-install.mjs` 隔离安装及 `upgrade.py --check` 预检，经独立 `launchd` 任务带失败自动回滚热升级至 `http://127.0.0.1:7441`（[本机部署](../../../build/reports/standalone-0.1.66-local.3-live-upgrade/result.txt) · [安装日志](../../../build/reports/standalone-0.1.66-local.3-live-upgrade/install.log)）。未修改 `scripts/standalone/version.txt`，未公开发布，未重打 IDEA 插件包。

## 0.1.66-local.6 手机会话列表与快速模式手动复核

- 快速模式从现有回合改动记录汇总路径。审核通过项目内文件交接；第 5 步可查看原回合的单文件差异，也可手动开始下一轮只读审核。中文交付按轮次保存，旧运行仍可打开原文档。
- 手机单聊的三横线打开可搜索的左侧会话列表，选中会话即可返回聊天。「全部会话」继续进入完整管理页。文件预览保留返回项目入口。
- 受影响的六个 Go 包通过竞态测试，覆盖真实会话存储、首轮至复核流转及旧库迁移。看板全量与旧库专项竞态测试通过。手机浏览器 5 项测试通过，最终包网页的快速模式与远程入口浏览器回归 5 项通过。
- macOS arm64 产物通过 6 个附件及 305 个网页文件的静态校验、临时 HOME 安装。热升级 `local.5 → local.6` 后在 7441 端口核对版本、二进制、HTTP 资源、原 9 个项目及 Relay 连接。在运行中的网页用 390 × 844 视口打开 292 px 左侧会话列表并点空白处收起。包和验证记录仅用于本机测试。[安装回执](../../../build/reports/standalone-0.1.66-local.6-live-upgrade/result.txt) · [手机布局回执](../../../build/reports/standalone-0.1.66-local.6-live-upgrade/live-phone.txt)
- 真模型附加试跑在临时项目启动 Codex 实现，原生 CLI 请求授权执行写文件的命令，随后终止并清理测试运行。两轮流程的通过记录来自协作服务和浏览器回归。

## 0.1.66-local.7 快速模式阶段正文

- 移除把回复正文压成一行路径的过滤器。自动阶段共用已有控制块过滤器，普通文字随模型输出推送并保存进会话，交接指令仍引用项目相对路径。步骤卡片取回实际保存的 Markdown，可以直接回看旧版的交付。
- 三个相关 Go 包的竞态测试、看板全量与旧库专项竞态测试通过。最终包浏览器回归核对阶段卡上可读正文，6 个 macOS arm64 附件、305 个网页文件及临时 HOME 隔离安装通过。
- 本机从 local.6 升级到 local.7 后，9 个项目可访问、Relay 连接已核对。用实际后台页面打开既有第二轮运行，逐一读取实现、审核、回应及最终结果四张卡片。[升级回执](../../../build/reports/standalone-0.1.66-local.7-live-upgrade/result.txt) · [正文回看验证](../../../build/reports/standalone-0.1.66-local.7-live-upgrade/live-cards.txt)

## 0.1.66-local.8 步骤卡片还原与原生对话区显示

- 撤销 `local.7` 将交付文档正文内嵌到步骤卡片的改动，`CollabShell` 步骤卡片恢复原样（仅保留标题、模型、摘要、分歧裁决/改动文件与底部文档弹窗入口）；服务端保持 `ControlStreamFilter`，新阶段输出实时流式推送并保存至原生对话区。
- 验证证据：`collab`、`api/usecase`、`api` 三个 Go 包 `-race` 通过（[race.log](../../../build/reports/standalone-0.1.66-local.8-live-upgrade/race.log)）；最终包 7 项浏览器回归通过（[browser.log](../../../build/reports/standalone-0.1.66-local.8-live-upgrade/browser.log)）；`macos-arm64` 6 个附件及 305 网页文件静态门禁通过（[assets.log](../../../build/reports/standalone-0.1.66-local.8-live-upgrade/assets.log)）；临时 HOME 隔离安装通过（[isolated-install.log](../../../build/reports/standalone-0.1.66-local.8-live-upgrade/isolated-install.log)）。
- 本机从 `local.7` 热升级至 `0.1.66-local.8`，核验 `http://127.0.0.1:7441`、9 个既有项目、二进制、`/api/collab/templates`、网页资源与 Relay 状态通过（[升级回执](../../../build/reports/standalone-0.1.66-local.8-live-upgrade/result.txt)）。**未做：** 真实页面的卡片与原生对话区交互验收交由作者自测；本轮未重跑 `kanban` 旧库迁移（未改动 `kanban` 或数据库结构，正式发包前仍须按 AGENTS.md 复跑）；未提交、未公开发布。

## 0.1.66-local.9 阶段对话末尾恢复阶段交付路径提示

- 改动：`ControlStreamFilter` 新增 `NewControlStreamFilterWithDeliveryPath(docPath)` 与 `CompletionSuffix()`（`runtime/server/internal/collab/control_filter.go`）；`handoffTurn` 传入 `step.DocPath`（`runtime/server/internal/collab/stage_handoff.go`）；`usecase.SendMessage` 新增可选接口 `StreamCompletionSuffixer`，仅在回合成功且上下文未取消（`sendErr == nil && ctx.Err() == nil && turnCtx.Err() == nil`）时将 `阶段交付路径：<step.DocPath>` 实时推送并持久化到阶段对话末尾，不写入 `VisibleText()` 与 `.mindfs/runs/` 交付文档正文。新增 `TestControlStreamFilterCompletionSuffixKeepsVisibleTextClean` 与 `TestSendMessageStreamFilterCompletionSuffix`（覆盖成功追加与取消不追加双分支）。
- 验证证据：`go vet` 与 `collab` / `api/usecase` / `api` `-race` 全部通过（[race.log](../../../build/reports/standalone-0.1.66-local.9-live-upgrade/race.log)）；`kanban` 旧库全量与 `-race` 迁移门禁通过（[kanban.log](../../../build/reports/standalone-0.1.66-local.9-live-upgrade/kanban.log) · [kanban-race.log](../../../build/reports/standalone-0.1.66-local.9-live-upgrade/kanban-race.log)）；`0.1.66-local.9` `macos-arm64` 6 个附件及 305 网页文件静态门禁通过（[assets.log](../../../build/reports/standalone-0.1.66-local.9-live-upgrade/assets.log)）；临时 HOME 隔离安装通过（[isolated-install.log](../../../build/reports/standalone-0.1.66-local.9-live-upgrade/isolated-install.log)）；`upgrade.py --check` 预检通过（`0.1.66-local.8`、9 个项目、Relay 已连接，[preflight.log](../../../build/reports/standalone-0.1.66-local.9-live-upgrade/preflight.log)）。
- 本机升级：独立 `launchd` 任务（`dev.ideaagent.standalone-upgrade-0166-local9`）已完成 `local.8 -> local.9` 热升级，核验 `http://127.0.0.1:7441`、9 个既有项目、二进制、`/api/collab/templates`、网页资源与 Relay 状态全部通过（[升级回执](../../../build/reports/standalone-0.1.66-local.9-live-upgrade/result.txt)）。**未做：** 未改 `scripts/standalone/version.txt`，未提交、未公开发布，未重打 IDEA 插件包；真实页面的阶段交付提示待作者自测确认。

## 0.1.66-local.10 审核依据去内联精简与 Skill 分组选择（2026-11-26）

- 改动：`LoadStandards` 与 `BuildReviewerStandardsSection`（`runtime/server/internal/collab/standards.go`）移除对 `~/.codex/AGENTS.md`、`~/.claude/CLAUDE.md`、`~/.gemini/GEMINI.md` 的自动扫描与正文内联，避免不同 Agent 全局配置冲突；仅按路径引用项目 `AGENTS.md` 作为唯一共享规范，并将模板勾选的 `SKILL.md` 从全文拼接改为单行索引（`名称：简介（路径）`，提示仅在改动涉及该领域时按需读取），使 `02-审核依据.md` 从 1,300+ 行收敛回约 40 行。同步更新 `CollabShell.tsx` Skill 选择器说明文案与 `prompts.go` 示例措辞，并包含前端 `CollabSkillPicker` 按来源/前缀分类及一键全选能力。
- 验证证据：`go vet` 与 `collab` / `api` `-race` 通过（含行数上限断言 `<= 55`，[race.log](../../../build/reports/standalone-0.1.66-local.10-live-upgrade/race.log)）；`kanban` 旧库全量与 `-race` 迁移门禁通过（[kanban.log](../../../build/reports/standalone-0.1.66-local.10-live-upgrade/kanban.log) · [kanban-race.log](../../../build/reports/standalone-0.1.66-local.10-live-upgrade/kanban-race.log)）；最终前端产物 10 项单测与浏览器回归全部通过（[browser.log](../../../build/reports/standalone-0.1.66-local.10-live-upgrade/browser.log)）；`0.1.66-local.10` `macos-arm64` 6 附件及 305 网页文件静态门禁通过（[assets.log](../../../build/reports/standalone-0.1.66-local.10-live-upgrade/assets.log)）；临时 HOME 隔离安装通过（[isolated-install.log](../../../build/reports/standalone-0.1.66-local.10-live-upgrade/isolated-install.log)）；`upgrade.py --check` 预检通过（[preflight.log](../../../build/reports/standalone-0.1.66-local.10-live-upgrade/preflight.log)）。
- 本机升级：独立 `launchd` 任务（`dev.ideaagent.standalone-upgrade-0166-local10`）已完成 `local.9 -> local.10` 热升级，核验 `http://127.0.0.1:7441`、9 个既有项目、二进制、`/api/collab/templates`、网页资源与 Relay 状态全部通过（[升级回执](../../../build/reports/standalone-0.1.66-local.10-live-upgrade/result.txt)）。**未做：** 未改 `scripts/standalone/version.txt`，未提交、未公开发布，未重打 IDEA 插件包；新运行生成的 `02-审核依据.md` 实机表现待作者确认。

## 0.1.66-local.11 快速模式交接文档清理与阶段流程控制加固（2026-11-26）

- 交接文档修复（4 处）：
  1. `prompts.go` 三个 `*ControlFormatSpec()` 移除外层四反引号围栏，直接输出三反引号 `mindfs-control` 格式，消除模型照抄外层围栏导致控制块漏进聊天与解析失败的风险。
  2. `ControlStreamFilter` 新增 `MarkToolActivity()` 与 `DeliverableText()`，`usecase.SendMessage` 在 `ToolCall`/`ToolUpdate` 事件标记工具边界：聊天流继续完整保留实时过程文字，落盘交付文档仅取最后一段完整交付正文（且尾部仅跟无正文工具与控制块时不误清），消除交付文档开头的等待过渡语。
  3. `renderReviewDocWithCitations` 尾部核验记录精简为单行出处核实状态（仅当正文未提及该条目编号时才补充标题说明）；`buildResponseDocContent` 在单轮正常完成且无解析兜底、正文已覆盖全部条目时不再重复追加结构化回应汇总。
  4. `service.go` 第 3 步仅在已有部分已回应条目（`respondedCount > 0`）时才标记增量续跑并输出“继续补齐尚未回应的条目”，消除首次执行误写“继续补齐：R1..Rn”。
- 流程控制加固：
  1. `usecase.SendMessageInput` 新增 `ReturnErrorOnCancel` 并在 `AppContext.RunStageTurn` 启用：在右侧 `ActionBar` 停止当前回合或 SDK 取消时返回 `context.Canceled`（且不广播红色错误横幅），由 `collab.Service.handleTurnError` 准确将当前步骤置为 `waiting_user` 暂停，杜绝把半截取消回合当成功推进至下一阶段。
  2. `claude/approval.go` 在 `readOnly` 会话中拒绝 `run_in_background: true` 的 `Agent`/`Task` 调用，要求 `Explore` 子任务同步执行，防止 Claude 审核回合提前返回导致第 2 步误暂停。
  3. `StepReview` 续跑仅补控制块时自动保留磁盘已有的审核正文（剥离旧核验尾注后合并），且未解析出有效 `review` 控制块的半截回合不输出 `阶段交付路径`。
- 验证证据：`go vet` 与 `collab` / `api/usecase` / `api` / `agent/claude` `-race` 全部通过（[race.log](../../../build/reports/standalone-0.1.66-local.11-live-upgrade/race.log)）；`kanban` 旧库全量与 `-race` 迁移门禁通过（[kanban.log](../../../build/reports/standalone-0.1.66-local.11-live-upgrade/kanban.log) · [kanban-race.log](../../../build/reports/standalone-0.1.66-local.11-live-upgrade/kanban-race.log)）；8 项前端与浏览器回归通过（[browser.log](../../../build/reports/standalone-0.1.66-local.11-live-upgrade/browser.log)）；`0.1.66-local.11` `macos-arm64` 6 附件及 305 网页文件静态门禁通过（[assets.log](../../../build/reports/standalone-0.1.66-local.11-live-upgrade/assets.log)）；临时 HOME 隔离安装通过（[isolated-install.log](../../../build/reports/standalone-0.1.66-local.11-live-upgrade/isolated-install.log)）；`upgrade.py --check` 预检通过（[preflight.log](../../../build/reports/standalone-0.1.66-local.11-live-upgrade/preflight.log)）。
- 本机升级：通过独立 `launchd` 任务（`dev.ideaagent.standalone-upgrade-0166-local11`）延迟 15 秒执行 `local.10 -> local.11` 热升级并在失败时自动回滚，回执写入 [result.txt](../../../build/reports/standalone-0.1.66-local.11-live-upgrade/result.txt)。**未做：** 未改 `scripts/standalone/version.txt`，未提交、未公开发布，未重打 IDEA 插件包；新运行实机表现待作者确认。

## 0.1.66-local.13 再审补充意见与附件

- 源码：第 5 步的「再审一轮」表单可填文字或选多个附件，提交前可移除选中的文件。沿用项目上传接口，把上传返回的 Agent 可读路径和文字一起写入新一轮 `00-作者补充意见.md`。`02-审核依据.md` 指示审核员打开附件核查。文字和附件均为可选。
- 回归：类型检查通过。最终包浏览器测试覆盖选择两个附件、移除一个、提交再审、进入第二轮及打开补充意见。后端端到端回归确认附件路径落盘并由审核依据引用。四包竞态、网页资源路由、看板全量及旧库迁移竞态通过。[浏览器日志](../../../build/reports/standalone-0.1.66-local.13-live-upgrade/browser.log) · [后端竞态日志](../../../build/reports/standalone-0.1.66-local.13-live-upgrade/race.log)
- 安装包：macOS arm64 六个附件和 305 个网页文件通过静态门禁，最终包通过临时 HOME 隔离安装。[静态门禁](../../../build/reports/standalone-0.1.66-local.13-live-upgrade/assets.log) · [隔离安装](../../../build/reports/standalone-0.1.66-local.13-live-upgrade/isolated-install.log)
- 本机：从 `0.1.66-local.11` 升到 `0.1.66-local.13`，验证 9 个既有项目、二进制、模板接口、网页资源和 Relay。用户确认升级成功。[升级回执](../../../build/reports/standalone-0.1.66-local.13-live-upgrade/result.txt)

## 0.1.66-local.14 快速模式共用流光设置

- 源码：网页快速模式的运行卡片和列表圆点复用单聊的边框流光，沿用设置里的开关、效果、颜色和速度。关闭时保留运行状态标记，系统减少动态效果时显示静态流光。
- 验证：类型检查和 9 项浏览器测试通过，覆盖桌面设置选环绕、青绿和较快，手机版式从设置关闭，以及减少动态效果。看板全量、旧库迁移竞态、六个 macOS arm64 附件和 305 个网页文件静态门禁、隔离安装均通过。[浏览器记录](../../../build/reports/standalone-0.1.66-local.14-live-upgrade/browser.log)
- 本机：从 `0.1.66-local.13` 升到 `0.1.66-local.14`，验证 9 个既有项目、二进制、模板接口、网页资源与 Relay。[升级回执](../../../build/reports/standalone-0.1.66-local.14-live-upgrade/result.txt)

## 快速模式交接文档修复（2026-11-26）

逐条回应合并磁盘文件时复用现有控制块过滤器。最终报告落盘前从结构化结果获取测试命令，补上正文缺少的命令。修复前已复现两个问题，修复后协作、API 及 usecase 三包竞态通过。[测试日志](../../../build/reports/collab-handoff-docs/go-race.log) · [修复记录](../../issues/2026-11-26-collab-handoff-docs/collab-handoff-docs-fix-note.md)

## 0.1.66-local.16 快速模式交接文档

- 验证通过协作、API、usecase 和 Web Push 竞态测试，以及看板全量测试和旧库迁移竞态测试。最终包通过 5 项浏览器回归、6 个 macOS arm64 附件及 305 个网页文件的静态门禁、临时目录隔离安装。[后端测试](../../../build/reports/standalone-0.1.66-local.16-handoff/race.log) · [浏览器测试](../../../build/reports/standalone-0.1.66-local.16-handoff/browser.log)
- 第 2 轮协作完成后，本机从 `0.1.66-local.15` 升级到 `0.1.66-local.16`，已核验二进制、9 个项目、模板接口、网页资源和 Relay 连接。[升级回执](../../../build/reports/standalone-0.1.66-local.16-handoff/result.txt)

## 后端测试配置隔离（2026-11-26）

- API 测试套件用临时目录隔离后台数据和 Agent 配置，Web Push 密钥生成测试显式写入自己的临时数据目录。
- 在继承伪造安装路径的环境下，`go test -race ./server/... -count=1` 通过 31 个测试包。模拟安装目录和配置文件在运行前后的文件清单与 SHA-256 完全一致。[测试日志](../../../build/reports/runtime-test-isolation/go-race.log) · [修复记录](../../issues/2026-11-26-runtime-test-isolation/runtime-test-isolation-fix-note.md)

## 0.1.66-local.15 协作进度与模板权限

- 阶段卡片和自动跟随对话直接采用推送的阶段状态，详情随后加载，重连时对齐状态。「检查进度并继续」沿用服务端阶段状态与工作队列，恢复停下的阶段，同时保留作者裁决。运行圆点本身按流光开关、颜色与速度明暗呼吸。
- 模板保存主模型原生权限档位，并在新运行的实现、回应和最终修改阶段传给 Agent。保存模板、设置任务和运行详情使用独立权限标签，手机窄屏可读。旧模板缺档位时沿用 Agent 配置。审核模型固定只读。
- 验证：类型检查、9 项浏览器测试、3 个 Go 包竞态、Codex 原生权限映射、看板全量及旧库迁移竞态通过。手机 390px 布局核对权限标签和 44px 进度按钮。macOS arm64 六个附件、305 个网页资源和临时目录隔离安装通过。[浏览器日志](../../../build/reports/standalone-0.1.66-local.15-progress/browser.log) · [后端竞态日志](../../../build/reports/standalone-0.1.66-local.15-progress/race.log)
- 本机：原协作回合结束后，从 `0.1.66-local.14` 升至 `0.1.66-local.15`。二进制、9 个既有项目、模板接口、网页资源和 Relay 已核验。[升级回执](../../../build/reports/standalone-0.1.66-local.15-progress/result.txt)

## 快速模式最终代码审核（2026-11-26）

- 初审记录包含 6 项发现，交叉审核补充了 Skill 简介和两项交接问题。以下记录修复后的复跑证据。
- R1 `collab/prompts.go:19` 的审核输入允许混入回应和裁决状态。R2 `api/usecase/session.go:737`、`api/usecase/session_runtime.go:120` 的 Codex 临时命令和会话复用可能丢失审核只读属性。
- R3 `collab/service.go:770–831` 的审核取消和补充续跑可能把未核验或已发现的改动显示为未改动。R4 `collab/service.go:387` 的 `SubmitDecisions` 缺少并发提交条件，导致数据库和裁决文档可能记录不同结果。
- R5 `collab/rounds.go:158` 写再审补充意见失败时，新轮已提交且无法从原轮重试。R6 `collab/control_filter.go:255` 显示交付路径前只检查控制块格式，漏掉上轮意见时仍出现路径。
- R7 `collab/standards.go` 逐行读取 YAML，丢失折叠与字面块简介。R8 checklist 当前步骤和旧测试版本进度过期。R9 本节缺少可复跑证据，版本小节顺序也需校正。

### 第 01 轮逐条回应

- 源码已更新。按审核回合保存核验状态，保留本轮已发现的改动和中断记录。裁决和再审在文档写入成功后提交数据库事务。复核完成提示与后端共用同一校验，Skill 简介使用现有 YAML 解析库。
- Go 竞态测试覆盖 10 个有用例的包。`server/internal/` 下的 `collab`、`api`、`api/usecase`、`session`、`agent`、`agent/acp`、`agent/claude`、`agent/codex`、`agent/types`、`kanban` 全部通过，`agent/logs` 无测试。复跑使用临时 `IDE_AGENT_DATA_DIR`。现有 `TestSwitchAgentConfigClearsExistingEnvWhenBackupHasNoEnv` 也已改为使用自己的临时数据目录。[Go 竞态日志](../../../build/reports/standalone-quick-mode-review-response/race-verified.log) · [迁移专项日志](../../../build/reports/standalone-quick-mode-review-response/kanban-migration.log) · [配置测试隔离](../../../build/reports/standalone-quick-mode-review-response/config-isolation.log)
- 专项用例各跑 5 次。`TestQuickModeEndToEndCompletenessDisputesAndNoAutoLoopOnTestFail` 覆盖裁决并发、文档写失败回滚及再审重试。`TestPauseThenImmediateContinueNeverDropsContinuation` 和 `TestContinueRunFlowControlReviewProsePreservationAndCleanFirstResponse` 覆盖暂停、续跑与核验状态。`TestReReviewDeliverySuffixRequiresEveryPreviousItem` 覆盖上轮意见遗漏时的交付提示。审核字段、Codex 临时命令与 YAML 简介也纳入专项。[专项竞态日志](../../../build/reports/standalone-quick-mode-review-response/focused-race.log)
- 前端类型检查和 4 项回归通过，覆盖三种设备布局、快速模式裁决和 Skill 选择。沙盒内落盘复跑受到本地端口和 Chrome 启动限制，允许本机运行后复跑通过。[类型检查](../../../build/reports/standalone-quick-mode-review-response/typecheck.log) · [前端回归](../../../build/reports/standalone-quick-mode-review-response/web-verified.log)
- 真实双模型复核及修复后的安装包验证待执行。

Go 命令从仓库的 `runtime/` 执行，网页命令从 `runtime/web/` 执行。

```sh
IDE_AGENT_DATA_DIR="$(mktemp -d)" go test -race ./server/internal/collab ./server/internal/api ./server/internal/api/usecase ./server/internal/session ./server/internal/agent/... ./server/internal/kanban -count=1
go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1 -v
go test -race ./server/internal/api -run '^TestSwitchAgentConfigClearsExistingEnvWhenBackupHasNoEnv$' -count=1 -v
go test -race ./server/internal/collab ./server/internal/api/usecase -run 'Test(QuickModeEndToEndCompletenessDisputesAndNoAutoLoopOnTestFail|PauseThenImmediateContinueNeverDropsContinuation|ContinueRunFlowControlReviewProsePreservationAndCleanFirstResponse|ParseReviewControlRequiresExplicitItemsArrayAndResponseDocMerges|ReReviewDeliverySuffixRequiresEveryPreviousItem|LoadStandardsAndSkillsInjection|ParseSkillFrontmatterLiteralDescription|TransientSlashCommandPreservesReviewReadOnlyMode)$' -count=5 -v
./node_modules/.bin/tsc --noEmit
node --test tests/collab-quick-mode.test.mjs tests/collab-skill-picker.test.mjs
```

### 第 01 轮最终修改与测试

- R4 补齐裁决提交与「检查进度并继续」的并发处理。裁决提交保留进度检查已启动的最终回合。新增 `TestSubmitDecisionsKeepsFinalWorkerStartedByProgressCheck`，修复前复现同一裁决触发两次最终回合，修复后只执行一次。涉及 `runtime/server/internal/collab/service.go` 和 `service_test.go`。
- 本轮复跑期间全局模板的角色标签改成「主模型」「审核模型」。同步更新 `runtime/web/tests/collab-quick-mode.test.mjs` 的文案断言，继续核对 Agent、模型和思考强度。选择权限后用 Esc 收起选择器，再测试附件操作。
- 11 个有用例的 Go 包通过竞态测试。在逐条回应的包列表上增加了 `turndiff`。9 项专项各跑 5 次，共 45 次通过。看板旧库迁移专项通过，覆盖缺字段和已有字段的数据库。[Go 竞态](../../../build/reports/standalone-quick-mode-review-final/race.log) · [专项竞态](../../../build/reports/standalone-quick-mode-review-final/focused-race.log) · [旧库迁移](../../../build/reports/standalone-quick-mode-review-final/kanban-migration.log)
- 第 01 轮的 TypeScript 类型检查和 4 项前端回归通过，涵盖三种设备布局、裁决和 Skill 选择。该批类型检查日志早于当前 `CollabShell.tsx` 的修改，当前源码验证见第 02 轮。[类型检查](../../../build/reports/standalone-quick-mode-review-final/typecheck.log) · [前端回归](../../../build/reports/standalone-quick-mode-review-final/web.log)
- 真实双模型复核与安装包验收待执行。

Go 命令从 `runtime/` 执行，网页命令从 `runtime/web/` 执行。Go 套件用独立临时数据目录。

```sh
IDE_AGENT_DATA_DIR="$(mktemp -d)" go test -race ./server/internal/collab ./server/internal/api ./server/internal/api/usecase ./server/internal/session ./server/internal/agent/... ./server/internal/kanban ./server/internal/turndiff -count=1
IDE_AGENT_DATA_DIR="$(mktemp -d)" go test -race ./server/internal/collab ./server/internal/api/usecase -run 'Test(SubmitDecisionsKeepsFinalWorkerStartedByProgressCheck|QuickModeEndToEndCompletenessDisputesAndNoAutoLoopOnTestFail|PauseThenImmediateContinueNeverDropsContinuation|ContinueRunFlowControlReviewProsePreservationAndCleanFirstResponse|ParseReviewControlRequiresExplicitItemsArrayAndResponseDocMerges|ReReviewDeliverySuffixRequiresEveryPreviousItem|LoadStandardsAndSkillsInjection|ParseSkillFrontmatterLiteralDescription|TransientSlashCommandPreservesReviewReadOnlyMode)$' -count=5 -v
IDE_AGENT_DATA_DIR="$(mktemp -d)" go test -race ./server/internal/kanban -run '^TestTaskStoreSnapshotMigration$' -count=1 -v
./node_modules/.bin/tsc --noEmit -p tsconfig.json
node --test tests/collab-quick-mode.test.mjs tests/collab-skill-picker.test.mjs
```

### 第 02 轮逐条回应与验证

- R10 审核依据和 Skill 选择器共用 `runtime/server/internal/collab/standards.go` 的解析函数。YAML 解析失败时按单行提取旧格式的 `description: Use when X: Y`。合法的折叠块和字面块由 YAML 解析，3 项用例通过竞态测试。[修复前日志](../../../build/reports/standalone-quick-mode-review-round-02/skill-repro.log) · [交付复跑](../../../build/reports/standalone-quick-mode-review-round-02/delivery/skill-race.log)
- R11 从包含当前 `CollabShell.tsx` 的源码重跑类型检查及 4 项前端回归，全部通过，覆盖桌面、平板和手机版式、裁决流程及 Skill 选择。[类型检查](../../../build/reports/standalone-quick-mode-review-round-02/delivery/typecheck.log) · [前端回归](../../../build/reports/standalone-quick-mode-review-round-02/delivery/web-verified.log)
- R12 按 `local.13`、`local.14`、`local.15` 排列版本记录。已核对本记录和第 01 轮逐条回应的 R3 出处指向 `collab/service.go:770–831` 的审核快照和状态保留逻辑。
- 交付复跑中 11 个有用例的 Go 包通过竞态测试。看板旧库迁移专项覆盖缺少快照列与已有快照列两种数据库。沙盒首次执行受 Go 缓存读取、回环端口和 Chrome 启动限制，相关命令在沙盒外复跑通过。[Go 竞态](../../../build/reports/standalone-quick-mode-review-round-02/delivery/go-race-verified.log) · [旧库迁移](../../../build/reports/standalone-quick-mode-review-round-02/delivery/kanban-migration.log)
- 真实双模型流程需连通两个实际 Agent，安装包、Windows 和手机实机需在对应环境验收。本轮完成源码和浏览器回归。

Go 命令从 `runtime/` 执行，每次使用独立的临时数据目录。前端命令从 `runtime/web/` 执行，浏览器测试从当前源码构建。

```sh
IDE_AGENT_DATA_DIR="$(mktemp -d)" go test -race ./server/internal/collab ./server/internal/api ./server/internal/api/usecase ./server/internal/session ./server/internal/agent/... ./server/internal/kanban ./server/internal/turndiff -count=1
IDE_AGENT_DATA_DIR="$(mktemp -d)" go test -race ./server/internal/collab -run '^(TestLoadStandardsAndSkillsInjection|TestParseSkillFrontmatter(Legacy|Literal)Description)$' -count=1 -v
IDE_AGENT_DATA_DIR="$(mktemp -d)" go test -race ./server/internal/kanban -run '^TestTaskStoreSnapshotMigration$' -count=1 -v
./node_modules/.bin/tsc --noEmit -p tsconfig.json
IDEA_COLLAB_DIST= node --test tests/collab-quick-mode.test.mjs tests/collab-skill-picker.test.mjs
```
