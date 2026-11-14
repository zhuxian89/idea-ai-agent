# 内置 Antigravity CLI 接入（2026-11-14，源码与测试完成，未打包）

范围：把 Google Antigravity CLI（命令 `agy`，ACP 协议）作为内置 agent 随 `runtime/agents.json` 提供，与 codex 同样由项目主动提供，不开放用户自行添加。本节只记录源码与测试结果；安装包未生成，安装包内 `agents.json` 尚未同步。

## 核实依据

- 本机 `agy` 版本 1.5.8，`agy acp` 为 ACP stdio 服务。ACP 协议版本为 1，与 `acp-go-sdk` 的 `ProtocolVersionNumber` 一致。
- 空 HOME 下 `initialize` 成功；`session/new` 返回 `-32000 Authentication required`，即未登录时如实报错。`authMethods` 为 Google 登录、Gemini Enterprise 登录、API Key、Agent Platform 四种。
- 官方安装脚本 `https://antigravity.google/cli/install.sh` 与 `install.ps1` 已下载到独立临时目录只读核对（未执行）。脚本从 `antigravity-cli-auto-updater` 下载清单，校验 SHA-512，安装到 `~/.local/bin/agy` 或 `%LOCALAPPDATA%\agy\bin\agy.exe`，并会后台自更新。
- 官方文档页未写明 `agy update` 与登录流程，因此：不写登录链接，只在 brief 中提示需先在 agy 中登录。
- 搜索摘要与官方文档页抓取结果在安装命令上不一致（文档页未写安装命令），因此最终以下载并阅读的官方脚本为准；registry 中的地址与该脚本来源一致。
- `agy install` 子命令只配置 PATH 与 shell 设置（`agy help install` 原文），不是下载器；脚本在下载二进制后会调用它。

## 变更

- `runtime/agents.json`：新增 `antigravity` 条目，置于列表末尾。安装命令 darwin/linux 用 `install.sh`，windows 用 `install.ps1`；更新命令 `agy update`；`versionArgs` 为 `--version`；`protocol` 为 `acp`；`args` 为 `["acp"]`；`configBackup` 为空。
- 置于末尾的原因：web 的默认 agent 逻辑取第一个 `available` 的 agent，若排在 codex 前，已安装并登录 agy 的用户会被改变默认选择。
- `runtime/web/public/assets/agents/antigravity.png`：由 Antigravity.app 的 `icon.icns` 导出 256px PNG。
- `src/main/kotlin/dev/ideaagent/RuntimeProcess.kt`：Windows 运行时 PATH 追加 `%LOCALAPPDATA%\agy\bin`（官方 `install.ps1` 的安装位置）。未追加此项时，即使 agy 已安装，应用也找不到它，状态会一直显示未安装。缺少 `LOCALAPPDATA` 时不追加，避免拼出错误路径。
- `src/test/kotlin/dev/ideaagent/RuntimeProcessTest.kt`：`windowsSearchIncludesNewNativeAndNpmInstallations` 增加该路径断言。
- `runtime/web/src/components/AgentIcon.tsx`：新增图标映射与名称分支（名字含 `antigravity`）。
- `runtime/web/src/services/agentSetup.ts`：`agentDisplayName` 增加 `antigravity` → `Antigravity`。
- `AgentSelector.tsx`、`AgentConnectionTest.tsx`、`IdeaAgentSettings.tsx`、`SessionList.tsx`：原先各自内联的 claude/codex 显示名三元式改为统一调用 `agentDisplayName`。`SessionList` 保留原 fallback：无 agent 时显示 `session.type`。

## 验证

- 新增 Go 测试 `runtime/server/internal/agent/shipped_antigravity_test.go`（4 条）：读取随包 `agents.json` 而非 testdata，断言命令、协议、参数、版本参数、安装/更新命令存在；断言 antigravity 不在首位；未安装时报告未安装；安装后只执行 `--version`、不启动 `agy acp`（脚本记录调用参数以证明）。
- 变异测试：把 antigravity 移到首位，顺序守卫测试失败；已恢复，与备份逐字节一致。
- 新增前端测试 `runtime/web/tests/agent-icon-antigravity.test.mjs`（4 条）：图标渲染为 `antigravity.png` 而非首字母回退；既有 agent 图标映射不变；真实 agy 错误 JSON `{"code":-32000,"message":"Authentication required"}` 归类为 `login`、无关错误归类为 `error`；显示名正确。
- 变异测试：删除图标分支后，图标测试失败；已恢复逐字节一致。
- Kotlin：`RuntimeProcessTest` 5/5 通过（JBR 21，`IntelliJ IDEA.app/Contents/jbr`）。变异测试：将 `LOCALAPPDATA` 项替换为 `null`（保证可编译）后，`windowsSearchIncludesNewNativeAndNpmInstallations` 因 `assertTrue` 失败，源码已恢复并重跑通过。
- Kotlin 全量（JBR 21，`./gradlew test`）：24 个套件、99 个测试，0 失败、0 错误、4 个跳过。跳过均为环境条件：`WindowsStandaloneInstallerCommandTest` 2 条需要 Windows；`RemoteHostTest`、`RuntimeCacheTest` 各 1 条需要 `IDE_AGENT_UPGRADE_TEST_RUNTIME`。
- 设置 `IDE_AGENT_UPGRADE_TEST_RUNTIME` 后，`RemoteHostTest.unversionedHostIsReplacedWithNewAssetsAndItsIdentityIsPreserved` 与 `RuntimeCacheTest.runningCoreResourcesSurviveUpdatesAndArePrunedAfterExit` 各失败 1 条。在未改动的 HEAD（`c4d7a16`，临时 worktree，已清理）上以相同方式复现，属既有问题，与本次改动无关：前者为测试临时目录中可执行文件 `Permission denied`，后者为插件包不含 `idea-agent-darwin-arm64`。本次未修复，留待升级链路负责人处理。
- 旧库迁移门禁（AGENTS.md）：`go test ./server/internal/kanban -count=1` 通过；`go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1` 通过。本次未改持久化代码。
- 排查记录：第一次变异是删除整行，导致语法错误，Gradle 在 `compileKotlin` 失败，并非断言失败；已识别并改用可编译的变异，未据此下结论。
- 真实端到端：临时测试经 `Prober.ProbeOne` 对真实 `agy` 探测（隔离 HOME），结果 `installed=true`、`version=1.5.8`、`protocol=acp`、`available=false`，未误报可用。临时测试文件已删除。
- 公开字段核对：`ProbeError` 的 JSON 标签为 `-`，不对外输出；`normalizeStatus` 会把它复制到公开的 `error` 字段。用真实 `agy` 经同步探测后执行 `setStatus`（与应用存储路径一致），API 返回的 `error` 为 `{"code":-32000,"message":"Authentication required"}`，与前端测试 fixture 完全一致。前端 `agentErrorMessage` 解析出 `message`，`agentSetupState` 归类为 `login`，界面显示"需要登录"。
- 时序注意：曾尝试经 `probeConfiguredAgents` 读取存储状态，但该调用异步写入，读取时拿到的是 `probe_pending: true` 的占位状态且无 `error`，该结果不代表最终状态，已弃用，以同步探测为准。
- 结果：Go `agent` 包全部通过；`go test ./...` 全量通过；前端 `node --test tests/*.test.mjs` 314/314 通过；`tsc --noEmit` 通过；`vite build` 通过，产物包含 `assets/agents/antigravity.png`，service worker 预缓存包含该文件；`gofmt` 与 `go vet` 对新测试文件无输出。
- `agy update` 核对：将 agy 复制到临时目录，在隔离 HOME 下运行 `update`，输出"已是最新版本"（1.5.8）；用户已安装的 `~/.local/bin/agy` 未被运行或修改，修改时间保持不变。`agy update` 在存在新版本时的真实行为未验证。

## 旧库与持久化

本次未修改任何持久化表结构、查询字段或读写模型，不涉及 `task_store.go` 迁移，因此不需要旧库升级用例。

## 未完成与风险

- 安装包：Mac 插件测试包 `build/local-packages/idea-ai-agent-0.1.27-local-macos-arm64.zip` 已生成（15,198,820 字节，SHA-256 `76a2470967d760c3c6c545c27ff49904f92810bceb5d5d800b36472e2c85ccaa`）。打包前门禁通过：kanban 全量、`-race` 旧库迁移、agent 注册表测试。打包命令 `IDEA_AGENT_JAVA_HOME=<IDEA JBR 21> node scripts/package-plugin.mjs local mac --version 0.1.27-local --verify`，Gradle test 与 verifyPluginProjectConfiguration 随打包执行并通过。包内核对：插件版本 `0.1.27-local`，`agents.json` 含 antigravity（command agy，protocol acp，args [acp]），web 含 `assets/agents/antigravity.png`，运行时 `idea-agent-darwin-arm64` 存在。
- 未安装到本机：当时 IDEA 2025.1 插件为 `0.1.26-local.26`，本机 `local-ai-agent` 后台运行中，替换需用户确认。Windows 包与独立包未生成。
- 真实登录后的 `session/new`、对话、工具调用与权限确认尚未验证；需要用户在已登录的 agy 上测试，或在明确授权后由我进行。
- 登录链接缺失：官方文档未给出可靠的登录步骤地址，未编造。
- 安装会修改 shell 配置：官方脚本调用 `agy install`，它会在 shell 配置文件末尾追加 `export PATH="$HOME/.local/bin:$PATH"` 并写入注释（隔离 HOME 的 `.zshrc` 验证）。应用的"安装"按钮执行的就是这条脚本，因此用户点击安装时 shell 配置会被改动。这是官方安装器行为，不是本次代码添加；需要在用户可见的文案或文档中说明。
- 更新检查未接入：`agents.json` 的 `updateCheck` 只支持固定 URL，未找到 agy 可用于查询最新版本的公开地址（官方文档未给出），因此未配置。结果是界面不会显示 agy 的"可更新"提示（`update_check_supported` 为 false），`agy update` 仅作为更新命令保留。
- `agy` 会在后台自更新，`updateCommands` 中的 `agy update` 在更新可用时执行的行为未在真实环境中验证。
- 验证过程产生的临时文件位于 `/tmp`（agy 副本、隔离 HOME、构建输出与日志），均未写入仓库；仓库中无残留测试文件。

# Windows .27 插件重打与发布（2026-11-13，已发布）

源码同步：用户授权 push，Windows 下载与日志修复、两项新增回归、Windows 测试环境及 SQLite 连接清理修正、三份交接资料共 9 文件随本次提交同步至 `main`。提交前 `git fetch origin` 确认本地与远端均为 `cb1ea91`，无分叉；Git 空白检查通过。相关回归、包核对和用户实测采用本节记录的结果。

用户验收补充：用户反馈“完美解决了”，确认本次 Windows 实际后台更新故障解决。首次安装与更新均调用 `StandaloneInstaller.kt:77` 的 Windows 命令及相同内置 `install.ps1`，此次下载跳转和 UTF-8 日志修复同时覆盖两条路径；首次安装额外传 `-DeferStart`。已通过的 `StandaloneInstallerTest.kt:96–109` 在空安装记录下验证下载、校验、解压、安装记录、版本与重复安装，使用临时包内安装桩，不注册真实系统任务；`WindowsStandaloneInstallerCommandTest.kt:14–34` 验证首次参数、中文错误及带单引号路径。全新 Windows 环境的真实计划任务注册、重启接入与登录自启仍待实机验收。本轮仅核对源码与同步交接，未另行安装或启动后台。

发布完成：`gh release upload --clobber` 顺序替换 `v0.1.27` 的 Windows x64 ZIP 与 `SHA256SUMS.txt`，新资产 ID 为 `741888281` / `741888811`。原生 Windows PowerShell `5.1.26100.9711` 使用本轮下载函数，从公开 URL 匿名重新下载两文件，逐字节及 SHA-256 与本地产物一致；日志 `build/reports/windows-0.1.27-public-plugin.log`。Release 元数据复核确认标题仍为 `0.1.27`，正文、标签和目标提交保持原值，其余 4 ZIP 的资产 ID、digest 和更新时间未变；报告 `windows-0.1.27-release-verification.json`。原包与发布前元数据保留于 `build/release-backups/windows-0.1.27/`。用户下一步重新安装插件、重启 IDEA 后重试后台更新；本轮未操作真实安装或后台。

当前结果：相关 Kotlin 回归 6/6 通过、0 失败/错误/跳过（完整安装 1、Release 查询 2、更新面板 1、Windows 启动命令 2），插件配置检查通过，`buildPlugin` 成功。Kotlin 命令显式传 `'-Pkotlin.compiler.execution.strategy=in-process'`，且 `-x buildRuntime` 复用此前成功生成的资源；日志 `build/reports/windows-0.1.27-kotlin.log`、`windows-0.1.27-build.log`。首次未整体引用该 PowerShell 参数导致 Gradle 把后半段当成任务名，已纠正启动命令。

候选包 `build/releases/0.1.27/idea-ai-agent-0.1.27-windows-amd64.zip` 已生成，15,769,797 字节，SHA-256 `8d1c18752f1c4ad8bed605311fe01e8b9be77a7b080c4c030e1a0ae18dcd6094`。以已验证原 Release 包为底包，仅换入本轮 Gradle 新 JAR；322 个条目列表相同，JAR 外所有文件（含运行程序与 304 个网页文件）逐字节一致。JAR 内安装脚本与当前源码一致，Shell 脚本与原包相同，测试类未打入，PE 架构和插件版本正确。其余 JAR 资源差异仅 XML/SVG 换行及 MANIFEST 的 Windows/JBR 构建元数据；生产 class 变化全部属于 `StandaloneInstaller`。报告 `build/reports/windows-0.1.27-package.json`，总校验文件仅替换 Windows x64 一行。

完整任务复核 `Review: PASS`：基线为本轮修改前源码（初始已有三份诊断文档）；检查下载流与元数据 `Content`、逐跳 HTTPS/五次请求上限、校验后安装、Windows 参数引用/退出码/UTF-8、首次延后启动与更新立即启动，以及 `AgentToolWindowFactory.kt:239–247` 的错误展示和成功重启消费者。附加测试变更仅清理临时 SQLite 连接、隔离 PS7 模块路径；生产数据库、Mac 命令及 Shell 脚本保持契约。code-simplifier 复核无进一步安全简化，源码无附加改写。最终任务差异与空白检查通过，用户后续实际更新反馈见本节顶部。

用户明确授权重打 `0.1.27` 插件并更新 GitHub Release，按当前 Windows x64 环境仅替换对应 ZIP 和总校验文件，其他平台包保持原值。原生 PowerShell 5.1 / pwsh 下载回归 2/2、0 跳过通过。首轮 `go test ./server/internal/kanban -count=1` 失败：18 个 service 测试的 TempDir 清理报告 SQLite 文件被占用，`Service.stores` 中的测试数据库连接没有关闭；迁移测试自身已有 Close。先补测试清理再复跑，生产数据库代码不改。前端 Volta pnpm shim 缺失，改用项目锁定的 `corepack pnpm` 准备依赖；Gradle 使用 IDEA JBR 21，构建准备中。此时 Release 尚未替换。

测试清理第一轮仅 Close，仍有一项因在途查询持有连接而失败，日志 `build/reports/windows-0.1.27-kanban-cleanup-first.log`；补上检查连接数归零后再清理临时目录，完整 kanban 复跑通过（29.356 秒），日志 `build/reports/windows-0.1.27-kanban.log`。本轮只改 `service_test.go` 的测试清理，任务库迁移和生产实现保持原样。Kotlin 编译 daemon 连续连接失败后已使用 Gradle 自带进程内回退；后续命令显式选择 in-process，不修改项目编译配置。

旧库迁移 race 通过（7.531 秒），日志 `windows-0.1.27-migration-race.log`；类型检查和 Vite 生产构建通过，入口仍为 `index-BCQTOTCL.js`。原生 Windows PowerShell 5.1 使用本轮下载函数下载真实 `.27` Windows 后台并完成 SHA-256 校验，摘要 `d9892e891e06bb5166949837f68f2a0e94ff467fd71082285787bd0934c64327`，仅下载未安装，日志 `windows-0.1.27-public-download.log`。

首轮 Kotlin：`WindowsStandaloneInstallerCommandTest` 两项通过，完整 `StandaloneInstallerTest` 在预期 SHA-256 断言处因 PowerShell 5.1 找不到 `Get-FileHash` 失败，原始 XML 保存在 `build/reports/windows-0.1.27-installer-first.xml`。测试从 PowerShell 7 启动 Gradle，继承的 `PSModulePath` 不匹配实际 5.1；测试夹具仅对 Windows 移除该环境键，让子进程自行生成 5.1 默认模块路径，Mac 及生产环境处理不改。修正后复跑与包核对结果见本节顶部。

# Windows 更新修复（2026-11-13，源码完成）

用户授权修复 Windows 下载跳转和日志编码，并确认 Mac 已实测正常。本轮起始基线仅三份交接资料已有诊断改动，生产源码无待提交修改；保留这些诊断记录。

- `scripts/install.ps1`：用 `HttpWebRequest` 禁用自动跳转后直接读取响应状态和 `Location`，消除 Windows PowerShell 5.1 将 `MaximumRedirection=0` 响应转成错误的差异。相对 Location 仍按当前 URI 解析，五次请求上限、逐跳 HTTPS 拒绝降级、测试专用下载地址覆盖和真实 HTTP 错误均保留。二进制按流写入下载文件，版本元数据仍返回字符串 `Content`；响应和流在 finally 中释放。下载及 SHA-256 校验完成后才调用原包内安装器。
- `StandaloneInstaller.kt`：仅 Windows 使用 `-Command`，在加载安装脚本前设置严格错误传播和无 BOM UTF-8 输出，与既有 `Files.readString(log)` 一致。脚本路径和版本作为 PowerShell 单引号字面量传递并转义内嵌单引号；首次安装仍加 `-DeferStart`，更新仍立即启动。原 Mac/Linux `/bin/sh` 命令及参数不变，`scripts/install.sh` 未改。
- `scripts/standalone/download-redirect.test.mjs`：真实本机 HTTP 服务覆盖 301/302/303/307/308、相对及多级跳转、二进制内容、版本元数据、五次跳转上限、缺 Location、404 和 HTTPS 限制。Windows 默认使用原生 `powershell.exe` 并补 pwsh（未安装时报告跳过），只调用下载函数，不调用安装或服务。
- `WindowsStandaloneInstallerCommandTest.kt`：两项 Windows 用例覆盖 UTF-8 中文错误、含空格/单引号路径、首次安装参数、更新不带延后启动参数以及成功/失败退出码，均使用临时脚本。

