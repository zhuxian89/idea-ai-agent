---
doc_type: issue-fix
issue: 2026-11-14-agent-selector-interaction
path: standard
status: source_verified
fix_date: 2026-11-14
related: [agent-selector-interaction-analysis.md]
tags: [remote, agent-selector, defaults]
---

# 远程模型选择器修复

点击 Agent 名称即可展开选项；选择 Agent、模型、模式、思考强度或 Fast 后，面板保持打开。点击外部、再次点击入口或按 Escape 关闭。远程复用现有视口定位，菜单保持在手机屏幕内。

新会话及切换 Agent 使用首个模式、high 思考强度和 Fast 关闭；模型不支持 high 时使用其支持的默认强度。已有会话恢复显式设置，同 Agent 切换模型保留模式、兼容的强度与 Fast。默认值同时用于显示和实际发送。

生产修改：`runtime/web/src/components/ActionBar.tsx`、`AgentSelector.tsx`、`runtime/web/src/services/agentDefaults.ts`。更新 `native-defaults.test.mjs`，新增 `agent-selector-interaction.test.mjs`，同步独立后台 README/checklist/implementation。

验证：

- 旧实现运行新增回归失败，确认默认参数未生效。
- 相关 16 项回归全部通过、0 跳过；覆盖 375px 触屏远程、1280px 桌面远程与 420px 插件，连续选择、实际发送参数、已有会话、模型能力变化、草稿和关闭操作。
- 类型检查、生产构建通过；三种入口的深浅色截图已检查。初轮断言与菜单外点击夹具错误已纠正；窄屏菜单越界已修复。
- 日志：`build/reports/agent-selector-regression.log`、`build/reports/agent-selector-build.log`；截图：`output/playwright/agent-selector/`。

源码验证完成，随后按用户要求纳入 Mac ARM64 插件 `0.1.27` 与独立后台 `0.1.30`，加入滚动修复后同版重打。两项旧库必检通过；包内 305 网页文件逐字节一致，隔离包内内置/独立后台的本地与转发资源 HTTP 检查及包内网页浏览器入口回归通过。独立包已公开发布并替换，六附件匿名下载、摘要和真实插件更新发现通过。详见 `build/reports/mac-30-27-verification.json`、`build/reports/standalone30-public-verification.json`。真实远程页面验收随用户更新配套后台进行。
