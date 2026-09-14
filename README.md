# Local AI Agent

在 IntelliJ IDEA 中使用本机 Codex、Claude Code 及 MindFS 已支持的 Agent。插件聚焦 Agent 配置与安装、聊天、聊天历史，复用 MindFS 已有的 Agent 执行和会话实现。

[下载 Windows / macOS 插件及查看安装说明](https://github.com/zhuxian89/idea-ai-agent/releases/latest)。每个平台的同一份插件包兼容 IDEA 2024.1、2024.2、2024.3。

当前版本为 **0.1.17**，更新说明见 [0.1.17 发布说明](docs/releases/v0.1.17.md)。

| 系统 / 架构 | 0.1.17 安装包 |
| --- | --- |
| Windows x64 | [windows-amd64.zip](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.17/idea-ai-agent-0.1.17-windows-amd64.zip) |
| Mac，Apple 芯片（M 系列） | [macos-arm64.zip](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.17/idea-ai-agent-0.1.17-macos-arm64.zip) |

Mac 包要求 macOS 12 或更新版本。可在「关于本机」查看芯片；请使用对应架构的 IDEA。各平台验证范围见发布说明。

0.1.3 修复了 Mac 从 Dock/Finder 启动 IDEA 时，终端可用的 CLI 在插件中无法识别的问题。插件使用 IDEA 从用户 shell 恢复的环境，让检测和执行继承相同的 `PATH`、Node 路径及 CLI 配置。升级后请完全退出并重新启动 IDEA；不需要重新安装 CLI。

0.1.5 继续保留用户 PATH 的优先顺序，并在 Mac 上补充 `~/.local/bin`、`~/.hermes/node/bin` 和 Homebrew 常见目录，覆盖运行期间新建的安装目录。进入配置页或刷新列表会立即检查 CLI 是否存在；安装输出在命令会话展示，执行后返回配置页即可重新识别。重启后检测结果会自动更新，连接错误会显示在对应 Agent 卡片上。

## 实现

0.1.17 接通 MCP 表单和 URL 确认、Codex 额外权限及 Claude 已知原生对话框，修复 Codex 高频事件丢失，并移除聊天输入区的 worktree 创建入口。

0.1.16 新增「加入当前文件」路径入口及文件右键入口，恢复回复思考强度和 Context，修复历史补录与每轮上下文快照保存。


0.1.15 修复重启后模型识别停在 `probe pending`、状态刷新遗漏及用户消息未贴齐右侧的问题。Agent 状态和错误摘要直接显示，“查看详情”和“重启 Agent”使用明确的文字入口。

0.1.14 将 Codex/Claude 共用工具过程改为默认折叠的轻量活动行，连续完成的普通操作可收成组；保留进展正文、最终回答、主动展开选择，以及“已等待”和“最近更新于”两项计时。修复真实 Codex 完整历史同步后重复显示包装命令、失败被误判为成功的问题。Claude 与 IDEA/JCEF 的剩余实机验收范围见发布说明。

0.1.13 修复原生标题栏按钮、发送后 Agent/模型串会话、异步选择题未等待回答、活动栏状态恢复和语言/外观持久化；同时包含此前本地测试版本的权限选择、消息同步与 Agent 管理改进。

0.1.8 修复队列快照过期和重连后残留、发送窗口漏显示正式消息的问题。等待区展示实际思考/工具/用户回答状态、已等待时间及最近更新间隔；运行中的工具保留原生状态。详情见 [0.1.8 本地测试版说明](docs/releases/v0.1.8.md)。

0.1.7 在 Agent / 模型旁增加执行权限选择，按本插件的使用要求默认使用 Codex 和 Claude Code 的原生最高权限；可以切回普通权限，切换模型保留已选权限。修复输入框仅接收图片粘贴、忽略普通文件的问题。详情见 [0.1.7 本地测试版说明](docs/releases/v0.1.7.md)。

0.1.6 修复适配层构造客户端时报 `model must be specified`，让 Claude 未指定模型时正常沿用 CLI 配置；补充真实构造器回归测试。顶部图标增加悬停提示，历史/配置支持再次点击收回，Agent / 模型弹窗固定两列；编辑器上下文和重连操作使用 IDEA 原生工具窗口按钮。

- `runtime/server/internal/agent/`：沿用 MindFS 的 Codex app-server、Claude Code SDK、ACP 适配器。
- `runtime/web/`：使用单栏插件界面，沿用原有会话、流式回复、工具卡片、模型/配置切换、安装更新、历史导入与分叉组件。项目列表、任务看板和独立文件/Git/Worktrees 面板不再出现在插件中。
- `src/main/kotlin/`：IDEA 工具窗口、本地服务生命周期、编辑器上下文、文件打开和主题同步。
- `runtime/server/cmd/idea-agent/`：插件专用本地启动入口。

服务只监听 `127.0.0.1` 的动态端口，插件自动启动和连接；关闭项目时退出。每个项目的插件配置保存在 IDEA 配置目录下的 `idea-ai-agent/<项目路径哈希>/`，原有会话仍使用 MindFS 的项目存储格式。CLI 的安装、登录和模型配置沿用 MindFS 原有能力。

插件入口关闭 Relay、Token Station、云端 Agent 配置拉取、服务自身更新和 PWA 入口；本机 Agent 仍按其配置连接模型服务。

每个工具窗口绑定当前 IDEA 项目。项目和文件管理由 IDEA 承担；新会话直接使用当前项目目录，输入区不提供 worktree 开关或分支选择，Agent 命令使用界面选定的原生权限模式。

模型和推理默认跟随本机 CLI 配置。插件内 Codex / Claude Code 未保存权限选择的会话默认最高权限；普通权限下保留原生授权交互，方案选择与计划模式继续可用。已确认的差异与验证边界见 [原生能力核对清单](docs/native-agent-compatibility.md)。

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

顶部提供新建会话、聊天历史、Agent 配置与安装三个入口。聊天、历史、配置在同一个工具窗口中切换，切换时保留输入草稿。配置页显示 Agent 识别状态和已获取的版本，提供添加/切换配置、安装更新、重启和列表刷新；外观与语言也保留在此页。所有操作复用原有表单和后端，安装更新继续通过原有命令会话展示执行过程。

配置页默认展示 Codex、Claude Code 和其他已安装的 Agent，其余未安装项收在“其他 Agent”中。

回复下方保留复制、分叉、模型、思考强度、时间、耗时和 Context 上下文占用（例如 `Context 42% (109K/258K)`）。Context 按每条回复保存，重新打开和离线查看时保留各自的快照；已有 Codex 历史会从本机原生记录补回缺失的思考强度和 Context。数据以实际记录为准，缺失时显示“未提供”，不使用当前配置或最新一轮数值推算旧回复。输入/输出 Token 和缓存命中率明细暂缓实现。

IDEA 原生标题栏保留新会话、历史、设置，网页内部不再重复显示同一工具栏；重新连接位于标题栏的更多菜单。

- 「加入当前代码」、编辑器右键「发送到 AI Agent」或 `Ctrl+Alt+A`：加入选中片段，没有选中内容时加入当前文件的完整内容；保留并注明未保存的编辑器内容。
- 输入框上方「加入当前文件」：只加入当前激活标签页文件的绝对路径。例如打开 10 个文件、正在查看第 8 个时，加入的是第 8 个文件的路径，由 Agent 按需读取磁盘文件，不粘贴全文或自动保存。
- 项目文件树或文件标签页右键「加入 AI Agent 对话」：只加入右击文件的路径，无需先打开该文件。

这些入口都会保留当前会话和已有草稿，不会自动发送消息。未保存的修改请继续通过「加入当前代码」提供，或先自行保存文件。模型执行结束后触发 IDE 文件刷新，会话中的文件链接可以打开当前 IDEA 项目内的文件。

## 验证

```powershell
./gradlew.bat test
./gradlew.bat verifyPluginProjectConfiguration verifyPlugin
cd runtime/web
pnpm run typecheck
node --test --test-concurrency=1 tests/*.test.mjs
cd ../..
node scripts/test-runtime.mjs
```

服务端测试脚本使用临时 HOME/配置目录，并移除继承的 `IDE_AGENT_DATA_DIR` 和模型认证变量，避免从插件内运行测试时写入正在使用的运行时配置；Go 构建缓存仍复用。脚本后面可以附加 `go test` 参数，例如 `node scripts/test-runtime.mjs ./server/internal/agent/claude -count=1`。

运行 `node scripts/smoke-runtime.mjs` 可验证本地服务和浏览器界面，需要本机 Chrome；仅验证 HTTP 时加 `--http-only`。测试使用空 Agent 配置，不调用模型。

项目保留 MindFS 的测试，原仓库中部分路径/权限测试依赖 Unix 语义。Windows 上的回归结果与实际验证范围见 [docs/validation.md](docs/validation.md)。

`verifyPlugin` 使用 JetBrains Plugin Verifier 检查 IDEA 2024.1、2024.2、2024.3 的社区版和旗舰版。首次执行会下载对应 IDE；报告写入 `build/reports/pluginVerifier/`。较新的 IDEA 版本仍需按实际验证结果确认兼容性。

## 来源

本项目复用 MindFS 源码，按 GNU AGPL v3 分发。来源、基线及修改范围见 [NOTICE.md](NOTICE.md)，许可证见 [LICENSE](LICENSE)。