静态审查 `Review: PASS`：对照原始源码检查完整本轮生产差异、下载和校验消费者、安装锁/版本判断/状态回调，并追踪 `AgentToolWindowFactory.updateStandalone()` 将非零安装结果的 error 传给 `RemoteBackendUpdate`；错误仍为字符串，成功才续接并重启 IDEA。当前安装日志每次执行先覆盖，统一生产端 UTF-8 后无需猜测历史日志编码。code-simplifier 检查无进一步安全简化，未额外改写。Git 空白检查通过。

本轮没有编译、运行测试、安装、停止、重启、打包或更新在线入口；旧的全通过结论不覆盖本轮源码。待授权执行的 Windows 定向验证：

```powershell
node --test scripts/standalone/download-redirect.test.mjs
.\gradlew.bat test --tests dev.ideaagent.WindowsStandaloneInstallerCommandTest --tests dev.ideaagent.StandaloneInstallerTest
```

通过后再生成包含修复的 Windows 插件，并验证真实 IDEA 更新；打包前仍需项目规定的两项旧库必检。当前已发布 `.27` 插件及在线 PowerShell 脚本未更新，用户正在使用的程序未替换。

# Windows 实机更新失败（2026-11-13）

用户截图 `.mindfs/upload/2026-11-13/image (1).png`：当前后台 `0.1.26-standalone.13`，目标 `0.1.27`，点击更新后详情为 `Input length = 1`。

本机 `C:/Users/42169/AppData/Roaming/LocalAIAgent/remote/logs/install.log`（763 字节，修改时间 2026-11-13 09:07:16 +08:00）实际为 GBK，内容确认：

```text
Installing Local AI Agent 0.1.27 (windows/amd64)
Downloading https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.27/local-ai-agent-0.1.27-windows-amd64.zip
Invoke-WebRequest : 已超过最大重定向数。要增加允许的重定向数，请为 -MaximumRedirection 参数提供一个更高的值。
...ps1:30 字符: 25
FullyQualifiedErrorId : MaximumRedirectExceeded,Microsoft.PowerShell.Commands.InvokeWebRequestCommand
```

源码链路：`scripts/install.ps1:19-43` 为每跳 HTTPS 校验而使用 `MaximumRedirection = 0` 并在 catch 中取 Response 的状态及 Location；本次 Windows 调用在此报错，当前现场的手动重定向处理失败。`:70` 下载 ZIP，`:85` 才调用包内安装器，因此本次尚未执行后台替换。具体重定向错误对象与 Windows PowerShell 的兼容处理仍需在修复阶段复现确认，不能仅据提示把跳数调大。

第二层错误：`StandaloneInstaller.kt:67-73` 使用 `powershell.exe`，输出重定向至安装日志；`:86` 在非零退出时调用 `Files.readString(log)`，默认 UTF-8，遇到本次 GBK 中文错误字节发生解码异常；`:93-95` 只将异常 message 传入面板，原始下载错误被替换为 `Input length = 1`。

本轮为实际日志与静态调用链诊断；未修改生产源码、执行测试、安装、停止、重启或生成新包。接下来修复 PowerShell 重定向兼容和日志编码契约，补 Windows 原生回归，再复验插件更新流程。原有隔离下载、资产哈希及测试记录保留各自范围，本次 Windows 实机升级为失败。

# 全部源码同步（2026-11-13）

用户明确要求全部 push。远端 main 为 `5718d70`，本地 main 相对远端独有 8 个提交、落后 1 个提交；工作区有 197 个待提交文件（含删除），其中 11 个未跟踪文件，均纳入本次源码提交。`git diff --check`、`git diff --cached --check` 和 `runtime/web` 的 `npm run typecheck` 通过，常见私钥/GitHub token/AWS access key 格式扫描未命中。计划提交工作区后正常合并远端，不强推、不移动已发布标签，不重新打包或操作真实服务。首轮显式暂存列表包含已暂存删除的路径，`git add` 因路径不存在失败；后续命令误继续提交了旧暂存区。已改为先 `git add -u` 纳入全部已跟踪修改，再逐项加入未跟踪文件，并修订刚创建且未推送的提交，防止遗漏工作区最新内容。最终源码提交 `fd897a24070bd7bf20e56d265934a810382f8273`，197 文件、13475 行新增/2525 行删除，工作区清空。使用正常 merge 合并远端 `5718d70`，没有内容冲突；合并提交 `0b95c3a` 已成功推送 origin/main。原本地独有 8 个提交全部进入远端历史。此处既有全量测试记录保持各自时间与范围，本轮仅重新执行类型检查和 Git 空白检查，未重新打包、重跑全量或操作真实服务。交接状态随随后文档提交同步。

# 固定安装入口修正（2026-11-12，已完成）

最终 12 项安装脚本测试全部通过、0 跳过（`stable-installer-tests-final.log`），包括 Shell/PowerShell 同一在线脚本重复运行自动获取更高版本。通过隔离 worktree 将 `scripts/install.sh`、`scripts/install.ps1`、`scripts/standalone/version.txt` 与指南 4 文件提交并推送 main，提交 `5718d7034d0cb3d46aa5ac21c199c25f8a95d479`；原工作区和其暂存内容未移动或合并。固定 raw 两入口与版本标记均匿名 HTTP 200、源码哈希一致（`stable-installer-public-urls.json`）。

`.27` 在线附件已去默认锁版，更新两脚本及各自校验文件共 4 资产，匿名 HTTP 200、哈希一致（`stable-installer-release-public.json`），其余程序包保持原值；校验清单已更新。Release 说明和本地/已发布指南使用固定 URL。版本化目录仅用于实际程序包下载，用户入口不再随版本改变。

实际下载公网固定入口，默认均读取 `0.1.27` 元数据，真实下载、校验 SHA-256 并解压 Mac ARM64 / Windows x64 发布包。末尾调用包内安装器时用进程桩截断，未安装、停止或重启用户真实服务。证据 `stable-installer-live-download.json` / `.log`。未来后台发布需同步发布版本元数据，用户仍使用同一 URL。原构建 30 资产报告是历史快照，在线四资产以本轮报告为准；程序包哈希未变。当前工作区保留打包器与测试改动，main 本次只发布上述四个入口相关文件。

用户指出在线脚本地址不应带版本。确认公网 main 的 `scripts/install.sh`、`.ps1` 都是 404，版本元数据同样未发布；根脚本实际已有默认读取最新版本元数据的逻辑，但打包器另将在线附件的默认版本替换为构建号。已将指南改为固定 raw 地址，在线附件改为直接复制源脚本，显式指定版本参数保留。不增加运行时依赖或自动重试。新增 Shell 连续两次运行（元数据从 2.0.0-standalone.1 更新至 2.0.1）和 PowerShell 连续两次运行（3.0.0 到 3.0.1）用例。首轮 PowerShell 元数据用例因测试 HTTP 服务把 version.txt 错标 application/octet-stream，导致响应 Content 为 byte[] 而 Trim 失败；已将测试服务元数据 MIME 改为与真实 raw 一致的 text/plain，未给生产代码添加兜底。首轮日志 `stable-installer-tests.log`，完整复跑 `stable-installer-tests-final.log`。接下来补 Shell/PowerShell 同一脚本连续读取元数据更新的行为验证，隔离发布脚本与版本标记至 main，再验证真实固定 URL。

# 市场历史版本补录（2026-11-12，已完成）

已公开 `v0.1.24` 与 `v0.1.25`，标题分别仅 `0.1.24` / `0.1.25`，各 5 个原始 ZIP 和原校验清单共 12 个资产匿名 HTTP 200、SHA-256 与本地一致。两版未重新编译；对应源代码 release 提交是当时发布提交。7 个市场版本的日期已在发布说明中记录，保留原说明；GitHub 发布字段记录本次补录时间，未伪造历史发布时间。最新标记仍为 `v0.1.27`，未更改或上传 Marketplace。验证：`market-history-public-assets.json` / `.log`、`market-history-release-check.json` / `.log`；10 原 ZIP 本地校验报告 `market-history-0.1.24-0.1.25-local.json`。未删除其他正式历史版本或改动安装目录。

用户粘贴市场正式序列和日期：0.1.26（11-01）、0.1.25/24（10-29）、0.1.23（09-19）、0.1.22（09-17）、0.1.21/20（09-15）。GitHub 原来缺少 .24/.25，并非本轮清理删除；本地 `build/releases/0.1.24/`、`.25/` 各 5 个历史 ZIP 及 SHA256SUMS 保留。10 个 ZIP 与各自原校验清单一致，ZIP 完整性、plugin.xml 版本通过，报告 `market-history-0.1.24-0.1.25-local.json`。使用原始包归档，不重新构建旧版本；市场日期写入说明，GitHub 本次归档的上传时间由平台记录。对应发布源码提交为 04efa59（.24）和 5590b55（.25），均有当时 release 提交，且是远端 main 的祖先。两版各六个资产（含原 SHA256SUMS）已进入 GitHub 草稿上传，记录 `market-history-restore-upload.log`；其他五个既有正式版本的说明保留，并增加用户提供的市场发布日期。

# 统一 0.1.27 版本包（2026-11-12，已发布并清理）

最终结果：GitHub `v0.1.27` 插件与 `standalone-v0.1.27` 后台均已公开，30 资产匿名下载 HTTP 200、大小及 SHA-256 与本地一致（`release-0.1.27-public-assets.json`）。前端真实选择器与新 `.27`、旧 `.26` 插件包内真实 Kotlin 查询类使用公网 Release 数据，在六个平台都发现 `0.1.27`，并确认旧测试后台可升级（`release-0.1.27-discovery-{frontend,kotlin}.log`）。未发布 JetBrains 市场，未安装或重启真实服务。

随后删除 11 个过渡测试 Release（`.8` 至 `.18`，含 `.16`）、84 个本地过渡文件或目录；执行前已确认无运行进程引用这些目录，28 个受保护正式文件哈希保持原值，所有正式历史 Release 保留。删除记录及旧资产元数据：`release-0.1.27-cleanup-{manifest,result}.json` 与 `.log`。旧测试标签不带安装包，作为源码引用保留。按用户后续截图要求，GitHub 新旧 Release 标题均改为纯版本号，安装包与更新说明不变（`release-version-titles.json`）。


用户最新指示覆盖此前只补平台的安排：保留截图市场正式版本，最新改为 `0.1.27` 并出所有平台。插件构建默认与后台版本文件均改为 `0.1.27`。将生成四平台及通用插件、六平台独立后台与在线/单文件脚本；只上传 GitHub，不发布插件市场；新下载入口验证后删除所有旧测试 Release，包括原先为兼容临时保留的 `.16/.18`。既有市场正式包、真实安装目录及用户数据不改。

插件五包已生成（Windows x64/ARM64、Mac Apple Silicon/Intel 与通用 ZIP），97 项 Kotlin 无失败/跳过，11 项安装脚本（包含便携 PowerShell）通过。六平台后台首轮生成后，发现打包 README 仍指向即将删除的 `.13`；已把中英文指南的安装链接和配套版本更新至 `0.1.27`，同时同步已有新版提示/常显启停入口描述，六平台后台重打以纳入新指南。插件市场未发布。

最终前端全量 310/310、0 失败/跳过（`release-0.1.27-web-tests-final.log`）；Go 全量、Kotlin 97/97、脚本 11/11 和两项旧库必检通过。5 个插件包与 6 个后台压缩包、4 个 Unix 单文件脚本和两个在线脚本共 30 个发布资产完成核验：304 网页文件一致、142 个插件 class 一致、XML 版本、PE/Mach-O/ELF 架构、指南/安装器及 SHA-256 通过，原生 ARM64 版本和签名通过。核验脚本首轮把原生版本输出误认为纯数字，实际为 `Local AI Agent 0.1.27`，修正匹配后通过，未改程序。报告 `release-0.1.27-packages.json`；正在创建并上传 GitHub 草稿，尚未公开和清理。发布标签沿用远端 main 的 `6d6d9e8`，构建来源为当前未提交工作区，未替用户提交或推送源码。

前端首轮全量由执行者在仓库根目录启动，部分旧用例使用相对 `src/...` 路径，因 ENOENT 失败（`release-0.1.27-web-tests.log`），已停止并切换 `runtime/web` 目录复跑（`release-0.1.27-web-tests-final.log`），未修改测试或生产逻辑。Go 后端全量通过（`release-0.1.27-go.log`），类型/构建通过，插件和安装脚本测试进行中。插件 XML 补充本版本的中英文更新说明。

前一阶段四平台 `.26` 已生成并上传 `.18`；八个插件资产匿名 HTTP 200/哈希一致，用户随后改为本次统一版本要求，旧包待新版本就绪后一并清理。

# 补齐插件平台与清理过渡包（2026-11-12，进行中）

用户允许清理后续过渡包，明确保留 `0.1.26` 及更早版本，不发布市场。沿用 `.26` Mac ARM64 与 `.18` 后台，补齐 Windows x64/ARM64 和 Mac Intel 插件；不重打独立版。公开 Release 选择器按平台要求同版本压缩包和 SHA-256，因此保留六平台后台 `.16`，否则 Windows/Intel/Linux 安装入口会失效；`.18` 仅有 Mac ARM64 后台。两项旧库必检通过（`plugin-platforms-kanban.log` / `plugin-platforms-migration-race.log`）。Windows x64 插件 `.26` 已生成，类型检查、生产构建、97 项 Kotlin（0 失败/跳过）与架构检查通过；其余两平台打包、下载发布与清理待执行。清理清单和旧 Release 元数据已保存于 `build/reports/plugin-platforms-cleanup-manifest.json`。

四个平台插件 `.26` 已齐，沿用原 Mac ARM64（SHA-256 保持不变），新增 Windows x64/ARM64 与 Mac Intel。四包 304 网页文件、142 个 class 逐字节一致，插件 XML 版本和 PE/Mach-O 架构检查通过；类型/生产构建均通过，Kotlin 97/97 无跳过，报告 `build/reports/plugin-platforms-package.json`。新增六个资产正在上传既有 `.18` GitHub Release，公网校验与清理尚未完成；未调用 Marketplace 发布任务。

# 当前实现：远程故障隔离（2026-11-11）

当前状态见 [计划与进度](README.md)。以下本轮记录优先于后面的历史阶段描述。

## 项目名称与会话层级调整（2026-11-12）

### Mac .26 / .18 打包与发布

按用户要求生成 Mac ARM64 插件 `.26` 和配套独立后台 `.18`；独立模式的页面由后台提供，因此两包配套。两项打包前旧库必检、97 项 Kotlin 测试（0 失败/跳过）、类型检查和生产构建通过。插件和独立包的 304 个网页文件逐字节一致，包含项目分组/缩进容器，网页入口由 `.17` 的 `index-Cw3bKZuh.js` 更新为 `index-BCQTOTCL.js`。版本、架构、安装器一致性、SHA-256、ARM64 原生版本和签名检查通过。报告 `project-hierarchy-mac-package.json`；相关日志 `project-hierarchy-mac-{package,standalone-package,kanban,migration-race}.log`。当前上传 Release 草稿中，尚未操作用户实际安装。

随后 `.18` Release 已公开，4 个分发文件及各自校验文件共 8 个资产匿名 HTTP 200、SHA-256 与本地一致（`project-hierarchy-mac-public-assets.json`）。真实前端选择器从公网发现 Mac ARM64 `.18`（`project-hierarchy-mac-release-discovery.log`）。本次只发布 Mac ARM64，沿用此前远端 target `6d6d9e8`；构建来自未提交工作区，标签源码归档不包含全部构建改动。没有操作用户真实安装，用户实测待反馈。

用户截图 `image (14).png` / `image (15).png` 指出项目名太小且展开后层级不对。现状：左侧根项目 13px/500，右侧项目标题 12px/600 且为辅助文字色；右侧主会话未在项目下缩进，文字起点甚至位于项目标题之前。

`FileTree` 仅将 managed root 的字号改为 14px、字重 600；普通目录/文件字号保持现有规则。`workspaceSidebar.css` 将右侧项目标题改为 14px/600 和主要文字色。多项目会话列表增加明确的 `workspace-project-sessions` 容器，使用左侧缩进和细线表达归属；不同项目之间增加 10px 间距，保留既有主会话 13px、子会话 12px 及递进缩进。调整仅在两侧组件内。

已有双主题浏览器用例补充两侧项目字形及实际坐标关系检查（主会话位于项目标题右侧、子会话位于主会话右侧）。8 项浏览器回归全部通过、0 跳过，涵盖子会话展开/结束状态/分页/项目折叠、菜单、接力与调度、双主题对比度及手机布局；类型检查通过。两张截图已查看：`output/playwright/remote-workspace-implemented/project-names-{light,dark}.png`。日志 `build/reports/project-name-hierarchy-{tests,typecheck}.log`，尚未生成新安装包。

## 远程面板新版提醒与服务管理布局（2026-11-12）

### Mac 测试包 .25 / .17 已发布

用户随后反馈仍为旧界面。截图 `image (12).png` 确认插件已安装 `.25`；`image (13).png` 的独立后台行仍显示 `.16`，已检测到 `.17` 并提供“更新并重启”。截图说明当前只完成插件更新，后台页面仍来自 `.16`；本轮没有清缓存、安装或重启后台，待用户在现有设置中升级 `.17` 后验收。

