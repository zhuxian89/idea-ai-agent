---
doc_type: issue-fix
issue: 2026-09-19-narrow-composer-layout
path: fast-track
fix_date: 2026-09-19
tags: [frontend, idea, responsive-layout, composer]
---

# 窄宽度聊天输入区布局修复记录

## 1. 问题描述

JetBrains 工具窗口约 441px 及更窄时，输入提示文字与 Agent / 模型选择器重叠，权限选择器被挤到不稳定的位置，右侧附件、语音和发送按钮与配置区割裂。

## 2. 根因

IDE 输入区预留了单行控制条空间，但提示文字仍在整个输入框内垂直居中；控制条同时采用绝对定位和不可控的自然换行。Agent、模型、思考强度和权限同时出现后，总宽度超过工具窗口，文字和控件因此占用同一区域。

## 3. 修复方案

- 将 IDEA 输入区控制条拆成主选择区和次操作区，保持原有 DOM 焦点顺序和业务回调。
- 480px 以下稳定显示两行：第一行放模式与 Agent / 模型，第二行左侧放权限、右侧放附件 / 语音 / 发送。
- Agent 标签使用剩余宽度并省略溢出内容，关键按钮固定保留。
- 将输入提示和正文放到输入框上方，并为两行控制区预留底部空间，避免文字与控制区相交。
- 非 IDEA 的 ActionBar 保持原有单行布局。

## 4. 改动文件清单

- `runtime/web/src/components/ActionBar.tsx` — 增加控制区语义分组并调整编辑区上下留白。
- `runtime/web/src/ide.css` — 增加 480px 以下两行响应式布局。
- `runtime/web/tests/idea-chrome.test.mjs` — 增加 441px 档位及两行、无重叠、无横向溢出的浏览器断言。

## 5. 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过；仅保留项目已有的大 chunk 提示。
- `node --test tests/idea-chrome.test.mjs`：22 项全部通过。
- Chromium 实际渲染检查：320、375、400、441、812px 均无控件越界或重叠；375px 浅色与其余深色截图均正常。

## 6. 遗留事项

- 无。本轮未生成插件安装包。
