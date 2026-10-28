---
doc_type: issue-fix
issue: 2026-10-23-task-migration-activity-status
path: fast-track
fix_date: 2026-10-23
tags: [sqlite, migration, activity, desktop]
---

# 启动数据库报错与活动状态误导修复

## 1. 问题描述

用户确认一次性修复：启动时缺少数据库字段；活动栏第三行重复提醒；实际执行脚本或等待下一步时，被无进展计时覆盖成“安静得有点久”。

## 2. 根因

- 查询固定选择 `template_snapshot_json`，旧表缺列，但迁移只有建表语句，没有补列。`CREATE TABLE IF NOT EXISTS` 不会升级已有表。
- 任务加载异常错误地报告为 `file.write_failed`。
- `SessionActivity` 的 30/90 秒无事件阈值优先于工具、生成、思考和压缩状态；相同等待时长又单独显示一行。
- 活动栏只看原始工具 status，没有遵循工具行已采用的结构化 terminal outcome。

## 3. 修复方案

- 沿用现有幂等迁移方式，只补缺失字段，默认空字符串，与现有插入行为一致；不删表、不重建表、不清空数据，已有字段值不变。
- 任务加载失败使用 `task.load_failed`，保留底层诊断信息。
- 移除时间阈值的表情覆盖与重复提示，保留总等待/最近更新两个独立时钟。没有事件不推断卡住。
- 复用结构化 outcome 与状态归一化；执行中显示 🔥 正在运行命令或脚本，完成后无后续事件显示 👀 等待 Agent 的下一步。保留断网、回答、发送、恢复和终态优先级。
- 按 UI 技能的真实反馈原则修正，不改既有主题与布局，不增加动画；保留用户指定的反应表情。

## 4. 改动文件清单

- `runtime/server/internal/kanban/task_store.go`、`task_store_migration_test.go`
- `runtime/web/src/App.tsx`（仅本次任务加载异常分类）
- `runtime/web/src/services/error.ts`、`activityReaction.ts`
- `runtime/web/src/components/SessionActivity.tsx`
- `runtime/web/src/i18n/locales/zh-CN.ts`、`en-US.ts`、`runtime/web/src/index.css`
- `runtime/web/tests/activity-reactions.test.mjs`、`session-activity-time.test.mjs`、`session-activity-lifecycle.test.mjs`、`approval-activity.test.mjs`、`tool-activity.test.mjs`、`task-load-error.test.mjs`

以上文件部分已有未提交改动，本次保留此前 Enter、回答状态、断网恢复等修复。没有新增范围外重构或提交。

## 5. 验证结果

- 修复前临时旧库测试准确失败：`no such column: template_snapshot_json (1)`；修复后通过。
- 旧库及已有字段两种场景验证：重复打开两次、任务/标签/编号/阶段输入/事件保留、额外旧字段保留、已有 snapshot 内容保留、新建及更新正常。测试仅操作 `t.TempDir()`，没有迁移真实项目数据库。
- `go test ./server/internal/kanban ./server/internal/api ./server/internal/session ./server/internal/agent/codex ./server/internal/agent/claude` 通过。
- `go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1` 通过。
- TypeScript 检查通过；完整前端测试 224/224 通过（实际 Chrome）。首次回归发现两处旧执行文案断言，更新到新文案后全量重跑通过。
- 浏览器覆盖：30/90 秒真实状态不变，脚本完成后等待 148 秒、静默压缩、终态事实优先于旧 running、回答与断线优先级、分钟/小时计时、中英文及深浅主题 320/420px。检查最窄截图，无溢出和重复说明行。
- `git diff --check` 通过。UI detector 仅报告既有 Inter 字体警告；属于原有设计，本次不更换。
- Review：改动限定在三项问题和回归断言，没有发现阻断问题。
- 打包 `node scripts/package-plugin.mjs local win --version 0.1.23-local.20 --verify` 成功；Gradle 58 项测试及配置检查通过。
- ZIP 完整性、目标平台及版本校验通过；直接检查包内 JS 和 Windows EXE，确认新运行/等待文案、✏️、任务错误分类及补列 SQL 存在，旧停滞提示与重复说明已消失。
- 产物：`build/local-packages/idea-ai-agent-0.1.23-local.20-windows-amd64.zip`，11,615,866 字节。
- SHA-256：`6cc6e1b583307bd1a3e1c56a8b1dadd1d7185a0b7b94abfaf8fff4075f6ec052`。

## 6. 遗留事项

- 尚未在真实 Windows IDEA 中安装验收，需要用户测试启动和实际会话。
