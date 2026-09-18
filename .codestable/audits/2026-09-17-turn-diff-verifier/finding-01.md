---
doc_type: audit-finding
audit: 2026-09-17-turn-diff-verifier
finding_id: security-01
nature: security
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 01：blob 校验允许路径越界

## 关键证据

- `runtime/server/internal/turndiff/artifact.go:292`：`validBlobID` 只检查 hash 长度为 64 和 mode 是八进制，没有检查 hash 字符。
- `runtime/server/internal/turndiff/artifact.go:215`：验证后直接 `os.ReadFile(filepath.Join(..., metadata.Blob))`，hash/size 在读取之后才验证。

临时测试把 blob 设为 `../../../` 加 55 个 `a` 再加 `-644`；hash 部分恰好 64 字节。manifest 填入临时目录中目标测试文件的正确 SHA-256 和大小后，`LoadArtifact` 成功返回了快照目录以外的内容：

```text
TestReviewManifestRejectsTraversal:
path traversal accepted and outside data returned: "outside snapshot\n"
```

## 影响与前提

需要磁盘 manifest 被篡改/替换，且读取返回内容需通过它声明的 hash/size；不等于未授权远程用户可以直接读取任意文件。HTTP token 校验无法保证磁盘 blob 路径受限，当前实现违反了设计中的快照目录边界。

## 修复方向

严格校验 64 位十六进制 hash，并让实际文件读取受快照根目录约束，包含符号链接边界。通过 `cs-issue` 补充恶意 manifest 回归。
