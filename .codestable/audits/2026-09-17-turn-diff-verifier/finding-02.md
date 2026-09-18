---
doc_type: audit-finding
audit: 2026-09-17-turn-diff-verifier
finding_id: performance-02
nature: performance
severity: P1
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 02：结束快照没有累计内存上限

## 关键证据

- `runtime/server/internal/turndiff/snapshot.go:303`：每个变化文件的 before/after 字节都保存在 `result.changed`，没有累计计数。
- `runtime/server/internal/turndiff/snapshot.go:391`：每次 `readFileAt` 都重新得到完整的 `maxFileBytes` 额度。
- `runtime/server/internal/turndiff/artifact.go:137`：64 MiB 检查发生在 Finish 已收集所有字节、且本文件 blob 已写入之后，无法限制之前的内存占用。

临时仓库中修改 40 个各 1 MiB 的已跟踪二进制文件，Finish 成功返回并持续持有 80 MiB：

```text
TestReviewFinishAggregateBudget:
Finish retained 83886080 bytes > artifact budget 67108864, Partial=false
```

## 影响与前提

批量修改大文件时，内存随变化文件总大小增长，32 MiB snapshot/64 MiB artifact 常量没有形成结束阶段的真实边界。文件数量上限是 20,000，单文件上限是 2 MiB。实际 OOM 门槛取决于机器内存与 I/O，因此风险置信度为 medium；超预算持有内存已经复现。runtime 被 OOM 终止会同时中断 Agent 连接。

## 修复方向

在读取和保留 before/after 字节之前统一扣减预算；超限保留已有安全结果并正确标记 partial，通过 `cs-issue` 加入批量文件边界测试。
