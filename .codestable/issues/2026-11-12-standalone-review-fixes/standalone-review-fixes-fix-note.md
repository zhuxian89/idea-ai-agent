---
doc_type: issue-fix
issue: 2026-11-12-standalone-review-fixes
path: fast-track
fix_date: 2026-11-12
related: [../../audits/2026-11-12-standalone-backend-review/index.md]
tags: [standalone, lifecycle, migration, installer]
---

# 独立后端整体审查修复

## 问题与方案

用户确认直接修复审查发现的四项问题，要求实现易读、按职责组织。审查根因与原始复现见 [审计报告](../../audits/2026-11-12-standalone-backend-review/index.md)。

| 问题 | 修复后的行为 |
| --- | --- |
| 长期 Core 所用缓存会在插件更新后被淘汰 | 清理前通过 Java `ProcessHandle` 获取活进程的程序目录；保留这些目录的程序与网页。Core 退出后按原缓存保留规则回收，无新增持久状态或配置。 |
| 旧 alias 项目再次打开真实路径会重复登记 | `fs/root_identity.go` 统一判断目录身份，使用路径比较与 `os.SameFile`。IDEA、浏览器添加和旧链接查找复用旧 RootInfo；Registry 在写锁内再次按目录身份去重，保留旧 ID、路径和元数据位置。 |
| Windows 安装到新目录漏停旧 Gateway | 源包 CLI 先执行 `-stop`，再 `-stop-core`，均成功后才复制文件；停止动作不再依赖目标目录中是否存在旧程序。 |
| 新旧 Standalone 模型并存 | 删除无生产调用的单进程分支、冗余 `StartOptions.Standalone`、内置控制器的独立服务状态和禁用参数。Core 用 `SharedCore` 选择启动模式，Gateway 独立维护自身状态。 |

## 代码组织

- 缓存逻辑保留在 `src/main/kotlin/dev/ideaagent/RuntimeCache.kt`，新增回归在 `RuntimeCacheTest.kt`。
- 目录身份共用逻辑放在 26 行的 `runtime/server/internal/fs/root_identity.go`；`registry.go`、`api/usecase/fs.go`、`app/standalone.go` 和 `standalone_migration.go` 调用它。并发持久化回归在 `fs/root_identity_test.go`，旧历史兼容回归在 `app/standalone_duplicate_test.go`。
- 旧模式清理涉及 `app/server.go`、`local_core.go`、`remote_access.go`、`remote_gateway.go`，相应远程控制和服务状态测试同步调整。
- Windows 安装器修改位于 `scripts/standalone/install.ps1`；包内实际流程测试独立放在 `scripts/standalone/package-install.test.mjs`。

## 验证

- Go 首轮七个相关包通过：app、fs、api、usecase、backend、remotehost、cmd/mindfs-server。最终 `env -u MINDFS_RELAY_BASE_URL go test -p 2 ./server/... -count=1` 全量通过，日志 `build/reports/standalone-fix-go-final.log`。
- `go test -race ./server/internal/fs ./server/app -run 'TestRegistryConcurrentAlias|TestStandalone|TestRemoteStatusReportsService' -count=1` 通过，日志 `standalone-fix-race.log`。覆盖并发 alias 登记、Core/Gateway 故障隔离、旧项目和服务状态。
- 两项强制旧库检查通过：kanban 全量及 `TestTaskStoreSnapshotMigration` race，日志 `standalone-fix-kanban.log`、`standalone-fix-migration-race.log`。
- 相关 `go vet` 通过，日志 `standalone-fix-vet.log`。
- Kotlin 首轮定向 11 项中缓存用例夹具失败：复制的 macOS 系统 `sleep` 被终止，退出 -9，尚未进入缓存断言。改用项目自身 Go Core 后，最终 Go 程序重建并强制 `test --rerun` 复验，全量 88/88、0 跳过通过，日志 `standalone-fix-kotlin-final.log`。
- PowerShell 使用现有临时 `/tmp/local-ai-agent-pwsh/pwsh`，下载与包内安装回归 5/5、0 跳过。包内测试在临时 HOME/发现目录运行真实本机 Go CLI，验证换目录时两端停止、新程序登记与启动、页面 200，以及停止失败时程序和 Core 保留。最终日志 `standalone-fix-install-final.log`。
- 新 alias 回归覆盖项目 `.mindfs` 和 home 两种存储：旧注册表重新加载后，经 IDEA/control 和浏览器多次打开真实路径或 alias，仍为原项目 ID、原元数据路径，历史内容一致，home 项目不会额外创建项目 `.mindfs`。
- 活 Core 回归在连续物化两版新缓存后确认旧程序和 `web/index.html` 仍存在；Core 退出后同一旧目录可以清理。

## 交付状态

修复留在工作区，未提交、未重新打包或更新本机安装。已有插件 `.15` 和独立版 `.6` 包不含本轮修复。Windows x64 交叉编译通过，检查产物为 `build/reports/standalone-fix-windows-amd64.exe`；完整 Windows EXE/安装流程仍需 Windows 环境执行。下一步重新生成配套测试包，再进行真实 IDEA 接入和原生按钮验收。
