---
doc_type: issue-fix
status: fixed-pending-user-validation
severity: high
tags: [remote-access, pairing, build-entry]
---

# 统一电脑入口配对失败

## 现象与根因

Windows `0.1.25-local.1` 打开 `/n/<node>/p/<project>/` 后显示旧 App 的“端到端配对码”弹框，复制正确的电脑配对密钥仍报 `e2ee_proof_invalid`。

2026-10-29 通过用户提供的公网地址只读验证：Host 的公开状态返回 `remote_host: true`；页面加载的 `index-T9Cn5Ps_.js` 与 local.1 ZIP 内文件 SHA256 完全一致（`ed552661ee1ee3cd953524fde00c19e7bad8a051c925600a923d3f8fcd52828c`），脚本不包含 `RemoteHostShell`。因此不是用户输入错误、安装包版本错误或浏览器缓存导致。

`runtime/web/index.html` 实际入口是 `src/ide-main.tsx`，之前误把 Host 外壳接入未参与插件构建的 `src/main.tsx`。实际页面直接启动项目 App，把电脑密钥用于项目身份的握手，必然校验失败。此前组件测试手工挂载 Host 外壳，未覆盖真实 HTML 入口。

## 修复范围

- `ide-main.tsx`：在 `/n/…` 远程路径挂载 `RemoteHostShell`；本地继续直接渲染 App，保留 ErrorBoundary 和 IDEA 初始化。
- `main.tsx`：撤回本次功能接错入口的修改。
- `tests/remote-entry-build.test.mjs`：通过 Vite 从真实 HTML 构建启动 Chrome；不替换浏览器 E2EE 实现。临时协议服务验证 ECDH/HKDF/HMAC/AES-GCM 握手及请求证明，分别使用电脑和项目密钥。可用 `IDEA_REMOTE_ENTRY_DIST` 对 ZIP 解出的页面运行同一测试。

不修改用户绑定、节点身份、数据库或 Relay 数据；不需要删除原有节点。

## 验证

- 对 local.1 ZIP 解出的原始页面运行新增测试，稳定失败于电脑密钥被用于项目握手的 proof 校验。
- 修复后实际 HTML 构建通过：扫码进入 A、切换 B、电脑手动配对、项目密钥只在内存、旧项目入口、本地 IDEA 入口。
- 打包前 kanban 全量与 `TestTaskStoreSnapshotMigration` race 通过，均使用测试临时数据库。
- 相关前端回归 45/45 通过；TypeScript 检查、Windows 构建、Kotlin 71/71 与插件配置检查通过。
- `0.1.25-local.2-windows-amd64.zip` 已生成，解出 ZIP 的真实页面再次通过相同浏览器测试，全部前端文件与当前 dist 逐字节一致。校验报告：`build/reports/remote-entry-pairing-package.json`。
- SHA256：`0e1c9c6b1e8622abb3233f1a0331e789b7a4d981360ef775d374f4744cd01bc9`。未提交、push 或发布市场。公网 Windows 用户机器上的最终验收待用户安装新版后确认。

升级测试时关闭所有 IDEA 项目并等待约一分钟，让旧共享 Host 的项目租约与空闲期限结束，再启动 IDEA 和刷新浏览器页面。已有绑定与配对密钥保留。
