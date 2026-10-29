---
doc_type: feature-implementation
feature: 2026-10-29-remote-access
status: review-ready
summary: 插件远程访问源码与本地验证完成，真实公网及平台验收待执行
tags: [idea, remote, relay, verification]
---

# 远程访问实现记录

2026-10-29。按已批准方案完成源码接入和本地 review；不代表已通过真实公网、Windows IDEA 或手机实机验收。未提交、push、打包或发布，未绑定生产 Relay。

## 动了哪些文件

本轮结束前工作区状态如下；其中 `.gitignore` 的 `.secrets/` 忽略项是本轮前已有修改，未改动其内容。其余为本功能源码、测试及文档。

```text
M .codestable/requirements/VISION.md
 M .gitignore
 M runtime/server/app/local_plugin.go
 M runtime/server/app/server.go
 M runtime/server/internal/api/http.go
 M runtime/server/internal/api/stream_hub.go
 M runtime/server/internal/api/ws.go
 M runtime/server/internal/fs/fs.go
 M runtime/server/internal/relay/manager.go
 M runtime/server/internal/relay/service.go
 M runtime/server/internal/relay/service_test.go
 M runtime/web/package-lock.json
 M runtime/web/package.json
 M runtime/web/pnpm-lock.yaml
 M runtime/web/src/App.tsx
 M runtime/web/src/components/TurnDiffSummary.tsx
 M runtime/web/src/i18n/locales/en-US.ts
 M runtime/web/src/i18n/locales/zh-CN.ts
 M runtime/web/src/layout/IdeaWorkbench.tsx
 M runtime/web/src/services/file.ts
 M runtime/web/src/services/ideaBridge.ts
 M runtime/web/src/services/session.ts
 M runtime/web/tests/idea-bridge-commands.test.mjs
 M runtime/web/vite.config.ts
 M src/main/kotlin/dev/ideaagent/AgentToolWindowFactory.kt
 M src/test/kotlin/dev/ideaagent/NativeAgentCommandTest.kt
?? .codestable/features/2026-10-29-remote-access/
?? .codestable/requirements/remote-access.md
?? runtime/server/app/remote_access.go
?? runtime/server/app/remote_access_integration_test.go
?? runtime/server/app/remote_access_test.go
?? runtime/server/internal/api/http_text_edit.go
?? runtime/server/internal/api/idea_access.go
?? runtime/server/internal/api/idea_access_test.go
?? runtime/server/internal/api/remote_queue_test.go
?? runtime/server/internal/api/usecase/text_edit.go
?? runtime/server/internal/fs/text_edit.go
?? runtime/server/internal/fs/text_edit_test.go
?? runtime/server/internal/relay/remote_lifecycle_test.go
?? runtime/web/src/components/ExitIcon.tsx
?? runtime/web/src/components/FileEditor.css
?? runtime/web/src/components/FileEditor.tsx
?? runtime/web/src/components/editor/CodeTextEditor.tsx
?? runtime/web/src/components/editor/codeEditorLanguage.ts
?? runtime/web/src/components/editor/codeEditorState.ts
?? runtime/web/src/components/remote/
?? runtime/web/src/services/fileEditing.ts
?? runtime/web/tests/remote-access.test.mjs
?? runtime/web/tests/remote-cache.test.mjs
```

## 按步骤的改动与退出信号