用户要求 Mac 测试包。独立模式的网页由 Core 提供，仅替换插件不会更新其页面，因此配套生成插件 `.25` 和独立后台 `.17`，发布后台供插件检测；不更新用户真实安装。两项打包前 kanban 旧库必检通过，日志 `remote-update-mac-{kanban,migration-race}.log`。后台 ARM64 包已生成，原生 `-version` 与 codesign 验证通过。

插件首轮 97 项 Kotlin 检查中 1 项失败：执行者错误地将 `IDE_AGENT_UPGRADE_TEST_RUNTIME` 指向独立 `local-ai-agent`，该测试需要插件 `idea-agent` 的旧远程入口。首轮日志保存为 `remote-update-mac-package-first.log`；从既有 `.24` 插件提取正确程序，在临时目录中重跑后 97/97 通过、0 跳过，未修改测试或生产源码。

最终插件 `build/local-packages/idea-ai-agent-0.1.26-local.25-macos-arm64.zip`；后台目录 `build/standalone/0.1.26-standalone.17/`。插件版本、两端 ARM64 架构、304 个网页文件逐字节一致、更新提醒/服务管理标记、安装器与校验和通过；26 个表情资源文件保留，其中 11 个 WebP、12 个 SVG、3 个说明文件。报告 `remote-update-mac-package.json`，构建日志 `remote-update-mac-package.log` 和 `remote-update-mac-standalone-package.log`。

`.17` Mac ARM64 测试 Release 已公开，4 个分发文件及各自校验文件共 8 资产匿名下载 HTTP 200，SHA-256 与本地一致（`remote-update-mac-public-assets.json`）。前端真实选择器从公网发现 Mac ARM64 `.17`（`remote-update-mac-release-discovery.log`）；其他平台未在本 Release 发包。沿用此前 Release target `6d6d9e8`，构建仍来自未提交工作区，标签源码归档不包含全部构建改动。本机后台与插件没有被安装或重启，真实验收由用户执行。

用户已反馈从真实 IDEA 插件手动升级 `.16` 成功，随后要求首页提示新版，以及将启停按钮放到独立后台附近常显。没有安装、升级或重启用户实际后台。

- `RemoteAccessDialog` 打开且独立模式准备好时即通过既有 IDEA bridge 检查版本；浏览器复用从 `RemoteBrowserUpdate` 提取的检查 hook。检查从设置页挂载改为面板生命周期，切换首页/设置不重复请求。
- 首页设置旁显示圆点和“有新版本”按钮，鼠标或键盘可直接进入设置。更新仍需点击原“更新并重启”按钮；检查失败在设置中显示，不影响访问操作。
- `RemoteBackendUpdate` 接收服务管理内容，版本、检查更新、服务状态和启停按钮放在同一区域。运行时重启/停止常显，停止时显示启动；故障排查仅保留连接状态、地址与错误详情。沿用原控制 bridge、禁用条件与本地聊天提示。
- 浏览器首轮新增提醒断言因按钮内 status 元素影响可访问名称而失败；显式设置与可见文字一致的 `aria-label` 后，最终相关 13 项测试全部通过，0 跳过。类型检查和生产构建通过；375/900px、中英文、深浅色、键盘进入设置与故障排查折叠时服务按钮常显均通过，8 张截图已检查。构建保留既有大 chunk 提示。
- 本轮界面变更已纳入上述 Mac `.25/.17` 包。截图输出 `output/playwright/remote-update-notice/`，最终测试与构建日志保存在 `build/reports/remote-update-notice-*.log`。

## 用户真实升级失败与 .16 停止等待修复（2026-11-12）

用户手动在 IDEA 从 `.14` 升级 `.15`，截图及 `logs/install.log` 均报告 `local data service did not finish stopping`。Core 日志：21:00:09 收到 `/control/stop`，关闭 Cursor 开始；21:00:19 才记录 Cursor 关闭超时，随后 Hermes/OpenCode 关闭完成，恰与升级器固定 10 秒期限重叠。只读确认当前已安装版本仍为 `.14`，现场 Core/Gateway PID 已由用户操作变为 `1560`/`1556`。原日志留存在 `build/reports/standalone15-upgrade-failure-{install,core}.log`，本轮没有重试真实安装或停止服务。

用户明确要求持续定时等待。`backend.StopCore` 去掉固定 10 秒截止，每 100ms 检查数据锁是否释放；调用方取消时返回取消错误，真实锁错误直接返回。保留等待数据写入者退出后才替换程序的保障。Shell/PowerShell 包内安装器增加等待停止阶段提示。

另一个根因由隔离真实子进程测试复现：ACP waiter 使用 `proc.waitCh <- cmd.Wait()`，而 `Close` 清空 `proc.waitCh`；退出时 waiter 可能向 nil 通道发送，`Close` 因而等满 10 秒。新增 `TestProcessCloseReceivesChildExit` 在修复前真实等待 10.001 秒后失败（`standalone-upgrade-acp-close-before.log`）。waiter 在启动 goroutine 之前保存通道，避免并发读取可清空字段，未调整 Agent 的关闭超时。

新增 Core 停止回归使用临时 HTTP 服务和真实临时文件锁，覆盖持锁超过 10 秒仍等待、锁释放后成功，以及调用方取消不会释放活跃写入者的锁。修复后 ACP/停止回归 race 通过（`standalone-upgrade-stop-after.log`），Go 后端全量、两项 kanban 旧库必检、11 项安装脚本全通过且无跳过。前端源码未变，沿用 `.15` 构建的 304 文件，未重复执行前端回归；`.15` 的首轮失败与复跑记录继续保留。

额外使用已发布 `.14` 原生程序及 `.16` 的真实包内安装器，在临时 HOME、发现目录和安装目录复验升级：配置隔离 ACP 进程，使旧 `.14` 仍经历退出通知问题的 10 秒等待；新安装器持续等待，11.439 秒后成功切换到 `.16`，保留安装目录的测试文件。Core PID 从测试进程 `13073` 变为 `13142`，临时 Core/Gateway 自启任务已通过 `-unregister` 清理。报告为 `standalone16-old14-upgrade.json` 和同名 `.log`，未操作用户真实安装。

六平台包、四个 Unix 单文件安装器及两个在线脚本均已生成，共 24 资产；包内版本、架构、304 个网页文件、脚本与源码一致性及 SHA-256 通过，原生 ARM64 签名和 `-version` 通过（`standalone16-package.json`）。新增两个回归测试已显式加入 Git。

`.16` 测试 Release 已公开发布，24 个资产逐一匿名下载均为 HTTP 200，内容 SHA-256 与本地一致（`standalone16-public-assets.json`）。从 `.24` 插件包提取的真实查询类在六个平台发现 `.16`，并判断 `.14` 可更新（`standalone16-packaged-release-discovery.log`）。用户真实插件升级待反馈，本轮未安装、升级、停止或重启用户本机后台。完整包路径 `build/standalone/0.1.26-standalone.16/`，校验和已同步到本入口的 `SHA256SUMS.txt`。

## 独立包 .15 升级测试准备（2026-11-12）

用户反馈停止独立远程后插件表现正常，并要求出 `.15` 独立包，随后自行测试插件内升级。按当时源码构建、验证并发布测试 Release，未安装或重启本机服务，未修改升级停止流程。发布前已说明升级仍会重启聊天 Core，既有停止超时未修复。`.15` 已发布，24 个公开资产 HTTP 200、逐文件 SHA-256 与本地一致（`standalone15-public-assets.json`）；`.24` 实际插件 JAR 的查询类在六个平台发现 `.15` 并识别 `.14` 可更新（`standalone15-packaged-release-discovery.log`）。用户实际升级失败见上节。

- 构建完成六平台包、四个 Unix 单文件安装器和两个在线安装器，共 12 个分发文件及其 SHA-256，24 个待发布资产。各包 304 个网页文件与本次 dist 逐文件一致，安装脚本与源码一致，Go 架构及嵌入版本核对通过，原生 ARM64 `-version` 返回 `.15`、ad hoc 签名验证通过；Intel Mac 程序未签名。报告 `build/reports/standalone15-package.json`。
- Go 后端全量、两项 kanban 旧库必检、前端类型检查及构建通过；安装脚本 11/11，通过便携 PowerShell 执行，0 跳过。日志为 `build/reports/standalone15-{go,kanban,migration-race,typecheck,web-build,installer-tests}.log`。
- 前端全量首轮 310 项中 308 通过、2 失败：实际为中文输入组合结束后立即 Enter 发送用例超时及其父测试失败。所属 `idea-chrome.test.mjs` 单独复跑 23/23 通过，未修改测试或产品代码。保留首轮 `standalone15-web-tests.log` 和复跑 `standalone15-idea-chrome-rerun.log`，不将首轮写成全通过。
- 包校验脚本首轮误以为 `go version -m` 必然包含链接器 `-X` 参数而中止；本次 Go 构建未保留该字段，改用二进制嵌入版本与原生 `-version` 核验，六平台均通过，未重建或修改包。
- Release 首次以本地提交 `b426c37` 为 target 被 GitHub 拒绝（该提交不在远端）。已按 `.14` 的既有发布方式使用当前远端 main `6d6d9e8` 建立草稿，再上传资产；二进制实际来自本地 `b426c37` 基线和未提交工作区，Release 标签不代表全部构建源码。资产上传与公开下载验证进行中。

## 用户要求停止远程以测试插件（2026-11-12）

用户明确要求“停止本地的，我试试插件表现”，结合前文独立远程误停止场景，执行前说明只停止本机独立远程服务并保留聊天进程。先核实安装路径及两端实际 `.14` 状态，再执行 `env -u MINDFS_RELAY_BASE_URL /Users/hongweizhang/Applications/LocalAIAgent/local-ai-agent -stop`，退出码 0。

执行后 `host.json` 不存在，原 Gateway PID `79110` 已退出；Core `/control/status` 返回 HTTP 200，PID 仍为 `78880`，版本仍为 `.14`。未停止或重启 Core，未执行升级或卸载。保持远程停止，由用户测试真实插件聊天；当前只确认进程和状态接口，插件聊天结果待反馈。

## 远程与本地聊天生命周期核对（2026-11-12）

用户要求核对上一轮关于“两个后端必须按项目抢锁”的判断。本轮读取迁移历史末 20 条，确认两条硬要求：IDEA 关闭后远程仍可聊天，独立远程停止或故障不影响本地聊天。用户禁止擅自升级和使用子代理，当前任务为诊断；历史卸载操作未完成，本轮不继续操作服务。

### 已核实的调用关系

- `LocalRuntime.kt:71–75`：独立模式经 `ensureLocalCore` 启动或复用 Core，并直接连接。插件已携带可启动 Core 的程序，但可能复用安装目录中的运行进程。
- `remote_gateway.go`：远程请求经 `coreProxy` 转发；Gateway 的 `/control/stop` 取消自身 context，不停止 Core。`backend/core.go` 通过独立登录服务或 detached child 启动 Core。
- `cmd/mindfs-server/cli.go:200–237`：普通 `-stop` 停 Gateway 并移除 gateway 登录任务；`-unregister` 额外调用 `stopLocalCore` 和 `RemoveLoginServices`。
- `scripts/standalone/install.sh:24–35`、`install.ps1:22`：安装器停止 Gateway 后再停止 Core，然后替换共享的程序与网页资源。问题不止停止超时；直接删除停止调用仍需解决活动资源替换与 Windows 可执行文件占用。
- `backend.Acquire` 的全局模式锁保证现有内置与共享 Core 互斥。`session/manager.go:1191–1204` 复用内存会话，`:529` 按缓存记录数量分配下一条 seq。因此“空闲释放项目锁、另一进程接管写入”还需设计缓存失效及 Agent 状态交接，不能只替换一把锁。

### 现场与验证范围

只读核对 `installation.json`、进程及两端 `/control/status`：本机 Core 版本 `.14`、PID `78880`、地址 `127.0.0.1:60895`；Gateway 版本 `.14`、PID `79110`、地址 `127.0.0.1:7441`。两端当前使用 `/Users/hongweizhang/Applications/LocalAIAgent/local-ai-agent`，进程均独立于 IDEA 存活。本轮未执行安装、卸载、重启、升级或降级，未输出控制令牌。

本轮完成源码和运行状态核对，未执行故障注入或升级复现。生产源码未改、未运行回归或生成安装包；此前测试通过不能覆盖新提出的升级/卸载不中断本地聊天要求。

### 修订建议与待办

保持唯一聊天数据写入者，让插件可独立提供和启动聊天运行时；该运行时的安装资源、自启与更新不归可选远程包所有。IDEA 直连聊天进程，远程入口只转发；IDEA 关闭不结束仍服务远程的运行时，远程退出和维护也不结束本地聊天进程。

此建议需要真实分离资源和生命周期，不能仅调整名称或去掉 `-stop-core`。聊天运行时自身的新版本需独立安排切换，保留运行中的程序和资源；不能承诺共享聊天引擎自身崩溃时任务不中断。具体版本管理与旧安装迁移方案待确认，尚未实施。

后续验收应直接观察同一条本地 WebSocket、运行中的 Agent 任务和会话写入，在远程停止、异常退出、升级、卸载期间持续可用；另验证 IDEA 退出后远程仍可继续发消息。使用临时安装和数据目录，真实面板升级由用户保留的测试流程验收。

## 2026-11-12 本轮修改卡片跨轮重复（源码与验证完成）

用户截图在新回答开头显示上一轮的 15 文件、+187/-42。本地真实会话 aux 中 seq=271 正好是该统计，seq=273 保存的是 12 文件、+290/-23，未发现这两轮落盘 diff 重复。消息记录存在 seq 缺口，前端历史合并按 seq 去重；`buildBaseTimeline` 却为没有 seq 的流式文本按消息条数推算编号，并用它查历史 aux，导致新回答显示旧卡片。

修复前新增单元测试 5 项中 3 通过、2 失败：缺号历史后的无 seq/seq=0 回答重复卡片、多段流式回答重复卡片。新增浏览器回归也复现新回答开始后应有 1 张、实际有 2 张卡片，日志 `turn-diff-ownership-before.log`。`buildBaseTimeline` 现仅用消息自带的持久化 seq 查历史 aux，不再把显示位置用作辅助记录身份。

实际历史只读回放：截取到 seq=271 并按生产逻辑按 seq 合并后共 269 条消息。追加新用户消息与流式回答，旧实现精确显示前轮 15 文件、+187/-42，修复后新轮无旧卡片；报告 `turn-diff-ownership-session-replay.json`，未改动用户会话文件。

最终验证（均从 `runtime/web` 执行）：

- `env -u MINDFS_RELAY_BASE_URL node --test tests/turn-diff-timeline.test.mjs tests/turn-diff-model.test.mjs tests/turn-diff-ownership-browser.test.mjs tests/turn-diff-workspace.test.mjs tests/session-settings-change.test.mjs tests/session-settings-change-browser.test.mjs`：17/17，0 跳过。工作区 diff 浏览器测试同时执行真实 Go `TestCommandOnlyTurnDiffSurvivesSendAndReload`；新增远程浏览器用例覆盖流式多段回答、纯解释轮完成、后续新修改、刷新与旧卡片展开。
- `env -u MINDFS_RELAY_BASE_URL node --test tests/activity-history.test.mjs tests/reply-metadata.test.mjs tests/session-stream-lifecycle.test.mjs tests/activity-segment-grouping.test.mjs tests/user-summary-jump.test.mjs`：22/22，0 跳过。
- `npm run typecheck`、`npm run build`、工作区及暂存区 `git diff --check` 通过；生产入口 `assets/index-DEepKwe8.js`。日志分别为 `turn-diff-ownership-{tests,related,typecheck,build}.log`。

本轮源码仅改辅助记录归属条件，保留已有会话设置改动；新浏览器测试已显式 Git 跟踪。尚未重新打包、发布或更新真实服务，已发布 .21/.11 不含修复。

## 2026-11-12 远程频繁重连排查

