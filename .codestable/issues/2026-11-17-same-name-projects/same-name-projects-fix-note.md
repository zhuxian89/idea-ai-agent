---
doc_type: issue-fix-note
issue: 2026-11-17-same-name-projects
status: fixed
related: [same-name-projects-report.md, same-name-projects-analysis.md]
tags: [standalone, project-identity, compatibility]
---

# 同名项目修复与交付

不同物理目录的同名项目可同时登记。已有项目保留 ID、名称、顺序和元数据位置；新目录冲突时使用目录名加路径摘要作为 ID，显示名称保持原样。重新打开按物理路径复用，移除和重命名使用实际 ID；网页添加、Git worktree 注册和自动发现同步使用该 ID 准备元数据。

基线为干净工作区 `c4d7a16`，完整任务审查 `Review: PASS`。IDEA 使用后台 root_id，网页按 root_id 索引；旧 JSON 缺省值与 home 元数据归属检查保留。code-simplifier 检查无进一步安全简化，最终源码差异与空白检查通过。

## 实际验证

| 范围 | 结果 | 证据（build/reports/） |
| --- | --- | --- |
| fs 同名身份与元数据相关 | 9 顶层通过，1 符号链接权限跳过 | same-name-0.1.27-fs-targeted.log |
| app 控制/网页/迁移/worktree/自动发现 | 13 顶层通过，1 符号链接权限跳过 | same-name-0.1.27-app-final.jsonl |
| usecase 重命名与回滚 | 2/2 通过 | same-name-0.1.27-usecase-targeted.log |
| kanban 全量 | 通过 | same-name-0.1.27-kanban.log |
| 旧库迁移 race | 通过 | same-name-0.1.27-migration-race.log |

较大范围 fs 全量在未改动的并发 watcher 用例超时；原生产代码 overlay 单项同样超时。usecase 全量的 Windows SQLite 清理和技能搜索干扰失败，在原生产代码代表用例中同样复现。原始失败和有效基线日志均保留，具体命令与范围见 [implementation](../../features/2026-11-11-standalone-backend/standalone-backend-implementation.md#回归结果)。

## 发布

Windows x64 独立后台 `0.1.27` 已重打并替换 [GitHub ZIP](https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v0.1.27/local-ai-agent-0.1.27-windows-amd64.zip)及其 `.sha256`。320 个条目仅 EXE 内容变化，304 网页及其他条目内容和属性相同；版本/Windows AMD64 架构通过。新 ZIP SHA-256 为 `ff1b843712674d428c96eab3b3abd0e509b4131fd2cbc76cc1ad9ed040e884f9`，原包与元数据已备份。

原生 Windows PowerShell 5.1 匿名下载 ZIP 和校验文件，与本地产物的哈希及字节一致。实时 Release 核对其余 22 个资产和标题/正文/标签/目标提交均保持原值。报告 `build/reports/same-name-0.1.27-package.json`、`same-name-0.1.27-release-verification.json`、`same-name-0.1.27-public-download.json`。源码尚未提交，安装验收由用户执行。

当前后台同为 0.1.27 时需手动覆盖安装一次，插件无需重装。退出全部 IDEA，解压后在含 `install.ps1` 的目录执行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`。安装后同时打开 Z:、D: 两个同名项目并核对各自历史。
