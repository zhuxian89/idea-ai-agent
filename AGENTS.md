# 项目开发约束

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