- **17:14:06 按用户“算了不采集了”停止。** 对 PID 69554 核对可执行文件和本轮目录后发送 SIGTERM，已观察到 `discovery_restored` 并确认进程退出。Core remote 恢复为 127.0.0.1:51477；Core/Gateway 控制接口 200、PID 16884/16881 不变，远程入口 200 且不含诊断脚本。本轮没有浏览器样本，无需用户刷新。退出证据 `build/reports/reconnect-observer-stopped.json`；当前无运行中的采集，排查暂停，未确认根因。
- 停止前于 17:12:43 恢复过一次采集，原计划 24 小时，实际仅运行约 83 秒。诊断工具新增 WS 握手进入/失败记录、每 5 秒本机 Core/Gateway/连接器状态采样；浏览器所有事件显式记录 hidden，并将队列从 300 提到 2000，覆盖此前 1307 条丢失的实际缺口。新增 health.go 已显式 Git 跟踪。两项 Go/race 通过，JS 语法和 diff 检查通过；实际 Gateway 4 次心跳 0.698–1.441 ms，HTML/脚本均 200。证据 `reconnect-observer-resumed-tests.log`、`reconnect-observer-resumed-smoke.json`。只改诊断工具，产品连接参数未改，没有生成安装包。
- 17:08 复核完整 4 小时记录，报告 `build/reports/reconnect-incident-review-20261112.json`。手机后续页面 `mwcx0ymg-291mya` / 客户端 `web-1794449711182-hy1giyz8` 的 2449 次已配对 Core 心跳中位数 0.268 ms、最大 20.512 ms；2445 次浏览器往返中位数 355 ms、最大 3542 ms。原 09:22 页面采到 213 对心跳，未出现主动 close。
- **真实前台故障**：浏览器时钟 13:06:23.101 发送 `ping-24a48f3d-72ca-412a-9161-c64e0f4f84e7`，13:06:25.102 主动 close，`age_ms=2000`、`hidden=false`、`state=1`，关闭快照的线程延迟为 0（日志 omitempty），未记录同期线程卡顿。对应 ping 在 Core 边界完全缺失；上一条 ping 的 Core 接收/回复仅隔 0.326 ms。同一 connection=8 于 13:06:39–13:09:09 每 30 秒仍完成原生 opcode=9/10 控制心跳，由本机连接器自动应答。说明该次中断发生在到达 Core 观测边界之前，不能归因于 Core 收到心跳后的业务阻塞。现有观测点仍不能区分本机连接器读流与其上游传输。
- 前台故障后记录 39 次 opening、38 次失败连接，13:09:14.653 的 socket=493 打开，从主动关闭到恢复为 169553 ms。其中多次握手被前端 5 秒期限结束；这是恢复阶段的实际行为，尚不能证明超时配置导致初始传输中断。原本机旧连接到新 client_id 注册替换时才关闭。
- **另一个后台样本**：13:03:38 的主动 close 为 `hidden=true`、探测 age=3007 ms；Core 对同一探测 0.293 ms 内回复。该样本不能解释用户描述的前台故障。11:25:53–12:02:00 还有一次长连接中断，浏览器队列仅保留 300 条，seq 2070→3378 丢失 1307 条，起因缺失，不能拿后续握手失败补推原因。诊断接收端会把未提供 hidden 的事件序列化为 false，判断前后台应使用明确采集该字段的 snapshot / visibility / event_loop_delay，不能用 open/pong 的默认 false 判断页面状态。
- 代理 13:18:44 写入 `discovery_restored` 并退出，Core 同秒记录该代理连接 EOF，13:18:46 重建；这一次关闭由诊断结束造成，独立计数。17:05 实查代理 PID 已不存在，当前 Core remote 为 127.0.0.1:51477，运行 `.13` 的 Core/Gateway PID 16884/16881 自 14:04:17 未变。14:18:09、14:24:42 的远程 code=1000 与 15:39:56 的 EOF 是后续关闭记录，当前没有浏览器分段观测；13:59–14:04 临时升级任务循环停止是其他工作已定位并修复的独立事件，不能替代本问题根因。
- 本次仅重新分析日志并同步交接，产品代码与连接参数保持原样，未重新启动诊断或生成安装包。下一步需观测本机连接器收到上游帧、向 Gateway 发出帧及握手的各段时间；保持云端不改动。
- 截至 09:26 手机观测汇总：54 次 Core 往返最大 0.607 ms；53 次完整浏览器往返中位数 329 ms、最大 488 ms，尚无带诊断的主动关闭事件。09:24:21 后该页 visibility 为 hidden，期间约 1 秒的定时器延迟属于后台样本，不能用于解释此前前台故障。汇总工具 `scripts/diagnostics/reconnect/analyze.py` 按客户端和探测 ID 关联，去重上传批次；结果 `build/reports/reconnect-live-summary.json`。本机对同一会话做 Chromium 6 倍 CPU 限速加载也未复现断连；该页面有已有未跟踪文件 diff 的 HTTP 400 及 relay/tips 404，未发现诊断代理错误，未据此归因。根因仍待真实复发证据。
- 最新现场：用户提供两张相同断连截图，日志确认刷新后的客户端于 09:07、09:08、09:12–09:14 仍复发，故刷新仅暂时恢复。快照目录 `build/reports/reconnect-recurrence-20261112T091516/`。
- 按用户“尽量自行完成、除非无法替代才配合”的要求，新增独立诊断工具 `scripts/diagnostics/reconnect/`；未修改 SessionService、Core 或 Gateway 产品源码。工具将原始升级字节流直接转发，仅旁路提取心跳 ID/方向/时间、大帧大小；为远程入口 HTML 注入记录脚本，上传连接事件、最后收包间隔、发送积压、前台线程延迟。失败批次留在该标签页 sessionStorage，刷新后继续上传。没有记录聊天正文、附件、Cookie 或令牌。
- 临时接入：2026-11-12 09:18:44，PID `1476`，监听 `http://127.0.0.1:62497`，原 Core remote 为 `http://127.0.0.1:50933`。只原子替换发现文件的 `remote_url`；Core PID 48682、Gateway PID 48681 仍自 07:30:20 运行。四小时到期或 SIGTERM 后，只在描述符仍为本工具写入内容时恢复原值。私有备份、元数据和事件位于 `~/Library/Application Support/LocalAIAgent/remote/diagnostics/reconnect-20261112T091844/`，入口信息在 `build/reports/reconnect-observer-live.json`。当前手机实例为 `web-1794446557491-b77tuvs6`；`observer-live-check` 和 `web-1794446446441-nn7cd1s8` 是本机验证连接，分析时区分。
- 验证：`go test -race ../scripts/diagnostics/reconnect/main.go ../scripts/diagnostics/reconnect/frames.go ../scripts/diagnostics/reconnect/main_test.go -run 'Test(FrameObserver|DiagnosticProxy)' -count=1` 两项通过，覆盖真实 HTTP/WebSocket 原样转发、分片/掩码解析、凭据检查与不记录业务正文；日志 `reconnect-observer-go.log`。临时文件/进程验证正常到期、SIGTERM 和新 Core 描述符保护三项通过，见 `reconnect-observer-lifecycle.json`。
- Playwright CLI 加载真实 SessionService 的隔离网页，正常心跳、2.5 秒迟到回复触发断连、2.6 秒前台阻塞记录及刷新后继续上传均验证；证据 `build/reports/reconnect-browser/events.jsonl` 和 `summary.json`。迟到回复记录与 2000 ms 主动 close 对应；线程阻塞最大记录 2556 ms。实际 Gateway HTML 和脚本返回正常，四次本机 WebSocket ping/pong 往返 0.76–1.53 ms。手机 09:22 刷新后已收到 observer_loaded/open/心跳事件，正常浏览器往返约 320–350 ms，Core 回复约 0.2 ms，并记录一次前台线程延迟 1244 ms；该延迟暂未与断连对应。
- 后续用户明确优先定位 root cause；故障时始终在前台，08:56:40 刷新或重新打开页面后恢复。Core/Gateway 未重启。本轮没有修改产品连接行为。
- 实际日志时序：旧客户端创建于 08:44:40.283；08:47:03 至 08:55:54 的 15 次 code=1000、空原因关闭，时间减去客户端创建的整秒后，全部 `% 3 == 2`，与每 3 秒探测后再等 2 秒的超时节拍一致。08:56:05 的 EOF 与 08:56:37 的 code=1001 不符合该节拍，分开记录。08:56:40 新客户端 `web-1794444997694-xizhjss6` 建连后，观察窗口内未记录断连。详细快照 `build/reports/reconnect-review-timeline.json`；这是直接触发路径的强证据，尚不能解释响应延迟的来源。
- 复审用 `node build/reports/reconnect-review-probe.cjs` 转译实际 `session.ts`，以模拟 WebSocket 和确定性时钟执行七组隔离探针，结果 `build/reports/reconnect-review-probe.json`：2.5 秒回复会反复重连；持续握手失败 40 秒仍约每秒重试，原因包括每次 onclose 延长快重连窗口，以及 3 秒 watchdog 绕过已安排的退避；隐藏页面仍探测；6 秒握手会被 5 秒计时反复中止。它们验证机制，不能替代实际事故的根因证据。
- 修正前轮建议的证据等级：旧探测超时已由 `activeProbeId` 校验保护，隔离探针未出现误关新连接；发送前计时在 E2EE 异步准备时可复现，但当前 SharedCore 关闭 E2EE，不能解释当前实例；写入上限 5 秒与前端 2 秒不是同一计时范围，无法证明发生过锁等待。
- 当前诊断缺口：远程 Core 入口直接包装 mux，未经过 HTTP 耗时日志；业务 ping 的接收/回复及锁等待无日志，前端仅输出通用超时警告；Gateway 关闭错误也未包含完整方向与耗时。下一步需在实际复发时关联同一 client_id/probe_id 的浏览器发送与处理、Gateway 转发、Core 接收与回复时间，才能区别后端响应、转发和前端处理延迟。无需调整云端 Relay。
- 用户确认发生于手机/浏览器远程访问。只读检查产品源码、安装网页、进程和日志，本轮仅同步排查记录。
- `~/Library/Application Support/LocalAIAgent/remote/logs/core.log`：客户端 `web-1794444280283-3w6e2vj8` 在 08:47–08:53 记录 14 次 `read.closed`，均为 code=1000、空原因；08:50:45、08:50:51、08:50:57 连续关闭重连。其他连接于 07:53:24、07:56:57 明确返回 code=1001、`WebSocket is closed due to suspension.`。关闭码经 Relay 桥接，不能单凭 Core 日志确认浏览器原始原因。
- `SessionService` 每 3000 ms 探测，2000 ms 未收到消息即 `reconnectNow()`；调用异步 `sendWSMessage()` 后立即计时。已安装网页 `~/Applications/LocalAIAgent/web/assets/index-M8pZm7QT.js` 同样为 `probeTimeoutMs=2e3`、`reconnectWatchdogMs=3e3`。短暂远程延迟被主动重连放大是主要嫌疑，仍需浏览器端 probe timeout 记录或复现验证。
- PID 48681/48682 均自 07:30:20 运行，实际程序为 `~/Applications/LocalAIAgent/local-ai-agent`。对应时段 `standalone.log` 无 Relay 主通道重连记录；存在 yamux missing-stream 警告，与根因的关系未确认。

## 2026-11-12 Review 修复完成

- 用户已授权直接修复四项发现，并要求代码易读、按职责拆分。路径身份复用放入 26 行的 `fs/root_identity.go`；缓存进程保留就近修改 `RuntimeCache`（147 行）；Windows 安装器调整停止顺序；删除无生产入口的单进程分支、冗余 `StartOptions.Standalone` 及专属状态字段。完整清单见 [修复记录](../../issues/2026-11-12-standalone-review-fixes/standalone-review-fixes-fix-note.md)。
- 首轮 Go app/fs/api/usecase/backend/remotehost/独立 CLI 七包通过，日志 `build/reports/standalone-fix-go.log`。
- 找到已有临时 PowerShell `/tmp/local-ai-agent-pwsh/pwsh`，运行在线脚本与新包内安装行为测试共 5/5，0 跳过，日志 `build/reports/standalone-fix-install.log`。包内脚本使用本机架构的真实 Go CLI，覆盖旧安装 A → 新目录 B、两端停止、重新启动后的页面 200、停止失败时保留原程序和 Core；完整 Windows EXE 运行仍需 Windows 环境。
- Kotlin 首轮定向 11 项中 1 项失败：复制的系统 `sleep` 在 macOS 退出 -9，缓存断言尚未执行；已将夹具改为项目自身 Go Core。首轮日志 `build/reports/standalone-fix-kotlin.log`。最终 Go 程序重建后执行 `./gradlew test --rerun --offline`，88/88、0 跳过，日志 `standalone-fix-kotlin-final.log`。
- 最终 `env -u MINDFS_RELAY_BASE_URL go test -p 2 ./server/... -count=1` 全量通过，日志 `standalone-fix-go-final.log`；fs/app 相关 race、相关 vet、两项强制旧库检查通过，日志 `standalone-fix-race.log`、`standalone-fix-vet.log`、`standalone-fix-kanban.log`、`standalone-fix-migration-race.log`。
- 最终 Shell/PowerShell 回归 5/5、0 跳过，日志 `standalone-fix-install-final.log`。Windows x64 交叉编译通过，产物 `build/reports/standalone-fix-windows-amd64.exe`（编译检查产物）。本轮未提交、未重新打包或更新本机安装，已有 `.15/.6` 包不含修复。

## 2026-11-12 独立后端整体 review

用户要求整体审查本次未提交的独立后端大功能。先核对实际全局和项目 AGENTS，再按已确认的 Core/Gateway 设计审查生产路径与测试。完整报告位于 [审计入口](../../audits/2026-11-12-standalone-backend-review/index.md)。以下保留修复前的审查证据；四项后续已修复，见上一节。

1. P1 / bug：IDEA 使用指纹缓存中的程序启动长期 Core，后续两次不同指纹更新会使旧缓存被清理。临时 Java 探针调用实际 Kotlin `materializeRuntime`，保留第一版进程，再物化第二/三版，结果 `process_alive=true`、程序和 web 路径均不存在。证据 `build/reports/standalone-review-cache.json`。
2. P1 / bug：旧注册表已有符号链接路径时，新 open-project 只规范化输入，不复用旧 RootInfo。临时 HOME/发现目录建立 alias 旧记录，经真实 Core `/control/open-project` 打开真实路径，项目从 1 条变 2 条。证据 `build/reports/standalone-review-alias.json`。
3. P2 / bug：PowerShell 包内安装器依赖目标目录存在程序才执行 `-stop`，但总会 `-stop-core`。在 macOS 临时环境运行实际 CLI 模拟该状态：A 启动 → 停 Core → B 登记安装并普通启动，旧 Gateway PID 不变、Core 描述符缺失，CLI 显示运行中，浏览器返回 503。证据 `build/reports/standalone-review-gateway.json`。脚本静态路径与 CLI 后果均确认，完整 Windows 流程未执行，置信度 medium。
4. P2 / maintainability：`server.go` 保留 `Standalone=true && SharedCore=false` 的旧单进程分支。当前唯一生产赋值同时设置两者为 true，独立 CLI 则直接使用 Gateway 启动路径；旧分支及专属 service 状态可清理。

本轮命令与结果：

```sh
# runtime/，五个包全部通过
env -u MINDFS_RELAY_BASE_URL go test ./server/app ./server/internal/backend ./server/internal/remotehost ./server/cmd/mindfs-server ./server/internal/kanban -count=1
# runtime/，通过
env -u MINDFS_RELAY_BASE_URL go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1
# 仓库根，3 通过、1 PowerShell 跳过（未安装 pwsh）
node --test scripts/standalone/install.test.mjs
```

日志分别为 `build/reports/standalone-review-go.log`、`standalone-review-migration-race.log`、`standalone-review-install.log`，退出码均为 0。探针使用临时程序和数据，相关进程已退出，临时目录已清理。本轮没有重跑前端/Kotlin 全量；前文历史测试和包结论不替代这些发现的回归验证。建议先处理行为问题，再继续配套包和真实 IDEA 验收。

## Core/Gateway 实现

- 新增 `app/local_core.go`、`app/remote_gateway.go` 和 `backend/core.go`。共享本地数据服务保存项目、会话与现有 UI；独立远程进程负责 Relay 和认证转发。保留既有排他数据锁，远程进程使用单独的 host 锁。
- `LocalRuntime` 启动或复用本地数据服务，不向远程入口请求主界面。实际 Kotlin 回归覆盖远程程序缺失和描述符损坏、删除；临时 core 启动、登录和重连通过。
- `AgentPanel` 服务控制使用局部事件，远程面板显示状态和错误；移除销毁 JCEF 与整页状态替换。
- 实际 CLI 测试保持同一条 WebSocket，在远程重启、停止、端口占用启动失败和错误令牌后继续完成会话操作。REST 会话读写、Agent/项目查询与本地登录继续可用。远程重启前后 core 描述符完全相同。
- Relay 集成使用临时云端 WebSocket/yamux 连接、新 Gateway 和 Core 转发，验证原身份、旧链接、真实 E2EE 握手和项目查询，控制接口返回 404。
- `gateway-address.json` 保存实际地址，重启不再回退到 7331。安装脚本调用 `-stop-core` 后更新；注销停止两端并删除发现记录。

本轮命令均以 `env -u MINDFS_RELAY_BASE_URL` 隔离继承的生产 Relay 配置。

## 验证记录

- `node --test tests/*.test.mjs`：299/299，0 跳过，`build/reports/remote-isolation-web-all.log`。
- `node --test tests/remote-access.test.mjs`：9/9，含远程状态与局部控制事件，`remote-isolation-web.log`。
- Kotlin 全量：87/87，0 跳过。使用 IDEA JBR 21 和 `IDE_AGENT_UPGRADE_TEST_RUNTIME=build/local-runtime/idea-agent-darwin-arm64`，无需修改 Gradle 配置。首次定向 4/4，最终以打包日志和 XML 为准。
- `go test ./server/... -count=1` 首轮在 `kanban/TestSchedulerRunsAgentStageAndStoresSessionKey` 失败：`runner exec count=2, want 1`。日志 `remote-isolation-go.log`。未修改该模块；该用例定向 `-count=5` 通过，随后 `go test -p 2 ./server/... -count=1` 全量通过，日志 `remote-isolation-go-final.log`。
- `go test -race`（app、backend、remotehost、api、cmd/mindfs-server）通过，日志 `remote-isolation-race.log`。
- 相关 `go vet` 通过，日志 `remote-isolation-vet.log`。
- 两项强制 kanban 旧库迁移检查均通过，日志 `remote-isolation-migration.log`。
- Shell 安装回归 2 通过；PowerShell 1 跳过（未安装 pwsh），日志 `remote-isolation-install.log`。
- 最初补 WebSocket 用例时误用 payload.request_id 判定完成，已按协议改为顶层 id；随后实际长连接用例通过。原缓存令牌红测试已替换为当前故障隔离运行回归。

## 包记录

`remote-isolation-package-final.log`：TypeScript、Vite、Kotlin 87/87、插件配置和构建通过；`remote-isolation-standalone-package.log`：独立包生成。`verify-macos-isolation.py` 使用包内二进制在临时目录完成离线安装、启动、远程停止后的本地 API、复用端口与 core、离线升级、元数据保留、注销。结果 `macos-local14-package.json` 全部通过。两个包 304 个前端文件逐个一致，26 个表情资源齐全；运行架构为 Mach-O ARM64。最终 CLI 与 Relay 用例及相关 race/vet 也已复核通过。


