---
doc_type: feature-implementation
feature: 2026-10-29-remote-project-hub
status: implemented
summary: 统一电脑节点与项目入口已接入，完成隔离环境多进程及浏览器回归，尚未发布
---

# 实现与验证记录

用户于 2026-10-29 批准实施一个电脑节点聚合多个项目。实现采用批准的 RemoteHost + 项目原有 runtime 结构，未操作生产 Relay、真实项目会话或数据库。没有新建 Agent 执行池或恢复第二个 Codex writer。

## 按步骤的实现落点

1. **共享入口与所有权**：`remotehost.Run` 在 OS 用户目录持有跨进程锁并发布鉴权描述文件；`register/heartbeat/unregister` 管理稳定项目 ID、唯一 owner、就绪检查和租约。Kotlin `RemoteHostService/RemoteHostSupervisor` 独立监督入口，`LocalRuntime` 只登记/释放参与关系，关闭启动方不会杀共享服务。
2. **连接与加密路由**：Host 的控制监听与公共监听分开；公共目录与项目握手材料使用节点 E2EE，`projectRoute` 透传业务 HTTP/WS。`RemoteProjectAccess` 保留包含项目 ID 的原始签名路径，不赋予原生 IDEA 权限。实际 Relay 联调修复了第二跳 WS Origin 必须指向项目 loopback 的问题。
3. **持久化与迁移**：`remoteHostControl` 保留旧模式直到新入口准备成功；先以 disabled 登记确认 owner/就绪，再关闭旧 Connector、保存新模式、切换项目 E2EE、发布新入口。新模式提交后若发布响应不确定，保留 pending 并重试新登记，不冒险重开旧连接造成双入口。关闭/取消会清 pending，已有电脑绑定的迁入不改变全局关闭选择。`ReplaceConfig/OpenSessionForNode` 使旧配对及未完成的旧握手不能跨入新身份。
4. **浏览器交互**：`RemoteHostShell` 提供节点首页、项目选择和完整页面导航；Host 和项目使用独立 E2EE 客户端，项目密钥只在内存。项目 URL、API、WS、缓存与草稿均按 projectId 分开；Service Worker 不缓存嵌套业务 API。`RemoteAccessDialog` 区分电脑与项目开关、明确迁移与取消，轮询不堆积。
5. **业务边界**：仍进入原 AppContext/StreamHub；项目关闭和全局关闭会撤销对应代理/WS。本地会话不受入口网络故障影响；坏的远程专用配置只阻止远程并在其面板报告，仍允许本地启动。
6. **验证与交付准备**：初次实现未打包。用户随后授权复核、直接修复与 Windows 本地测试包；本轮结果见下方复核记录。未提交、push 或上传市场，0.1.25 已上传的正式产物未更改。

## 本次复核发现与修正

- 新入口未确认可登记前就停止旧入口：改为先 disabled 准备，再持久化模式和发布；失败时旧入口保持可用。
- 取消迁移仍可能在绑定完成后自动开放：统一清除内存与磁盘 pending，增加显式取消端点。
- Host 断线仍保留 connected=true：清掉当前连接状态并关闭旧项目代理许可。
- 远程配置损坏阻止本地启动：隔离管理错误并返回明确 503，本地服务继续启动。
- Relay 第二跳 WS Origin 不一致：在受信任代理中改写到项目目标，保留 E2EE 与项目令牌校验。
- Host 注册轮询重复写盘、健康检查会跟随跳转：未变化登记不写盘，探测仅 loopback、不跟随跳转。
- 旧冒烟脚本仍断言早已改掉的 Thinking/工具停滞文案和已删除的聊天页副标题：更新测试定位和期望，不回退产品行为。

## 验证证据

