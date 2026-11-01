---
doc_type: audit-finding
audit: 2026-10-29-remote-project-hub-review
finding_id: "bug-01"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# 慢网目录请求重叠与过期响应

证据位置：`runtime/web/src/components/remote/RemoteHostShell.tsx:82`（修复后落点）。

原来 interval、visibilitychange 和项目菜单都直接触发异步 refresh，没有在途限制；refresh 完成后直接 setProjects/setPhase，不核对连接世代。慢响应能叠加，并在用户重新连接成功后以旧目录清除项目授权。

修复与验证：增加单次刷新和世代校验；授权失效增加世代，重连同时关闭旧菜单。浏览器回归挂起旧目录响应，跨越 16 秒轮询及可见事件后确认没有重复请求，再重连并释放旧空目录，业务仍可见。

用户已明确授权直接修复，本轮完成，不留待二次审批。