首次自动版本计算生成 local.1，仅作为中间产物；本轮明确使用 local.14，防止用户从已安装 .13 降级。配套独立版本为 standalone.4。最终 `.14/.4` 已生成。插件 SHA-256 `030f77dc289f1da583adff81792f548d69397881f1c8dbb098242f657ed582c0`；独立包 SHA-256 `345d289bac77b5a40d1ece753889cd4803309a3045c1cd6a1a0b39eeb293f3cc`。

---

## 项目添加恢复（2026-11-12，源码与验证完成）

- 维护性整理：`StandaloneProjects` 保留弹窗、步骤切换和空白项目表单，由 279 行降为 115 行；目录查询/导航/选择及其错误状态迁入 111 行的 `project-add/ProjectDirectoryPicker`，GitHub 请求/轮询/错误状态迁入 87 行的 `project-add/GitHubProjectImport`。本地与空白项目合用 `registerDirectory`；直接使用目录 API 的可选字段，删除 `String(parent || "")` 等转换。必要的请求取消、忙碌锁定、名称校验和失败后清空目录列表保留；不新增重试或兼容机制。
- 拆分后验证：`npm run typecheck`、`node --test tests/standalone-projects-browser.test.mjs`（7/7、0 跳过）、`npm run build`、`git diff --check` 通过。日志 `build/reports/project-add-refactor-browser.log`、`project-add-refactor-build.log`。以下全量前端与样式截图为拆分前验证。

- 功能恢复验证：前端 `node --test --test-concurrency=2 tests/*.test.mjs` 为 301/301，0 失败、0 跳过，含项目添加浏览器 7 项；`npm run typecheck`、`npm run build`、`git diff --check` 通过。日志为 `build/reports/project-add-web-tests.log`、`project-add-web-build.log`。
- 后端 `env -u MINDFS_RELAY_BASE_URL go test ./server/internal/api/... ./server/internal/githubimport ./server/app -count=1` 通过（githubimport 包无独立测试文件），日志 `build/reports/project-add-go-tests.log`；`go test -race ./server/internal/api -run TestGitHubImportStatusWithoutWebSocket -count=1` 通过。覆盖真实本地 Git clone、无 WebSocket 状态查询及终态保留、注册失败、未知任务 404 和 no-store。
- 浏览器用例覆盖目录导航/空目录、Windows 切盘、名称校验、导入完成后仅切换一次、导入失败后再次发起及忙碌时 Escape；目录查询失败时清除旧列表，防止误提交旧选择。
- 使用生产 `dist` 的实际 App、隔离 API 数据检查空项目入口；桌面菜单和 390px 目录弹窗深浅色、空白项目表单显示正常，目录弹窗 clientWidth/scrollWidth 均为 350px，控制台无错误。截图位于 `output/playwright/project-add-*.png`；浏览器操作使用 Playwright CLI。使用说明已同步到 `docs/standalone.md`。

- 恢复独立版添加项目菜单的空白项目、本地目录选择和 GitHub 导入，复用 `/api/local_dirs`、`POST /api/dirs` 和 `POST /api/imports/github`。补回 Windows 盘符与完整路径输入。
- 首次无项目时 `App` 不连接聊天 WebSocket；新增 `GET /api/imports/github/{id}` 读取内存中的原导入任务状态，前端按任务查询到完成/失败，避免依赖聊天连接或错接其他导入任务。
- 初版 `node --test tests/standalone-projects-browser.test.mjs` 为 3/3；`npm run typecheck`、`npm run build`、`git diff --check` 通过；Go 的默认 home 目录列表与独立项目/访问边界定向测试通过。
- 首轮沙箱内全量前端为 130 通过、53 失败，包含 Chrome `MachPortRendezvousServer Permission denied` 与 `listen EPERM`。沙箱外全量复跑被会话中断，最终结果未取到。新增任务状态接口、盘符和路径输入后重新验证。
- 源码与上述验证完成；未重新生成安装包，`.15/.6` 包不包含本次恢复。

# 历史阶段记录（以下描述不作为当前架构或包状态）

# 独立后端实现记录

接手先读 [计划与进度](README.md)。当前功能仍在收尾，源码目标为 `0.1.26-standalone.3`，已有安装包为 `.2`。

一个 Local AI Agent 服务托管多个项目，IDEA 在启动内置进程前查找独立安装。浏览器沿用当前 React 界面，独立模式显示“添加项目”；IDEA 模式保留当前工作台和原生桥接。

## 变更与行为

| 步骤 | 主要文件 | 结果 |
| --- | --- | --- |
| backend | `runtime/server/internal/backend/`、`runtime/server/app/standalone.go`、`runtime/server/app/server.go`、`runtime/server/cmd/mindfs-server/cli.go` | 固定目录发现、独立进程控制、多项目接入、内置与独立进程写入互斥 |
| idea | `src/main/kotlin/dev/ideaagent/StandaloneBackend.kt`、`LocalRuntime.kt`、`remote/RemoteHostProcess.kt`、`AgentToolWindowFactory.kt` | 优先复用独立服务，不替换其版本；已安装但不可达时报告错误；提供启动、重启、关闭操作 |
| web | `runtime/web/src/services/ideaBridge.ts`、`components/StandaloneProjects.tsx`、`components/remote/RemoteAccessDialog.tsx`、`App.tsx` | 添加项目复用当前样式，保留 IDEA 模式 URL 标记；产品标题为 Local AI Agent |
| distribution | `scripts/install.sh`、`scripts/install.ps1`、`scripts/package-standalone.mjs`、`scripts/standalone/`、`docs/standalone.md` | 在线下载、平台识别与 SHA-256 校验、离线安装脚本、CLI 管理和安装说明 |

项目 `.mindfs` 原位复用；IDEA 接入时只读旧注册表，保留 home 元数据位置。独立服务重启后加载自己的项目注册表。不同路径的同名项目明确报告冲突。

本地 cookie 访问与远程 E2EE 入口分开；远程不暴露控制和本地管理接口。独立服务复用现有用户目录中的 Relay 凭据和配对身份。插件不替换独立服务，也不随项目关闭而停止它。

互斥锁用于防止双后端写同一份数据；发现文件以重命名方式发布，防止读取半份 JSON。停止服务时先关闭 WebSocket，再结束 Agent 和释放项目资源；CLI 等待数据锁释放后才报告停止完成。服务退出留下的描述符可在取得两把锁后清理，仍在占锁的进程不会被当成已停止。

## 最近的数据接入修改（`.3` 源码，尚未打包）

- 新增 `app/standalone_migration.go` 与测试，在独立启动时读取旧 `projects.json`，按实际路径导入原先开放且未暂停的项目。聊天、附件与 home 元数据原地读取；旧清单、已有独立项目及显式远程设置保留。
- `standalone-migration.json` 保存旧 ID 到实际路径的映射，一次性导入后不恢复用户已移除的项目。不存在的项目目录在日志中提示并跳过。
- 使用真实路径识别同一项目，处理 macOS `/var` 与 `/private/var` 的别名。不同路径同名项目继续明确报告冲突。
- 旧 `/p/` 导航保留 `session`、`file` 并替换 `root`；直接写相对 `Location`，保留浏览器的 `/n/<node>/` 前缀。这里使用 `http.Redirect` 会规范化为根路径，丢失 Relay 前缀。
- `internal/relay/service.go` 只在代理请求中复制 HTTP client 并设置 `CheckRedirect`，把跳转响应交给浏览器；绑定请求继续使用原 client。
- 补充旧项目、home 数据、真实进程及 WebSocket/yamux Relay 接入用例。最近的 `TestStandaloneMigrationReconnectsExistingRelay` 定向运行曾通过；完整收尾仍待进行。

## 当前复核（2026-11-11）

本轮只整理计划、交接及验证证据，未修改功能代码。

交接文档的本地链接、代码围栏与 checklist YAML 解析检查通过，步骤 ID 无重复，当前步骤存在；`git diff --check` 通过。

在 `runtime/web/` 实际执行：

```sh
node --test tests/*.test.mjs
```

结果为 **297 项，295 通过、2 失败、0 跳过，退出码 1**。具体失败为 `tests/activity-reactions.test.mjs:87` 的 `reduced motion uses a still image` 截图断言，父测试 `quiet workbench follows real activity without silence-based overrides` 随之失败；计数中的 2 项不是两个独立故障。原因尚未定位，下一步单独运行该文件排查。完整日志为 `build/reports/standalone-handoff-web-tests.log`。

上一轮模型在会话 `1794228634-8aa7dc4189ca` 的 seq 183 报告 Go 编译、vet、race 和强制旧库迁移检查通过；未找到对应的完整输出。已找到的 `/tmp/local-ai-agent-standalone-go-final.log`、`race.log`、`migration-race.log` 属于下方首轮验证，时间早于最新迁移与代理重定向修改。

最终回归在 `runtime/` 使用 `env -u MINDFS_RELAY_BASE_URL`，避免继承的 Relay 地址影响测试。打包前必须重新执行：

```sh
env -u MINDFS_RELAY_BASE_URL go test ./server/... -count=1
env -u MINDFS_RELAY_BASE_URL go vet ./server/...
env -u MINDFS_RELAY_BASE_URL go test ./server/internal/kanban -count=1
env -u MINDFS_RELAY_BASE_URL go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1
```

另补相关 app/backend/API/Relay 的 race 检查、Kotlin 回归、前端类型检查与构建，并记录实际测试选择。重复添加同一项目的完整用户流程、插件安装引导、Relay 前端资源与版本机制，以及 `.3` 测试包仍待完成，见交接入口。

## 首轮验证（历史结果，早于最新迁移和 Relay 修改）

- 前端：`node --test tests/*.test.mjs`，297 项通过、0 跳过；类型检查和生产构建通过。
- Kotlin：86 项通过、0 跳过。旧主机升级用例通过临时 Gradle init 脚本显式传入本机测试 runtime，实际执行后通过。
- Go：`env -u MINDFS_RELAY_BASE_URL go test ./server/... -count=1` 通过。
- 旧库：`go test ./server/internal/kanban -count=1` 与 `go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1` 通过。
- 并发检查：app、backend 和 API 的独立服务、锁与 WebSocket 关闭用例通过 race 检查。
- 真实进程：两个项目复用一个服务；重启后读取既有会话；未登录的控制请求被拒；`-no-relayer` 生效；停止后锁释放；清理过期描述符后可重新启动。
- 旧数据：项目内会话、只读旧注册表及 home 元数据位置保留测试通过。
- 浏览器：真实生产资源下完成添加第二项目、切换项目、远程面板、浅色和深色显示及 390 px 窄屏检查。IDEA 模式隐藏添加项目，URL 改写和刷新后保留 `ide=1` 与 `ide_chrome=1`。
- 动态表情：浏览器解码眼睛 WebP 得到 37 帧，首帧与中间帧像素不同；分发包包含相同资源。
- 安装：macOS 安装脚本在临时目录完成安装、启动、查询状态与注销；测试使用临时发现目录和项目。

前端、Kotlin 与进程测试包含运行行为验证。Windows 包完成交叉编译与压缩包检查，Windows EXE 和 PowerShell 安装脚本尚未在 Windows 实机执行。IDEA 接入使用 Kotlin HTTP 测试与浏览器工作台检查，未进行新版插件的 JCEF 实机操作。

## `.2` 在线安装验证（历史结果）

在线脚本读取独立版本文件，下载 `standalone-v<版本>` Release 中的对应平台压缩包与校验文件，再调用包内安装脚本。独立包与插件 ZIP 使用不同的版本来源。

- `INSTALL_TEST_POWERSHELL=/tmp/local-ai-agent-pwsh/pwsh node --test scripts/standalone/install.test.mjs`：3 项通过、0 跳过。覆盖 HTTP 下载、版本解析、含空格的路径、安装与更新、校验失败保留旧版本、停止失败中止替换；PowerShell 覆盖 x64 / ARM64 资产选择、解压与包内安装器调用及失败传递。
- macOS 实际压缩包经临时 HTTP 服务下载安装，从 `0.1.26-standalone.1` 更新到 `.2`，安装记录、后台启动、本地认证页面、升级停止旧服务、新版启动及注销通过。检查结果在 `build/reports/standalone-online-install.json`。
- 新包打包前重新运行旧库迁移和 race 检查，通过。

PowerShell 下载流程在 macOS 的临时 PowerShell 7.7.0 中执行，包内 Windows EXE 安装仍需 Windows 实机验证。GitHub 当前仅有插件 Release，在线脚本与独立版资产尚未发布。

## 已有测试分发包（`.2`，不含最近数据接入修改）

- `build/standalone/0.1.26-standalone.2/local-ai-agent-0.1.26-standalone.2-windows-amd64.zip`
- `build/standalone/0.1.26-standalone.2/local-ai-agent-0.1.26-standalone.2-macos-arm64.tar.gz`
- `build/local-packages/idea-ai-agent-0.1.26-local.11-windows-amd64.zip`

压缩包和全部 Web 资源逐文件核对，SHA-256 见独立包旁的 `.sha256` 文件及本目录 `SHA256SUMS.txt`。先更新配套插件并退出 IDEA，再安装、启动独立服务，最后重新打开 IDEA。

## macOS 简化安装（`.5` 已打包）

新增原生 AppKit 安装器与应用入口，DMG 内双击安装，包内脚本自动复用原安装位置、停止两端、替换并启动。入口用按钮管理远程。安装记录由 CLI 只读查询；更新前从已认证的旧 host 描述符保存端口。首次启动自动分配端口，避免与已有 MindFS 7331 冲突。本轮没有变更协议或前端，可搭配 `.14` 插件。

源码、脚本、CLI 和新包安装升级验证已完成；GUI 点选待实机确认。验证不操作真实服务。

首轮 CLI、Shell 安装行为（3 通过、1 PowerShell 跳过）、两项旧库迁移通过。首个 DMG 的真实新装、从 `.3` 升级、旧目录/端口/数据保留通过。原生 UI 工具返回 `cgWindowNotFound`。诊断构建确认 didFinishLaunching 已执行，AppKit 窗口 isVisible=true，大小 510×292；仍无法取得 CUA 窗口，因此按钮点选未验证。显式保留 delegate 生命周期后重建；不能把工具报错判定为产品窗口未创建。

最终 `.5` 验证：

- `node --test scripts/standalone/install.test.mjs`：3 通过，1 PowerShell 跳过。
- `env -u MINDFS_RELAY_BASE_URL go test -race ./server/cmd/mindfs-server -count=1` 与对应 `go vet` 通过，包含真实进程、安装目录查询、旧版端口保留和远程故障隔离。
- 两项强制 kanban 旧库迁移命令通过，日志 `simple-installer-kanban.log`、`simple-installer-migration-race.log`。
- `node scripts/package-standalone.mjs macos-arm64 --skip-web` 生成 `.5` DMG 和 tar.gz。前端与插件协议未改，复用现有已构建 web 和 `.14` 插件。
- `python3 build/reports/verify-simple-installer.py` 在临时 HOME 与发现目录验证新装自动启动、Finder 入口签名、停止远程保留本地、真实 `.3` 自定义目录升级、旧端口/项目/元数据保留及重复升级。最终报告 `macos-standalone5-installer.json`。
- DMG 完整性、安装器深层签名以及 304 个 web 文件、26 个表情资源与构建目录一致。仅 ad hoc 签名，本机没有 Developer ID。
- 原生自动化工具未能识别窗口，未执行安装或启停按钮。临时 UI 进程已退出、测试 DMG 已卸载；用户真实安装保持原状态。

后续只需实机确认安装器与应用入口按钮，再继续 `.14/.5` 的 IDEA 接入验收。公开发布仍未执行。

## 本机脚本升级（2026-11-12）

用户给出历史会话 `1794228634-8aa7dc4189ca`，要求使用脚本安装最新独立版。核实原服务为 `.3`，安装在 `/Users/hongweizhang/Applications/LocalAIAgent`，监听 `127.0.0.1:7441`；本机插件目录版本为 `.13`。本轮使用现有 `.5` 包，不修改源码或重新打包。

执行前核对 tar.gz SHA-256 为 `acc3ef128ab6fb8ee5d5ad5b57a22e569c8bdf1ad27ab719ecfc636d120ecd3a`，与包旁校验文件及安装验证报告一致。将发现目录的 JSON 配置备份至 `~/Library/Application Support/LocalAIAgent/upgrade-backups/20261112T065050`（目录 0700，文件 0600），记录配置和指定会话的哈希。重新执行以下两项检查，均通过：

```sh
go test ./server/internal/kanban -count=1
go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1
```

解压已校验的包到临时目录，执行包内 `/bin/sh install.sh`。首次返回 `Local AI Agent did not finish stopping`，尚未替换程序：旧服务在 06:50:51 收到停止请求，等待 Cursor ACP 子进程清理至 06:51:01 超时，达到 CLI 的 10 秒停止等待上限。随后确认旧 PID `45637` 已退出、`host.json` 已删除且 host/backend 锁均已释放，原端口已写入 `gateway-address.json`。再次执行同一包内安装脚本成功，自动复用原目录并启动两端；未强制结束 IDEA。

安装后验证：

- CLI `-version`、`-status` 显示 `.5` 与 `http://127.0.0.1:7441`。认证的 `/control/status` 确认远程入口 PID `31367`、本地数据服务 PID `31368` 实际运行版本均为 `.5`；`lsof -d txt` 确认两端加载原安装目录的程序。
- 原安装记录路径、`projects.json`、`registry.json`、`credentials.json`、`device.json`、`e2ee.json` 及指定会话 JSONL 保持不变，SHA-256 对比通过。
- 分别通过远程入口和本地数据服务完成网页登录、`/health`、`/api/dirs`、`/api/sessions/1794228634-8aa7dc4189ca?root=idea-ai-agent` 读取，均成功。
- `/control/relay-status` 返回 `connected=true`、`no_relayer=false`；`~/Applications/Local AI Agent.app` 的 `codesign --verify --deep --strict` 通过。
- 本机插件仍为 `.13`，配套 `.14` 安装与 IDEA 接入验收继续待办；原生按钮点选状态不变。

