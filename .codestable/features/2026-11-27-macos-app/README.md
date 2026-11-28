# Local AI Agent macOS 客户端

## 当前状态

| 项目 | 状态 |
| --- | --- |
| 源码 | macOS 原生壳、Apple 共享策略、网页平台适配已完成。第 01–04 轮改进（含顶部模式切换工具栏与未安装自动安装本机后台）已完成 |
| 自动化验证 | 第 04 轮改动后 macOS 28 项单测与 WebKit 测试全通过（0 警告）；iOS 43 项单测、13 项界面测试、网页与 kanban 检查沿用前轮结果，本轮仅改 `macos/` 原生壳代码，未重跑。 |
| 本地包 | `0.1.0`（build `1`），Apple Silicon `arm64`，最低部署目标 macOS `13.0`，ad-hoc 签名。第 04 轮包生成于 `build/macos/LocalAIAgentMac-0.1.0-arm64.zip`（SHA-256 `46cf339ac96fdca8d17400b8c4148dcbe9144d12ee08b818d35ad45b60a2a6f1`），已通过 `scripts/macos/build-app.sh` 签名、架构与文件清单门禁 |
| 本机安装 | 已安装第 04 轮包至 `/Applications/LocalAIAgentMac.app`（已通过 ZIP SHA-256、签名校验与二进制逐字节比对并启动）；仍需人工在桌面验收顶部工具栏交互及干净环境下真实网络自动下载安装流程 |
| 网页部署 | 平台标识适配随下一次后台发版生效 |

动工前 1–2 天的桌面 PWA 试用尚无验收记录。当前首版按 macOS 本机试用交付，通知沿用 Bark 或独立后台通知脚本。首版原生通知取舍、是否对外分发、是否仅覆盖 macOS 待作者确认。

## 使用

打开 Local AI Agent 后会读取 `~/Library/Application Support/LocalAIAgent/remote/host.json` 并连接本机独立后台；如果首次在未安装独立后台的 Mac 上打开，客户端会自动下载官方安装脚本、安装并启动独立后台，同时实时展示日志，完成后自动进入界面。顶部原生工具栏常驻「本机 / 远程 Relay」分段切换与实时状态胶囊（`本机 · 已连接` / `本机 · 安装中` / `远程 · Relay` 等），也可按 `⌘⇧1` 切回本机、`⌘⇧2` 打开 Relay 节点、`⌘N` 开新窗口、`⌘R` 刷新。客户端记住手动选择的连接模式。`localaiagent://open?path=…` 打开对应的 Relay 页面。通知沿用 Bark 或独立后台通知脚本。

## 构建与复测

第 03 轮修订包（含应用图标）由 `scripts/macos/build-app.sh` 生成于 `build/macos/LocalAIAgentMac-0.1.0-arm64.zip`（SHA-256 以 `c50b73b3` 开头），同目录有校验文件，构建日志在 `build/macos/qa/round-03/icon/build-app.log`（加图标后的重新构建与 22 项测试日志也在同目录），修复前的构建日志在 `build/macos/qa/round-03/build-app.log`；测试日志在同目录的 `mac.log`、`ios-unit.log` 和回退验证的 `mac-reverted-fixes.log`。第 02 轮包留存为 `build/macos/qa/round-02/LocalAIAgentMac-0.1.0-arm64.round-02.zip`。第 01 轮包仍在 `build/macos/qa/final-review-01.pj5lFN/package/`。脚本会校验版本、架构、签名、URL Scheme，要求 `.app` 内只有 Info.plist、PkgInfo、签名资源、主程序和编译后的应用图标 `AppIcon.icns`、`Assets.car`（网页文件、网页图标、manifest、Service Worker 放在任何位置都会失败）。图标由 `scripts/macos/make-icon.swift` 从 iOS 的 1024px 图标生成到 `macos/LocalAIAgentMac/Assets.xcassets`，并检查主程序内的 `/mindfs-assets/` 引用。需要 Xcode、XcodeGen 和 Python 3。

