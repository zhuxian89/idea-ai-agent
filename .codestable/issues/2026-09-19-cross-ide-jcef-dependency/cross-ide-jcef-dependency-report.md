---
doc_type: issue-report
issue: 2026-09-19-cross-ide-jcef-dependency
status: confirmed
severity: high
path: fast-track
tags: [jetbrains, jcef, compatibility]
---

# PyCharm 与 WebStorm 工具窗口无法打开

## 1. 问题描述

`0.1.23-local.11` 能在 PyCharm 2026.2.3 与 WebStorm 2026.2.3 安装并显示 `AI Agent` 入口，但打开工具窗口即失败。

## 2. 复现步骤

1. 在隔离配置中安装 macOS arm64 本地包。
2. 打开测试项目。
3. 点击右侧 `AI Agent`。

## 3. 期望行为

工具窗口正常创建，JCEF 页面和本地 Agent runtime 启动。

## 4. 实际行为

两个 IDE 均抛出 `ClassNotFoundException: com.intellij.ui.jcef.JBCefBrowser`，本地 runtime 未启动。

## 5. 根因

插件直接使用 JCEF API，但清单仅声明 `com.intellij.modules.platform`。2026.2 的模块化产品要求显式建立 JCEF 模块类加载依赖；同时 2024.1 基线没有该模块 ID，所以依赖需要使用带配置文件的可选声明。
