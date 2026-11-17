---
doc_type: issue-analysis
issue: 2026-11-17-same-name-projects
status: confirmed
root_cause_type: logic
related: [same-name-projects-report.md]
tags: [standalone, project-identity, compatibility]
---

# 同名项目身份冲突分析

## 根因与失败路径

`app/standalone.go` 的 `/control/open-project` 已按物理路径复用已登记项目，但新目录进入 `fs.Registry.UpsertWithMetaLocation` 后，`registry.go:158–174` 将 basename 同时作为 ID 和名称，并拒绝不同路径占用同名 ID。

网页添加入口 `api/usecase/fs.go:795–824` 还有同样的名称拦截；`Registry.Remove` 按 basename 定位记录。只解除一处冲突会造成网页仍无法添加，或移除失败。home 元数据目录以 root ID 分区，仍须保留 `.mindfs-project.json` 的路径归属检查。

## 已确认方向与方案比较

用户明确两份项目同时保留使用。沿用已告知的“旧项目保留身份，新目录获得独立 ID”方向。

- 方案 A（采用）：无冲突的新目录沿用 basename ID；有冲突时分配 basename 加规范化路径摘要，保留名称和真实路径。重新打开按物理路径复用，现有注册记录与聊天文件不迁移；home 元数据选择与新 ID 保持一致。移除按物理路径定位，重命名使用相同分配规则。
- 方案 B：全量迁移所有项目到路径摘要 ID。会改变现有 URL、前端状态、定时任务及 home 元数据索引，超出本次需求。

## 实施范围与兼容核对

修改 `internal/fs/registry.go`、`root_identity.go`、`meta_location.go`、`internal/api/usecase/fs.go` 及相应临时目录回归测试。补独立打开入口的回归；兼容追踪发现 `usecase/git_worktree.go` 和 `app/server.go` 的自动发现也在注册前按 basename 准备元数据，两处同样使用实际分配 ID，避免 home 数据先写入错误目录。Kotlin 已直接使用后台返回的 root_id，前端也按 ID 索引，无需修改协议字段或插件。

核对：不同路径同名可并存；原 ID/名称/顺序/元数据位置不变；重复打开/别名路径只保留一条；home 数据隔离与移除后重新添加；只移除目标目录；重命名不覆盖同名项目；空/非法目录仍报错。数据库结构与迁移不变。源码、运行验证与新包生成状态分别记录，验证使用临时目录和数据库。

用户随后授权运行相关回归、重打 Windows x64 独立后台并替换 GitHub `0.1.27` 对应包。首轮相关 app 回归中，旧 `standalone_migration_test.go` 的拒绝同名断言需按本次授权行为改为并存及旧链接保留；`server_test.go` 的自动发现用例仅覆盖 Unix TMPDIR，在 Windows 下 `os.TempDir` 仍指向包含测试项目的父目录，导致全部跳过，补齐临时 HOME/USERPROFILE/TMP/TEMP。两处仅修测试夹具/期望，原始失败见 `build/reports/same-name-0.1.27-app.log`。
