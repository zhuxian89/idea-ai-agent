---
doc_type: audit-finding
audit: 2026-10-29-remote-release
finding_id: bug-02
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: resolved
---

# 自动配对的网络失败误报为需要配对

已修复并验证，详见 [修复记录](../../issues/2026-10-29-remote-release-review/remote-release-review-fix-note.md)。以下为修复前证据。

## 证据

- `runtime/web/src/services/bootstrap.ts:142` 捕获 `ensureSession` 和后续状态请求的所有错误。
- `runtime/web/src/services/bootstrap.ts:148` 不区分网络失败与密钥无效，统一设置 `{ phase: "needs_pairing", error: "" }`。
- `runtime/web/src/App.tsx:14987` 据此显示输入配对密钥弹层。
- `runtime/web/src/services/bootstrap.ts:78` 在 `needs_pairing` 状态直接返回，后续调用 start 不会使用已保存的正确密钥重新握手。

## 影响与复现

扫码或已配对浏览器再次打开时，bootstrap 状态请求成功，但加密握手或后续状态读取遇到网络抖动、502 等错误，会要求重新输码。正确密钥仍保留，真正错误却被清空，用户难以判断是网络问题。

临时探针复用 `tests/pairing-link.test.mjs` 的真实 bootstrap 编译和 VM 测试入口，仅让握手阶段抛出 `Error("Failed to fetch")`：期望连接失败状态和原始错误，实际为 `needs_pairing`。既有离线测试只覆盖第一次状态请求失败，没有覆盖这个阶段。

## 修复方向

只在缺少/无效凭据时要求配对；其他失败保留密钥、展示具体连接错误并允许手动重试。须同时检查 App 初始化 effect，避免状态切换触发无间隔重试。建议 cs-issue，沿用现有加密协议。
