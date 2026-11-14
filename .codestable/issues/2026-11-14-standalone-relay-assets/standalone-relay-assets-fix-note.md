---
doc_type: issue-fix
issue: 2026-11-14-standalone-relay-assets
status: pending-acceptance
severity: P1
summary: 独立后台远程页面从节点自身加载前端资源，避免请求 Relay 的 MindFS 共享构建。
tags: [standalone, relay, frontend, release]
---

# 独立后台远程页面资源路由修复

插件 0.1.27 配合独立后台 0.1.28，远程页面弹出“版本太老，请重新安装最新版 mindfs”。

## 根因与修复

`HTTPHandler.shouldRewriteRelayedAssets` 对正式版本且带 `X-MindFS-Relayed: 1` 的请求，将 `./assets/` 改为 Relay 根目录 `/mindfs-assets/`。内置项目模式已有 `ProjectLocked` 豁免，独立多项目模式没有豁免。独立后台的构建不应依赖 Relay 部署的 MindFS 构建。

2026-11-14 从运行中的 Core 远程入口与真实 Relay 节点取得的 HTML 均引用 `/mindfs-assets/index-Bnxwp8mQ.js`、`/mindfs-assets/index-Da3ByXOE.css`，两个实际请求都是 404。后台磁盘文件存在，清浏览器缓存不能修正新响应中的地址。

修复对 `Standalone` 同样保留节点相对路径。Vite 生成的 manifest、Apple 图标链接改为相对路径，防止跳到 Relay 根目录。源码入口 `ide-main.tsx` 不变；构建哈希由 Vite 生成。

## 验证

- 新回归先在原实现运行：`0.1.28`、`v0.1.29` 均失败，开发版本通过。修复后检查正式/开发版本的 HTML、Service Worker 与 JS，均保留节点内路径。
- `go test ./server/internal/api ./server/app -count=1` 与两包 `-race` 通过。
- 两项强制 kanban 旧库迁移检查通过。
- 类型检查、生产构建、`remote-entry-build.test.mjs` 浏览器回归通过，校验节点/项目/本地入口及每个 HTML 资源的节点前缀。
- 从 0.1.29 Mac ARM64 包启动隔离 Core，通过模拟节点前缀的 HTTP 代理访问；主 HTML/JS/CSS、manifest、Apple 图标、Agent 图标和表情均 HTTP 200。浏览器显示空项目工作区；Relay 状态接口使用测试夹具，未连接真实 Gateway。初始无 Gateway 的 503 和现有 `/api/relay/tips` 404 保留在日志中，不计入资源成功断言。
- 补跑 `go test -p 2 ./server/... -count=1` 在未改动的 `TestWorkspaceTurnDiffSharedAcrossAgents` 挂起约 3 分钟后人工 SIGQUIT 中止，堆栈位于 `turn_diff_agents_test.go:128`；其余包通过。本轮不宣称 Go 全量通过。
- 六平台压缩包均包含 Antigravity 与修正后的 HTML；6 个压缩包、4 个单文件 Shell 安装器、2 个在线安装脚本对应的 12 个 SHA-256 全部一致。Mac ARM64 二进制实际输出 `0.1.29`，六平台程序架构正确。

证据：`build/reports/standalone-relay-assets-{go,migration,browser,package,go-all,race}.log`、`standalone-relay-assets-packages.json`、`standalone-relay-assets-http.json`；截图 `output/playwright/standalone-relay-assets-0.1.29.png`。

## 交付状态

独立后台 0.1.29 六平台包已生成，待发布；真实后台更新和远程刷新由用户在插件面板操作。插件继续使用 0.1.27。
