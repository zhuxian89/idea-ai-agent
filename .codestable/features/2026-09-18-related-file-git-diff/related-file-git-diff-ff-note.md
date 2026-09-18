---
doc_type: feature-ff-note
feature: related-file-git-diff
date: 2026-09-18
requirement:
tags: [idea, git, diff, related-files]
---

## 做了什么

为会话底部“关联文件”增加 IDEA 专属的“与 HEAD 对比”操作。文件名点击仍打开文件；按钮仅在当前 Git worktree 有该文件变更时显示，并用 IDEA 原生 DiffManager 弹出左右对比窗口。

## 改了哪些

- `runtime/server/internal/gitview/gitview.go` — 只读读取 `HEAD` 与工作区两侧内容，支持修改/新增/删除/重命名/二进制和 2 MiB 上限；HEAD 存在性用 `git ls-tree` 判断，避免把 Git 错误误判为新增文件。
- `runtime/server/internal/api/usecase/fs.go`、`runtime/server/internal/api/http_git_compare.go` — 复用关联文件路径解析并暴露本地 token 专用 compare API。
- `runtime/web/src/services/ideaBridge.ts`、`RelatedFileCompareButton.tsx`、`SessionViewer.tsx`、`App.tsx`、i18n — 增加按钮、文案和 bridge action，保持文件打开语义。
- `runtime/web/src/components/TurnDiffSummary.tsx`、`RelatedFileCompareButton.tsx` — 本轮 diff 文件行直接提供打开与原生对比图标；`+/-` 统计固定在按钮左侧，文件名仍展开 inline diff。
- `src/main/kotlin/dev/ideaagent/AgentToolWindowFactory.kt`、`TurnDiffViewer.kt` — 处理 bridge action 并用公共 Diff API 展示原生左右弹窗。

## 怎么验证的

Go 相关包、TypeScript、真实 Chromium 关联文件与本轮 Diff 交互测试、Gradle 测试与插件配置校验通过；Windows AMD64 local.21 本地包完成 ZIP、版本、架构与 SHA-256 校验；真实 runtime 冒烟验证原生 dialog token 不再返回 401。

## 顺手发现

- `TurnDiffViewer.kt` 承担 turn diff 与 Git diff 两个弹窗入口，后续若继续增加对比类型可拆出更清晰的展示层；本次未扩大范围。