| 验证 | 结果 / 证据 |
| --- | --- |
| 后端全量 `./server/... -count=1` | 通过；`/tmp/idea-remote-project-hub-go-final.log` |
| app/api/e2ee/remotehost race | 通过；`/tmp/idea-remote-project-hub-race.log`；迁移最后调整再跑 `/tmp/idea-remote-project-hub-final-integration.log` |
| 真实多进程与 Relay 消息通路 | `TestSharedRemoteHostRealProjectProcesses`：真实 Connector/yamux + 两个项目进程，独立 E2EE/API；关闭 A 后 B 同一 WS 仍返回加密 pong，只有一个 Connector |
| 入口单实例与崩溃 | `TestSeparateProcessesShareOneHostAndRecoverAfterCrash`：重复启动共享身份、stdin EOF 不关闭入口、崩溃后复用身份并更新进程凭证 |
| 撤销与权限 | `TestProxyPreservesSignedPathAndRevokesOnlySelectedProject`、节点握手/目录测试、项目原始路径证明与 native bypass 拒绝测试 |
| 旧版迁移 | `TestRemoteHostMigrationPreservesLegacyUntilBound`：准备失败保留旧入口、取消不会重新开启、重复启动不启旧 Connector、owner 冲突明确失败；`TestProjectMigrationRevokesLegacySessionsAndInflightHandshake` |
| 远程错误与本地可用 | `TestRemoteConfigurationFailurePreservesLocalProject`：真实子进程读取坏远程配置，native `/api/dirs` 200，远程管理 503 |
| Kotlin | 71/71；`/tmp/idea-remote-host-kotlin.log` |
| 前端 | 全量 256/256；后续定向 22/22、面板 6/6；实际 App+Shell bootstrap、A→B→A 草稿、共享配对与内存项目密钥、撤销隐藏业务、慢请求不堆积 |
| 类型/前端生产构建 | TypeScript、Vite 通过；`/tmp/remote-hub-final-check.log`、`/tmp/idea-remote-project-hub-build-final.log` |
| 数据库升级 | 全量 kanban 已通过；旧库 `TestTaskStoreSnapshotMigration` race 再通过：`/tmp/idea-remote-project-hub-migration.log`；仅临时数据库 |
| 消息与原生入口冒烟 | `smoke-runtime.mjs --delivery-only` 通过：启动/鉴权、模型发现、回答、会话模型、IDE bootstrap、消息去重/工具活动/切换/队列/后台完成、干净退出；`/tmp/idea-remote-project-hub-smoke-delivery.log` |
| 完整冒烟 | 未全通过：Agent 管理旧脚本仍用小写 `claude` 精确匹配，并假定未就绪 Agent 可直接选择；当前 UI 是 Claude Code 与配置引导。本次未改产品行为，也未继续扩展该菜单测试的重写；`/tmp/idea-remote-project-hub-smoke-final.log` |
| 测试隔离与静态检查 | 清理共享目录环境变量后迁移用例通过；修改脚本 `node --check` 和 `git diff --check` 通过 |
| 平台编译 | macOS arm64/amd64、Windows amd64/arm64 完整运行程序编译通过；Windows RemoteHost 测试程序亦交叉编译通过 |

## 范围澄清与限制

- 统一目录为 Windows `%APPDATA%/LocalAIAgent/remote`、macOS `~/Library/Application Support/LocalAIAgent/remote`；不改项目现有数据位置。
- 各旧项目首次迁入需要在本机明确确认加入，但电脑 Relay 只绑定一次。不能将旧项目 enabled 静默升级成对所有电脑级配对浏览器的授权。此澄清已回填设计，README 和隐私说明同步。
- 首版目录以真实活登记报告 online/closed；未启动成功的项目不会伪报在线，具体错误在本机面板查看。不提供远程拉起 IDEA。
- 只支持一个远程 owner；不同 IDEA 同时打开同一路径的本地会话竞争不由入口接管。不兼容入口协议明确报错。
- 文件草稿仍在页面内存，切换前提示；文字聊天草稿保留在同标签页 sessionStorage，附件不持久化并在离开前提示。
- Windows 实机、真实 IDEA 多窗口/多版本进程、手机公网 Relay 和真实付费 Agent 的新版验收尚未执行。自动测试和交叉编译不能替代这些验收。
- 新职责放在 remotehost、Kotlin remote 与前端 remote 功能边界，未重构整个 App 或更改会话模型。实现新增的名称和契约均对应批准设计，无无关产品功能。

## 阶段状态

实现 checklist 已完成，保留明确的实机验收边界。此记录是实现自检，不冒充发布或独立验收通过；正式包/市场发布需另行执行打包流程与交付检查。

## 验收场景与证据对应

| 设计场景 | 当前证据与边界 |
| --- | --- |
| 一次绑定、多进程单节点、关闭 A 保持 B | RemoteHost 真实子进程单实例测试 + 两个实际项目进程的 Relay/E2EE 集成；真实 IDEA 多窗口待验收 |
| 重启复用身份、异常死亡释放、最后项目退出 | `TestSeparateProcessesShareOneHostAndRecoverAfterCrash`、`TestRegistrationBoundaryAndIdleExit`、Kotlin supervisor 测试 |
| 配对一次、A/B 切换、草稿/缓存/终态隔离 | 浏览器项目切换测试、remote-cache/remote-project-hub 单测及原会话模型回归；手机公网待验收 |
| 项目撤销与全局停用 | Proxy 撤销测试、浏览器撤销隐藏业务测试、迁入已绑定但全局关闭时不重新开启的回归 |
| 同名/路径别名、重复 owner | `TestStableProjectPathAliasesAndSameNames`、`TestProjectOwnershipPersistenceAndExpiry`；Windows 原生路径/ACL 实机待验收 |
| 断网恢复、不重发消息 | supervisor 恢复、控制客户端重新读描述文件、迁移状态与断连状态测试；Host 仅代理，不创建消息或 Agent writer |
| 篡改路由/编码/管理端点/未配对/旧授权 | signed-path、控制入口与公共入口隔离、节点目录鉴权、项目旧握手失效测试 |
| 旧版升级失败、中断、重复启动、多个旧账号 | 迁移回归；显式新电脑绑定与逐项目加入，不自动合并旧账号或删除节点 |
| 不兼容协议 | Go 描述文件与 Kotlin 协议校验测试；真实混合 IDEA 版本待验收 |
| 未保存文件/附件切换 | 既有 beforeunload 与新增离开项目事件、草稿浏览器测试；原生浏览器关闭提示需实机确认 |
| 三端原有会话行为 | 实际项目进程 WS 加密通路、前端原有回答/排队/会话切换测试；真实付费 CLI 与三端人工联调待验收 |

