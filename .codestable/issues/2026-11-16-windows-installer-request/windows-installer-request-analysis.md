---
doc_type: issue-analysis
issue: 2026-11-16-windows-installer-request
status: confirmed
severity: P1
summary: 无 BOM UTF-8 中文注释经 Windows ANSI 936 解码吞掉下一行请求赋值
tags: [windows, powershell, encoding]
---

# 根因与修复范围

用户确认 Windows PowerShell 为 5.1.26100.9818，手动创建的 `System.Net.HttpWebRequest` 确有 AllowAutoRedirect 属性。该版本支持此属性，问题不能归为属性不兼容。

最终公开插件 JAR 内 `installers/install.ps1` 与源码逐字节一致，是无 BOM UTF-8。使用 .NET `Encoding.GetEncoding(936)` 按中文 Windows ANSI 解码后，`# Windows PowerShell 5.1 ... Location。` 注释的末尾吞掉换行，解析器将下一行 `$request = ...` 一并识别为 Comment。赋值未执行，随后对空 `$request` 设置属性，产生与用户一致的 PropertyNotFound 错误。证据 `build/reports/windows27-installer-dotnet-gbk.ps1`，以及 GBK 模式下载回归。

现有测试抽取 UTF-8 函数，在 PowerShell 7 默认编码下运行，未覆盖 5.1 的 ANSI 读取；上次 macOS 打包又跳过 PowerShell 测试，故同一风险再次进入发布。

用户提出使用 `[System.Net.WebRequest]::CreateHttp([System.Uri]$current)`，并要求统一 UTF-8。采用此明确的 HTTP 工厂，两个安装入口保持 UTF-8 并添加 BOM，保留中文注释；`.gitattributes` 固定 PowerShell 脚本 LF 换行，保证跨平台源码与包内脚本字节一致。增加 ANSI 936 读取（启用 BOM 检测）的真实解析与下载回归，以及最终插件包中脚本与源码一致、UTF-8 BOM 的打包检查。

影响 `scripts/install.ps1`、`scripts/standalone/install.ps1`、下载测试、`scripts/package-plugin.mjs`、`.gitattributes` 和 Windows 5.1 CI 验证入口。验证后替换在线脚本、Windows 双架构及通用插件的内嵌脚本、Windows 独立包的安装脚本与校验和。独立后台 EXE 和网页保留原字节。真实 Windows 5.1 CI 从最终插件 ZIP 提取安装器，执行 GitHub 下载与摘要检查，通过后才替换正式资产。
