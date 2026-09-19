---
doc_type: issue-fix
issue: 2026-09-19-cross-ide-jcef-dependency
status: fixed
path: fast-track
fix_date: 2026-09-19
tags: [jetbrains, jcef, compatibility]
---

# 跨 IDE JCEF 类加载修复记录

## 1. 问题描述

PyCharm 与 WebStorm 能加载插件入口，但无法创建 `AI Agent` 工具窗口。

## 2. 根因

插件缺少 2026.2 模块化产品所需的 JCEF 类加载依赖。

## 3. 修复方案

在主清单增加指向 `jcef.xml` 的可选 `com.intellij.modules.jcef` 依赖。依赖存在时建立模块类加载关系；2024.1 不存在该模块 ID 时仍保持原兼容路径。

## 4. 改动文件清单

- `src/main/resources/META-INF/plugin.xml`
- `src/main/resources/META-INF/jcef.xml`

## 5. 验证结果

- IDEA 2024.1 基线：58 项 Gradle 测试与项目配置校验通过。
- PyCharm 2026.2.3：插件加载、工具窗口、JCEF renderer、本地 runtime 和退出清理通过。
- WebStorm 2026.2.3：插件加载、工具窗口、JCEF renderer、本地 runtime 和退出清理通过。
- Plugin Verifier：IDEA 2024.1、PyCharm 2026.2.3、WebStorm 2026.2.3 均为 `Compatible`；2026.2 两个产品无插件配置缺陷，2024.1 仅报告预期的可选 JCEF 模块未解析。
- 本地包：`idea-ai-agent-0.1.23-local.14-macos-arm64.zip`。

## 6. 遗留事项

未执行真实模型请求、语音识别或原生 Diff 内容交互；本次只验证 JCEF 类加载故障及工具窗口启动链路。