完整记录位于 `build/reports/standalone-live-upgrade-20261112T065050.json`，首轮失败与再次安装输出位于同名 `.log`。

### Relay 首页节点进入后的配对引导

用户从 Relay 首页点击节点，手机浏览器显示“请使用 IDEA 中的访问链接”。该视图来自 `RemoteAccessRequired.tsx`：bootstrap 为 `needs_pairing` 且 E2EE 未解锁时显示，表示当前浏览器缺少可用配对授权；其中 IDEA 文案是现有组件固定提示。

核实公网 `/api/relay/status` 的 E2EE 节点 ID 与升级前保存的 `e2ee.json` 一致，身份和绑定配置未变化。使用当前前端 `E2EEService` 源码、原配对密钥和真实 `https://relay.20260310.best/n/<node>/` 地址，完成 `/api/e2ee/open` 握手、带 proof 的 `/api/dirs` 请求与响应解密，返回 3 个项目。报告：`build/reports/relay-browser-authorization-20261112.json`。

已为用户生成带 `#mindfs_pairing` 的完整访问链接；前端会消费片段并将授权保存在该浏览器。手机实际进入结果待确认。本轮未修改程序或重新安装。

## 2026-11-12 取消额外远程认证（进行中）

用户确认以 Relay 登录作为远程身份保证。IDEA 与独立版启动禁用浏览器 E2EE；共享 host 取消配对和项目 access 接口；前端取消配对提示、密钥链接及二次授权请求。Relay 转发入口复用现有 authenticateUser 和节点 OwnerUserID。内部控制令牌、进程锁继续保留。

本轮 TypeScript 类型检查通过。首次 Go 编译因 remotehost 旧测试仍引用 newHost 第三个参数和 h.e2ee 失败，正在更新回归。当前安装与运行的仍是 .5，本轮未部署，历史通过记录仅对应历史包。部署顺序为 Relay 登录入口生效后安装新独立版；尚未取得云端部署入口。

验证进展：Go 后端全量、app/remotehost race、Relay 云端全量与 app/gateway race、两项强制旧库检查通过。前端首次 14/15，通过项包括实际 App 无配对启动；目录停用错误丢失已修正为显示后端 error；复跑发现测试仍期待旧配对清除动作自动关闭项目菜单，已按新行为改为显式关闭菜单，待最终复跑。

本轮产物已生成：插件 `0.1.26-local.15`、独立版 `0.1.26-standalone.6`（tar.gz/DMG）。TypeScript 与 Vite 构建通过。包内版本、插件/独立版/当前 dist 的 304 个网页文件及 26 个表情资源一致，包内文档、App 签名、DMG 完整性通过，校验见 `build/reports/relay-login-package.json`。

全量前端首轮 291/294，0 跳过：旧 remote-entry-build 测试仍要求 E2EE，已改为普通入口；表情 reduced-motion 截图比较首轮失败，单独复跑 13/13。新包内真实 HTML 的 remote-entry-build 测试 1/1，通过无密钥节点列表、项目切换、旧单项目地址和本地入口；最终全量复跑中。Kotlin 首轮跳过未提供平台程序的 host 升级用例，更新旧配对文件 fixture 后使用 `IDE_AGENT_UPGRADE_TEST_RUNTIME=build/local-runtime/idea-agent-darwin-arm64` 复跑，87/87，0 跳过，配置核对通过。

本轮尚未部署云端或安装新包。当前生产 Relay 仍依赖节点加密，应先通过现有部署流程更新 Relay 登录转发，再安装 .6；缺少云端部署入口。云端改动保留在 mindfs/cloud 工作区，补丁副本 `build/reports/relay-login-cloud.patch`，未提交或推送。

Relay 云端 `go test ./... -count=1 -timeout=120s` 默认套件通过；两个需 `MINDFS_RUN_COMPAT=1` 的官方版本兼容用例本轮未启用，不沿用旧匿名 E2EE 互操作结论。新登录行为通过 app 真实 HTTP/WS/yamux 转发、匿名/其他账号拒绝和云端 cookie 不转发回归。

`.6` 压缩包内安装脚本的隔离实测通过：全新安装自动启动、签名应用入口、停远程保留本地、重启保留端口、真实 `.3` 升级、自定义目录及旧端口保留、项目与元数据保留、重复升级自动启动。报告 `build/reports/macos-standalone6-installer.json`，临时 HOME 与发现目录不影响当前安装。

最终前端 `env -u MINDFS_RELAY_BASE_URL node --test --test-concurrency=1 tests/*.test.mjs`：294/294，0 失败、0 跳过，退出码 0。旧发布入口测试已更新；表情代码未改，最终全量也通过。源码与 `.15/.6` 包验证完成，部署/真实安装继续待 Relay 云端入口。最终日志 `build/reports/relay-login-web-final.log`。

用户追问云端是否需要改动后，再次核对当前公网：完全不带 Cookie 请求节点根页面返回 200、不跳登录；relay/status 返回 200 与 e2ee_required=true；api/dirs 返回 401、error=e2ee_required。HEAD 原 handleGateway 直接调用 gateway，openNodeStream 只检查节点状态，没有用户登录校验。说明当前节点转发的实际保护在节点端，取消配对后需让 Relay 转发复用已有登录态。只读证据 `build/reports/relay-login-public-anonymous-probe.json`；未部署或安装。

## 2026-11-12 用户约束更新：云端保持现状

用户明确 Relay 已接入其他客户端，云端不能更新。已仅撤回本轮修改的 gateway_handler.go、protocol_integration_test.go、security_regression_test.go、deploy/README.md；mindfs 工作区只剩原有无关未跟踪目录。IDEA/独立版继续取消额外配对，普通 HTTP/JSON 与 WebSocket 兼容原 Relay，不引入新密钥或授权协议。撤销“先部署云端再安装”的前提；当前 Relay 登录保护列表/绑定，节点地址直接进入已开放项目，此事实已写入中英文文档。准备重打包、通过包内脚本安装 .6 并验证现有公网转发。

本机 .5→.6 首次包内脚本安装中止：local data service did not finish stopping。旧 OpenCode 子进程清理耗时达到 10 秒，随后远程/本地 PID 和所有四个子进程均退出，host/core 描述符已删除。尚未复制新程序；已保留配置备份和原始会话 hash。确认退出后继续执行原包内脚本，不改生产 Relay，也不强杀 IDEA。证据 `build/reports/existing-relay-live-upgrade-20261111T232928.json` 和同名 .log。

## 仅保留后台程序（2026-11-12）

用户明确不需要额外的 `Local AI Agent.app`，独立版只提供后台程序。删除 `Launcher.swift`，移除打包脚本中的 Swift 编译、应用打包、签名和 DMG 生成，移除 Shell 安装器中的应用复制。保留 Shell 下载校验、安装目录识别、停服替换、自动启动及数据/端口保留。中英文使用文档同步删除图形操作引导，历史 DMG 标记为旧产物。

源码与安装回归完成：

- `node --test --test-name-pattern='^Shell:' scripts/standalone/install.test.mjs`：3/3 通过，0 跳过；日志 `build/reports/backend-only-shell.log`。
- `node --check scripts/package-standalone.mjs`、两份 Shell 的 `sh -n` 和 `git diff --check` 通过。当前 scripts、README 和用户指南已无管理应用或 DMG 引用。
- 核对 bundle identifier 后，将本机 `~/Applications/Local AI Agent.app` 移至废纸篓。后台服务未执行停止或卸载；Core/Gateway 的 `/control/status` 均返回 200。报告 `build/reports/backend-only-cleanup.json`。
- 首次清理后检查误从描述符读取不存在的 `pid` 字段而报 KeyError；改为已认证的控制状态接口核验通过。该错误仅在验证脚本中，源码无此逻辑。
- 本轮未生成新包；历史 `.5/.6` 包仍包含旧图形入口，后续构建使用当前脚本。

## macOS 常驻后台（`.7` 已完成，2026-11-12）

用户要求常驻与重启后自动启动。采用用户 LaunchAgent，在登录后启动 Core/Gateway，异常退出重启，正常停止不立即重启；两个进程保持各自生命周期。安装脚本通过 `-install` 配置，已有 CLI 负责启停、更新和注销。实现与验证待完成，不修改当前真实运行实例。

第一轮真实 launchd 集成与最终 CLI/backend race、vet 通过；Shell/PowerShell 5/5、两项 kanban 旧库检查通过。覆盖脚本注册启动、SIGKILL 后恢复 Core/Gateway、端口保留、停止远程保留 Core、重复升级、原地安装、按登录方式加载已保存作业及注销清理。为消除离线安装的手动解压步骤，Unix 分发同时生成含程序与资源的单文件 `.sh`，运行一次调用同一安装流程；新包验证待执行。

最终交付：

- `backend/login_service_darwin.go` 生成用户 LaunchAgent，以发现目录派生独立 label，避免隔离测试或其他安装相互控制。Core 与 Gateway 分别运行；`RunAtLoad=true`、`KeepAlive.SuccessfulExit=false`。参数和环境使用 XML 转义；日志沿用 `core.log` 与 `standalone.log`。
- CLI `-install` 自动配置，自启后的进程直接运行前台服务；普通启动复用对应作业，`-stop` 只停止并卸载 Gateway 当前作业，`-stop-core` 用于更新，`-unregister` 删除作业配置。临时停止仍在下次登录启动。Gateway 从保存文件读取地址，避免把首次随机端口 `:0` 固定进启动参数导致崩溃后换端口。
- Shell 同目录原地安装也会先停服，再重新注册启动，确保既有进程纳入管理。Unix 包额外输出自解压 `.sh`，将原安装器与 tar.gz 合并，用户无需手动解压。
- `TestMacLoginServiceInstallation` 真正运行临时 launchd 作业：新装启动、两端分别 SIGKILL 后恢复、远程停止保留 Core、重复更新、原地安装与 XML 路径转义、按登录方式加载两个作业、注销清理通过。
- 最终 `go test -race ./server/cmd/mindfs-server ./server/internal/backend -count=1` 与相关 vet 通过；安装测试 5/5、0 跳过；两项强制 kanban 旧库检查通过。日志 `build/reports/login-service-{race,vet,shell,kanban,migration-race}.log`。
- `node scripts/package-standalone.mjs macos-arm64 --skip-web` 生成 `.7` 的 `.sh` 与 tar.gz。复用当前已构建前端资源，未再次运行前端/Kotlin 测试。
- `python3 build/reports/verify-login-service-package.py` 从最终单文件安装器执行新装、真实 `.6` 升级及重复升级，验证原安装目录、端口、项目元数据、两个已加载的系统作业、停止远程后的本地 API；注销后临时作业配置清空。报告 `build/reports/macos-standalone7-installer.json`。
- 本轮未修改用户正在运行的安装，也未重启用户电脑。`.7` 源码和分发验证完成；新版 IDEA 插件包与真实接入待后续完成。

## Windows 脚本与公网测试分发（进行中，2026-11-12）

用户要求 Windows 与 macOS 一致的一次脚本安装体验，并明确要求可通过正式 URL 获取测试脚本。Windows 使用当前用户的计划任务实现登录启动和异常恢复，不增加桌面应用；安装器自动识别旧目录、停服替换并启动。新程序包及版本固定的在线安装脚本将发布为测试 Release，先验证本机可执行的脚本/配置与交叉编译，再验证公网资产；Windows EXE 与计划任务实机运行由用户测试。

Windows 源码完成：包内 PowerShell 自动识别原安装位置，先停止两端，再复制/原地注册并自动启动；在线入口不覆盖未指定的 Prefix。当前用户计划任务使用 Interactive/Limited、AtLogOn、无限运行时长、异常后一分钟重试，正常退出码保留；停服等待任务退出后才替换文件。Go Windows 控制调用隐藏窗口，Core/Gateway 独立任务。macOS 复用保存 Gateway 地址的参数处理，行为保持一致。

验证：`INSTALL_TEST_POWERSHELL=/tmp/local-ai-agent-pwsh/pwsh node --test --test-concurrency=1 scripts/standalone/*.test.mjs` 7/7，0 跳过；含 macOS 上真实 Go CLI 安装/重装/原地更新/失败保留、x64/ARM64 下载校验、计划任务 cmdlet 替身及真实 runner 日志/退出码。`go test -race ./server/cmd/mindfs-server ./server/internal/backend -count=1`、对应 vet、两项强制 kanban 旧库检查通过。日志 `build/reports/windows-installer-*.log` 和 `windows-login-regression.log`。Windows 原生计划任务和 EXE 未在 Windows 实机运行。接着构建 .8 并发布固定版本安装入口。

Windows `.8` 构建与发布完成：

- `node scripts/package-standalone.mjs windows-amd64` 执行前端类型检查/生产构建并交叉编译；ARM64 使用 `--skip-web` 复用同一资源。两包压缩完整性、PE machine 0x8664/0xaa64、内嵌版本、包内安装脚本、304 个网页文件和 26 个表情文件全部核对。报告 `windows-standalone8-package.json`。
- 补充无 Prefix、无旧安装记录的新装流程通过，默认目录、两端自动启动及注销验证通过；日志 `windows-installer-fresh.log`。Windows 目标 vet 通过。包内生产 HTML 与项目添加浏览器共 8/8，0 跳过；日志 `windows-standalone8-web.log`。
- 打包器同时生成固定默认版本的公开 `install.ps1` 和校验文件，避免依赖尚未推送的 main/version.txt。已发布 `standalone-v0.1.26-standalone.8` prerelease，包含 x64/ARM64 ZIP、脚本及三个校验文件，不改变现有 stable/latest。发布目标远端 main `6d6d9e854bc1a7d38f0a04db507862c6a6cd666e`；包来自本地 `b426c37` + 未提交改动，Release notes 已注明，未推送工作区源码。
- 正式入口 `https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.8/install.ps1`。使用 `curl -q` 不附认证下载 6 资产，全部 HTTP 200，与本地逐字节一致，三个实际文件 SHA-256 正确；报告 `windows-standalone8-public.json`。将下载回的原脚本传给安装测试，在隔离 HTTP 测试包上验证无参数默认版本 `.8`、x64/ARM64 选择、校验错误拒绝、安装错误传播和目录参数；PowerShell 定向 1/1，0 跳过，日志 `windows-standalone8-public-script-test.log`。
- 本轮脚本和打包验证没有失败项。已将六个新增源码/测试显式加入 Git。Windows 实机计划任务和 EXE 仍待用户测试；本机真实 macOS 服务/远程诊断保持原样。下一步与验证边界已同步到 README/checklist。

## Windows 配套插件 .16（2026-11-12，进行中）

用户继续要求 Windows 插件。更新远程面板 Windows 安装命令为已发布 .8 Release URL，浏览器用例固定 Win32 并验证实际剪贴板内容；构建当前源码的 Windows x64 插件，包含 review 修复与独立服务接入。先执行旧库必检，再跑前端、Kotlin 与包内容验证；完成后提供正式下载地址。

`.16` 打包已完成：`env -u MINDFS_RELAY_BASE_URL IDE_AGENT_UPGRADE_TEST_RUNTIME=.../windows-local16-host-runtime node scripts/package-plugin.mjs local win --version 0.1.26-local.16 --verify` 成功；当前源码编译的本机 runtime 用于跨平台进程测试，Kotlin 88/88、0 跳过。两项强制旧库迁移、类型检查、生产构建和插件配置检查通过。ZIP 322 项、Windows x64 PE、304 个网页文件、26 个表情及内嵌 .8 正式安装地址核对通过；报告 `windows-local16-package.json`。前端全量仍在执行，公网发布待完成。

Windows 插件 `.16` 最终验证与公网交付完成：

- 前端 `node --test --test-concurrency=1 tests/*.test.mjs` 301/301，0 失败、0 跳过，日志 `windows-local16-web.log`。Windows 复制安装命令用例确认真实剪贴板是 `.8` Release 地址，包内生产网页包含该入口。
- 包为 `build/local-packages/idea-ai-agent-0.1.26-local.16-windows-amd64.zip`，SHA-256 `e89f4d32a27fd150babbe4a5a78b8388fa23d727bae0e0f8b4bd727861045783`，15,706,800 字节。报告 `windows-local16-package.json` 记录 Kotlin 88/88、前端 301/301、ZIP 与资源证据。
- 已将插件 ZIP 及 `.sha256` 添加到现有 `standalone-v0.1.26-standalone.8` prerelease，更新 Release notes，未改变 stable/latest。正式地址：https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.26-standalone.8/idea-ai-agent-0.1.26-local.16-windows-amd64.zip。
- `curl -q` 匿名下载两资产均 HTTP 200，与本地逐字节一致，校验正确。证据 `windows-local16-public.json`，下载副本 `build/reports/windows-local16-public/`。
- 文档明确 Windows `.16/.8` 配套；源码保持工作区未提交。Windows IDEA 内加载与原生自启仍待实机测试，macOS 真实服务和独立诊断未操作。

## 首次选择与重启切换（2026-11-12，进行中）

按用户确认实现首次选择、面板随时修改、重启 IDEA 生效。发现现有安装记录自动选模式，Core/Gateway 自启会与内置写入冲突；加入明确偏好和进程级模式会话，保存时不改变运行服务。新实现与测试不沿用 .16/.8 的全通过结论。

首轮定向验证：Kotlin 模式偏好/跨进程锁/独立接入 7/7、远程面板浏览器 9/9、类型检查、Go embedded history 与 macOS launchd 双向切换通过。首次选择独立后仍会请求启动内置入口，已改为只有确认且目标等于当前模式时才请求。新增安装衔接：获取排他数据锁确认 IDEA 项目退出后，用认证接口停止驻留入口；不再要求手动等 30 秒。新增测试首轮将正常停止返回的 context.Canceled 当成失败，已调整退出断言，待重跑。以上新改动待最终回归，准备 .17 插件 / .9 独立包；未操作真实本机服务。

