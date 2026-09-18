---
doc_type: issue-fix
issue: 2026-09-17-markdown-windows-link
path: fast-track
fix_date: 2026-09-17
tags: [markdown, windows, file-navigation, frontend]
---

# Windows 回复文件链接导致会话重新加载

## 现象与根因

用户在 Codex 回复中首次点击 README.md 下划线链接进入新会话；重新从历史打开该会话再点击，则刷新当前会话。

`MarkdownViewer` 的 HTML sanitizer 和 ReactMarkdown URL 过滤器把 `Z:/java_project/.../README.md` 的盘符当成不支持的协议，文件路径被过滤为空。旧组件继续渲染 `href=""` 且没有阻止默认导航。点击后浏览器重新请求当前页面：无 session 参数时显示新会话，有参数时恢复该会话。旧类名识别规则不匹配 README.md，因此没有阻止这条路径。

修复前 Chromium 回归已复现，见 `build/reports/markdown-windows-link-red.log`。

## 修复范围

- `runtime/web/src/components/MarkdownViewer.tsx`：在 URL 过滤前把可识别的 Windows 盘符、file URI 和文件名行号引用转成路径形式；保留原有 sanitizer 和协议过滤。识别 Markdown 预先编码的反斜杠，打开前恢复盘符路径。空链接不再携带空 href；文件点击阻止页面导航并通过既有文件回调或 IDEA bridge 打开。
- `runtime/web/tests/markdown-idea-navigation.test.mjs`：在初始地址和历史会话地址分别验证类名、相对路径、Windows 正反斜杠、file URI、行号、百分号文件名、空链接和不安全链接；覆盖无 callback 时的 bridge 分支。
- `scripts/smoke-turn-diff.mjs`：完整生产 App 的 Codex 原生／工作区 diff 和 Claude 工作区 diff 场景增加普通 README 链接点击检查。
- 本记录及 `docs/validation.md`。

不改动 Agent 适配器、工具列表、Prompt、权限、原生协议或后端。保留此前本轮 diff 的公共采集和实时同步修复。

## 验证

- TypeScript 检查与 12 项相关前端测试通过，包含此次导航回归和既有 diff／会话流测试。日志为 `build/reports/markdown-windows-link-regressions.log`。
- Vite 生产构建通过；完整 App 在有／无 session 参数两种状态各连续点击两次，只发送预期 `openFile` 消息，地址不变，无页面导航。diff 卡片保留、展开和原有打开按钮正常，历史重载、迟到响应及 replay 检查均通过。
- 完整页面日志为 `build/reports/markdown-windows-link-live.log`；已查看 `build/reports/turn-diff-live-codex-workspace.png`。
- Windows amd64 本地 ZIP 的构建与完整性核验记录追加在 `docs/validation.md`。

## 验收边界

macOS 上的真实 Chromium 使用生产前端与模拟会话传输验证，未调用模型 API。尚需用户在 Windows IDEA 安装 local.13 后验证实际文件打开。仅交付本地 ZIP，不 commit、push、打标签或发布 Release／Marketplace。
