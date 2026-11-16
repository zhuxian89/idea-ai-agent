---
doc_type: issue-report
issue: 2026-11-16-windows-installer-request
status: fixed
severity: P1
summary: Windows 升级 0.1.30 在下载前设置 AllowAutoRedirect 时失败
tags: [windows, powershell, installer]
---

# Windows 下载请求属性错误

用户在 Windows amd64 的 IDEA 插件内升级独立后台 0.1.30，日志输出下载 ZIP 地址后立即报“在此对象上找不到属性 AllowAutoRedirect”，错误来自临时 `local-ai-agent-install-*.ps1`。期望下载、校验并继续升级，实际在下载请求阶段退出。

已核对公开 Windows 插件 0.1.27：内嵌 `installers/install.ps1` 与修复前源码一致（无 BOM UTF-8）。失败位置为 `scripts/install.ps1` 的 `Get-HttpsContent`，由 `StandaloneInstaller.kt` 解出 JAR 内脚本后调用 Windows 系统 PowerShell。用户已确认 PowerShell 5.1 中 HttpWebRequest 含该属性；.NET ANSI936 解码复现中文注释吞掉请求赋值行，根因与验证见 analysis/fix-note。

本次沿用已授权的 Windows 发布修复范围，定位后修复在线入口及插件内嵌入口。UTF-8 BOM 修复已通过真实 Windows 5.1 最终包下载验证并发布；用户实际 IDEA 安装升级待验收。
