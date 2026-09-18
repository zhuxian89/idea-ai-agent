---
doc_type: issue-fix
issue: 2026-09-17-turn-diff-windows-capture
path: fast-track
fix_date: 2026-09-17
tags: [turn-diff, windows, git, workspace]
---

# Windows 大工作区本轮差异采集失败

## 问题

local.13 已修复回复内文件点击和完成后前端读取，但用户在 Windows IDEA 中让 Codex 追加 `README.md` 后仍没有出现本轮差异卡片。失败链路集中在服务端采集：原实现把项目内所有已跟踪和未忽略文件完整读入内存，两个阶段各只有 3 秒预算；大项目、冷缓存或 Windows 磁盘扫描变慢时采集超时后静默降级。`Z:` 等非常规归属目录还可能被 Git `safe.directory` 检查拒绝。

## 修复

- 快照仍保留回合开始时磁盘状态，但干净已跟踪文件只记录 Git 索引对象；只有回合前已 dirty 或未跟踪文件读取内容。结束时用 Git 索引对象/磁盘内容生成变更文件对比，避免读取整个项目。
- 单阶段预算从 3 秒提高到 10 秒；输出和单文件限制不变。
- 只读 Git 命令为当前观察目录显启用 `safe.directory`，不改用户全局 Git 配置。
- 保持公共会话旁路观察，不修改 Agent 适配器、原生工具、提示词、权限或协议。

## 验证

- `internal/turndiff`、`internal/api/usecase` 回归通过，覆盖已有 dirty/staged、未跟踪、新增、删除、重命名、二进制、CRLF、回合中提交、工作树隔离、原生 diff 合并、Codex 命令修改和 Claude/ACP 公共路径。
- 新增测试确认 Capture 只保存 dirty/untracked 字节，干净跟踪文件使用索引对象。
- 用户已在 Windows IDEA 安装 local.14 并让 Codex 修改 `README.md`；截图确认本轮差异卡片显示 1 个文件、`+53` 统计和可展开 diff。
- `./gradlew test verifyPluginProjectConfiguration buildPlugin -PpluginVersion=0.1.22-local.14 --offline` 通过并交叉构建 Windows amd64。
- ZIP 完整性、无重复条目、单一 Windows AMD64 PE 检查通过，构建日志为 `build/reports/turn-diff-windows-local14-build.log`。

## 交付

`build/local-packages/idea-ai-agent-0.1.22-local.14-windows-amd64.zip`

SHA-256: `a5df643ab760ad318e92388bf8af7c2c6cf5015061cf6705a3aae26af4b17fd6`

未 commit、push、打标签、创建 Release 或上传 Marketplace。
