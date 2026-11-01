---
doc_type: audit-finding
audit: 2026-10-29-remote-project-hub-review
finding_id: "bug-02"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# 测试复用单请求 Relay stream

证据位置：`runtime/server/app/remote_host_process_test.go:252`（修复后落点）。

测试 http.Transport 默认启用 keep-alive；relay/service.go handleStream 每个 yamux stream 只读取一个请求，返回后关闭。全量测试实际出现 POST /access EOF；Go 对此非幂等请求不自动重试。

修复与验证：测试 transport 禁用 keep-alive，与云网关一请求一 stream 对齐，不增加业务重试。真实进程测试连续 20 次通过。

用户已明确授权直接修复，本轮完成，不留待二次审批。
