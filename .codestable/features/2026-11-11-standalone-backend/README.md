# 独立后端计划与进度

## 当前状态（2026-11-24）

- **选择模型界面单行按钮与全 Agent 刷新统一重启（2026-11-24，源码已更新，未公开重新发包）。** 将选择模型菜单中的「刷新模型」与「重启」合并到同一行（移除 `AgentRestartAction.tsx`）；所有 Agent 的「刷新模型」统一走重启接口再等待重新探测，中英文悬停与完成提示均写明会中断进行中的对话。独立后台与插件内置后台共用 `runtime/web/src`，后续打插件包会自动带入。
  已验证：前端 `tsc --noEmit` 与相关 3 个测试文件（`agent-model-refresh.test.mjs`、`agent-lifecycle-restart.test.mjs`、`agent-model-refresh-browser.test.mjs`，5/5）通过；本机已构建 macOS arm64 本地测试包（版本号沿用 `0.1.61`）并升级运行于 `http://127.0.0.1:7441`（[本机部署](../../../build/reports/standalone-0.1.61-live-upgrade/result.txt)）。
  **未做：** GitHub 公开的 `standalone-v0.1.61` Windows 预发布包不含本次改动；未重新发布多平台独立包或重打 IDEA 插件包；英文界面与最窄菜单宽度、以及界面交互效果待实机确认。
- **独立后台 0.1.61 测试预发布，仅 Windows x64（2026-11-24）。** 插件 Agent 配置页与选择模型界面增加单 Agent「重启」按钮（复用网页版已有的重启接口，前端改动，后端未改）。提交 `9973b35`，已快进合并 `main`；`version.txt` 仍为 0.1.60，0.1.60 未下架，Release 为预发布且不占 latest。
  已验证：干净克隆构建（`vcs.modified=false`）；包内网页 305 个文件、无 `/mindfs-assets/`、含新按钮脚本；GitHub Actions 在 Windows PowerShell 5.1 验证包内安装脚本通过；匿名下载 4 个附件与构建产物逐字节一致；`kanban` 迁移测试与 race 测试通过。
  **未做：** macOS、Linux、Windows ARM64 包；用公开在线入口安装验证；真实 Windows IDEA 里看到按钮；转正（改 `version.txt` 并下架 0.1.60）。独立后台模式的界面来自独立包，所以插件包里的同一改动在独立模式下不会生效，只有内置模式会。

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