| 步骤 | 主要函数/类型及位置 | 实现与证据 |
| --- | --- | --- |
| 1 通路和鉴权 | `server/app/server.go:82 Start`、`remote_access.go:116 remoteAccessMiddleware`、`api/idea_access.go:12 LocalIDEAccess` | 本地 Cookie 后标记可信入口，独立 loopback 远程入口经 E2EE 验证；共用 AppContext、mux、Agent Pool。真实测试 Connector/yamux 转发，加密和本地 API 结果一致、未配对 401、管理路由 404。 |
| 2 会话编排 | `api/stream_hub.go:464 reserveOrQueueSessionMessage`、`:576 reserveNextQueuedSessionMessage`、`ws.go handleSessionMessage/startNextQueuedSessionMessage` | 原子占用运行状态/入队；32 个并发提交只有一个直接执行，其余顺序出队，保留 request ID；问题/审批复用既有单次消费机制。 |
| 3 入口 | Kotlin `AgentToolWindowFactory.kt:74 NativeAgentCommands`、`IdeaWorkbench`、`RemoteAccessDialog` | 常驻原生工具栏入口；先提示绑定，生成绑定链接；状态、URL、复制、打开、QR、隐藏配对密钥和启停。Chrome 测试覆盖未绑定、绑定、取消、解绑提示及 375px 版式，原生命令测试通过。 |
| 4 网页能力 | `RemoteFileViewer`、`FileEditor`、`CodeTextEditor`、`FileEditStore`、`api/http_text_edit.go`、`fs/text_edit.go` | 定向移植 MindFS 文件编辑和 revision 检测，UTF-8/1 MiB 上限、项目路径约束、换行/BOM 保留、导航草稿、退出确认。复用已有网页上下文和 Git Diff；本轮 Diff 直接展示会话中固定的 update.diff。 |
| 5 生命周期 | `remoteAccessControl`、`relay.Manager.SetEnabled`、`StreamHub.CloseRemoteClients` | 私有配置保存启用选择；实际连接状态、绑定取消与迟到响应隔离；关闭 Connector 和远程 WS，本地不受影响。文件/会话缓存按节点隔离，SW 仅清理自身 scope 缓存。 |
| 6 联调检查 | 同目录 checklist、相关测试文件 | 本地自动化和编译完成；真实平台/公网联调与用户 review 仍待执行，步骤保持 pending。 |

后端路径以 `runtime/` 为根，前端路径以 `runtime/web/src/` 为根。新增文件编辑器和远程组件是已批准的职责边界；未重组 App.tsx，也未复制整个 MindFS 项目。

## Review 修正

- 共用 E2EE Manager 时，本地 WS 必须按连接标记走明文；远程不能靠伪造头或客户端 ID 获取本地权限。
- 同一 client ID 重连会关闭旧连接，避免旧连接遗留；关闭远程与 WS 注册间的竞态另有关闭检查。
- 消息准入、出队预留统一在 StreamHub 锁内完成，避免双端同时进入执行。
- Relay 绑定结果在写入前核对取消状态和当前绑定码；终态在锁内释放 polling，避免重新绑定被旧 polling 卡住。
- 修正既有绑定测试的观察时序：请求被 transport 收到并不代表响应已处理完成，等待最终状态而非单个请求通知。
- 专用远程 loopback 使用 HTTP，与本地入口是否 TLS 无关；Relay 外部 HTTPS/WSS 协议保持原样。
- 远程 UI 禁用项目管理、原生功能及 Token Station 请求；缓存前缀加分隔符，避免相似节点名交叉清理。

没有新增领域模型、独立 daemon、第二个 Agent Pool、抢锁或自动 fork。持久化只新增项目私有远程启用配置，没有修改任务/会话表结构，保留旧库迁移。

## 验证记录

| 检查 | 结果 |
| --- | --- |
| 后端全部 `./server/...` | 通过；使用 `scripts/test-runtime.mjs` 隔离 HOME/IDE 数据及 Agent 凭据 |
| app/api/relay/fs 全模块 `-race` | 全部通过 |
| Chrome 既有完整前端回归 | 237/237，通过，0 skipped；使用本机 Chrome 启动覆盖测试环境缺失的 Playwright Chromium |
| 新增 remote-access 浏览器回归 | 4/4，通过：绑定面板、取消、编辑/草稿/冲突 |
| 新增 remote-cache 回归 | 1/1，通过：两个相似节点名不能读取或清除对方同路径文件缓存 |
| TypeScript + Vite 生产构建 | 通过；仍有大 chunk 体积提示 |
| Kotlin test + verifyPluginProjectConfiguration | 通过；使用 IDEA JBR，offline，跳过 buildRuntime |
| Windows amd64 / macOS arm64 Go runtime | 交叉编译/本机编译通过；临时输出在 /tmp，不是插件安装包 |
| kanban `-count=1` | 通过 |
| kanban `-race -run TestTaskStoreSnapshotMigration -count=1` | 通过；仅临时数据库 |

测试调用清除了进程继承的 `MINDFS_RELAY_BASE_URL`，避免它覆盖 fixture 的测试 Relay 地址；未改动用户环境。真实应用仍按原规则尊重环境配置。

## 2026-10-29 手机扫码自动配对

