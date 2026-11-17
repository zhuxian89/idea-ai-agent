# 滚回底部按钮修复

源码完成：`SessionViewer.tsx` 在距底部 120px 内隐藏按钮，底部触摸/聚焦工具活动不再误显示。阅读暂停保留位置，内容追加后按距离显示按钮，滚回底部附近恢复跟随。

验证：旧实现六个浏览器场景均失败。修复后 375px 触屏与 1080px 桌面六个场景通过；相邻活动、消息布局、会话设置与选择器测试 30/30 通过。首轮修复后测试未等待初次布局稳定、并要求恢复跟随后停留精确的 80px，调整夹具等待两帧及近底断言后通过。日志 `build/reports/session-bottom-{before,after,regression}.log`；截图 `output/playwright/session-bottom/`。

打包门禁：kanban 全量与旧库迁移 race 均通过；类型检查、生产构建、插件配置通过，Kotlin 95 通过/4 环境跳过/0 失败。已重打 Mac 插件 0.1.27 与独立后台 0.1.30，305 网页逐字节一致，包内四入口各 87 项资源 HTTP 200、字节匹配，包内浏览器入口及资源失败提示通过。报告 `build/reports/mac-30-27-verification.json`。

按用户要求沿用 0.1.30，[GitHub Release](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.30) 中归档、单文件安装器及对应校验四项资产已替换。首次匿名下载遇 GitHub TLS 连接失败，复跑六项资产均 HTTP 200，字节与本地及 GitHub 摘要一致；真实插件包确认从 0.1.29 发现并提示更新至 0.1.30。报告 `build/reports/standalone30-public-verification.json`。用户自行安装与验收，真实服务未重启；已装首次构建 0.1.30 时需手动同版重装。
