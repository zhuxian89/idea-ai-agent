---
doc_type: refactor-scan
refactor: 2026-11-09-app-split
---

# App 现状与清理依据

初始 `App.tsx` 为 15,805 行，`App()` 为 13,949 行，包含 149 个 useState 和 91 个 useEffect。

用户明确插件不需要充值、余额、任务创建及任务看板，允许删除插件未提供的功能。核对实际入口后：

- `services/ideaBridge.ts` 的 `isIDEManagedProject` 固定为 `true`。
- `docs/releases/v0.1.5.md` 已记录取消任务看板、项目列表和本地独立文件/Git 管理面板。
- `server/app/local_plugin.go` 与 `remote_access.go` 阻止创建、导入、重命名或移除项目，以及创建、移除 worktree。
- 远程浏览器仍使用文件、Git、worktree 状态及会话关联文件视图，因此这部分不能按本地隐藏入口统一删除。

清理目标为前端财务与任务看板整条链路、被禁用的项目管理流程及其专用组件、服务、状态、effect、翻译和测试。会话操作、消息缓存和实时事件按职责分文件；接口仍传入较多 App 状态，需按实际耦合程度评估，不能只看文件行数。