- 用户确认取消手机扫码后的手动输码和二次确认。二维码在 URL fragment 中携带现有配对密钥；浏览器读取后立即清除该参数，获取 bootstrap 的 E2EE 节点 ID 后保存密钥并自动执行原有加密握手。未关闭服务端鉴权。
- 普通复制链接和“打开浏览器”仍不含密钥，首次打开普通链接需手动配对。二维码本身授予访问权限，面板已提示不要转发；使用现有长期密钥，不声明一次性或短时有效。
- 新增自动配对回归覆盖地址清理、再次打开、不同项目隔离、错误密钥拒绝、初次离线后重试、特殊字符及本地页面隔离。Chrome 面板测试逐模块比较实际二维码像素与预期授权 URL 的编码结果；定向测试 9/9 通过。
- 修改后完整前端回归 247/247 通过，0 skipped，使用本机 Chrome。
- 本次打包前再次通过 kanban 全模块和 `TestTaskStoreSnapshotMigration` race 检查，仅使用临时数据库。真实手机和公网 Relay 扫码仍待用户实测。
- Windows 测试包 `build/local-packages/idea-ai-agent-0.1.24-local.3-windows-amd64.zip` 已生成（11.7 MiB）。TypeScript、Vite、Gradle tests/configuration 通过；ZIP CRC 和 278 个前端文件与 dist 的逐字节比对通过，已包含扫码配对代码。SHA256：`bb8441f2be8c1107120027599bd966e2f037b84ed73463a22fa748c958813b07`。

## 验收场景证据和边界

- 2026-10-29 用户实测确认：PC 浏览器、IDEA 插件、手机三端消息实时同步正常。该确认仅覆盖用户已测试场景，不扩展为所有平台及异常情况均验收通过。
- 同日补齐项目启动行为：`RemoteAccessStartup` 注册为 `postStartupActivity`，后台读取该项目已有 `remote-access.json`；仅 `enabled: true` 时调用同一项目 `LocalRuntime.start()`。数据目录计算与面板启动共用，保留原有真实路径 SHA-256 标识；不创建第二个服务、不展开面板。启动失败记录原因并提示打开面板重试。Gradle 66 项测试与插件配置校验通过，旧库迁移及 race 检查通过；重启 IDEA 后不打开面板的实机验证待执行。
- 自动启动测试包：`build/local-packages/idea-ai-agent-0.1.24-local.4-windows-amd64.zip`（11.7 MiB），SHA256 `eb8da4d25eb7970d6a8afb1d57f52368c96241e996903252981af4db02d0c105`。TypeScript/Vite、Gradle 校验和 ZIP CRC 通过；核实 JAR 内启动类与扩展注册已包含，278 个前端文件与 dist 一致。

- 只装插件：全部资源/API/编辑依赖随插件 runtime 构建；无新增 MindFS 安装或服务调用。本机“从未安装 MindFS”的整机验收尚未执行。
- 配对：真实 Connector 转发下无 proof 拒绝、正确 proof 解密成功；浏览器首次配对沿用原有 E2EE 协议，真实手机扫码配对待验。
- 双端会话：共享对象和连接内广播已验证；并发队列、断线投递、问题终态、Agent 单次回答及停止相关既有回归通过。真实 Codex 双端会话尚未联调，不将 fake/单元测试等同实机。
- 文件与 Diff：后端真实临时文件回归和浏览器草稿/冲突测试通过；固定 diff 不回读当前磁盘。原生完整快照对比保持本地能力。
- 关闭/恢复：测试 Relay 通路在线、关闭、保留绑定及启用选择恢复通过；本地 WS 保留。关闭浏览器不取消后台任务，复用 pool context，不绑定 websocket 生命周期。
- 解绑：立即关闭远程，明确引导用户在云端 `/nodes` 删除节点；云端删除需要账号登录，设备令牌无此权限。不会把本地关闭显示成云端已删除。
- 项目隔离：项目私有数据目录与本地 Cookie 沿用既有机制；新增节点缓存隔离回归。两个真实 IDEA 项目同时经公网在线待验。
- 升级：未改变旧库迁移，强制旧库及 race 检查通过。
- Windows IDEA、macOS IDEA 实际插件操作、手机实机、公网 HTTPS/WSS 与生产 Relay 协议兼容性仍待联调。

## 顺手发现

`App.tsx` 体积与现有前端大 chunk 不属于本次功能修复范围，未顺手重构。不得依据本记录宣称所有平台已经验收或允许直接发布。
