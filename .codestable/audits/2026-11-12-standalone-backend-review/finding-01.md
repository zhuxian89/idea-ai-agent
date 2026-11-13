---
doc_type: audit-finding
audit: 2026-11-12-standalone-backend-review
finding_id: "bug-01"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: resolved
resolved: 2026-11-12
---

# Finding 01：插件缓存清理会删除仍被长期 Core 使用的资源

已修复：缓存淘汰保留活进程所用目录，进程退出后按原规则回收。真实 Core 跨两次新缓存更新及退出后的回收回归通过，见 [修复记录](../../issues/2026-11-12-standalone-review-fixes/standalone-review-fixes-fix-note.md)。以下为修复前证据。

## 速答

IDEA 从按版本指纹管理的插件缓存启动长期 Core，但缓存只保留当前版本和一个旧版本；后续更新会删除仍在使用的程序与网页目录，导致 Core 页面和资源加载失败。

## 关键证据

- `src/main/kotlin/dev/ideaagent/LocalRuntime.kt:69-73`：先调用 `materializeRuntime(...)`，再以返回的缓存程序执行 `ensureLocalCore(executable, hostDir)`。新的独立生命周期由此依赖原有缓存淘汰策略。
- `src/main/kotlin/dev/ideaagent/StandaloneBackend.kt:37`：`MINDFS_STATIC_DIR = executable.parent.resolve("web")`，Core 的网页来自这个缓存版本。
- `runtime/server/internal/backend/core.go:48-49`：`client.Status(ctx)` 成功即复用已运行 Core；插件更新不会让它换到当前缓存。第 78 行从所传程序启动长期进程。
- `src/main/kotlin/dev/ideaagent/RuntimeCache.kt:69-76`：`keepPrevious: Int = 1`，随后执行 `others.drop(keepPrevious).forEach { (dir, _) -> deleteTree(dir) }`；没有保留活 Core 所用目录。这个文件本次未改，但调用方新增的长期生命周期使原策略失效。
- 临时探针调用真实 `materializeRuntime`，第一版程序保持运行，再物化另外两个指纹版本。结果：`{"process_alive":true,"active_executable_exists":false,"active_web_exists":false}`。证据为 `build/reports/standalone-review-cache.json`。

## 影响

已安装独立版、Core 由 IDEA 缓存程序启动，且 Core 跨越后续两次不同指纹的插件更新继续运行时触发。macOS/Linux 上运行中的进程可以在文件被删除后继续存活，但网页文件已不可读；因此存活/健康检查不足以保证 UI 能继续使用。探针验证了活进程资源被删除，没有运行真实 Agent 任务。

## 修复方向

为活 Core 保留其程序和静态资源目录，或使用生命周期匹配的稳定 Core 资源位置；单纯增加缓存保留数量只会推迟问题。

## 建议动作

`cs-issue`：修复长期进程与缓存淘汰的生命周期冲突，并覆盖活 Core 跨多版缓存更新的回归。