```sh
xcodegen generate --spec macos/project.yml
xcodebuild test -project macos/LocalAIAgentMac.xcodeproj \
  -scheme LocalAIAgentMac -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath build/macos/DerivedData
```

测试使用临时 `host.json` 和独立的 `WKWebsiteDataStore`。复测真实后台时，将 `IDE_AGENT_REMOTE_HOST_DIR`、`IDE_AGENT_DATA_DIR` 和 `MINDFS_AGENTS_CONFIG` 指向临时目录。

## 自测证据

- WKWebView 探针在 macOS 27.0.1 上成功激活回环 HTTP Service Worker。同源主框架能调用桥接，子框架和其他端口被拒绝。`HttpOnly; SameSite=Strict` 会话 Cookie 在进程内有效，重新启动后由壳重新换取。记录在 `build/macos/phase-0-probe/`。
- 最终 macOS 15 项测试覆盖本机登录只请求一次落地页、亮暗窗口外观、原生弹窗、附件完成时恢复隐藏窗口、多窗口桥接鉴权与 `401` 续签。下载清理测试使用独立临时目录，验证上次残留被删除且相邻文件保留。记录在 `build/macos/qa/final-review-01.pj5lFN/mac-final-retry.xcresult`。
- 网页类型检查及生产构建通过。Mac 壳设置菜单隐藏 Web Push 并保留 Bark，普通桌面浏览器继续显示 Web Push。网页全量 416 项中首跑 414 项通过，GitHub 导入和远程 diff 用例超时，两个文件串行复跑 8 项全通过。以本轮构建运行远程入口测试，4 项通过。记录在 `build/macos/qa/final-review-01.pj5lFN/` 的 `web-typecheck.log`、`web-build.log`、`web-tests.log`、`web-retry.log` 和 `remote-entry-dist.log`。
- 从本轮最终 ZIP 解出的 `.app` 通过签名、架构、元数据和 SHA-256 校验。在隔离副本植入 Service Worker 文件和 `/mindfs-assets/` 路径标记，静态门禁均拒绝。记录在 `build/macos/qa/final-review-01.pj5lFN/packaged-app.log`。
- 用最终源码复测了真实 Go 后台重启。隔离后台从 `dev` 切换到 `0.1.68` 后，WKWebView 使用新 Cookie 加载新版页面，保留查询参数与锚点。记录在 `build/macos/qa/final-review-01.pj5lFN/backend-restart.log`。
- 最终复测的 kanban 全量与 `TestTaskStoreSnapshotMigration` 竞态检查通过。用本轮网页产物在隔离的开发版和带版本号的真实 Go 后台上核验了 HTML、JS、CSS 和 Service Worker 的 HTTP 响应。记录在 `build/macos/qa/final-review-01.pj5lFN/` 的 `kanban.log`、`kanban-migration.log`、`backend-assets.log` 和 `backend-http.log`。
- 最终 iOS 43 项单测及 13 项界面测试通过。新建模拟器首次未弹出软件键盘，改用已有的 iPhone 18 Pro 模拟器后，界面套件完整通过。记录在 `build/macos/qa/final-review-01.pj5lFN/ios-final-unit.xcresult` 和 `build/macos/qa/final-review-01.pj5lFN/ios-final-ui.xcresult`。
- 初次实现包安装后核对了 `.app` 签名及可执行文件字节，并在隔离后台实测首次登录、`host.json` 原子替换和新 Cookie 再次登录。记录在 `build/macos/qa/installed-app-smoke.log` 与 `build/macos/qa/installed-app-http.log`。

## 第 02 轮修订

- 下载临时文件按 `LocalAIAgent-Downloads/<进程号>/<UUID>` 存放，启动只清理已退出进程和本进程号的残留，不影响另一个仍在运行的客户端。
- 附件响应转为下载时，若正在续签后恢复页面，立即显示页面并结束续签状态，不再留下空白窗口。
- 连接失败页的「重试」保留失败页面的路径、查询和锚点。
- WebView 单独跟随系统外观，窗口标题栏和保存面板继续跟随页面主题，「跟随系统」不再被窗口外观固定。
- `host.json` 必须带 `mode: "standalone"` 才作为本机后台使用。仅运行 IDEA 插件时直接显示启动独立后台或打开 Relay 的引导。
- 测试夹具在后台提前退出时报告退出状态，等待超时只记一次失败。

