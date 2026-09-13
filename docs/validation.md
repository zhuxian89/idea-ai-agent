# 验证记录

环境：Windows amd64、开发 JDK 21、Go 1.26.5、Node.js 20.18.1、pnpm 12.4.1。

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