安装驻留入口交接真实测试复跑通过：活项目持锁时拒绝接管且原入口继续可用；释放后认证停止入口并处理陈旧描述符。Go 后端全量、相关 race/vet、两项 kanban 必检与安装脚本 7/7 通过。Kotlin 全量 92 项中 90 通过/2 跳过，跳过原因是没有 IDE_AGENT_UPGRADE_TEST_RUNTIME；打包时提供当前源码本机 runtime 复跑。新增实际 LocalRuntime 用例证明切回内置遇到远程描述符损坏时仍可启动登录，保存独立偏好不替换当前连接。前端完整回归进行中。浅色窄屏/桌面截图已检查，设计 detector 无发现。

最终源码回归完成：前端全量 301/301、补充远程面板（保存失败/重开/中文暗色窄屏）9/9；提供当前源码编译的 host runtime 后 Kotlin 全量 92/92，0 跳过。Go 后端全量、相关 race/vet、安装脚本 7/7 与两项 kanban 必检通过。Windows `.17` 插件与 `.9` x64/ARM64 独立包已生成，包内 304 个网页文件、26 个表情、PE 架构、插件类/版本及 .9 安装 URL 核对通过。校验脚本首轮预期插件旁已有单独 .sha256 而中止（打包器只打印哈希），补生成校验文件后通过。报告 `build/reports/backend-mode-packages.json`；正在发布并验证公网原文件。

`.17/.9` 测试 Release 已发布：`standalone-v0.1.26-standalone.9`，保留 prerelease，不改变 stable/latest。八个资产经过匿名 curl 下载，均 HTTP 200、与本地逐字节及 SHA-256 一致。固定版本入口 PowerShell 测试通过，Windows 目标 vet 通过。发布沿用远端 `6d6d9e8` 标签目标并在说明中注明本地未提交源码来源。新增文件已显式 Git 跟踪，诊断工具和真实本机服务保持原样。下一步为 Windows 原生 IDEA/计划任务/登录自启验收；macOS 新配套插件与在线分发仍未进行。

公网下载回的原 `install.ps1` 已在隔离 PowerShell 测试中验证默认 `.9` 版本、下载校验与安装调用，1/1 通过、0 跳过，日志 `backend-mode-public-installer.log`。Release 最终为已发布 prerelease（isDraft=false）。

## 面板检测与一键安装（2026-11-12，进行中）

用户明确认为复制命令流程不友好，要求选择独立服务时检测，没有则面板按钮安装，然后进入远程界面。保留已确认的重启生效约束：内置进程仍持有项目数据时，直接安装会被正常脚本的停服检查阻止。为在线/包内 Shell、PowerShell 加入延后启动选项，仅新装时复制并登记自启，不停止当前进程，也不启动第二个数据写入服务；重启后由既有切换逻辑接管。插件携带同源在线脚本，后台执行并展示进度/错误，完成后保存独立偏好。面板使用方式压缩为一行，配置阶段隐藏旧模式远程状态与二维码。新改动待验证，不沿用 .17/.9 结果。

首轮前端类型检查与面板浏览器 9/9 通过，覆盖检测、安装中禁用、关闭重开保留安装状态、失败重试、安装完成待重启及远程界面分步显示。延后安装真实进程测试首轮 PowerShell 通过，Shell 夹具因 PATH 为空找不到 dirname/mkdir 失败；改为仅安装脚本提供系统命令 PATH，内置运行时仍隔离 Agent PATH，正在重跑。Kotlin 下载校验与复用回归进行中。

定向验证完成：类型检查、面板浏览器 9/9；安装器 10/10，含 Shell/PowerShell 下真实内置进程继续登录、首次安装只登记不启动、拒绝原地覆盖、退出后独立启动；Kotlin 6/6，包含实际运行插件所带在线脚本、SHA-256 拒绝损坏包、重试成功、已安装免下载、保存模式/跨进程锁和远程故障隔离。旧库必检与 macOS 实际 launchd 安装生命周期通过。已检查浅色桌面和中文深色窄屏布局，检测无发现。准备 .18 Windows 插件与 .10 六平台独立资产，在线脚本同样生成固定版本入口。

加入检测中禁用按钮后，远程面板最后定向回归有 1 子用例失败：切入选择界面的同一帧，旧服务状态尚未由父组件隐藏，严格 status 定位器暂时匹配两个元素。测试改为先验证旧“关闭服务”按钮已隐藏，再检查检测结果，保留两阶段互斥显示的行为断言；产品代码未因测试新增等待/兜底。Kotlin 全量 93/93，0 跳过；Windows .18 初版已生成，发布仍等待前端最终回归。

本轮完成并发布：Windows 插件 `.18`，独立版 `.10` 六平台压缩包、Unix 单文件安装器、固定版本 Shell/PowerShell 在线入口，共 26 个 Release 资产。包内 304 个网页文件、26 个表情、原生架构、插件 JAR 同源安装脚本和 .10 版本常量均核对通过。每个资产匿名公网下载 HTTP 200，与本地逐字节、SHA-256 一致，证据 `one-click-packages.json`、`one-click-public.json`。Release prerelease 不改 latest，未提交/推送源码，标签来源约定同前。

最终测试：Kotlin 93/93、安装器 10/10、远程面板定向 9/9；前端全量首轮 301 项中 299 通过、1 子用例和父测试失败，均是上文记录的瞬时状态定位问题，修正后定向 9/9 通过，未重复全量。类型/构建、两项旧库必检、真实 launchd 生命周期通过。公网下载的 PowerShell 原脚本默认 .10 和 DeferStart 参数测试 1/1；公网原 Shell 在隔离 HOME 中实际下载 .10 macOS ARM64 并延后启动安装成功：安装记录与两个 LaunchAgent 配置存在，Core/Gateway 未启动，注销及临时文件清理完成。报告 `one-click-public-native-installer.json`，当前真实服务未改动。Windows EXE/IDEA/计划任务为剩余实机验收项。

## 安装后的下一步（2026-11-12，`.19` 已发布）

用户截图显示 installed=true、已选择独立、当前仍内置，但主按钮“使用独立服务”被禁用。新增待重启状态的可操作主按钮“重启 IDEA 并继续”和“稍后重启”；使用 IDEA 正常重启 API，原项目的续接标记保存在现有插件偏好中。新页面加载后消费标记，通过现有 native remote 命令打开远程设置，其他项目不消费且只执行一次。未操作当前真实 IDEA 的重启。

回归：Kotlin 94/94，0 失败/跳过；远程面板 9/9；Bridge 17/17。初次从仓库根启动两个前端文件，面板通过，但 Bridge 依赖 cwd=runtime/web，读取 `src/services/ideaBridge.ts` 报 ENOENT；从正确目录补跑后 17 项通过。本轮未重跑前端全量。两项强制 kanban 旧库迁移检查通过；打包流程的类型检查、生产构建与插件验证通过。日志 `restart-continue-{web,bridge,kanban,migration-race,package}.log`。深浅色与窄屏视觉检查通过，detector 报告为空。

Windows 插件 `.19` 已生成：SHA-256 `1bec3ad7242ff702584e811a4931205459ee19d57fe3fcc8b49d7235dc2e089b`，ZIP 322 项、304 个前端文件与当前 dist 一致、26 个表情资源、x64 PE 和 JAR .19 版本正确。安装脚本与源码一致，安装源仍为独立版 .10。初次包检查错误地在外层 AgentPanel.class 查找桥接实现，实际代码位于 attach 生成的内部类；检查内部类后确认重启与续接代码存在。报告 `restart-continue-package.json`。

ZIP 与 `.sha256` 已上传现有 `.10` prerelease，保留 `.18` 资产与历史说明，追加 `.19` 说明。两项匿名 `curl -q` 下载均 HTTP 200，与本地逐字节、SHA-256 一致；报告 `restart-continue-public.json`。本轮未重新打独立版，.10 网页已有 native remote 命令；未提交或推送源码。中英文使用文档、计划与校验清单已更新。Windows 原生重启续接待实机测试。

## Windows 安装后远程启动超时（2026-11-12，`.20/.11` 已发布）

用户 `.19/.10` 截图：模式已切换独立，提示 `Local AI Agent did not start`，下方仍展示“开启远程访问”。`standalone.log` 记录 `local data service startup timed out`；后续 `core.log` 从 12:17:43 至 12:21:58 持续有 API 200，证明本地 Core 已启动，远程入口没有就绪。

复现：PowerShell Legacy 原生参数传递会将 `--agent-config "" --notify-script ""` 的空字符串丢掉；实际收到 `--agent-config --notify-script --web-push=true`。用当前真实 Core 执行丢值后的参数，退出码 1，错误为 `open --notify-script: no such file or directory`。这条代码路径会让 Gateway 等待超时；IDEA 随后以无可选参数的命令启动 Core，可以继续本地聊天。证据 `remote-start-legacy-repro.json`、`remote-start-core-repro.log`。用户给出的日志尾部未包含此前 Core 的配置文件错误，当前定位基于代码路径和本机复现。

修复：Gateway 使用 `--agent-config=<值>` / `--notify-script=<值>`，空值与参数名一起传递；Core 超时指出 core.log 路径。远程面板在 service.running=false 时只展示服务启动状态、启动操作与错误详情，服务健康后才显示连接/绑定；停止状态不再提供重启、连接重试和二维码，启动命令错误不会被后续“仍未运行”的状态轮询清掉。

首轮 CLI/backend/kanban 与强制迁移 race 通过，浏览器服务状态用例通过。PowerShell 新增真实 Core 启动已成功，但测试错把健康接口的 mode=standalone 当作描述符 mode=core，断言失败；调整为验证 core.json 的 mode 与健康接口 protocol 后待补跑。源码与新安装源已切 `.11`，配套插件拟 `.20`，尚未生成和发布。

补跑结果：安装器全套 11/11，0 跳过，包括 Legacy 参数模式下真实 Core 启动/健康检查/停止；CLI 与 backend race 通过。浏览器首轮 9/9，实际按钮、失败后保留详情、恢复后绑定、当前面板不销毁通过。一次视觉检查确认浅色桌面与深色窄屏正常；补充服务错误详情长路径换行并复验。插件 .20 首次验证构建完成，Kotlin 结果待汇总；随后网页长路径样式改动需刷新最终 ZIP。

最终源码验证：面板含长路径详情 9/9，Kotlin 94/94 且无跳过；类型检查、生产构建通过。插件 .20 已重新打包纳入最终 CSS；六平台独立版 .11、在线入口和 Unix 单文件安装器已生成。所有包前端均与最终 dist 的 304 文件一致，含 26 个表情资源，原生架构与版本、同源安装脚本核对通过，报告 `remote-start-packages.json`。Windows 插件 SHA-256 为 `7d9bcb4738b8ccb1e3d0ac05ddf4aedeefb33745b5f41946993e71d572d4faf4`。待发布新 .11 prerelease；已有 .10 需要安装脚本升级，插件更新不会替换独立程序。

发布完成：新建 `.11` prerelease，包含 .20 插件、六平台独立包、Unix 单文件安装器和固定版本在线脚本；26 个资产匿名 HTTP 200、字节及 SHA-256 与本地一致，报告 `remote-start-public-assets.json`。历史 .10/.19 保留，未提交/推送工作区源码。用户已有 .10 需通过 .11 脚本升级；本机真实 IDEA 与后台未操作。Windows 实机复验仍待用户完成。

公网入口补验：匿名下载回的原 install.ps1，以不传 Version 的方式运行默认 .11 下载/校验/安装调用测试，1/1 通过、0 跳过；使用隔离测试包，不修改本机安装。日志 `remote-start-public-installer.log`。中英文说明、版本与校验清单、交接入口和 checklist 已同步。

## 插件内更新独立服务（2026-11-12，`.21` 已发布）

用户明确要求点击远程时直接更新，拒绝手动命令。旧 Core 会提供旧网页，所以更新入口放在插件的 Swing 原生区域，作为聊天页面上方的提示；工具栏 remote 命令和旧网页 remoteAccess 桥接均触发检测。读取安装程序 `-version`，比较插件配套 .11；旧版本显示按钮，同版或更新版不降级。

`StandaloneInstaller.install(update=true)` 复用当前同源在线脚本，升级时不传 DeferStart：下载校验后正常停止、替换、注册和启动；成功校验安装版本后调用正常 IDEA restart，并保存原项目的远程续接标记。按钮提示更新会重启后台及 IDEA，应等待当前回复完成。原生提示显示进度、失败详情和重试，不要求执行命令。独立 .11 资产和安装脚本不变，只需插件 .21。

定向 Kotlin 首轮通过：真实 HTTP 下载与版本探针、首次安装保留运行方式、更新校验失败保留旧版、成功后版本变化与数据哨兵保留、同版及更高版不下载/不降级；Swing 按钮更新/稍后/忙碌禁用/失败重试及续接偏好用例通过。新增原生视图文件与测试已显式 Git 跟踪。两项旧库迁移检查通过；正在跑完整 Kotlin 验证、原生视图离屏预览与 .21 打包。

最终源码验证：Kotlin 95/95、0 失败/跳过，包含更新成功/校验失败保留旧版/同版与更高版不下载、原生按钮与重启续接偏好；两项强制旧库检查、类型检查及生产构建通过。中英文 375px / 英文 640px Swing 离屏预览通过，未运行真实 Windows IDEA。插件 .21 已生成，SHA-256 `cc957ddcfc49e402a17a33acc6fd4030db334babd780bcf96bf7bb6ebef65c95`，原生更新类/桥接入口、.11 安装源、304 个前端文件和 26 个表情资源核对通过。报告 `in-plugin-update-package.json`，日志 `in-plugin-update-*.log`。正在上传现有 .11 prerelease。

.21 ZIP 与校验文件已上传现有 .11 prerelease，旧 .20 资产保留，说明顶部增加插件内升级用法。两项匿名下载 HTTP 200、字节与 SHA-256 一致；报告 `in-plugin-update-public.json`。最新使用方式、计划与 checklist 已更新为直接在插件内更新，不再让当前 .10 用户手动运行命令。独立 .11 包未改动；本机真实 IDEA/后台未操作，Windows 原生完整更新重启待实机验收。

## 本轮修改修复打包（2026-11-12，进行中）

用户要求直接打包；配套插件 .22，独立后台 .12，原生更新入口与在线安装源同步切换 .12。计划生成 Windows x64 / macOS ARM64 插件和六平台独立资产，完成旧库必检、插件验证、资源与公网校验后交付。当前真实服务保持运行。

打包验证完成：两项强制 kanban 检查通过；重新编译本机测试 runtime 后，Windows 打包 --verify 的 Kotlin 95/95、0 失败/跳过，插件配置验证通过；macOS 使用相同插件类重打包，不重复执行测试。两平台均完成类型检查和生产构建。六平台独立包使用同一份最终 dist。8 个 ZIP/tar.gz 的架构、304 个网页文件逐字节、26 个表情、插件 .12 安装常量/原生更新类、安装脚本及 SHA-256 一致。报告 `turn-diff-packages.json`，日志 `turn-diff-package-*`。正在发布新 .12 prerelease。

.22/.12 发布完成：28 个资产匿名 HTTP 200，与本地逐字节、SHA-256 一致。报告 `turn-diff-public-assets.json`；Release 标签继续使用远端 main 锚点，资产来自本地工作区，说明中已明确。未更新真实服务。

## 远程访问易用性与 Release 更新（2026-11-12，产品方案）

用户先指出固定后台版本导致每次升级都要换插件，并要求简洁的检查更新入口；随后要求从易用性和产品角度整体考虑远程界面。本轮检查了 React 两个组件、Swing 更新面板和当前截图，发现管理/设置重复、日常访问与维护混放、状态分散、更新横幅在弹窗外等问题。方案见 `remote-access-usability-proposal.md`，保留原有选择与重启交接，首页围绕可用状态和扫码/链接，设置集中运行方式、版本、项目与维护；更新版本从 Release 获取。当前只完成分析与方案，未修改相关 UI 或 Release 检测源码。旧 .22/.12 的验证不用于未来新实现。

## 远程访问 HTML 交互原型（2026-11-12，完成）

用户要求先看 HTML 效果。新增 `docs/design/remote-access-v3/preview.html`，内联 CSS、JS、SVG 图标及示例二维码，可离线打开；保持插件深灰/蓝色样式，同时支持浅色与窄屏。首页保留当前项目、二维码和两项访问操作；设置承载方式更改、后台版本与更新、项目、折叠维护。安装、登录、启动、重启和版本发现均是明确标注的演示，不调用生产服务；二维码与复制链接使用 example.com。

Playwright CLI 实际点击验证：首次选择独立后台、模拟安装后重启续接、登录到首页；检查版本、更新 .11 到 .12 与再次检查；暂停后从设置返回仍暂停、恢复访问；关闭重开；切换项目后链接和二维码同步；切换回内置并重启；启动失败经设置和项目返回仍无访问入口、重试后恢复。检查中修正故障页页脚仍声称可访问、项目选择错误返回已连接首页的问题。

桌面 1160×900 深色及 375×850 浅色的首页、设置、故障截图已查看，窄屏无横向溢出；最终控制台 0 错误、0 警告。初次 localhost 请求 favicon 404，已内联 favicon；最终不再请求外部资源。原型脚本通过 `node --check`。截图位于 `output/playwright/remote-access-v3/`，预览监听 `127.0.0.1:56639`。生产 React/Kotlin、真实 IDEA 和后台未变更，未重新打包；等待用户查看原型后继续实现。

## 接入生产界面与动态检查新版（2026-11-12，进行中）

用户确认原型后授权实现。已开始调整 React 面板、方式选择与版本行，新增 Kotlin Release 查询，按当前平台筛选带包及 SHA-256 的独立版本，移除固定更新目标；旧页面通过紧凑原生按钮接入。验证待完成。首轮类型检查使用 pnpm 时本机无该命令，改用已有 npm 脚本。

