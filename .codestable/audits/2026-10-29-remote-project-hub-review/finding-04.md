---
doc_type: audit-finding
audit: 2026-10-29-remote-project-hub-review
finding_id: "maintainability-04"
nature: maintainability
severity: P2
confidence: high
suggested_action: cs-issue
status: fixed
---

# 完整冒烟仍依赖旧设置界面

证据位置：`scripts/smoke-agent-management.mjs:80`（修复后落点）。

旧测试使用 Agent configuration and installation、小写 claude 精确名称、Refresh Agent list、Restart/Configure 及 WS 安装命令；当前界面是 Agent settings、配置引导、probe、更新检查及安装 API。此前完整冒烟因此无法完成。

修复与验证：更新 fixture 与真实界面契约：就绪 Agent 权限切换、未就绪错误详情、probe 失败/恢复、更新检查、安装 API 与检测、历史元数据和草稿保留。安装请求全部拦截，不运行真实安装器。完整冒烟通过。

用户已明确授权直接修复，本轮完成，不留待二次审批。
