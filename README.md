# Local AI Agent

把 MindFS 的本地 Agent 工作台集成到 IntelliJ IDEA。插件内置 Go 服务和 Web 前端，在 IDEA 右侧工具窗口中使用本机 Codex、Claude Code 及 MindFS 已支持的 Agent。

[下载 Windows / macOS 插件及查看安装说明](https://github.com/zhuxian89/idea-ai-agent/releases/latest)。每个平台的同一份插件包兼容 IDEA 2024.1、2024.2、2024.3。

| 系统 / 架构 | 0.1.2 安装包 |
| --- | --- |
| Windows x64 | [windows-amd64.zip](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.2/idea-ai-agent-0.1.2-windows-amd64.zip) |
| Mac，Apple 芯片（M 系列） | [macos-arm64.zip](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.2/idea-ai-agent-0.1.2-macos-arm64.zip) |
| Mac，Intel 处理器 | [macos-amd64.zip](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.2/idea-ai-agent-0.1.2-macos-amd64.zip) |

Mac 包要求 macOS 12 或更新版本。可在「关于本机」查看芯片；请使用对应架构的 IDEA。两个 Mac 包已完成交叉编译及安装包校验，尚未在 Mac 实机运行验证。

## 实现

- `runtime/server/internal/agent/`：沿用 MindFS 的 Codex app-server、Claude Code SDK、ACP 适配器。
- `runtime/web/`：沿用原有会话、流式回复、工具卡片、模型/配置切换、历史导入与分叉、任务看板和 Git 界面。
- `src/main/kotlin/`：IDEA 工具窗口、本地服务生命周期、编辑器上下文、文件打开和主题同步。
- `runtime/server/cmd/idea-agent/`：插件专用本地启动入口。

服务只监听 `127.0.0.1` 的动态端口，插件自动启动和连接；关闭项目时退出。每个项目的插件配置保存在 IDEA 配置目录下的 `idea-ai-agent/<项目路径哈希>/`，原有会话仍使用 MindFS 的项目存储格式。CLI 的安装、登录和模型配置沿用 MindFS 原有能力。

插件入口关闭 Relay、Token Station、云端 Agent 配置拉取、服务自身更新和 PWA 入口；本机 Agent 仍按其配置连接模型服务。

每个工具窗口绑定当前 IDEA 项目。Git 项目支持会话和任务创建独立 worktree；项目添加、重命名、移除及跨项目切换由 IDEA 管理。Agent 命令遵循所选 CLI 的权限配置。

原生会话默认跟随本机 CLI 的模型、推理和权限配置，支持原生方案选择及授权交互。已确认的差异、0.1.2 修复和验证边界见 [原生能力核对清单](docs/native-agent-compatibility.md)。

## 客户运行要求

- IntelliJ IDEA 2024.1、2024.2、2024.3，使用 IDEA 自带且包含 JCEF 的运行环境。同一个插件 ZIP 覆盖这三个版本，社区版和旗舰版均通过 Plugin Verifier 兼容检查。
- 安装与操作系统、CPU 对应的插件 ZIP；至少安装并配置 Codex 或 Claude Code 等一个本地 Agent CLI。
- 业务项目可以继续使用 JDK 8。插件运行在 IDEA 自带的 Java 环境中，客户不需要为插件另装 JDK、Go、Gradle 或前端开发工具。

## 开发

开发和打包需要 JDK 21、Go 1.25+、Node.js 20+ 和 pnpm 12.4.1。插件以 IDEA 2024.1 SDK 编译，最低平台 build 为 `241`，生成 Java 17 字节码，并使用 Kotlin 1.9 语言/API 基线与 IDEA 提供的标准库。开发工具的 JDK 21 要求不适用于客户的业务项目。

```powershell
cd runtime/web
pnpm install --reporter=append-only
cd ../..
./gradlew.bat buildPlugin
```

macOS/Linux 使用 `./gradlew buildPlugin`。构建会编译 Web 前端和当前系统架构的 Go 服务，将服务与静态资源一起打入插件 ZIP，产物在 `build/distributions/`。

在 Windows 上交叉编译 Mac 包时，设置 `$env:GOOS = 'darwin'`，并设置 `$env:GOARCH = 'arm64'`（Apple 芯片）或 `'amd64'`（Intel），然后执行 `./gradlew.bat buildPlugin`。每次构建后及时将 ZIP 另存为对应架构的文件名；两个架构必须顺序构建，因为共用输出目录。恢复当前系统构建前清除这两个环境变量。

```powershell
./gradlew.bat runIde
```

开发使用独立的 IDEA 沙箱。至少安装并配置一个 Agent CLI；可通过原有 Agent 配置界面检查和切换配置。插件包按操作系统/CPU 构建，不能把 Windows 包作为 macOS/Linux 包使用。

## 使用

在 IDEA 的「Settings → Plugins → 齿轮 → Install Plugin from Disk」中选择生成的 ZIP，打开项目和右侧「AI Agent」工具窗口。

选中代码后通过右键「发送到 AI Agent」或 `Ctrl+Alt+A` 加入聊天草稿。没有选中内容时加入当前文件；未保存的编辑器内容会注明。添加上下文不会自动发送消息。模型执行结束后触发 IDE 文件刷新，会话中的文件链接可以打开当前 IDEA 项目内的文件。

## 验证

```powershell
./gradlew.bat test
./gradlew.bat verifyPluginProjectConfiguration verifyPlugin
cd runtime/web
pnpm run typecheck
cd ..
go test ./server/app ./server/cmd/idea-agent ./server/internal/api -run TestIDE
go test ./server/internal/agent ./server/internal/agent/codex ./server/internal/agent/acp
```

运行 `node scripts/smoke-runtime.mjs` 可验证本地服务和浏览器界面，需要本机 Chrome；仅验证 HTTP 时加 `--http-only`。测试使用空 Agent 配置，不调用模型。

项目保留 MindFS 的测试，原仓库中部分路径/权限测试依赖 Unix 语义。Windows 上的回归结果与实际验证范围见 [docs/validation.md](docs/validation.md)。

`verifyPlugin` 使用 JetBrains Plugin Verifier 检查 IDEA 2024.1、2024.2、2024.3 的社区版和旗舰版。首次执行会下载对应 IDE；报告写入 `build/reports/pluginVerifier/`。较新的 IDEA 版本仍需按实际验证结果确认兼容性。

## 来源

本项目复用 MindFS 源码，按 GNU AGPL v3 分发。来源、基线及修改范围见 [NOTICE.md](NOTICE.md)，许可证见 [LICENSE](LICENSE)。
