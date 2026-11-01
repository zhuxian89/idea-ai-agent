# Changelog

## 0.1.26 — 2026-11-01 — 统一电脑远程入口

- 远程绑定、登录、充值和下载默认使用自托管服务 `https://relay.20260310.best`；清理旧服务地址和上游独立程序自更新入口，插件继续通过 IDEA 安装升级。
- 重设计远程访问面板：手机扫码、电脑打开或复制连接链接均自动授权，移除配对码显示与输入；链接携带当前会话位置。
- 首次开启只保留一个主操作，未完成的连接可继续；项目开关集中到管理页，暂停选择在后台登记和重启后仍保留。
- 升级插件时自动替换仍驻留的旧远程后台，修复节点首页继续加载旧页面、看不到项目的问题；保留绑定与项目身份，旧 IDEA 窗口不会将后台降级。

- 同一系统用户的多个 IDEA 项目共用一个 Relay 节点，项目分别开放，浏览器配对一次后切换。
- 公共远程目录独立于项目和 IDEA 版本；关闭一个项目不影响其他项目，支持入口崩溃后的身份复用与重新登记。
- 旧项目可显式迁入统一入口，旧会话与任务数据保持原位；旧配对权限不自动扩大。
- 项目缓存和文字草稿隔离，未保存文件/附件切换时提示；项目撤销与全局停用会断开对应远程连接。


## 0.1.25 — 2026-10-29

- Add optional Relay remote access from the plugin toolbar, with shared IDEA/browser/phone sessions and live updates.
- Pair phones automatically from a QR code; preserve pairing and offer manual retry on connection failures.
- Start enabled projects' remote connections when IDEA opens them, without opening the plugin panel.
- Add remote file editing with revision-conflict detection and in-page draft retention.
- Preserve completion-before-next-turn ordering when multiple clients send messages.
- Document remote access, browser storage and Relay data handling in README and the Privacy Notice.

Marketplace availability depends on JetBrains review after upload.