阶段验证：前端原有流程与新增更新场景共 31 项、相邻入口 9 项通过；Go 远程/独立定向通过。Kotlin 首轮 97 项中 95 通过、2 项因未提供本机 runtime 跳过，正在补齐本机程序重跑。新增正式版与测试版比较回归发现 IntelliJ VersionComparatorUtil 将相同基础版本的 standalone 测试版判为更新，已改为明确的四段数字比较，正式版优先；待补跑。初次 Bridge 测试因 cwd 不在 runtime/web 未执行，随后正确目录验证通过。

最终实现：RemoteAccessDialog 复用原轮询、绑定与 QR 地址逻辑，按访问/设置/项目组织显示；RemoteBackendChoice 只在设置显示运行方式摘要。RemoteBackendUpdate 接收原生检查/升级状态，RemoteBrowserUpdate 从独立服务提供的平台与版本读取适用 Release。更新目标按完整平台资产与 SHA-256 选择；初次安装也查询 Release，下载安装沿用原有脚本与数据保留流程。浏览器仅检测与查看新版，自动安装入口在 IDEA。

最终验证：类型检查、生产构建、31 项前端（面板/Bridge/Release）及相邻入口 9 项通过；补充本机 runtime 后 Kotlin 97/97、0 失败/跳过，插件配置检查通过；Go 远程、独立与服务元数据定向通过。公开 GitHub 响应按版本排序，六个平台全部选中 0.1.26-standalone.12，报告 `remote-v3-release-discovery.json`。Kotlin 真实 HTTP 检查模拟新 Release 发布后从 .51 发现 .52；安装器真实下载校验并更新到测试目标 .42，同版/更高版不覆盖，错误保留数据与旧版本。

视觉检查确认中英、深浅色及 375px/桌面；统一修正版本提示换行与深色危险操作对比度。旧网页原生面板首次截图发现英文更新按钮被 FlowLayout 换行裁切，缩短按钮文本并补充纵向边界断言，最终截图确认两按钮可见。证据在 `build/reports/remote-v3-*`、`output/playwright/remote-access-implemented/`，原生截图 `in-plugin-update-*-*.png`。本轮未生成包、未更新本机真实后台；源码新增文件已显式加入 Git。下一步打包须重跑旧库必检，本轮不沿用历史迁移验证替代新包验收。

## 新远程面板 Windows 测试包（2026-11-12，已发布）

用户要求 Windows 插件及配套后台包。版本选择插件 .23、独立后台 .13；为保持独立 Release 的平台覆盖，生成六平台后台、版本固定的在线安装入口和 Unix 单文件安装器。先执行两项强制旧库检查，再生成 Windows 插件并验证 Kotlin；发布后检查匿名下载与动态版本选择。当前后台和 IDEA 不做安装或重启。

包已生成。首次包内检查把 checkBackendUpdate 桥接字符串限定在 AgentPanel.class，断言失败；实际位于 Kotlin 编译出的 AgentPanel 附属类。已定位实际类并调整检查范围，待重跑。

打包核对通过：Windows 插件 .23 与六平台独立后台 .13 共 7 个包，304 网页文件逐字节一致、26 表情完整、原生架构/后台版本/安装源/动态 Release 查询及桥接类均通过。插件 97/97、无失败或跳过，两项旧库必检通过。固定版本 install.sh/install.ps1 与校验文件已生成；正在上传 26 个资产到 .13 草稿 Release，上传完成且尺寸清单一致后再发布。

发布完成：`standalone-v0.1.26-standalone.13` 为已公开 prerelease，不改变 stable/latest。26 个资产匿名下载均 HTTP 200，尺寸及 SHA-256 与本地一致，报告 `remote-v3-public-assets.json`。Release 标签锚定远端 main `6d6d9e854bc1a7d38f0a04db507862c6a6cd666e`，说明已注明资产来自本地未提交工作区；未提交或推送源码。

实际版本发现验证通过：从最终 Windows 插件 ZIP 提取 JAR，运行其中 `latestStandaloneVersion` 查询公网 GitHub，发现 `0.1.26-standalone.13`，且 `.12` 可更新。日志 `remote-v3-packaged-release-probe.log`。前端 `selectStandaloneRelease` 使用匿名公网 Release 响应，六平台全部选中 `.13`，报告 `remote-v3-release-discovery.json`。macOS ARM64 包内程序实际 `-version` 输出 `.13`。

Windows 插件：`build/local-packages/idea-ai-agent-0.1.26-local.23-windows-amd64.zip`，SHA-256 `5dadc823b95901deb3fb08c635b56672e5f67d6ac702948c232cfd9ef354a413`。Windows 后台：`build/standalone/0.1.26-standalone.13/local-ai-agent-0.1.26-standalone.13-windows-amd64.zip`，SHA-256 `c6e79544287172128c910ca37c753a354f45588334c8b21e5835202a19d73403`。全部校验和已写入 `SHA256SUMS.txt`。

本轮包前重新通过两项 kanban 必检、Kotlin 97 项、类型检查、生产构建和插件配置检查；前端 40 项为本次实现阶段结果。安装脚本未修改，包内逐字节核对通过；本机当前无 PowerShell，本轮未重跑原生 Windows 安装。Windows IDEA 完整点击升级、计划任务与登录自启仍待实机验收，本机真实 IDEA/后台未安装或重启。

## Mac 本机后台升级（2026-11-12）

用户要求 Mac 安装。实测本机插件 .13、独立后台 .6，两进程 PID 48681/48682，地址 7441；当前 Codex 是 Core 子进程。先生成 macOS ARM64 插件 .23，97 项 Kotlin、两项旧库必检和包资源校验通过，SHA-256 `c62cb7889da79da83860a33cc2dd093530685c4e38e180bbd022689aaca93809`。正常退出 IDEA 返回“用户已取消”，CUA 读取失败 `cgWindowNotFound`，未替换插件。用户随后明确“先只更新后台”。

旧程序、配置和插件备份至 `~/Library/Application Support/LocalAIAgent/upgrade-backups/20261112-local23-135529/`。后台使用已发布并验证的 .13 ARM64 包。独立安装进程按控制 API 正常停止旧两端，等待退出后执行包内 install.sh；保留安装目录、7441 地址及数据，配置 launchd 登录自启，随后检查两端实际版本、项目、历史、新网页与自启注册。因老版本关闭 Agent 曾超过 10 秒，本次在安装前等待旧进程完成退出，超时则保留旧程序，不强杀数据服务。执行前 Relay 状态 connected=false；升级后另记录连接情况。执行结果将写入 `mac-backend13-live-upgrade.json` 并回写本交接。

## 本机更新任务重复执行与断连恢复（2026-11-12）

用户报告一会在线、一会断开。确认 `launchctl submit` 创建的临时任务 `dev.ideaagent.upgrade.backend13.1794463174` 在安装完成后再次运行，五次安装日志对应 Core 的五次 `/control/stop`：13:59:55、14:00:58、14:02:00、14:03:03、14:04:06，间隔约 63 秒。原验证报告被每次任务启动重置为 scheduled，并重复追加交接结果。断连由此次临时安装编排造成。

已 `launchctl remove` 移除唯一临时更新任务，确认 launchd 无其他 `dev.ideaagent.upgrade.*` 任务、无 updater/install.sh 进程。保留正式 Core/Gateway 自启任务；两者 RunAtLoad=true、KeepAlive.SuccessfulExit=false，实际 .13 进程 PID 16884/16881。7441 地址与 304 个新网页资源通过，IDEA 插件仍 .13；device/credentials/e2ee/remote-access 四项元数据与安装前备份一致。此前按转发 API 写入的 Relay 未连接结论不准确，以实际 Gateway `/control/relay-status` 确认 connected=true。

14:05:56–14:08:09 完成 121 次连续观测：Core/Gateway 版本 .13，PID 始终为 16884/16881，0 请求错误、0 Relay 断连。报告 `mac-backend13-stability.json`，安装结果已更新为 verified。后续一次性后台操作使用明确的单次启动任务（RunAtLoad=true、KeepAlive=false），不复用本次 submit 编排。安装记录已改为当前实际状态，历史被覆盖报告另存 `mac-backend13-repeating-job-report.json`。

补充数据核对：初次将旧远程清单的哈希项目 ID 与独立 API 的目录 ID 直接比较而失败，随后按同一项目目录核对，原三个路径全部保留；当前额外登记 mindfs 项目，共四项。远程身份与配置四个文件逐字节保持。

## 远程网页样式评估（2026-11-12）

用户要求使用 ui-ux-pro-max 评价远程网页。读取技能并查询正文行高、移动触控和 React 语义元素；首个宽泛查询首项不相关，缩为正文行高后得到匹配规则。Playwright CLI 使用独立浏览器会话查看 .13 本机 Gateway 网页，在 390×844、1440×900 实测与截图；正文 15px/26.25px，桌面聊天宽 900px、段落约 868px，手机复制/编辑约 18px、模型 24px、附件/发送 28px、信息文字 10px。发现跨断点时左右侧栏可同时覆盖聊天，手机宽度重载正常；部分历史 diff 请求 400 已记录。形成 `remote-web-style-review.md`，没有修改生产代码或重启后台。

用户随后用桌面截图质疑评估。核对确认模型参数已在弹出菜单、工具记录已折叠、会话已有项目分组，桌面也没有侧栏遮挡。已撤回将这些已有功能列为新增项、把手机触控问题泛化到桌面的建议；评估改为小字可读性和大屏阅读宽度的局部精修，手机方案单独考虑。此前建议不能作为重排导航或重做输入区的实施授权。

用户继续追问左右侧栏。针对截图核对 FileTree 顶部 36px 工具条、11px 标签，以及 SessionList 居中项目分组、头像数量角标和默认三个子会话。补充侧栏方案：右侧分组/行布局/已完成子会话收纳优先，运行中子会话保持可见；左侧统一项目标题、标签和选中状态，安装应用降为次级操作。保留三栏不等于仅调整字号。技能查询的选中状态条目适用；导航与渐进展开未检索到直接适用结果，具体布局建议来自实际页面分析。

## 远程工作区双主题设计预览（2026-11-12）

按用户要求制作独立 HTML 设计预览，保留三栏、模型菜单、工具折叠和动态眼睛，整理左右侧栏层级。图片以 data URL 内嵌，可离线打开；项目、会话和运行状态使用示例数据。没有修改生产组件、更新后台或生成安装包。

已查看 1600×1000 浅色/深色及深色模型菜单、390×844 深色截图。首轮颜色对比度检查发现浅色选中行的时间 4.27:1，已调深浅色 muted 色值，待复验。手机抽屉只显示一侧，关闭时也从键盘/辅助访问中隐藏，输入区和主要导航点击范围扩大。

最终验证完成：浅色 muted 调整为 #5d697e，选中行时间由 4.27:1 提升至 4.81:1；每种主题 11 组文字颜色均达到 4.5:1，最低浅色 4.79:1、深色 4.94:1。Playwright 交互检查通过模型选择与勾选标记、已完成子会话展开/收起且运行项保持可见、项目分组折叠、搜索/空结果/清空、标签/项目/会话选中、示例消息发送、设计说明、双主题手机互斥抽屉、系统主题和减少动态效果。390×844 无横向或页面级纵向溢出，列表与聊天各自滚动。最终页面控制台 0 错误、0 警告。

已实际查看桌面双主题、双主题模型菜单、深色手机聊天、浅色手机会话抽屉和深色项目抽屉截图。file URL 离线打开、切深色、全部内嵌图片加载通过。交互执行记录 `build/reports/remote-workspace-preview-checks.txt`，对比度及离线结果 `remote-workspace-preview-contrast-offline.json`。CLI 的 network 子命令在当前版本不可用，未用它作验收依据；离线能力以 file URL 实际加载验证。主设计图保存至 `docs/design/remote-workspace-v1/light.png` 和 `dark.png`。本轮没有生产源码变更、后台重启或新包。

## 右侧多子代理设计补充（2026-11-12）

用户明确中间聊天区域不动，要求说明右侧默认展开行为并改善多子代理。仅在 HTML 预览中调整右侧子代理数据、呈现和点击：主会话下面统一单层缩进，任务名为主、Agent 和耗时为辅，保留小尺寸动态眼睛；运行数量从头像区独立出来。4 个运行代理默认展示，3 个完成代理默认折叠；运行组可手动折叠，数量仍显示。项目分组继续默认展开。

中间 main DOM 和子代理以外全部 CSS 与本轮前逐字一致；Playwright 比较 main 全部元素的尺寸、坐标和计算样式一致。首次深色对比度断言在按钮颜色 150ms 过渡尚未完成时触发；检查改为等待计算颜色达到主题值，未增加产品延迟或改色。本轮 13 项浏览器检查通过，运行/完成折叠、行选中、手机 4 项可见和无横向溢出、减少动态效果及无运行错误均通过。新子代理 5 组文字对比度最低浅色 5.17:1、深色 6.79:1。结果为 `build/reports/remote-workspace-subagents-checks.json`。

已查看浅色完整桌面、深色侧栏与手机截图，并更新预览目录的完整图和子代理细节图。当前仍为设计预览，生产界面及安装包不变。

## MindFS 会话菜单复用核对（2026-11-12）

查看用户截图并对比同级 MindFS 的 SessionList、HandoffPackDialog、handoff/session/scheduledTasks 服务、App 接线、后端日志路径和 fixed_session_key 调度实现。确认置顶、同步、重命名、删除当前已存在，缺少的四项可在现有基础上移植，但日志路径接口、接力包弹窗/草稿追加和固定会话调度需要一起接入。旧内置与远程中间件不屏蔽定时任务 API。详细依据写入 `session-menu-reuse-review.md`；本轮仅源码核对，没有生产变更或执行运行测试。

## 侧栏字号和字重统一（2026-11-12）

用户指出项目文字与会话名字反差。预览左侧项目名为 13px，右侧主会话为 12px，1180px 以下曾降到 11px，1700px 以上又变成 13px；普通项目和会话的字重/文字颜色也不同。仅调整 HTML 预览的侧栏字体，主名称统一 13px、普通 500/选中 600，组名和子代理标题 12px，时间 11px，去掉会话标题随断点变化的字号。ui-ux-pro-max 查询匹配 Font Size Scale 的一致层级建议，具体大小沿用现有项目名称基准。

Playwright 读取 1600/1100/390px 的计算字号均一致，中间 main 的全部元素计算字号、字重、颜色、尺寸和坐标与本轮前一致。已查看浅色与深色完整图，更新主图及子代理细节图。报告 `build/reports/remote-workspace-typography.json`。本轮为预览样式调整，生产源码未改。


## 侧栏与会话菜单生产实现（2026-11-12）

按已批准 HTML 设计接入 SessionList/多项目列表共同层级逻辑：运行子会话默认展开，结束子会话默认收起，选中分支保留可见；项目分组独立折叠，数量和置顶分开。项目/会话主标题 13px，子会话 12px、辅助信息 11px。FileTree 顶部改为项目标题配添加按钮，保留现有添加项目流程。样式限定在两侧栏；AppShell 宽度与聊天样式未变。

从同级 MindFS 移植固定会话调度、受保护日志路径接口与接力包模板，接力包错误原位展示，填入追加已有草稿。菜单使用浮层避开列表裁切，保留原同步/重命名/置顶/删除入口。移动断点关闭桌面两侧栏，手机打开一侧关闭另一侧。

首次类型检查发现 TokenEditor 无获取序列化草稿 API，新增实际编辑器读取方法后通过。后续旧 JSON/跨项目路径/浏览器交互及生产构建结果见下文；安装包仍为 .23/.13。


### 本轮最终验证与交付状态

生产组件浏览器测试新增 8 项，覆盖单/多项目列表的运行和结束分组、选中嵌套分支、分页、跨项目同名 ID、菜单键盘和剪贴板失败、接力包请求竞态/模板/草稿追加、固定和普通定时任务保存、真实 App 手机互斥抽屉。连同原有会话搜索、导航/发送/Git hook、IDE/远程 App 启动和项目添加回归，共 23 项通过，0 失败。测试使用隔离页面与模拟 API，不连接真实后台。

后端 `env -u MINDFS_RELAY_BASE_URL go test ./server/internal/scheduled ./server/internal/api/usecase ./server/internal/api -count=1` 通过。新增旧调度 JSON 的两次读写验证，保留历史时间、原会话、重置计划和模型设置；固定会话创建/更新/旧客户端保存/删除后执行和不重置通过。日志路径验证实际临时会话、Agent 绑定、缺失会话、错误项目与路径穿越输入；新增 HTTP 路由测试验证成功响应和未认证 Relay 请求 401。

首轮浏览器检查发现复制临时 textarea 夺走焦点，修复菜单复制后的焦点恢复与捕获阶段 Escape；短视口中滚动事件可能在菜单打开后才送达，改为由用户滚轮/触摸操作关闭。首轮还修正了测试中的英文按钮文本与缺失时间戳夹具。手机端的定时任务弹窗原层级低于抽屉，提升为与接力包相同层级，Escape 关闭弹窗并阻断发送区的取消事件。

浅色、深色和 390px 手机截图已实际查看。8 组侧栏文字分别检查对比度，选中文字改用现有 accent-hover 后全部达到 4.5:1。运行子代理使用原动态眼睛资产，侧栏缩进和菜单未改变中央宽度。对实施前备份的 AST/文本核对确认：App main 属性、ActionBar 的全部 style 属性、index.css 一致。类型检查及生产构建通过；构建保留现有大文件分块与第三方注释提示。

证据为 `build/reports/remote-workspace-{implementation-checks.json,browser-tests.txt,go-tests.txt,typecheck.txt,build.txt}`，截图目录 `output/playwright/remote-workspace-implemented/`。本轮 10 个新增实现/测试文件显式 Git 跟踪；新包未生成，当前已发布 .23/.13 和运行后台均未更新。下次打包需重新执行根 AGENTS 的两项 SQLite 旧库必检。
