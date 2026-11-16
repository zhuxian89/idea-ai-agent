---
doc_type: issue-fix-note
issue: 2026-11-16-windows-installer-request
status: fixed
severity: P1
summary: 两份安装器统一 UTF-8 BOM，真实 Windows 5.1 最终包下载验证后替换公开附件
tags: [windows, powershell, utf8, installer]
---

# 修复与交付

无 BOM UTF-8 的中文注释被 Windows ANSI936 误读，吞掉下一行 `$request` 赋值，导致对空对象设置 AllowAutoRedirect。用户诊断及 .NET 解码回归确认该属性受 PowerShell 5.1 支持。

两份安装器保留 UTF-8，添加 BOM，请求使用用户指定的 `WebRequest.CreateHttp([Uri]$current)`。PowerShell 脚本固定 LF。打包检查最终 JAR 的脚本字节与源码一致且含 BOM；新 CI 从候选 ZIP/JAR 取出脚本，在真实 Windows 5.1 下载 GitHub 包、核对 SHA-256 并运行默认/ANSI936 读取回归。GBK 仅用于复现错误读取，产品文件未改为 GBK。

## 验证

- 修复前 .NET ANSI936 读取复现同一错误：`build/reports/windows-request-936-before.log`、`windows-request-bom-before.log`。
- 本机便携 PowerShell7 下载/在线安装/隔离包安装 8/8，0 跳过：`windows-request-after.log`。
- 真实 Windows PowerShell 5.1.26100.33648 最终 ZIP 脚本公网下载/摘要通过；默认/ANSI936 读取回归 2/2，PowerShell7 2/2，0 跳过。[发布前 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/43788798807)。
- [发布后 CI](https://github.com/zhuxian89/idea-ai-agent/actions/runs/43789264659) 再次通过，新公网独立包的 SHA-256 为 `e25e62a5b3e1e9ac64dc830e7f329c6b7869d5df363ced1c8bcc0e8183c3180f`。日志 `windows-utf8-ci-public.log`。
- kanban 全量与旧库迁移 race 均通过，日志 `windows-utf8-{kanban,migration-race}.log`。
- 最终包检查拒绝旧安装器，Windows 双架构/通用候选通过。ZIP/JAR 逐条比对只有安装脚本变化，后台程序和网页保留原字节。
- 替换的 10 项公开附件匿名下载与本地/GitHub digest 一致；其余 20 项资产 ID/digest 保留。在线 raw 安装器与源码一致，默认 0.1.30、Latest 插件 v0.1.27。证据 `build/reports/windows-utf8-delivery/public-verification.json`。

## 发布与使用

独立后台继续 0.1.30，插件继续 0.1.27。替换 Windows 双架构独立 ZIP、在线 install.ps1、各自校验文件，以及 Windows 双架构/通用插件 ZIP 与 SHA256SUMS。Mac/Linux 附件保留。

插件运行 JAR 内嵌脚本。已装旧插件需要下载修正后的 Windows ZIP，通过 IDEA“从磁盘安装插件”重新安装并重启 IDEA，之后再检查独立后台更新；同版本不会自动提示插件升级。Windows x64 包为 `build/releases/0.1.27/idea-ai-agent-0.1.27-windows-amd64.zip`，SHA-256 `749f7a30cebcdcdc4058bb2b2416d00383646d564644ff5ebb39b35b4277801d`。

真实用户 IDEA 更新、计划任务及服务启动待用户验收。本轮未安装、停止或重启用户服务。源码聚焦提交 `a3663ae67caaab898f6932833bb2d8a600135b99`；交接记录及 AGENTS 门禁同步更新。
