---
doc_type: feature-implementation
feature: remote-access-simplify
date: 2026-10-29
status: implemented-pending-user-validation
tags: [remote-access, ux, automatic-authorization]
---

# 远程访问简化

用户已确认 `docs/design/remote-access-v2/` 效果图，并明确要求不再输入配对码。本次沿用现有 E2EE 协议，没有增加需要用户回到 IDEA 批准的设备配对流程。

## 实现

- `RemoteAccessDialog.tsx`：主界面直接展示二维码、打开浏览器、复制链接；这些入口共用带 fragment 凭据的链接，并只转发当前 `root/session` 定位，不转发 IDEA UI 标记或文件路径。授权数据不放在 query 参数中。
- 首次“开启远程访问”自动打开服务绑定页；已有电脑连接时仅“加入远程访问”。关闭面板不取消待完成的连接，重新打开可继续。旧项目迁移在原有安全转换流程中执行，不把旧项目权限扩大为整机权限。
- 管理页集中列出项目开关和电脑开关。Host 本地控制接口增加项目暂停设置，持久化 `sharing_paused`；项目登记与重启不会覆盖这个选择。只有项目先主动加入，电脑管理才能恢复它。暂停立即关闭代理连接并禁止新访问，公开目录隐藏该项目。
- `RemoteAccessRequired.tsx`：缺少或无效授权只引导用户扫码/打开访问链接；Host 页面和旧项目 App 均移除密钥输入表单，不放松验证。
- `RemoteHostShell` 识别同页 fragment 更新；bootstrap 接收新凭据后重新获取公开身份，再验证连接，避免旧缓存凭据阻止新链接生效。网络失败保留有效授权供重试。
- README、隐私说明与未发布更新记录同步说明：复制链接现在包含可复用的访问权限，应仅供本人使用。

## 验证与 review

- review 修复：同一页面粘贴链接仅改变 fragment 时仍需触发连接；新链接替换过期凭据时不能先用旧凭据请求受保护状态；项目暂停不可被周期登记覆盖。
- Go 服务全量通过，app/remotehost race 通过；新增覆盖旧 JSON 默认行为、重启保持暂停、匿名管理拒绝、现存 WS 关闭、暂停后 HTTP 拒绝以及不允许代替项目 opt-in。
- kanban 全量与 `TestTaskStoreSnapshotMigration` race 通过，均使用临时数据库。
- 新前端测试验证二维码和复制链接一致、当前会话参数保留、无配对码输入、首次服务登录与加入已有电脑、关闭面板后可继续、项目管理、断线恢复、主题/窄窗；对实际 HTML 构建使用真实浏览器加密握手，并对 ZIP 解出的页面复验。
- 前端全量首次发现旧主题测试未 mock 实际入口新增的路由函数；已修复测试桩，主题行为未更改。最终前端全量 263/263、Kotlin 71/71、ZIP 浏览器测试通过，界面机械检查无发现。完整交付校验结果见 `build/reports/remote-access-v2-package.json` 及本会话验证日志。

## 交付边界

Windows 本地测试包 `0.1.25-local.3`。未提交、push 或发布市场。尚未代替用户的 Windows IDEA / 公网 Relay 实机验收。由旧 local 包升级时应关闭所有 IDEA 实例，等待旧共享 Host 的租约/空闲期结束后再启动，原有电脑绑定保留。
