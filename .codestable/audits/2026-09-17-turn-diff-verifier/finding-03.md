---
doc_type: audit-finding
audit: 2026-09-17-turn-diff-verifier
finding_id: bug-03
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 03：恢复已有 dirty 修改时丢失本轮变化

## 关键证据

- `runtime/server/internal/turndiff/snapshot.go:279`：候选文件依赖结束时 dirty、未跟踪状态和索引 OID 变化，未纳入开始时已捕获的 tracked dirty 文件。
- `runtime/server/internal/turndiff/snapshot.go:283`：此路径还会被标为 covered；`merge.go` 因此可能丢弃对应 native diff。

复现：索引内容为 `old`，开始本轮前磁盘内容为 `preexisting dirty`；Capture 后把文件恢复为 `old`，索引不变。应显示 `-preexisting dirty/+old`，实际为空：

```text
TestReviewDirtyResetToIndex:
turn reset a dirty file but diff = "", changed files = 0
```

## 影响

Agent 撤销用户本轮之前的修改时，文件列表、快照和原生对比入口全部缺失。这会隐藏一类需要用户复核的实际文件改动。

## 修复方向

候选集合包含开始时捕获的 tracked dirty 文件，covered 只能在本轮前后可比较且已核实后设置；建议 `cs-issue`。
