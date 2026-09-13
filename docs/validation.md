# 验证记录

环境：Windows amd64、开发 JDK 21、Go 1.26.5、Node.js 20.18.1、pnpm 12.4.1。

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
