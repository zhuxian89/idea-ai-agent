# 原生 Agent 能力核对与修复（0.1.2）

执行代码、调用工具、推理、压缩上下文、使用项目指令和子 Agent 的主体仍是本机 Codex CLI / Claude Code。插件使用 Codex `app-server` 和 Claude Code `stream-json`；没有自行实现模型的工具循环。Go 传输层来自第三方 SDK，不能仅凭“使用 CLI”就承诺与终端交互功能完全一致。

| 已确认的问题 | 修复后的行为 | 验证 |
| --- | --- | --- |
| Codex SDK 按模型名字将 `max/ultra` 改为 `xhigh` | 原样传递用户选择；能力列表及不支持的参数由 CLI 判断，包括计划模式 | `TestNativeEffortIsNeverDowngraded`、`TestBuildTurnParamsPreserves*` |
| Claude SDK 固定旧默认模型，适配器又选择列表中的第一个模型 | 未选择时省略模型参数；读取 CLI 上报的实际模型 | `TestNativeOptionsInheritCLIConfiguration`、`TestNativeCLIFlagsAndArguments` |
| 0.1.5 及此前的默认模型修复只覆盖选项/传输层，SDK 构造器仍拒绝空模型，实际启动报 `model must be specified` | 0.1.6 在原固定版本 SDK 上仅移除“模型不得为空”的校验，允许 CLI 读取默认配置；显式模型、权限及其他校验保留 | `TestNativeCLIFlagsAndArguments` 先经真实 `NewClient` 再连接记录器，分别验证默认/显式模型；`TestNativeClientRetainsConfigurationValidation` |
| 新会话将缓存模型和推理档位当成用户选择 | 新会话的“默认”跟随 CLI；明确选择仍传递，已有会话保留其模型信息 | Go `TestNativeDefaultsDoNotPinCachedModelOrEffort`、前端 `native-defaults.test.mjs` |
| Claude 只加载 `user,project` 配置 | 实际启动参数加载 `user,project,local`；包含项目的本地设置 | 检查 SDK 实际生成的 CLI 参数 |
| 早期权限硬编码，用户无法选择 | 0.1.2 恢复 CLI 继承与授权交互；0.1.7 按用户要求在插件内提供原生权限选择并默认最高权限。已保存的普通权限保留，后端空模式调用继续继承 CLI，不自动允许工具回调 | 原生选项和权限等待测试；`TestNativePermissionModeChoices`、`TestNativeFullAccessAndPermissionDowngrade`、`TestNativePermissionCLIArguments`；打包浏览器权限切换检查 |
| Codex 的额外排版提示可能覆盖原生 developer instructions | 普通原生会话不注入该覆盖 | 适配器参数检查；显式开发者指令接口仍保留 |
| Claude 配置中的 CLI 附加参数未传递 | 保留顺序、重复参数和带空格的值；流式协议必需的三个参数冲突会明确报错 | `TestNativeCLIFlagsAndArguments` |
| 方案选择仅凭 WebSocket 发出就显示成功，且后端先写入已回答状态 | 后端接受答案后才更新记录及确认；断线、超时、过期显示错误，保留填写内容；重复答案不阻塞 | 前端 `question-delivery.test.mjs`；Go `TestAnswer*` |
| 等待选择可能阻塞 Codex 后续事件、取消或任务结束 | 询问独立等待，取消和答案接收只有一个终态；主会话及子会话串行处理事件和完成记录，避免工具回调与流输出竞争 | `TestPendingQuestionDoesNotBlockTurnCompletion`、`TestTurnUpdatesSerializeAndIgnoreLateCallbacks`、`TestNativeBackgroundCompletion*`、`TestCanceledNativeQuestion*` |
| IDEA 入口禁用会话及任务 worktree | Git 项目恢复会话和任务的独立 worktree，项目注册仍绑定 IDEA | `TestIDEProjectSupportsSessionAndTaskWorktrees`、打包界面冒烟 |
| 编辑器内容截取前 128000 字符 | 传递完整选择/文件内容，保留未保存内容与安全 Markdown 围栏 | `EditorContextTest` |

方案选择支持 Codex `request_user_input` 与 Claude `AskUserQuestion`，包括多问题、文字补充和 Claude 多选。协议测试验证答案映射回原生问题标识/问题文本；CLI 工具请求的允许或拒绝通过相同交互入口返回。Codex 会保留服务端提供的授权选项和结构化决定。

本机 CLI 的配置仍受其自身的项目信任规则、模型能力和权限规则约束。主动打开计划模式会切换原生计划模式；关闭时恢复已观察到的先前权限模式，尚未观察到时使用普通模式。新会话不会从插件缓存恢复旧的模型/推理/快速服务默认值，需要固定选择时在会话中明确选择。

保留的 IDE 生命周期与界面范围：关闭项目会停止本地服务；项目注册和跨项目切换由 IDEA 管理，文件跳转限于当前项目。Relay、Token Station 和远程配置同步仍关闭。插件不会为 CLI 新增终端命令或未来协议接口自动生成界面，因此本次修复不等同于承诺所有 CLI 版本和交互功能 100% 对等。

验证边界：本轮回归使用真实适配器和 SDK 的协议/参数构建逻辑、模拟协议输入、临时 Git 仓库、Kotlin 测试及打包浏览器冒烟，不调用付费模型。当前机器可发现 `codex-cli 0.154.0`，未发现 Claude Code；真实 IDEA/JCEF 内已登录模型的执行、审批与恢复仍需实机验证。完整构建记录见 [validation.md](validation.md)。
