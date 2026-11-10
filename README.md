# Local AI Agent

[中文](#中文) · [English](#english)

## 中文

在 IntelliJ IDEA 中使用本机 Codex CLI、Claude Code 和已配置的 ACP Agent，完成代码分析、修改、命令执行和审批。会话按项目保存，也可以通过浏览器或手机继续同一个项目。

> **最大限度还原原生 Agent 能力，零配置接入。** 如果 Codex CLI 或 Claude Code 已经能在你的终端中工作，安装插件后即可直接开始对话：无需复制 API Key、重复登录或重新配置模型与 MCP。

### 为什么选择 Local AI Agent

#### 尽可能完整地还原原生 Agent

插件不会自行重写模型的工具循环。代码读取与修改、命令执行、推理、上下文压缩、项目指令和子 Agent 仍由本机 CLI 完成：

| 原生能力 | 插件中的表现 |
| --- | --- |
| 原生会话 | 恢复和延续 CLI 会话，而不是把每条消息当成独立请求 |
| 模型与推理 | 默认跟随 CLI 配置，也可以按会话选择模型、思考强度和 Fast 模式 |
| 权限与计划模式 | 保留原生权限请求、只读/普通/最高权限选择以及 Plan Mode |
| 工具调用 | 实时显示读文件、改代码、执行命令、MCP 和子 Agent 等过程 |
| 原生交互 | 支持方案选择、异步提问、MCP 表单、URL 确认和额外权限申请 |
| 上下文 | 展示 CLI 上报的每轮 Context 占用、上下文压缩事件和已保存的历史快照 |
| 项目规则 | 继续使用 CLI 自己的项目指令、配置、登录状态和 MCP 配置 |

Codex 通过原生 `app-server` 协议运行，Claude Code 通过原生 `stream-json` 协议运行；其他 Agent 可通过 ACP 接入。早期原生协议修复记录见[兼容性说明](docs/native-agent-compatibility.md)。

#### 零配置接入

已经安装并登录本机 Agent CLI 时：

- 自动检测 Codex、Claude Code 和其他已安装的 Agent。
- 自动复用 CLI 的登录状态、默认模型、推理配置、项目配置和 MCP。
- 自动继承终端中的 `PATH`；从 Dock 或 Finder 启动 IDEA 时也能识别常见 CLI 安装目录。
- 不要求在插件中再次填写 API Key。

尚未安装 CLI 时，可以在插件的 Agent 配置页执行安装或更新，再按对应 CLI 的方式完成登录。插件不提供模型账户或模型额度。

#### 为 IDEA 工作流设计

- 通过编辑器右键或 `Ctrl+Alt+A` 把选中代码加入当前对话；没有选区时加入当前文件内容。
- 从输入区加入当前文件路径，或从项目文件树、文件标签页把指定文件加入对话。
- Agent 修改文件后自动刷新 IDEA；回复中的项目文件链接可直接打开。
- 每个工具窗口绑定当前 IDEA 项目，会话历史按项目保存。
- 用会话标签切换多个任务，从历史页搜索、置顶、重命名、导入和继续会话。
- 查看每轮文件差异，有快照的记录可打开 IDEA 原生对比窗口。
- 在同一个侧边栏中完成聊天、原生审批、Agent/模型切换、权限选择和 Agent 管理。
- 跟随 IDEA 深色/浅色主题，支持简体中文和英文界面。

#### 本机运行

插件自动启动随项目生命周期运行的本地服务，只监听随机的 `127.0.0.1` 端口，并使用临时令牌保护连接。会话和插件设置保存在本机。Agent CLI 是否向模型服务发送数据，取决于该 CLI 自己的配置和服务提供商。

#### 可选远程访问

默认远程服务为 [relay.20260310.best](https://relay.20260310.best)，由 `runtime/agents.json` 的 `relayBaseURL` 配置并随插件打包。

从 0.1.26 起支持多项目统一入口。点击插件右上角“远程访问”，再点“开启远程访问”，首次登录并连接访问服务，无需另装 MindFS。同一系统用户的多个 IDEA 项目共用一次绑定，每个项目分别选择是否开放。浏览器配对一次后可切换已开放项目；各项目继续使用自己的原有后台服务与会话，消息和执行进度实时同步。

- 手机扫描插件中的二维码后自动配对，不需要再输码。二维码携带访问凭据，请勿转发；页面读取后会清除地址栏中的配对参数。
- 电脑点击“打开浏览器”，或将“复制链接”得到的连接链接在自己的其他设备打开，即可自动授权，无需输入配对码。链接与二维码同样包含访问凭据，请勿公开转发；浏览器会记住授权。普通节点地址不会绕过验证。
- 开启过远程访问的项目，随 IDEA 打开自动加入统一入口，无需再打开插件面板。关闭 A 仅使 A 离线，B/C 保持可用；所有参与的项目服务退出后，统一入口自动结束。电脑需要联网，访问的项目需要在 IDEA 中打开。
- 主面板直接展示二维码和访问链接，并携带当前会话位置。“管理”统一控制已开放的项目；暂停一个项目只断开该项目，关闭电脑远程访问则断开所有远程连接，本地任务继续运行。关闭访问不会删除浏览器保存的授权。
- 远程端可以查看会话、审批和发送消息，浏览代码、Markdown、图片、PDF、DOCX、XLSX、PPTX 和 Git 差异，并编辑支持的 UTF-8 文本文件，保存时检测版本冲突。文件视图读取磁盘内容；IDEA 尚未保存的编辑不会同步。切换项目保留同一标签页的文字草稿，未保存文件编辑会先提示。
- 浏览器保存授权，连接失败可保留有效配对信息后重试。
- 在远程项目根目录的更多菜单中打开“定时任务”，设置 Cron 规则、Agent 和提示词，可编辑、启停、删除或立即执行，也可配置定期新建会话。定时执行需要对应项目在 IDEA 中保持打开。
- 浏览器文件视图支持按文件匹配项目自定义视图插件，加载新的或已变更的插件前需要确认信任。
- 电脑身份保存在 Windows `%APPDATA%\LocalAIAgent\remote\` 或 macOS `~/Library/Application Support/LocalAIAgent/remote/`，独立于项目和 IDEA 版本目录。项目历史数据不搬动。
- 旧项目通过同一个“开启远程访问”流程接入统一入口，其他项目点击“加入远程访问”复用已有绑定。准备完成前保留旧入口，不自动扩大旧项目访问权限；旧云端节点不自动删除。关闭面板后，未完成的连接仍可继续。

远程业务请求体和响应使用现有端到端加密协议，经 Relay 转发；Relay 仍可见连接元数据及请求地址。远程浏览器会保存配对凭据与文件/会话缓存，详见 [隐私说明](PRIVACY.md)。

### 安装

[GitHub Releases](https://github.com/zhuxian89/idea-ai-agent/releases)

1. 在 Releases 页面下载最新版本中与你的操作系统和 CPU 对应的 ZIP，不要解压。
2. 在 IDEA 中打开 **Settings → Plugins → 齿轮 → Install Plugin from Disk**，选择 ZIP 并重启 IDEA。
3. 打开项目，点击右侧 **AI Agent** 工具窗口。插件会自动检测已有 CLI 和配置。

最低支持 IntelliJ IDEA 2024.1，不设置最高版本限制。需要使用 IDEA 自带且包含 JCEF 的运行环境；macOS 包要求 macOS 12 或更新版本。业务项目可以继续使用 JDK 8，不需要为插件安装额外 JDK、Go、Gradle 或 Node.js。

### 使用

#### 开始对话与选择执行方式

1. 点击工具窗口顶部的新建会话按钮，在输入区选择 Agent。
2. 按需选择模型、思考强度、Fast 模式和执行权限。新会话的模型、思考强度和 Fast 默认跟随 CLI 配置，权限以输入区显示的选择为准。
3. 输入任务，按 `Enter` 发送；`Shift+Enter` 换行。中文输入法选词确认不会触发发送。

输入 `/plan` 可开启原生计划模式；输入区的 Plan 标记可关闭该模式。审批、方案选择、多问题表单和追问会直接显示在对话中，可选择选项、填写补充文字并提交。模型和交互选项取决于当前 Agent 提供的能力。

输入区的模式按钮还可切换到**命令模式**，选择本机 Shell 直接执行命令，输出保存为命令会话；**插件模式**用于让 Agent 生成项目文件视图插件，在远程浏览器的文件视图中使用。

#### 加入代码、文件和附件

- **编辑器内容**：右键“发送到 AI Agent”或按 `Ctrl+Alt+A`，将完整选区加入草稿；没有选区时加入当前文件内容，包含尚未保存的编辑。
- **文件路径**：点击“加入当前文件”，或在项目树、文件标签页右键“加入 AI Agent 对话”，将文件绝对路径加入草稿，供 Agent 读取磁盘内容。
- **控制台报错**：在 Run/Debug 控制台选中文字，右键选择“交给当前会话分析”或“在新会话中分析”。内容先进入草稿，不自动发送或打断执行；长选区保留首尾并标记省略，常见凭证会遮盖。发送前检查所选内容。
- **图片与附件**：点击输入区的附件按钮选择一个或多个文件，也可粘贴剪贴板图片或文件；发送前可预览图片、移除附件，上传时可查看进度和取消。
- **文件补全**：输入 `@` 搜索项目文件并插入文件引用。
- **技能与命令**：输入 `/` 搜索技能和当前 Agent 可用的斜杠命令。Codex 还提供 `/status` 状态查看与 `/login` 登录入口。
- **常用提示词**：输入 `#` 搜索、插入或管理已保存的提示词；对话中的用户消息也可以保存为提示词。

#### 管理与继续会话

- **会话标签**：从历史页打开或首次发送的会话会加入顶部标签，可快速切换并查看运行指示。关闭标签保留会话历史和后台任务，可从历史页重新打开；标签工作集保留到当前工具窗口关闭。
- **历史管理**：按项目搜索历史会话、置顶、重命名、删除，恢复原生线程、回复元数据和 Context 快照。
- **外部会话**：历史页的导入入口可按 Agent 查找并选择本项目已有的 CLI 会话，支持批量导入、隐藏已导入记录和后续同步。
- **会话分支**：在 Agent 回复下点击“从此消息 fork”，以该位置为起点创建并继续新会话。
- **消息导航**：输入区上方的“消息 N”打开当前会话的用户消息摘要，可跳转到对应消息。
- **草稿保留**：在会话间切换或打开历史、设置时保留各自的文字与附件草稿，保留期为当前工具窗口生命周期。
- **消息队列**：Agent 执行期间可以继续提交消息，排队内容显示在输入区上方，可编辑、删除或立即发送；停止按钮和 `Esc` 可取消当前轮次。

#### 查看执行过程与代码变化

- 两行活动区显示当前工具、命令、文件或计划步骤，并分别显示本轮耗时和距上次更新的时间；状态表情随活动变化，遵循系统“减少动态效果”设置。
- 展开工具活动可查看输入、输出和执行结果；对话还显示 Agent 上报的计划、待办、上下文压缩和子 Agent 活动。
- 每轮回复展示实际 Agent、模型、耗时及 CLI 提供的 Context 信息；历史记录保留已保存的数据。
- “本轮修改”汇总文件增删、重命名及行数统计，支持展开补丁、切换左右分栏；有前后快照的文件可点击“在 IDEA 中对比”。
- 关联文件可打开 IDEA 文件或查看当前 Git 差异；回复中的项目文件链接支持行号定位。
- 回复支持 Markdown、代码高亮与复制、表格、数学公式和 Mermaid 图。
- 断网和连接中断会显示状态提示，恢复入口可重新连接或重试。

#### 管理 Agent 与模型

设置页展示本机 Agent 的检测状态和版本，提供安装、重新检测、更新检查及可用更新的执行入口。Agent/模型选择器支持重启 Agent 和主动刷新模型列表，无需重启 IDEA。

点击 Agent 卡片上的“测试连接”，可读取模型列表、选择模型和测试消息，查看响应、耗时与成功或失败状态，并停止或重试。测试使用独立临时会话，不进入项目聊天历史。

外观可跟随 IDEA，也可手动选择深色或浅色；界面语言可切换为简体中文或英文。

#### 语音输入

点击输入区麦克风开始录音，浮层显示当前供应商、音量波形和时长。点击“停止并转为文字”后，识别结果插入草稿原光标位置，不自动发送。`Esc`、取消、切换会话或离开聊天页会取消本次录音。

在**设置 → 语音输入 → 配置与测试**中配置供应商，也可从录音浮层齿轮或工具窗口更多菜单进入。配置页可用当前表单录音测试，结果仅显示在窗口内；点击保存后生效。

| 供应商 | 配置 | 单次录音上限 |
| --- | --- | --- |
| 腾讯云 | `SecretId`、`SecretKey`；自动填写服务地址和 `16k_zh` 模型 | 60 秒 |
| 硅基流动 | API Key；自动填写服务地址和 `FunAudioLLM/SenseVoiceSmall` 模型 | 120 秒 |
| 自定义服务 | 兼容 `/audio/transcriptions` 的地址、模型和 API Key | 120 秒 |

首次录音需要允许 IDEA 使用系统麦克风。各供应商凭据分别保存在 IDEA 密码保险箱；录音保存在内存中，停止后直接发给所选语音服务。配置页提供开户、密钥、计费和限流说明链接。

### 支持范围

- 原生重点支持 Codex CLI 和 Claude Code。
- 支持已配置的 ACP Agent；实际能力取决于各 Agent 暴露的协议功能。
- 插件最低平台 build 为 `241`，不设置 `until-build`，因此 IDEA 2024.1 及更高版本均可安装。
- IDEA 社区版和旗舰版 2024.1、2024.2、2024.3 已通过 JetBrains Plugin Verifier。这些是回归检查目标，不是最高可安装版本。
- 支持 Windows x64/ARM64，以及 macOS Apple Silicon/Intel。
- GitHub Release 提供体积更小的单平台安装包；Marketplace 使用一个包含四种运行程序的通用 ZIP，插件会自动选择当前系统和 CPU 对应的程序。

### 开发与验证

开发和打包需要 JDK 21、Go 1.25+、Node.js 20+ 和 pnpm 12.4.1。插件以 IDEA 2024.1 SDK 编译，生成 Java 17 字节码。

```bash
cd runtime/web
pnpm install --reporter=append-only
cd ../..
./gradlew buildPlugin
```

生成的插件位于 `build/distributions/`。完整验证命令：

```bash
./gradlew test verifyPluginProjectConfiguration verifyPlugin
cd runtime/web
pnpm run typecheck
node --test --test-concurrency=1 tests/*.test.mjs
cd ../..
node scripts/test-runtime.mjs
```

每次打包前，还需在 `runtime/` 中确认旧库迁移回归通过：

```bash
cd runtime
go test ./server/internal/kanban -count=1
go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1
cd ..
```

统一打包脚本自动选择 JDK 21，构建前端与运行程序并校验 ZIP。`--verify` 为本地包增加 Gradle 测试和插件配置检查；正式包默认执行这两项检查：

```bash
node scripts/package-plugin.mjs local mac --verify
node scripts/package-plugin.mjs local mac-intel --verify
node scripts/package-plugin.mjs local win --verify
node scripts/package-plugin.mjs local win-arm --verify
node scripts/package-plugin.mjs release
```

本地包输出至 `build/local-packages/`；正式包输出至 `build/releases/<版本>/`，包含四个单平台包和一个 Marketplace 通用包。打包脚本的检查不替代上述前端、运行时和旧库迁移测试。构建与兼容性验证记录见 [validation.md](docs/validation.md)。

本项目按 GNU AGPL v3 分发。第三方来源和修改范围见 [NOTICE.md](NOTICE.md)，许可证见 [LICENSE](LICENSE)，隐私说明见 [PRIVACY.md](PRIVACY.md)。

### 社区

本项目认可并支持 [LINUX DO](https://linux.do/) 社区。

---

## English

Use locally installed Codex CLI, Claude Code, and configured ACP Agents inside IntelliJ IDEA to analyze code, edit files, run commands, and handle approvals. Conversations are saved per project, and you can continue the same project from a browser or phone.

> **Maximum native Agent fidelity with zero-configuration setup.** If Codex CLI or Claude Code already works in your terminal, install the plugin and start chatting. There is no API key to copy, no second login, and no model or MCP configuration to recreate.

### Why Local AI Agent

#### Faithful native Agent behavior

The plugin does not reimplement the model's tool loop. Reading and editing code, running commands, reasoning, compacting context, applying project instructions, and starting subagents remain the responsibility of the local CLI.

| Native capability | Behavior in the plugin |
| --- | --- |
| Native sessions | Resumes CLI sessions instead of treating every message as an isolated request |
| Models and reasoning | Follows CLI defaults or lets each session select a model, reasoning effort, and Fast mode |
| Permissions and planning | Preserves native permission requests, access levels, and Plan Mode |
| Tool calls | Streams file reads, code changes, commands, MCP calls, and subagent activity |
| Native interactions | Supports choices, asynchronous questions, MCP forms, URL confirmation, and additional permission requests |
| Context | Shows context usage reported by the CLI, compaction events, and saved historical snapshots |
| Project rules | Uses the CLI's existing project instructions, configuration, authentication, and MCP setup |

Codex runs through its native `app-server` protocol, while Claude Code uses native `stream-json`. Other Agents can connect through ACP. See the [compatibility notes](docs/native-agent-compatibility.md) for earlier native protocol fixes.

#### Zero-configuration setup

When a supported Agent CLI is already installed and authenticated, the plugin:

- Detects Codex, Claude Code, and other installed Agents automatically.
- Reuses CLI authentication, default models, reasoning settings, project configuration, and MCP servers.
- Inherits the terminal `PATH`, including common CLI locations when IDEA starts from the macOS Dock or Finder.
- Does not ask you to enter the same API key again.

If a CLI is missing, use the Agent configuration page to run its installation or update command, then authenticate using that CLI's normal flow. The plugin does not provide model accounts or usage credits.

#### Built for the IDEA workflow

- Add selected code with the editor context menu or `Ctrl+Alt+A`; when there is no selection, add the current file contents.
- Add the current file path from the composer, or add a specific file from the project tree or editor tab.
- Refresh IDEA after Agent file changes and open project file links directly from replies.
- Keep each tool window and its conversation history bound to the current IDEA project.
- Switch tasks with session tabs; search, pin, rename, import, and resume conversations from History.
- Review per-turn file changes and open IDEA's diff window for records with saved snapshots.
- Chat, handle native approvals, select Agents and models, control permissions, and manage CLIs in one sidebar.
- Follow IDEA light and dark themes, with English and Simplified Chinese interfaces.

#### Local runtime

The plugin starts a bundled service for the lifetime of the project. It listens only on a random `127.0.0.1` port and protects the connection with an ephemeral token. Conversations and plugin settings stay on the local machine. Any data sent to a model service is controlled by the Agent CLI and its configured provider.

#### Optional remote access

The default remote service is [relay.20260310.best](https://relay.20260310.best), configured by `relayBaseURL` in the bundled `runtime/agents.json`.

Starting with 0.1.26, projects can share one remote entry. Choose **Remote access**, then **Enable remote access** in the plugin toolbar. Sign in and connect the access service once. No separate MindFS installation is required. IDEA projects for the same OS user share the node and are enabled individually. A paired browser can switch between shared projects; each project retains its original backend, sessions and live progress.

- Scanning the plugin's QR code pairs the phone automatically. The QR code grants access; do not share it. The page removes the pairing parameter from its address after reading it.
- Choose **Open browser**, or open the **Copy link** access link on your other device. Authorization is automatic, with no code to enter. The link grants the same access as the QR code: keep it private. Browsers remember authorization; plain node URLs do not bypass authentication.
- Shared projects join the entry when opened in IDEA, without opening the plugin panel. Closing A only makes A unavailable; B/C continue working. The entry exits after all participating project services leave. Keep this computer online and the target project open in IDEA.
- The main panel shows the QR code and access link with the current conversation location. **Manage** controls shared projects: pause one project or disable the whole computer. Local tasks continue, and saved browser authorization is retained.
- Remote users can view sessions, handle approvals, send messages, browse code, Markdown, images, PDF, DOCX, XLSX, PPTX, and Git diffs, and edit supported UTF-8 text files with revision-conflict detection on save. File views read from disk; unsaved IDEA editor buffers are not synchronized. Text drafts survive project switches in the same browser tab; unsaved file edits require a decision before switching.
- Browsers retain authorization and can retry failed connections while keeping valid pairing.
- Open **Scheduled tasks** from the remote project's root-directory menu to configure Cron rules, an Agent, and a prompt. Edit, enable, disable, delete, or run tasks immediately, with an optional schedule for starting new sessions. Scheduled execution requires the project to remain open in IDEA.
- Browser file views support project-defined view plugins matched to files. Loading new or changed plugins requires a trust confirmation.
- Computer identity lives in `%APPDATA%\LocalAIAgent\remote\` on Windows or `~/Library/Application Support/LocalAIAgent/remote/` on macOS, independently of project and IDE version directories. Existing project history stays in place.
- Older projects use the same **Enable remote access** flow. Other projects choose **Share this project** to reuse the computer connection. Preparation failures retain the old entry without expanding its permissions. Closing the panel keeps a pending connection resumable. Old cloud nodes are not automatically deleted.

Remote business request bodies and responses use the existing end-to-end encryption protocol through Relay. Relay still sees connection metadata and request addresses. Browsers retain pairing credentials and file/session caches; see the [Privacy Notice](PRIVACY.md).

### Installation

[GitHub Releases](https://github.com/zhuxian89/idea-ai-agent/releases)

1. On the Releases page, download the ZIP for your operating system and CPU from the latest release. Do not extract it.
2. In IDEA, open **Settings → Plugins → gear icon → Install Plugin from Disk**, select the ZIP, and restart IDEA.
3. Open a project and select the **AI Agent** tool window on the right. The plugin detects existing CLIs and configuration automatically.

The minimum supported version is IntelliJ IDEA 2024.1, with no upper version limit. IDEA must use a bundled runtime that includes JCEF. The macOS package requires macOS 12 or later. Projects may continue using JDK 8; users do not need to install JDK, Go, Gradle, or Node.js for the plugin.

### Usage

#### Start a conversation and choose execution settings

1. Choose New Conversation in the tool-window toolbar, then select an Agent in the composer.
2. Choose a model, reasoning effort, Fast mode, and permission level as needed. New conversations follow CLI defaults for the model, reasoning effort, and Fast mode; permissions follow the selection displayed in the composer.
3. Enter a task and press `Enter` to send, or `Shift+Enter` for a new line. Confirming an IME composition does not send the message.

Enter `/plan` to enable native Plan Mode; close it using the Plan indicator in the composer. Approvals, choices, multi-question forms, and follow-up questions appear in the conversation, where you can select options, add text, and submit answers. Available models and interactions depend on the selected Agent.

The composer's mode button also offers **Command mode** to run commands in a selected local shell and retain their output as command sessions. **Plugin mode** lets an Agent generate project file-view plugins for the remote browser's file viewer.

#### Add code, files, and attachments

- **Editor contents:** use “Send to AI Agent” or `Ctrl+Alt+A` to add the full selection to the draft. With no selection, it adds the current file contents, including unsaved changes.
- **File paths:** choose “Add current file”, or “Add to AI Agent conversation” from the project tree or editor tab, to add the absolute path for the Agent to read from disk.
- **Console errors:** select Run/Debug output and choose “Analyze in Current Agent Session” or “Analyze in New Agent Session”. The selection enters a draft without sending or interrupting execution. Long selections retain the beginning and end with an omission marker; common credentials are redacted. Review the selection before sending.
- **Images and attachments:** choose one or more files using the attachment button, or paste clipboard images or files. Preview images and remove attachments before sending; uploads show progress and can be canceled.
- **File completion:** type `@` to search project files and insert a reference.
- **Skills and commands:** type `/` to search skills and slash commands available for the current Agent. Codex also provides `/status` and `/login` entries.
- **Saved prompts:** type `#` to find, insert, or manage saved prompts. User messages in a conversation can also be saved as prompts.

#### Manage and resume conversations

- **Session tabs:** conversations opened from History or started with a first message appear in tabs with running indicators. Closing a tab retains history and background work; reopen it from History. The tab set lasts for the current tool-window lifetime.
- **History:** search, pin, rename, delete, and resume project conversations with their native threads, reply metadata, and saved context snapshots.
- **External sessions:** use History's import entry to find this project's CLI sessions by Agent. Select multiple sessions, hide imported records, and synchronize later changes.
- **Conversation forks:** use “Fork from this message” below an Agent reply to start a new conversation from that point.
- **Message navigation:** the message-count button above the composer opens user-message summaries and jumps to the selected message.
- **Drafts:** switching conversations or opening History and Settings retains each conversation's text and attachment draft during the tool-window lifetime.
- **Message queue:** submit follow-up messages while the Agent runs. Queued messages appear above the composer and can be edited, removed, or sent immediately. Use Stop or `Esc` to cancel the current turn.

#### Inspect execution and code changes

- A two-line activity area shows the current tool, command, file, or plan step, with separate turn-duration and last-update timers. Activity emoji follow the current operation and respect the system's reduced-motion setting.
- Expand tool activity to inspect inputs, outputs, and outcomes. Conversations also display plans, todos, compaction events, and subagent activity reported by the Agent.
- Replies show the actual Agent, model, duration, and available CLI context information; saved metadata remains available in History.
- Per-turn changes summarize added, modified, deleted, and renamed files and line counts. Expand patches, switch to side-by-side view, or open IDEA's diff window for files with saved before/after snapshots.
- Open related files in IDEA or compare their current Git changes. Project file links in replies support line navigation.
- Replies render Markdown, highlighted code with copy controls, tables, math, and Mermaid diagrams.
- Network and connection failures show status feedback with reconnect or retry actions.

#### Manage Agents and models

Settings show local Agent detection status and versions, with installation, detection retry, update checks, and available update actions. The Agent/model picker can restart an Agent or refresh its model list without restarting IDEA.

Choose **Test connection** on an Agent card to load models, select a model and test message, and inspect the response, elapsed time, and success or failure status. Tests can be stopped or retried and use a separate temporary session outside project chat history.

Follow IDEA's appearance or select a light or dark theme manually. The interface supports English and Simplified Chinese.

#### Voice input

Click the microphone to record. The popover shows the provider, waveform, and duration. Stop recording to insert recognized text at the original draft cursor without sending. `Esc`, Cancel, switching conversations, or leaving the chat page cancels the recording.

Open **Settings → Voice input → Configure and test**, the recording popover's gear, or the tool-window menu. Record a test using the current form; results stay in the dialog, and settings take effect when saved.

| Provider | Configuration | Recording limit |
| --- | --- | --- |
| Tencent Cloud | `SecretId` and `SecretKey`; endpoint and `16k_zh` model filled automatically | 60 seconds |
| SiliconFlow | API Key; endpoint and `FunAudioLLM/SenseVoiceSmall` model filled automatically | 120 seconds |
| Custom service | A compatible `/audio/transcriptions` endpoint, model, and API Key | 120 seconds |

IDEA needs OS microphone permission. Each provider's credentials are stored separately in the IDE Password Safe. Audio stays in memory until recording stops, then goes directly to the selected provider. Account setup, key creation, billing, and rate-limit links are available in the configuration dialog.

### Support matrix

- Codex CLI and Claude Code receive the deepest native integration.
- Configured ACP Agents are supported according to the capabilities exposed by each Agent.
- The minimum platform build is `241`; no `until-build` is set, so IntelliJ IDEA 2024.1 and later can install the plugin.
- IntelliJ IDEA Community and Ultimate 2024.1, 2024.2, and 2024.3 pass JetBrains Plugin Verifier. These are regression targets, not an installation ceiling.
- Supported platforms are Windows x64/ARM64 and macOS Apple Silicon/Intel.
- GitHub Releases provide smaller platform-specific packages. Marketplace uses one universal ZIP containing all four runtimes, and the plugin selects the matching operating system and CPU automatically.

### Development and verification

Building requires JDK 21, Go 1.25+, Node.js 20+, and pnpm 12.4.1. The plugin targets the IDEA 2024.1 SDK and emits Java 17 bytecode.

```bash
cd runtime/web
pnpm install --reporter=append-only
cd ../..
./gradlew buildPlugin
```

The plugin ZIP is written to `build/distributions/`. Run the complete verification suite with:

```bash
./gradlew test verifyPluginProjectConfiguration verifyPlugin
cd runtime/web
pnpm run typecheck
node --test --test-concurrency=1 tests/*.test.mjs
cd ../..
node scripts/test-runtime.mjs
```

Before every package build, also run the existing-database migration regressions from `runtime/`:

```bash
cd runtime
go test ./server/internal/kanban -count=1
go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1
cd ..
```

The packaging script selects JDK 21, builds the frontend and runtimes, and validates ZIP contents. `--verify` adds Gradle tests and plugin configuration checks for local packages; release builds enable those checks by default:

```bash
node scripts/package-plugin.mjs local mac --verify
node scripts/package-plugin.mjs local mac-intel --verify
node scripts/package-plugin.mjs local win --verify
node scripts/package-plugin.mjs local win-arm --verify
node scripts/package-plugin.mjs release
```

Local packages go to `build/local-packages/`. Release artifacts go to `build/releases/<version>/` and include four platform packages and one Marketplace universal package. Packaging checks supplement the frontend, runtime, and migration tests above. See [validation.md](docs/validation.md) for build and compatibility verification records.

This project is distributed under GNU AGPL v3. See [NOTICE.md](NOTICE.md) for third-party sources and modifications, [LICENSE](LICENSE) for license terms, and [PRIVACY.md](PRIVACY.md) for privacy details.

### Community

This project recognizes and supports the [LINUX DO](https://linux.do/) community.
