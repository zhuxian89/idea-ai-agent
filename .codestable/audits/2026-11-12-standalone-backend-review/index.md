---
doc_type: audit-index
audit: 2026-11-12-standalone-backend-review
scope: 工作区中未提交的独立后端功能及其与现有缓存、项目注册和安装流程的交互
created: 2026-11-12
status: resolved
total_findings: 4
open_findings: 0
resolved: 2026-11-12
---

# 独立后端整体审查

四项发现已按用户要求修复并完成回归，见 [修复记录](../../issues/2026-11-12-standalone-review-fixes/standalone-review-fixes-fix-note.md)。Go 后端全量、相关 race/vet、旧库迁移、Kotlin 88 项和安装 5 项通过，0 跳过；Windows x64 交叉编译通过。源码尚未重新打包。下面保留审查时的发现与证据，文件行号以审查时工作区为准。

## 范围

先读取实际全局 `/Users/hongweizhang/.codex/AGENTS.md`、项目 `AGENTS.md` 和 `.codestable/attention.md`，再对照独立后端设计与当前交接记录审查工作区。

覆盖 Core/Gateway 分工、写入锁、发现协议、IDEA 启动与服务控制、旧项目和书签迁移、前端入口与项目添加、Relay 转发、CLI、安装升级与打包脚本。会话设置是并行改动，本报告聚焦独立后端。架构目录目前主要记录 UI 模块，后端职责同时对照本功能已确认设计。

## 审查结论（修复前）

Core 持有项目数据、Gateway 管理远程入口、IDEA 直连 Core 的拆分清楚，远程故障与本地聊天的生命周期已分离。项目添加也已按目录选择、GitHub 导入和弹窗流程拆开。主要问题位于新生命周期与旧机制的衔接：长期 Core 使用可被淘汰的插件缓存、旧别名路径未复用项目身份，以及 Windows 换安装目录时漏停 Gateway。

共发现 3 条行为问题和 1 条可维护性问题：P1 两条、P2 两条。旧单进程 Standalone 分支仍留在生产代码中，后续调整启动和远程状态时需要额外理解一套无生产调用的模型。现有写入锁、本地令牌和来源校验有明确的数据完整性与访问控制用途，属于必要保护。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 证据入口 |
| --- | --- | --- | --- | --- | --- |
| 1 | bug | P1 | high | 插件缓存清理会删除仍被长期 Core 使用的资源 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | high | 已有别名路径项目再次打开真实路径会重复登记 | [finding-02.md](finding-02.md) |
| 3 | bug | P2 | medium | Windows 安装到新目录会留下旧 Gateway 和已停止的 Core | [finding-03.md](finding-03.md) |
| 4 | maintainability | P2 | high | 废弃的单进程 Standalone 分支仍与新模型并存 | [finding-04.md](finding-04.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
| --- | --- | --- | --- | --- |
| bug | 0 | 2 | 1 | 3 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 1 | 1 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **2** | **2** | **4** |

## 审查时验证

本轮使用隔离数据，没有修改产品代码或更新安装包。

| 检查 | 本轮结果 | 证据 |
| --- | --- | --- |
| Go app、backend、remotehost、独立 CLI、kanban | 五个包通过，退出码 0 | `build/reports/standalone-review-go.log` |
| kanban 旧库迁移 race | 通过，退出码 0 | `build/reports/standalone-review-migration-race.log` |
| 安装脚本测试 | 3 通过，1 PowerShell 跳过；本机没有 pwsh | `build/reports/standalone-review-install.log` |
| 旧注册表 alias → 实际 Core HTTP open-project | 项目从 1 条变成 2 条 | `build/reports/standalone-review-alias.json` |
| 真实 Kotlin materializeRuntime 缓存函数 | 进程仍存活，所用程序和 web 目录均已删除 | `build/reports/standalone-review-cache.json` |
| 漏停 Gateway 的后续 CLI 行为 | 新 CLI 显示运行中，旧 Gateway PID 不变，Core 描述符缺失，浏览器返回 503 | `build/reports/standalone-review-gateway.json` |

最后一项在 macOS 上运行当前 Go CLI，验证 Windows 脚本会形成的进程状态；完整 PowerShell/Windows 安装流程未实机执行。前端和 Kotlin 测试的历史结果保留在功能交接中，本轮未重跑其全量套件。

## 下一步建议

四项修复均为 resolved。下一步重新生成包含项目添加恢复和本轮修复的配套包，完成包内回归，再继续真实 IDEA 与原生按钮验收。
