---
doc_type: feature-ff-note
feature: plugin-packaging-script
date: 2026-09-19
requirement:
tags: [build, packaging, release]
---

## 做了什么

新增统一插件打包命令，可自动生成下一个本地 Mac/Windows 测试包，或一次生成四平台包与 Marketplace 通用包。脚本自动选择 JDK 21、复用一次前端构建、管理版本和文件名，并校验 ZIP、版本、重复条目、二进制架构与可执行权限。

## 改了哪些

- `scripts/package-plugin.mjs` — 新增 `local mac`、`local win` 和 `release` 三种打包入口及产物校验。
- `scripts/build-runtime.mjs` — 允许五包流程复用已构建的 Web 产物，避免对每个平台重复执行 Vite。
- `README.md` — 增加中英文打包命令。

## 怎么验证的

Mac arm64 和 Windows amd64 本地模式均完成端到端构建与校验；临时版本的五包模式在约 23 秒内生成四平台包、Marketplace 通用包和 SHA-256 清单，全部通过自动校验。
