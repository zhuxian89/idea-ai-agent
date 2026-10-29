---
doc_type: audit-finding
audit: 2026-10-29-remote-release
finding_id: arch-drift-03
nature: arch-drift
severity: P1
confidence: high
suggested_action: cs-issue
status: resolved
---

# 对外说明未覆盖可选远程访问

README、PRIVACY、plugin.xml 及 Unreleased 更新记录已补齐，详见 [修复记录](../../issues/2026-10-29-remote-release-review/remote-release-review-fix-note.md)。以下为修复前证据。

## 证据

- `PRIVACY.md:5` 仍写插件没有托管服务，`:15` 声明不向插件供应商服务器发送项目数据；全文没有 Relay、中转流量、配对密钥或远程浏览器缓存说明。
- `README.md:51` 和 `:171` 只解释本地 loopback 与 Agent CLI 网络，没有可选远程连接流程。
- `src/main/resources/META-INF/plugin.xml` 的市场介绍和 0.1.24 更新说明尚未涵盖远程功能。
- 已批准的 `.codestable/features/2026-10-29-remote-access/remote-access-design.md` 明确复用 Relay 云服务、扫码访问凭据及项目启用状态；实现包含远程浏览器持久化密钥与文件/会话缓存。

## 影响

这是正式发布材料与当前实现不一致，不是鉴权漏洞。即使业务负载加密，Relay 仍参与转发；浏览器会保存配对凭据和缓存。发布前应准确区分本地默认行为、用户主动开启的远程行为、加密业务数据和连接元数据，不能笼统保证数据只在原电脑上。

## 修复方向

补齐 README、隐私说明、市场描述及新版本更新记录，说明启停/自动启动、Relay 绑定、扫码授权、浏览器保存数据及退出 IDEA 后离线；不要臆测第三方 Relay 的日志保留政策。建议在 cs-issue 的发布材料修复中处理。
