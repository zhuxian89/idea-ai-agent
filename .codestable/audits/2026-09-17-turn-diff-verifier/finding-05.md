---
doc_type: audit-finding
audit: 2026-09-17-turn-diff-verifier
finding_id: bug-05
nature: bug
severity: P2
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 05：聊天补丁与原生弹窗可能显示不同内容

## 关键证据

- `runtime/server/internal/turndiff/snapshot.go:303`：第一次读取的字节被保留给 artifact。
- `runtime/server/internal/turndiff/snapshot.go:330`：准备生成补丁的临时文件时，再次调用 `mustBaselineFile` 和 `readFileAt`，而非使用刚保存的字节。

临时复现通过 Git smudge 测试夹具，在两次读取之间把 `turn result` 改为 `concurrent later`，模拟用户保存或后台任务更新：

```text
TestReviewPatchUsesSameBytesAsArtifact:
Web patch after=concurrent later; IDEA artifact after="turn result\n"
```

## 影响

同一轮同一文件，聊天左右视图与原生弹窗会给出互相矛盾的结果。第二次读取失败时还会被 `mustBaselineFile` 降成缺失状态，可能生成错误删除补丁。

## 修复方向

补丁和 artifact 共同使用一次确认后的 before/after 字节，建议 `cs-issue` 加入并发保存回归。
