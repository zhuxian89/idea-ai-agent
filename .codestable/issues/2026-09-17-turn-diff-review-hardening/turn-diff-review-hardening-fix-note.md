---
doc_type: issue-fix
issue: 2026-09-17-turn-diff-review-hardening
path: fast-track
fix_date: 2026-09-17
tags: [turn-diff, verifier, security, compatibility]
---

# Turn diff 审查问题修复记录

## 1. 问题

审查发现 7 项问题：artifact manifest 篡改后 blob 路径可越界；Finish 阶段无累计内存预算且 Partial 不回写；轮前 dirty 文件恢复到索引版本会漏报；新增/删除文件没有 IDEA 原生对比入口；聊天 diff 与 artifact 使用两次读取可能不一致；左右 diff 解析误判空白行和 `++` 开头代码；2026.3 `CredentialAttributes` 新构造器匹配条件恒不成立。

## 2. 根因与修复

- `turndiff/artifact.go`：blob 文件名只校验长度与八进制 mode，未限制 SHA-256 为十六进制；读取使用 `os.ReadFile`。改为十六进制与大小校验，并用 `os.OpenRoot` 读取 manifest/blob，同时限制 manifest 1 MiB。
- `turndiff/snapshot.go`：候选集合纳入 Capture 时已保存的 dirty/untracked 文件；Finish 对已变更内容设置 64 MiB 累计预算；补丁临时目录复用同一份 before/after 字节；超限和读取失败统一标记 Partial；保存前识别二进制。
- `usecase/turn_diff.go`：允许新增/删除文本文件进入 `ComparePaths`，二进制不提供 IDEA 文本对比假入口。
- `gitDiffModel.ts`：只在文件头阶段剥离 `---`/`+++`，进入 hunk 后按首字符识别添加/删除，空行和 `++...` 内容不再错判。
- `VoiceSettings.kt`：新版四参数签名改为 `(String, String, boolean, boolean)`，2026.3 优先走新构造器，2024.1 回退旧五参数构造器。

未修改 Codex/Claude/ACP 适配器、Agent 工具、提示词、权限参数或原生请求结构。

## 3. 回归

- 新增/更新 Go 用例：篡改 manifest 的路径越界拒绝；轮前 dirty 恢复到索引仍显示；轮内超大文件 Partial=true；新增/删除文件 artifact 与 `ComparePaths`；本地包二进制标记。
- `go test ./server/internal/turndiff ./server/internal/api/usecase -count=1` 通过。
- TypeScript `tsc --noEmit`、`git-diff-viewer.test.mjs`、`turn-diff-model.test.mjs` 和真实 Chromium `turn-diff-workspace.test.mjs` 通过。
- Gradle `test verifyPluginProjectConfiguration buildPlugin --offline` 通过，58 项 Kotlin 测试无失败。
- `verifyPlugin` 对 IC/IU 2024.1、2024.2、2024.3 与 IU 2026.3 EAP 共 7 个目标全部 Compatible，无 deprecated/internal API 提示；日志 `build/reports/turn-diff-verifier-local17.log`。

## 4. 交付

Windows x64 本地包：`build/local-packages/idea-ai-agent-0.1.22-local.17-windows-amd64.zip`。ZIP 完整性通过，仅包含一个 `PE32+ x86-64` runtime，插件版本 `0.1.22-local.17`，最低 IDEA build 241。SHA-256：`b809135cf028551a94e97516ecc970fa027ecf3cc6306ccb011825fd931744b0`。

未 commit、push、创建 Release 或上传 Marketplace。Windows IDEA 原生左右 Diff 弹窗仍需用户实机验收。
