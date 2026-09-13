---
doc_type: issue-fix
issue: 2026-09-14-session-activity-switch
fix_date: 2026-09-14
tags: [session, activity, lifecycle]
---

# 切换会话后活动栏更新时间丢失

## 问题与根因

正在运行的会话收到思考或工具事件后，切到其他会话再切回，“最近更新于”消失；后台缓存事件在重新订阅时又会被算成刚刚收到。此前只覆盖时间单位边界，遗漏真实 hook 的订阅生命周期。

`useSessionStream` 在会话或 pending 变化时把局部时间清零，并在每次 onStream 回调中使用 Date.now，无法区分即时接收与缓存重放。局部状态在切换后的首帧还可能短暂属于上一个会话。尚无事件时，静默时长又以组件打开时间为起点，重新挂载会重置等待提示。

## 修复

- SessionService 在分发全局事件前，按会话记录接收时间和恢复提示；未打开的会话同样记录。
- hook 在渲染时读取当前会话快照，订阅只负责触发重渲染与运行状态；运行状态也带会话归属，避免首帧串用。
- 本地缓存重放不改变活动时间。独立保存已见事件游标，清理内容重放游标后再次收到同一轮的旧事件，也不刷新活动时间或恢复提示。
- 新用户消息重置上一轮活动，重复投递的同一时间戳不重置；完成与错误沿用终止清理。恢复后的思考、文本或工具进度清除恢复提示。
- 尚未收到进度时，静默计时从本轮用户消息开始；不凭空显示未知的最近更新时间。

## 本次文件范围

- runtime/web/src/services/session.ts
- runtime/web/src/hooks/useSessionStream.ts
- runtime/web/src/components/SessionActivity.tsx（仅静默时间起点；时分秒格式是此前的本地修复）
- runtime/web/tests/session-activity-lifecycle.test.mjs
- runtime/web/tests/session-activity.test.mjs（补充服务快照依赖的测试替身）
- scripts/smoke-message-delivery.mjs

## 验证结果

- 使用 HEAD 的旧 hook 运行新浏览器场景，切换返回、后台进度/恢复、新一轮三项实际失败，证明回归可检出原问题。日志：build/reports/activity-switch-baseline.log。
- 真实 React hook、活动组件和 SessionService 的七个生命周期场景通过，含首帧归属、pending 变化、缓存与游标重放、后台完成/错误；中英文时间边界、原工具结算与流结束回归一并通过，共 17 个测试计数。日志：build/reports/activity-switch-tests.log。
- TypeScript 类型检查通过；本地 Web 资源构建通过。
- 完整应用的历史按钮切换测试最初揭示首帧状态串用，修正后 `node scripts/smoke-runtime.mjs --delivery-only` 通过：切回保留 1 分钟以上的更新时间；后台工具更新 20 秒后打开仍显示原接收时间；队列清空、任务结束与后台完成后打开保持正常。日志：build/reports/activity-switch-delivery.log。
- 已查看 375px 界面截图，状态、时长、最近更新与静默说明均可见，无横向溢出：build/reports/ide-message-activity.png。

## 边界与发布状态

时间表示当前 WebView 收到进度的时间。没有已知事件时间时不编造“刚刚更新”；本次不新增跨 WebView 重启的运行中活动持久化，也不改变后端协议。未调用真实模型，未替换已安装的 IDEA 插件。按用户要求保留本地修复，尚未发版，真实 IDEA/JCEF 安装后的验收留待用户通知统一出版本。


## 后续发布源码

本次修复已纳入 0.1.13 发布源码。安装包及本轮验证边界见 `docs/releases/v0.1.13.md`；上述“未打包”说明记录的是修复当时的状态。
