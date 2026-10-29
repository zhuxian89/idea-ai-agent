---
doc_type: issue-fix-note
issue: remote-release-review
date: 2026-10-29
status: verified
---

# 修复结果

审计的两个功能问题和发布材料缺口已处理，未修改版本号、打包、提交或上传市场。

## 轮次交接

- `AppContext.BroadcastSessionDone` 保留当前轮 Active，等待已有回放完成，先发送 done，再清理 pending 并释放下一轮准入。
- 入队不再删除上一轮完成记录；真正分配下一轮执行资格时才清理 completed，避免新入队抹掉断线回放终态，也避免旧 done 污染下一轮。
- 新增 `turn_completion_test.go`：真实 WebSocket 写锁模拟慢客户端，覆盖空/已有队列下的新消息准入、完成通知、终态回放、下一轮 FIFO、旧完成记录清理和重复调度拒绝。故障探针已转为正式回归并通过 race。

## 配对与网络失败

- `bootstrap.ts` 仅在密钥无效时要求重新配对；握手/状态读取的其他错误保留密钥，进入 error 并保留具体错误。手动输入密钥后的网络失败采用相同语义。
- `App.tsx` 在 error 状态停止自动初始化，显示 `ConnectionErrorDialog`；点击重试重新启动已有 bootstrap，不添加定时重试。
- 配对单元回归覆盖握手断网、握手后状态请求失败及手动配对失败后的恢复；无效密钥仍被拒绝并清除。
- 新增真实 App 的 Chrome 浏览器回归：错误弹窗不含输码框，失败后不出现重复握手；点击 Retry 后使用保存的扫码密钥进入 ready。已目视检查 375px 浅色错误弹窗，背景不透明且内容/按钮可见。

## 发布材料

README 增加中英文远程操作说明；PRIVACY 说明可选 Relay、连接元数据/请求地址、端到端加密业务负载、可重复使用的扫码凭据、浏览器存储及独立清理方式。plugin.xml 的中英文介绍和待发布更新记录同步，CHANGELOG 新增 Unreleased。未编造 Relay 日志保留政策或宣称市场已发布。

## 验证

- 前端 250/250，通过，无 skipped；包括真实 App 连接错误与重试浏览器测试。
- TypeScript 和 Vite 构建通过；现有依赖注释/大 chunk 提示仍存在，不属于本次缺陷。
- Go `./server/...` 全量通过。
- app/api/relay/fs/kanban 全模块 `-race` 通过；包含旧库迁移，测试使用隔离环境与临时数据库。
- Kotlin 66/66 及 `verifyPluginProjectConfiguration` 通过；`git diff --check` 通过。

Windows/macOS 实机及公网重启自动上线不由以上回归替代。local.4 ZIP 未重建，不含本次修复；正式发布前需生成新包并完成实机确认。
