---
doc_type: audit-finding
audit: 2026-11-12-standalone-backend-review
finding_id: "maintainability-04"
nature: maintainability
severity: P2
confidence: high
suggested_action: cs-refactor
status: resolved
resolved: 2026-11-12
---

# Finding 04：废弃的单进程 Standalone 分支仍与新模型并存

已修复：删除旧分支、冗余模式开关及内置控制器专属 service 状态，状态回归改为验证实际 Gateway。Go 全量与相关 race 通过，见 [修复记录](../../issues/2026-11-12-standalone-review-fixes/standalone-review-fixes-fix-note.md)。以下为修复前证据。

## 速答

生产入口已统一使用独立 Core/Gateway，但 `server.go` 仍保留 `Standalone=true && SharedCore=false` 的旧模型，增加启动、描述符和远程状态维护成本。

## 关键证据

- `runtime/server/app/server.go:289-309`：`else if opts.Standalone` 仍创建 `newRemoteAccessControl`、绑定业务与管理路由、发布 `host.json` 并管理同进程远程客户端。这是在 `opts.SharedCore` 分支之外的一套完整旧 Standalone 启动流程。
- `runtime/server/app/local_core.go:34`：生产代码唯一赋值为 `opts.Standalone, opts.SharedCore = true, true`，因此走前一个 SharedCore 分支。
- `runtime/server/cmd/mindfs-server/cli.go:276` 的 `serveStandalone` 使用 `backend.EnsureCore` 和 `app.StartRemoteGateway`，不再通过该旧分支启动。
- 对 `runtime/server` 全部 Go 文件检索 `.Standalone`、`.SharedCore` 和结构体初始化，未发现生产入口构造 `Standalone=true && SharedCore=false`；HTTPHandler 测试中的 `Standalone: true` 只是网页模式测试。
- `runtime/server/app/remote_access.go:24-25,126-133` 的 `remoteAccessControl.service` 只由该旧分支在生产代码赋值，新 Gateway 则在 `remote_gateway.go` 维护自己的 `gatewayControl` 和服务状态。

## 影响

阅读者需要理解内置、Core/Gateway 以及一个无生产调用的旧 Standalone 组合；远程状态字段、配置与启停行为也有两套 Standalone 实现需要辨别。它没有提供当前设计要求的额外能力，是当前可维护性负担。

## 修复方向

删除无生产调用的单进程 Standalone 分支及专属状态代码，保留实际使用的内置模式、Core 和 Gateway 职责；调整只验证旧模型的测试。

## 建议动作

`cs-refactor`：行为保持不变，删除废弃模型即可，不需要引入通用生命周期框架。