反向核对：未新增系统服务、项目扫描、云协议修改、会话库迁移、Thread 抢占或旧节点删除；远程登记仅由受保护本机控制端点完成。

## 复核落点与范围

- 步骤 1 新增 `remotehost/host.go:63 Run`、`:279 register`、`:419 expire` 和 Kotlin `remote/RemoteHostService.kt:29 RemoteHostSupervisor`。
- 步骤 2 新增 `remotehost/http.go:121 publicHandler`、`proxy.go:94 proxyProject`，修改 API 的 HTTP/WS 证明路径和 E2EE 管理器。
- 步骤 3 新增 `app/remote_host_control.go:123 syncLocked`、`:209 ServeHTTP`、`:329 middleware`；远程启动失败隔离在 `server.go`。
- 步骤 4 新增 `RemoteHostShell.tsx:14 RemoteHostShell`、`remoteHost.ts:65 openRemoteProject`、`:88 navigateRemoteProject`、`remoteScope.ts`、`remoteDrafts.ts`；接入现有 App/bootstrap/远程面板。
- 步骤 5 原有会话执行逻辑不迁移；修改路由、存储作用域和离开页面挂接，测试单独关闭与全局撤销。
- 步骤 6 增加相关测试和文档；同步旧冒烟脚本中已有产品文案/结构的断言。`test-runtime.mjs` 清理新增共享目录环境变量，防止从 IDEA 启动测试时连接用户正在运行的 RemoteHost。
- 无新增产品概念；两个独立 E2EE 上下文、所有权和租约均来自批准设计。测试脚本调整服务于回归验证，不修改 Agent 菜单产品行为。
- 结构自检：已有 App 很大，本次新职责放独立 remote 模块，App 仅作接入；未趁机全面拆分。公开输入在 HTTP/描述文件边界校验，内部沿用已有类型。
- checklist 六步均有自动验证证据；实机/公网验收仍独立待做，不能以 checklist 的实现完成代替发布验收。

## 当前文件清单

以下为本次实现工作区的 `git status --short --untracked-files=all` 快照，未提交：