本机图形会话锁屏，中文输入法、实体快捷键、拖拽上传、人工确认下载落盘及休眠唤醒留待解锁后验收。Relay `/nodes` 的匿名跳转已验证，登录后打开远程会话待验收。真实换版本测试使用隔离后台重启，面板内下载安装升级待验收。

## 第 03 轮修订

- 下载临时文件根目录改为 `LocalAIAgent-Downloads-v2`，与初次实现包使用的 `LocalAIAgent-Downloads` 分开，新旧版本启动时互不清理对方仍待保存的附件。
- 重试时后台尚未重新发布 `host.json`，失败页面的路径、查询和锚点保留到连接恢复，不再登录到根页。
- 本机文件查看器的下载链接遇到 `401` 时，放弃拒绝页、续签后重新取附件，保存的是真实文件。修复前保存下来的是 `Local AI Agent session required`。
- 附件触发续签后，下载开始时回到发起下载的会话页，不再停在登录落地页。

验证：macOS 22 项、iOS 43 项单测通过。回退 R11、R15、R16 修复后三项新增测试均失败，已还原。第 03 轮包尚未安装，`/Applications` 里仍是初次实现包。人工验收项与第 02 轮相同，仍待桌面验收。

## 第 04 轮体验增强（自动安装 + 顶部模式切换工具栏）

- **常驻原生工具栏（`MacWindowController.swift`）**：主窗口启用 `.unifiedCompact` 工具栏，包含「本机 / 远程 Relay」分段切换（带图标，与 `⌘⇧1` / `⌘⇧2` 菜单同步）、彩色状态胶囊（`本机 · 已连接` / `本机 · 安装中` / `本机 · 启动中` / `本机 · 未安装` / `远程 · Relay` 等，跟随亮暗外观刷新）和右侧刷新按钮。
- **首次未安装自动安装独立后台（`StandaloneBackend.swift`、`MacWindowController.swift`、`MacAppDelegate.swift`）**：
  - `StandaloneBackendManager` 依据 `installation.json`（及默认目录 `~/Applications/LocalAIAgent/local-ai-agent`）检测安装状态；非默认目录（测试隔离 `IDE_AGENT_REMOTE_HOST_DIR`）不回退读取宿主机二进制。
  - 本机模式首次检测到未安装时自动拉取官方 HTTPS `install.sh` 执行安装并启动，界面展示实时滚动日志、「取消安装」和随时可用的「切换至远程 Relay」；每次启动仅自动尝试一次，失败或取消后保留日志并提供手动重试与复制命令，不死循环；若已安装但未运行，则直接引导点击「启动本机后台」（`local-ai-agent -no-browser`）而不误重装。
  - 子进程输出采用关闭父端写句柄 + 退出时非阻塞排空管道，避免后台守护进程继承描述符导致卡住。
- **空目录监听修复（`HostWatch.swift`）**：当 `~/Library/Application Support/LocalAIAgent/remote/` 尚未创建时，监听最近的已存在祖先目录，待目标目录创建后自动升级监听，安装完成后无需手动刷新即可自动连入。

验证：macOS 全部 28 项测试（新增 6 项：空目录监听、安装状态检测、工具栏模式切换与状态同步、未安装自动安装连入、安装失败不循环且可切 Relay、已安装未启动直接拉起）通过，0 编译警告；`scripts/macos/build-app.sh` 生成 `build/macos/LocalAIAgentMac-0.1.0-arm64.zip`（SHA-256 `46cf339ac96fdca8d17400b8c4148dcbe9144d12ee08b818d35ad45b60a2a6f1`）通过签名、架构、清单和校验和检查。干净 Mac 上真实拉取 GitHub 安装脚本与桌面视觉交互仍需人工实机验收。
