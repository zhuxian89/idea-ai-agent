# Local AI Agent

[中文](#中文) · [English](#english)

## 中文

在 IntelliJ IDEA 中直接使用本机 Coding Agent。Local AI Agent 的核心不是重新做一层聊天界面，而是把 Agent 在终端里的原生执行能力尽可能完整地带进 IDE。

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
| 上下文 | 展示每轮真实 Context 占用，并保留历史回复的上下文快照 |
| 项目规则 | 继续使用 CLI 自己的项目指令、配置、登录状态和 MCP 配置 |

Codex 通过原生 `app-server` 协议运行，Claude Code 通过原生流式协议运行；其他 MindFS Agent 可通过 ACP 接入。已核对的原生行为和验证边界见[原生能力清单](docs/native-agent-compatibility.md)。

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
- 在同一个侧边栏中完成聊天、历史恢复、Agent/模型切换、权限选择和 Agent 管理。
- 跟随 IDEA 深色/浅色主题，支持简体中文和英文界面。

#### 本机运行

插件自动启动随项目生命周期运行的本地服务，只监听随机的 `127.0.0.1` 端口，并使用临时令牌保护连接。会话和插件设置保存在本机。Agent CLI 是否向模型服务发送数据，取决于该 CLI 自己的配置和服务提供商。

### 安装

当前版本：**0.1.19** · [查看发布说明](docs/releases/v0.1.19.md)

| 系统 / 架构 | 下载 |
| --- | --- |
| Windows x64 | [idea-ai-agent-0.1.19-windows-amd64.zip](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.19/idea-ai-agent-0.1.19-windows-amd64.zip) |
| macOS Apple 芯片（M 系列） | [idea-ai-agent-0.1.19-macos-arm64.zip](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.19/idea-ai-agent-0.1.19-macos-arm64.zip) |

1. 下载与你的操作系统和 CPU 对应的 ZIP，不要解压。
2. 在 IDEA 中打开 **Settings → Plugins → 齿轮 → Install Plugin from Disk**，选择 ZIP 并重启 IDEA。
3. 打开项目，点击右侧 **AI Agent** 工具窗口。插件会自动检测已有 CLI 和配置。

最低支持 IntelliJ IDEA 2024.1，不设置最高版本限制。需要使用 IDEA 自带且包含 JCEF 的运行环境；macOS 包要求 macOS 12 或更新版本。业务项目可以继续使用 JDK 8，不需要为插件安装额外 JDK、Go、Gradle 或 Node.js。

### 使用

顶部的新建会话、历史和设置按钮用于切换主要视图。发送消息前可以选择 Agent、模型、思考强度和执行权限；未显式选择时继续使用 CLI 默认配置。

- **加入当前代码**：编辑器右键“发送到 AI Agent”或按 `Ctrl+Alt+A`。选中的代码会完整加入输入框，并保留未保存内容。
- **加入当前文件**：输入区按钮只加入当前激活文件的绝对路径，让 Agent 按需读取磁盘内容。
- **加入指定文件**：在项目文件树或文件标签页右键“加入 AI Agent 对话”，不会自动发送消息。
- **继续历史会话**：从历史页恢复会话、原生线程、回复元数据和已保存的 Context 快照。
- **切换权限**：最高权限适合让 Agent 连续完成任务；普通、只读等模式保留对应 CLI 的原生授权交互。

### 支持范围

- 原生重点支持 Codex CLI 和 Claude Code。
- 支持 MindFS 已配置的 ACP Agent；实际能力取决于各 Agent 暴露的协议功能。
- 插件最低平台 build 为 `241`，不设置 `until-build`，因此 IDEA 2024.1 及更高版本均可安装。
- IDEA 社区版和旗舰版 2024.1、2024.2、2024.3 已通过 JetBrains Plugin Verifier。这些是回归检查目标，不是最高可安装版本。
- 插件包包含平台相关的本地运行程序，请选择正确的操作系统和 CPU 架构。

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

项目复用 [MindFS](https://github.com/a9gent/mindfs) 的本地 Agent 与会话实现，并按 GNU AGPL v3 分发。第三方来源和修改范围见 [NOTICE.md](NOTICE.md)，许可证见 [LICENSE](LICENSE)，隐私说明见 [PRIVACY.md](PRIVACY.md)。

---

## English

Use locally installed coding agents directly inside IntelliJ IDEA. Local AI Agent is built to bring the Agent's native terminal capabilities into the IDE as faithfully as possible, rather than replacing them with a separate chat implementation.

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
| Context | Shows real context usage for each reply and retains historical context snapshots |
| Project rules | Uses the CLI's existing project instructions, configuration, authentication, and MCP setup |

Codex runs through its native `app-server` protocol, while Claude Code runs through its native streaming protocol. Other Agents supported by MindFS can connect through ACP. See the [native capability notes](docs/native-agent-compatibility.md) for verified behavior and test boundaries.

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
- Chat, restore history, select Agents and models, control permissions, and manage CLIs in one sidebar.
- Follow IDEA light and dark themes, with English and Simplified Chinese interfaces.

#### Local runtime

The plugin starts a bundled service for the lifetime of the project. It listens only on a random `127.0.0.1` port and protects the connection with an ephemeral token. Conversations and plugin settings stay on the local machine. Any data sent to a model service is controlled by the Agent CLI and its configured provider.

### Installation

Current version: **0.1.19** · [Release notes](docs/releases/v0.1.19.md)

| OS / architecture | Download |
| --- | --- |
| Windows x64 | [idea-ai-agent-0.1.19-windows-amd64.zip](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.19/idea-ai-agent-0.1.19-windows-amd64.zip) |
| macOS Apple Silicon | [idea-ai-agent-0.1.19-macos-arm64.zip](https://github.com/zhuxian89/idea-ai-agent/releases/download/v0.1.19/idea-ai-agent-0.1.19-macos-arm64.zip) |

1. Download the ZIP for your operating system and CPU. Do not extract it.
2. In IDEA, open **Settings → Plugins → gear icon → Install Plugin from Disk**, select the ZIP, and restart IDEA.
3. Open a project and select the **AI Agent** tool window on the right. The plugin detects existing CLIs and configuration automatically.

The minimum supported version is IntelliJ IDEA 2024.1, with no upper version limit. IDEA must use a bundled runtime that includes JCEF. The macOS package requires macOS 12 or later. Projects may continue using JDK 8; users do not need to install JDK, Go, Gradle, or Node.js for the plugin.

### Usage

Use the New Conversation, History, and Settings buttons at the top to switch views. Before sending a message, you can select the Agent, model, reasoning effort, and execution permission. Leaving them at their defaults preserves the CLI configuration.

- **Add current code:** choose “Send to AI Agent” from the editor context menu or press `Ctrl+Alt+A`. The plugin includes the complete selection and preserves unsaved editor content.
- **Add current file:** the composer action adds the active file's absolute path so the Agent can read it when needed.
- **Add a specific file:** choose “Add to AI Agent conversation” from the project tree or editor-tab context menu. Nothing is sent automatically.
- **Resume a conversation:** restore its native thread, reply metadata, and saved context snapshots from History.
- **Choose permissions:** Full Access supports uninterrupted task execution, while standard and read-only modes preserve the CLI's native approval interactions.

### Support matrix

- Codex CLI and Claude Code receive the deepest native integration.
- MindFS-configured ACP Agents are supported according to the capabilities exposed by each Agent.
- The minimum platform build is `241`; no `until-build` is set, so IntelliJ IDEA 2024.1 and later can install the plugin.
- IntelliJ IDEA Community and Ultimate 2024.1, 2024.2, and 2024.3 pass JetBrains Plugin Verifier. These are regression targets, not an installation ceiling.
- Plugin packages contain a platform-specific local runtime. Select the correct operating system and CPU architecture.

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

This project reuses the local Agent and session implementation from [MindFS](https://github.com/a9gent/mindfs) and is distributed under GNU AGPL v3. See [NOTICE.md](NOTICE.md) for third-party sources and modifications, [LICENSE](LICENSE) for license terms, and [PRIVACY.md](PRIVACY.md) for privacy details.