```text
 M CHANGELOG.md
 M PRIVACY.md
 M README.md
 M docs/validation.md
 M runtime/server/app/remote_access.go
 M runtime/server/app/server.go
 M runtime/server/cmd/idea-agent/main.go
 M runtime/server/internal/api/http.go
 M runtime/server/internal/api/ws.go
 M runtime/server/internal/e2ee/manager.go
 M runtime/web/src/App.tsx
 M runtime/web/src/components/remote/RemoteAccessDialog.tsx
 M runtime/web/src/components/remote/remoteAccess.css
 M runtime/web/src/hooks/useIdeaComposerContext.ts
 M runtime/web/src/i18n/locales/en-US.ts
 M runtime/web/src/i18n/locales/zh-CN.ts
 M runtime/web/src/layout/AppShell.tsx
 M runtime/web/src/main.tsx
 M runtime/web/src/services/base.ts
 M runtime/web/src/services/bootstrap.ts
 M runtime/web/src/services/e2ee.ts
 M runtime/web/src/services/file.ts
 M runtime/web/src/services/git.ts
 M runtime/web/src/services/session.ts
 M runtime/web/tests/pairing-link.test.mjs
 M runtime/web/tests/remote-access.test.mjs
 M runtime/web/tests/remote-cache.test.mjs
 M runtime/web/vite.config.ts
 M scripts/smoke-agent-discovery.mjs
 M scripts/smoke-agent-management.mjs
 M scripts/smoke-message-delivery.mjs
 M scripts/smoke-question-choice.mjs
 M scripts/smoke-session-model.mjs
 M scripts/test-runtime.mjs
 M src/main/kotlin/dev/ideaagent/LocalRuntime.kt
 M src/main/kotlin/dev/ideaagent/RuntimeProcess.kt
 M src/test/kotlin/dev/ideaagent/RuntimeProcessTest.kt
?? .codestable/features/2026-10-29-remote-project-hub/remote-project-hub-checklist.yaml
?? .codestable/features/2026-10-29-remote-project-hub/remote-project-hub-design.md
?? .codestable/features/2026-10-29-remote-project-hub/remote-project-hub-implementation.md
?? runtime/server/app/remote_host_control.go
?? runtime/server/app/remote_host_control_test.go
?? runtime/server/app/remote_host_process_test.go
?? runtime/server/internal/api/remote_project_access.go
?? runtime/server/internal/api/remote_project_access_test.go
?? runtime/server/internal/e2ee/rotation_test.go
?? runtime/server/internal/remotehost/host.go
?? runtime/server/internal/remotehost/host_test.go
?? runtime/server/internal/remotehost/http.go
?? runtime/server/internal/remotehost/lock_unix.go
?? runtime/server/internal/remotehost/lock_windows.go
?? runtime/server/internal/remotehost/process_test.go
?? runtime/server/internal/remotehost/protocol.go
?? runtime/server/internal/remotehost/proxy.go
?? runtime/web/src/components/remote/RemoteHostShell.tsx
?? runtime/web/src/services/remoteDrafts.ts
?? runtime/web/src/services/remoteHost.ts
?? runtime/web/src/services/remoteScope.ts
?? runtime/web/tests/remote-project-hub-browser.test.mjs
?? runtime/web/tests/remote-project-hub.test.mjs
?? src/main/kotlin/dev/ideaagent/remote/RemoteHostProcess.kt
?? src/main/kotlin/dev/ideaagent/remote/RemoteHostService.kt
?? src/test/kotlin/dev/ideaagent/RemoteHostTest.kt
```

## 初次实现时的验证待项（本轮复核已更新）

- `scripts/smoke-agent-management.mjs:169` 的旧菜单 fixture/定位与当前 Agent 配置引导不一致。完整冒烟先修该脚本后再重跑；本次只同步其已经删除的页头等待条件，没有改菜单产品逻辑。
- 以上完整冒烟缺口及 Windows/macOS IDEA、手机公网实机检查在发布前完成；当前状态为实现完成待验收，未宣称可直接发布。

## 第二轮复核（2026-10-29）

用户明确要求发现问题直接修复并出 Windows 本地测试包。[审查报告](../../audits/2026-10-29-remote-project-hub-review/index.md)记录 1 个产品竞态与 3 个测试问题，均已修复：

- 项目目录刷新只保留一个在途请求；连接世代改变后忽略旧响应，重连关闭旧项目菜单。慢网浏览器回归覆盖轮询、可见事件、重连与旧空目录迟到，验证不覆盖新状态。
- 真实 Relay 测试按“一次 HTTP 请求一个 yamux stream”禁用 stream keep-alive，修复 POST 偶发 EOF。
- 进程测试隔离 PATH，避免空 Agent overlay 仍合并默认定义并调用本机 CLI。连续 20 次真实双项目/单 Connector 测试通过。
- 完整冒烟更新为当前 Agent settings、配置引导、probe、更新检查和安装 API；对安装器完全拦截，保留草稿/权限/历史元数据等行为验证。原完整冒烟阻塞已解除。

最终验证：后端全量通过（`/tmp/remote-hub-review-go-final.log`）；相关 race 通过（`/tmp/remote-hub-review-race.log`）；前端 260/260 通过（`/tmp/remote-hub-review-web-final.log`）；最新 runtime 完整冒烟通过（`/tmp/remote-hub-review-smoke-final.log`）；kanban 全包与快照旧库迁移 race 再次通过（`/tmp/remote-hub-review-kanban.log`、`/tmp/remote-hub-review-migration.log`）。初次前端执行从仓库根目录启动，因相对路径产生 ENOENT；按测试约定在 runtime/web 重跑后全通过，没有修改产品来规避测试。

Windows 实机 IDEA 多窗口、手机公网 Relay 与真实 Agent 联调仍由本地测试包验证；自动测试不替代实机验收。最终包名、SHA256、Kotlin 与 ZIP 校验见 docs/validation.md。

交付已完成：Windows x64 本地包 `idea-ai-agent-0.1.25-local.1-windows-amd64.zip`，SHA-256 `59797fe44b6c6179389b538d6ca4bc46b7cc81627a3886e64dac61c8d4e36f7f`。Kotlin 71/71 与打包配置检查通过；ZIP 内 278 个前端文件匹配最新构建，Windows PE 与共享 Host 类均存在。未发布市场。
