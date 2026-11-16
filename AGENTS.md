# 项目开发约束

## 当前工作交接

独立后端正在开发，接手前先读
[独立后端计划与进度](.codestable/features/2026-11-11-standalone-backend/README.md)，
再按其中的下一步继续。该入口汇总已确认决策、当前实现、验证状态和安装包版本。
每完成一个步骤、遇到测试失败或结束一轮工作时，同步更新交接入口与 checklist；
实现细节和验证证据写入 implementation。源码完成、验证通过和安装包生成分别记录，
后续代码有改动时重新标明待验证范围，不沿用旧版本的全通过结论。

## Windows 安装脚本与发布验证（2026-11-16）

此前 Windows 更新在下载 GitHub 包时出现 `MaximumRedirectExceeded`，
安装日志又因 GBK/UTF-8 不一致被二次解码错误覆盖，界面只显示 `Input length = 1`。
修复下载跳转处理和日志输出编码后，用户确认更新成功。
本次 `AllowAutoRedirect` 错误已证实由无 BOM UTF-8 被 Windows ANSI 936 误读引起：中文注释吞掉下一行请求赋值，随后对空对象设置属性。

- 插件从自身 JAR 的 `installers/install.ps1` 解出临时脚本执行，不从独立后台附件加载脚本。修改 `scripts/install.ps1` 后，需同步发布固定在线入口，并重打受影响的插件包、更新校验和；只替换独立后台不能修复已安装插件的内嵌脚本。发布前核对公开插件包内的脚本与修复源码一致。
- 安装脚本统一 UTF-8 BOM，不转为 GBK；PowerShell 5.1 需要 BOM 识别 UTF-8。`.gitattributes` 固定 `.ps1` 的 LF 换行。打包检查最终 JAR 内脚本与源码逐字节一致且有 BOM。
- 插件实际调用 `powershell.exe`（Windows PowerShell 5.1）。相关下载修复必须从最终插件 ZIP 提取脚本，在真实 Windows 5.1 验证后才能发布；PowerShell 7 或 macOS 验证不能替代。缺少环境或测试跳过时不得替换正式附件或记为验证通过。验证真实 GitHub 下载、相对及连续重定向、二进制内容和 SHA-256 校验，保留逐跳 HTTPS 校验和校验成功后才安装的顺序。
- Windows 安装进程须在加载脚本前统一 UTF-8 输出，与插件读取日志的编码一致。安装失败应展示原始下载或执行错误，不能让日志解码异常覆盖原因。
- 首次安装与更新共用下载脚本，但首次安装使用 `-DeferStart`。分别验证安装参数与流程；临时安装桩通过不能记为真实计划任务注册、登录自启或重启接入已通过。
- 属性不存在时先复现实际请求类型、脚本读取编码和完整报错；不要仅凭属性名断定 PowerShell 版本或跳转是根因。请求使用 `WebRequest.CreateHttp([Uri]$current)`，保留逐跳校验；不通过增加等待时间或重试掩盖错误。

回归入口：`scripts/standalone/download-redirect.test.mjs`、
`scripts/standalone/install.test.mjs`、`scripts/standalone/verify-windows-plugin-installer.ps1`、
`.github/workflows/windows-installer.yml`、`StandaloneInstallerTest.kt` 与
`WindowsStandaloneInstallerCommandTest.kt`。
历史证据见 [Windows 更新修复记录](.codestable/features/2026-11-11-standalone-backend/standalone-backend-implementation.md#windows-27-插件重打与发布2026-11-13已发布)，
当前故障见 [Windows 下载请求属性错误](.codestable/issues/2026-11-16-windows-installer-request/windows-installer-request-report.md)。

## 数据库升级必须兼容旧库（2026-10-23）

### 已发生的问题

旧项目的 `.mindfs/tasks/task-kanban.db` 中，`tasks` 表缺少
`template_snapshot_json`，新版启动加载任务时出现：

```text
SQL logic error: no such column: template_snapshot_json (1)
```

根因是查询已引用新字段，但迁移仅在新建表时声明字段，没有给已有表补列。
**`CREATE TABLE IF NOT EXISTS` 不会更新已有表结构。不能把新建数据库测试通过当成升级兼容通过。**

修复位于 `runtime/server/internal/kanban/task_store.go` 的 `TaskStore.migrate()`：
幂等添加 `template_snapshot_json TEXT NOT NULL DEFAULT ''`，保留已有字段内容。
空字符串与当前任务插入逻辑一致，不伪造历史快照。不要删除这条旧库迁移。

### 后续修改的硬约束

- 修改持久化表结构、查询字段或读写模型时，必须同时检查已发布版本的旧库升级路径；新库建表与旧库迁移都要覆盖。
- 新增字段必须提供幂等迁移及适合历史数据的默认值或回填方案，在依赖该字段的查询、索引及业务读写之前执行。重复启动不能报错或覆盖已有值。
- 不得通过删除用户数据库、删表重建、清空任务或要求用户重新安装来规避兼容问题；不得吞掉数据库错误制造启动成功的假象。
- 必须增加旧库回归测试：缺列旧库可读写、重复迁移成功、已有字段值与任务/阶段/事件保留、新库仍正常。后续表结构变化继续补充对应旧结构用例，不能只保留本次字段测试。
- 迁移测试仅使用临时数据库，不得直接拿用户真实项目数据库做破坏性验证。
- 任务加载失败应报告 `task.load_failed`，保留诊断信息；不得误报为 `file.write_failed`。

### 每次版本打包前必检

在 `runtime/` 目录执行并确认通过：

```sh
go test ./server/internal/kanban -count=1
go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1
```

现有回归测试：`runtime/server/internal/kanban/task_store_migration_test.go`。
涉及其他数据库时，另跑相应模块的迁移回归测试。迁移测试失败或升级路径未经验证，不得宣称版本可交付。
打包成功、前端测试通过或只验证新库，都不能替代旧库升级验证；交付时明确说明迁移验证结果。

详细修复记录见
[启动数据库报错与活动状态误导修复](.codestable/issues/2026-10-23-task-migration-activity-status/task-migration-activity-status-fix-note.md)。
