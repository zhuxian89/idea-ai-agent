---
doc_type: issue-fix
issue: 2026-09-14-native-toolbar
fix_date: 2026-09-14
tags: [idea, toolbar, bootstrap, navigation]
---

# 原生标题栏无响应与双工具栏

## 现象与根因

用户安装 0.1.12 后看到两个 AI Agent 标题栏，上方 IDEA 原生的新会话、历史和设置按钮均无响应。

IDEA 使用 `?ide_token=…&ide_theme=…&ide_chrome=1` 打开 WebView，但 Go 登录中间件在设置 Cookie 后重建跳转地址，只保留 root 和 ide。页面收不到 ide_chrome，因而同时显示内嵌工具栏且不订阅原生指令。这两个现象来自同一原因。

App 的会话/文件导航又会重建 URL，丢掉同样的标记；只修登录跳转，刷新时仍会复发。完整验证还发现新会话按钮清空显示状态但不清理 URL 中的旧 session，刷新会再次选择旧会话。

此前组件测试直接使用带 ide_chrome 的地址，没有经过真实登录跳转；完整冒烟则使用普通浏览器入口，未覆盖 IDEA 原生入口。

## 修复范围

- `runtime/server/app/local_plugin.go`：登录重定向仅额外保留有效的 ide_chrome=1 与 dark/light 主题；凭证和其他参数仍被移除。
- `runtime/web/src/App.tsx`：导航保留原生界面标记；新会话清除 URL 中的旧 session 和 cursor。
- `runtime/server/app/local_plugin_test.go`：覆盖原生明暗主题、浏览器预览、非法值和任意参数过滤。
- `scripts/smoke-native-chrome.mjs`：完整应用经过真实认证跳转，调用原生按钮使用的 JS 指令入口，检查标题栏去重、历史选择、设置往返、新建、刷新和重新连接。
- `scripts/smoke-runtime.mjs`：默认同时验证原生入口和已有浏览器预览入口。

## 验证

- 修复前 Go 回归四个场景失败，确认跳转丢失界面标记：`build/reports/native-chrome-go-baseline.log`。
- 修复前完整浏览器测试在原生模式断言处失败：`build/reports/native-chrome-baseline.log`。
- 修复后 `node scripts/test-runtime.mjs ./server/app -run '^TestIDE' -count=1` 通过：`build/reports/native-chrome-go-tests.log`。
- 桥接队列和原生界面组件共 20 个测试计数通过；NativeAgentCommandTest 六项通过，覆盖实际 Kotlin action 的指令转发和加载队列；TypeScript 检查通过。
- 完整 `node scripts/smoke-runtime.mjs` 通过，含原生入口、浏览器预览、权限/配置、会话切换和活动栏回归：`build/reports/native-chrome-smoke.log`。确认选择历史和新会话后的 URL 刷新、重新登录仍能处理指令。
- 已检查 375px 截图，无重复网页工具栏或横向溢出：`build/reports/ide-native-chrome.png`。

## 验证边界与交付状态

本次真实 HTTP/浏览器测试覆盖认证到完整页面的路径，原生按钮入口通过 Kotlin action 测试与页面 JS 指令入口验证；未在已安装的 IDEA/JCEF 中替换插件后实际点击原生按钮。为避开工作区另一份尚在开发的 Claude 压缩功能，运行时验证沿用独立构建目录并同步本次改动。

修复保留在本地代码，未更新已生成的 0.1.12 安装包、未替换用户已安装插件、未创建新版本或发布。


## 后续发布源码

本次修复已纳入 0.1.13 发布源码。安装包及本轮验证边界见 `docs/releases/v0.1.13.md`；上述“未打包”说明记录的是修复当时的状态。
