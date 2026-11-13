---
doc_type: audit-finding
audit: 2026-11-12-standalone-backend-review
finding_id: "bug-03"
nature: bug
severity: P2
confidence: medium
suggested_action: cs-issue
status: resolved
resolved: 2026-11-12
---

# Finding 03：Windows 安装到新目录会留下旧 Gateway 和已停止的 Core

已修复：源包 CLI 依次停止 Gateway/Core 后才复制程序。PowerShell 包内脚本配合本机真实 Go CLI 的换目录安装、页面读取和停止失败保留回归通过；Windows x64 交叉编译通过。完整 Windows EXE 运行仍需 Windows 环境，见 [修复记录](../../issues/2026-11-12-standalone-review-fixes/standalone-review-fixes-fix-note.md)。以下为修复前证据。

## 速答

PowerShell 包内安装器仅用目标目录已有程序停止 Gateway；目标目录没有旧程序时会跳过停止，随后仍停止 Core，形成“旧 Gateway 存活、Core 缺失”的状态。

## 关键证据

- `scripts/standalone/install.ps1:9-15`：`$Executable` 指向 `$Target`，`-stop` 被包在 `if (Test-Path $Executable)` 内，`-stop-core` 却总由源程序执行。
- `scripts/standalone/install.ps1:24-27`：安装只登记新程序并提示手动启动，没有检查已运行 Gateway 是否来自旧目录。
- `runtime/server/cmd/mindfs-server/cli.go:142-143`：Gateway `/control/status` 成功就将 `running` 设为 true；第 212 行只有 `!running` 时才启动新的后台进程，无项目参数的普通启动不会调用 open-project 或恢复 Core。
- 相应隔离探针执行：目录 A 启动两端 → 跳过 `-stop`、仅 `-stop-core` → 将程序复制到空目录 B → B 程序 `-install` → B 程序普通启动。输出显示运行中，但旧 Gateway PID `69796` 不变，Core 描述符缺失，浏览器返回 503。证据为 `build/reports/standalone-review-gateway.json`。
- `scripts/standalone/install.sh:28-29` 使用源程序无条件执行 `-stop` 与 `-stop-core`，不依赖目标目录中是否存在旧程序。

## 影响

Windows 用户以前安装在 A、这次指定 B，或以前使用自定义目录、这次使用默认目录，且 A 的 Gateway 仍运行时触发。新程序已登记但旧 Gateway 继续占用发现记录与锁，数据服务则已停止。用户按安装器提示普通启动 B 后仍无法使用页面。

脚本路径由静态分析确认，后续 CLI/HTTP 状态在 macOS 的真实 Go 进程中复现；本机没有 PowerShell，完整 Windows 包内安装尚未执行，置信度为 medium。

## 修复方向

复制前使用源包程序停止当前发现目录登记的 Gateway，再停止 Core，与目标目录是否已有程序解耦；补充换安装目录的 Windows 安装回归。

## 建议动作

`cs-issue`：修复安装流程的停止顺序，随后在 Windows 验证目录迁移与正常启动。
