---
doc_type: audit-finding
audit: 2026-10-29-remote-project-hub-review
finding_id: "bug-03"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# 测试空配置仍发现本机 CLI

证据位置：`runtime/server/app/remote_host_process_test.go:37`（修复后落点）。

agent.LoadConfig 会合并内置默认配置；agents:[] 不会删除默认 Agent。测试子进程继承 PATH 导致真实 Claude 探测；重复运行实际出现临时目录清理失败，残留 .claude.json 和 .claude/backups。

修复与验证：仅在测试 helper 中把 PATH 指向空临时目录，测试执行文件仍使用绝对路径；不再发现本机 CLI，不更改用户环境。连续 20 次通过，清理正常。

用户已明确授权直接修复，本轮完成，不留待二次审批。
