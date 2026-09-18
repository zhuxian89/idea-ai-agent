---
doc_type: audit-finding
audit: 2026-09-17-turn-diff-verifier
finding_id: bug-04
nature: bug
severity: P2
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 04：新增和删除文件被排除原生对比入口

## 关键证据

- `runtime/server/internal/api/usecase/turn_diff.go:58`：`file.Before.Present && file.After.Present` 才加入 `ComparePaths`。
- `src/main/kotlin/dev/ideaagent/TurnDiffViewer.kt:55`：弹窗实现已有 `factory.createEmpty()` 分支，能够表示不存在的一侧。

临时 Go overlay 测试确认两种文件都已保存可读取的 artifact，但入口为空：

```text
add: artifact exists (before=false after=true) but comparePaths=[]
delete: artifact exists (before=true after=false) but comparePaths=[]
```

## 影响

用户创建/删除文件后只能看聊天卡片，无法点击“在 IDEA 中对比”；重命名被拆为新增/删除时也受到影响。

## 修复方向

按 artifact 是否能表示这次变化决定入口，允许一侧缺失，并为不支持的二进制场景单独提供准确降级；建议 `cs-issue`。
