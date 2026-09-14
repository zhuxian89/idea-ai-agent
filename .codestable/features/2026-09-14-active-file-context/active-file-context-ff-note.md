---
doc_type: feature-ff-note
feature: active-file-context
date: 2026-09-14
requirement:
tags: [idea, editor, context, codex, claude]
---

## 做了什么
保留「加入当前代码」的选择片段/未保存内容行为；新增「加入当前文件」，只把激活编辑器文件的绝对路径加入当前对话草稿。项目文件树和文件标签页右键也可加入所点击文件的路径，不读取全文、不自动保存、不自动发送。

## 改了哪些
- `FileContext.kt`、`AddFileContextAction.kt`、`plugin.xml` — 点击时取激活标签页或右键目标文件，注册两个文件右键入口；无可用本地文件时显示提示。
- `AddContextAction.kt`、`AgentToolWindowFactory.kt`、`ideaBridge.ts` — 复用上下文交付与启动队列，新增独立文件路径请求，添加时返回现有聊天视图。
- `IdeaWorkbench.tsx`、`ide.css`、中英文文案、`README.md` — 输入框上方常显文字按钮，说明代码内容与文件路径的区别。
- `build.gradle.kts` 与测试 — 接入 IDEA 自带平台测试框架，验证编辑器选择与菜单注册；补充桥接及浏览器回归。

## 怎么验证的
26 项 Kotlin/IDEA 平台测试、23 项桥接/浏览器测试、TypeScript 检查、完整运行时/App 冒烟及项目配置检查均通过。平台测试覆盖打开 10 个文件后选择第 8/第 3 个、右击未打开文件、未保存选区、无激活文件及两个菜单注册；浏览器覆盖已有草稿、当前会话、双入口及 320/375/400px 中英文深浅主题。证据在 `build/reports/file-context*`；尚未进行用户安装后的 IDEA/JCEF 手工体验验收，未发布新版本。
