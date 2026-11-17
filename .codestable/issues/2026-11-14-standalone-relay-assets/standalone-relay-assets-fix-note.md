---
doc_type: issue-fix
issue: 2026-11-14-standalone-relay-assets
status: resolved
severity: P1
summary: 0.1.29 修复独立后台资源错误改写并经用户确认恢复；后续本地源码删除旧机制，内置与独立后台统一提供配套资源。
tags: [standalone, relay, frontend, release]
---

# 独立后台远程页面资源路由修复

插件 0.1.27 配合独立后台 0.1.28，远程页面弹出“版本太老，请重新安装最新版 mindfs”。

## 根因与修复

`HTTPHandler.shouldRewriteRelayedAssets` 对正式版本且带 `X-MindFS-Relayed: 1` 的请求，将 `./assets/` 改为 Relay 根目录 `/mindfs-assets/`。内置项目模式已有 `ProjectLocked` 豁免，独立多项目模式没有豁免。独立后台的构建不应依赖 Relay 部署的 MindFS 构建。

2026-11-14 从运行中的 Core 远程入口与真实 Relay 节点取得的 HTML 均引用 `/mindfs-assets/index-Bnxwp8mQ.js`、`/mindfs-assets/index-Da3ByXOE.css`，两个实际请求都是 404。后台磁盘文件存在，清浏览器缓存不能修正新响应中的地址。

修复对 `Standalone` 同样保留节点相对路径。Vite 生成的 manifest、Apple 图标链接改为相对路径，防止跳到 Relay 根目录。源码入口 `ide-main.tsx` 不变；构建哈希由 Vite 生成。

## 0.1.29 验证

- 新回归先在原实现运行：`0.1.28`、`v0.1.29` 均失败，开发版本通过。修复后检查正式/开发版本的 HTML、Service Worker 与 JS，均保留节点内路径。
- `go test ./server/internal/api ./server/app -count=1` 与两包 `-race` 通过。
- 两项强制 kanban 旧库迁移检查通过。
- 类型检查、生产构建、`remote-entry-build.test.mjs` 浏览器回归通过，校验节点/项目/本地入口及每个 HTML 资源的节点前缀。
- 从 0.1.29 Mac ARM64 包启动隔离 Core，通过模拟节点前缀的 HTTP 代理访问；主 HTML/JS/CSS、manifest、Apple 图标、Agent 图标和表情均 HTTP 200。浏览器显示空项目工作区；Relay 状态接口使用测试夹具，未连接真实 Gateway。初始无 Gateway 的 503 和现有 `/api/relay/tips` 404 保留在日志中，不计入资源成功断言。
- 补跑 `go test -p 2 ./server/... -count=1` 在未改动的 `TestWorkspaceTurnDiffSharedAcrossAgents` 挂起约 3 分钟后人工 SIGQUIT 中止，堆栈位于 `turn_diff_agents_test.go:128`；其余包通过。本轮不宣称 Go 全量通过。
- 六平台压缩包均包含 Antigravity 与修正后的 HTML；6 个压缩包、4 个单文件 Shell 安装器、2 个在线安装脚本对应的 12 个 SHA-256 全部一致。Mac ARM64 二进制实际输出 `0.1.29`，六平台程序架构正确。
- 24 个公开资产均匿名下载 HTTP 200，SHA-256 全部与本地一致。实际前端版本选择函数读取公开 GitHub Releases 后，六个平台均选中 `0.1.29`。

证据：`build/reports/standalone-relay-assets-{go,migration,browser,package,package-final,go-all,race}.log`、`standalone-relay-assets-{packages,http,public,updater}.json`；截图 `output/playwright/standalone-relay-assets-0.1.29.png`。

## 交付状态

源码 `60f2c61` 已推送。独立后台 [0.1.29](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.29) 六平台、24 个资产已发布，标题为 `0.1.29`，非草稿、非预发布；插件仍是 GitHub 的 Latest。GitHub 资产大小与 SHA-256 摘要匹配本地，24 个公开资产匿名下载均 HTTP 200 且 SHA-256 与本地一致。在线版本元数据更新为 0.1.29。Mac ARM64 压缩包 SHA-256：`bfde7574f9aa49671bfdfce7cf36535150cb4c1dbc73840c872dda8dff00d516`。

随后用户明确要求在本机更新并重启，已通过官方安装脚本升级至 0.1.29。用户确认远程页面恢复，插件继续使用 0.1.27。本次本机更新使用脚本，未走插件面板升级流程。

## 后续删除旧机制（2026-11-14，源码与验证完成）

用户确认修复有效后，要求删除旧改写逻辑，并在项目中强调这次 bug。0.1.29 保留的旧机制已从本地源码删除：

- `runtime/server/internal/api/http.go` 删除资源改写分支及六个专用辅助函数，缺少网页文件时统一报告实际缺失。
- `runtime/web/vite.config.ts`、`src/main.tsx` 清理公共资源路径的专用处理；`index.html` 报告“页面资源加载失败”及实际 URL，覆盖节点和项目资源地址。
- 根 `AGENTS.md` 新增长期约束：资源随对应后台安装包发布，禁止改写到 Relay 公共路径，验证实际 HTML、Service Worker 及资源 HTTP 响应。`attention.md` 增加入口，独立后端交接三份文件同步。

内置后台由 `LocalOnly: true` 设置 `ProjectLocked`，原先就跳过资源改写；此次故障发生在当时遗漏豁免的独立模式。本轮删除机制后，各模式均保留自身资源路径，Relay 继续转发 HTTP/WebSocket。

扩大后的回归在原实现确认默认正式模式改写错误及缺文件无提示。删除后验证全部通过：

- `TestFrontendAssetsStayWithBackend` 通过真实临时 HTTP 服务检查 HTML、Service Worker、JS/CSS，覆盖三种后台模式、四种版本、本地/远程共 24 组合；缺文件提示回归通过。
- API/app/remotehost 三包测试与 `go vet` 通过。
- 前端 `remote-entry-build.test.mjs`、`remote-project-hub.test.mjs` 共 6/6 通过，包含生产构建、节点/项目/本地入口及主动阻断主 JS/CSS 后的错误提示和失败 URL。
- `npm run typecheck` 通过。

证据：`build/reports/relay-assets-cleanup-{before,go,vet,browser,typecheck}.log`。

上述清理仅在本地源码完成，未提交、打包、发布或更换运行程序。已发布并经用户确认的 0.1.29 使用独立模式豁免修复。

## 故障版本下架（2026-11-14）

已删除 GitHub `standalone-v0.1.28` Release 及全部 24 个附件，Release API 与 24 个原附件下载地址均返回 HTTP 404。保留源码标签供追溯；0.1.29 与插件 0.1.27 的发布元数据及附件保持原样，线上默认安装版本仍为 0.1.29。删除前元数据与删除后验证结果保存于 `build/reports/standalone-0.1.28-withdrawal.json`。
