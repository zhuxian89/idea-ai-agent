---
doc_type: audit-index
audit: 2026-10-29-remote-release
scope: 远程入口鉴权、三端会话、扫码配对、项目自动启动、文件编辑和发布说明
created: 2026-10-29
status: resolved
total_findings: 3
---

# 远程访问发布前复查

2026-10-29：用户要求直接修复后，三项发现均已处理并通过回归，见 [修复记录](../../issues/2026-10-29-remote-release-review/remote-release-review-fix-note.md)。以下保留审计时的发现与复现结果；local.4 尚未重建，不包含这些修复。

## 总评

本轮完成源码审查及故障验证，没有修改业务源码或发布插件。确认 2 个需要修复的功能问题，以及 1 个发布说明缺口；不建议直接发布 local.4。用户已经确认正常三端消息同步，但这不覆盖本次复现的网络失败和轮次交接问题。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 记录 |
|---|---|---|---|---|---|
| 1 | bug | P1 | high | 下一轮准入早于上一轮完成通知发送结束 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | high | 自动配对网络失败被误判为需要重新输码 | [finding-02.md](finding-02.md) |
| 3 | arch-drift | P1 | high | 对外说明未覆盖新增 Relay 数据流及浏览器存储 | [finding-03.md](finding-03.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 |
|---|---|---|---|
| bug | 0 | 2 | 0 |
| security | 0 | 0 | 0 |
| performance | 0 | 0 | 0 |
| maintainability | 0 | 0 | 0 |
| arch-drift | 0 | 1 | 0 |

没有在本轮限定范围中确认鉴权绕过、额外性能或维护性阻断项；这不是完整安全认证，也不代表未测试路径均无问题。

## 验证结果

- Go `./server/...` 全量通过；app/api/relay/fs `-race` 全量通过，使用隔离环境，不操作用户数据库。
- Chrome 前端 247/247 通过；Kotlin 66 项及插件配置校验通过。
- kanban 旧库迁移包含在 Go 全量中；`-race -run TestTaskStoreSnapshotMigration -count=1` 再次通过。
- 新增临时故障探针：`TestReviewCompletionMustPublishBeforeNextAdmission` 失败，证实结束通知仍被连接阻塞时新消息已获执行资格。通过 Go overlay 注入测试，没有改动仓库业务文件。
- 新增临时配对探针：bootstrap 状态请求成功后让握手抛出 `Failed to fetch`，实际得到 `needs_pairing` 和空错误，故障断言失败。
- 自动启动的路径兼容、开关读取及编译测试通过；local.4 重启后不打开面板的 Windows 实机确认仍待执行，不能把单元测试等同实机验收。

## 下一步

发布前先修复 1、2 并将故障探针纳入正式回归；补齐第 3 项对外说明，再跑受影响模块回归和正式打包检查。此次未更改版本号、打包、提交、push 或上传市场。
