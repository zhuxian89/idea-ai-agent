---
doc_type: issue-fix
issue: 2026-09-17-turn-diff-live-sync
path: fast-track
fix_date: 2026-09-17
tags: [turn-diff, session, frontend, live-sync]
---

# 本轮 diff 在实时页面不显示

## 问题与根因

用户在 Windows local.10 使用 Codex 还原 README 后，回复完成但未显示本轮文件卡片。用户进一步确认是否与隐藏的文件列表有关。

代码核查及完整页面复现确认，`App.tsx` 的 `session.done` 只更新 pending 和会话列表元信息，不读取完成后持久化的 `exchange_aux`；实时事件分支也未处理 `turn_diff`。`TurnDiffSummary` 独立渲染于聊天时间线，不属于“关联文件”列表。服务端保存和组件直接载入测试都正常，并不能证明实时页面收到了数据。

## 修复范围

- `runtime/web/src/App.tsx`：实际完成通知后复用既有会话读取与恢复流程；等待此前在途读取结束再获取最终记录；用回合版本及 pending 防止迟到响应覆盖下一轮；不对 replay 完成通知发起循环读取。
- `scripts/smoke-turn-diff.mjs`：实际构建的完整页面测试，HTTP 返回保存数据，WebSocket 传递原生流及宿主完成通知，不直接注入组件 props。
- `scripts/smoke-runtime.mjs`：增加定向验证入口及独立测试运行程序路径，避免验证过程混入交付包架构。
- 本记录与 `docs/validation.md`。

不修改 Agent 适配器、原生工具、权限、Prompt 或协议；保留 local.10／local.11 的公共工作区采集。没有恢复隐藏的关联文件区域，也不扩展修改已有 Claude 并发问题。

## 验证

- 旧前端完整页面先复现 README 文件卡片数量 0。
- 新前端 Codex 命令修改兜底、原生 diff 和 Claude 公共兜底在结束后显示卡片，展开差异及 IDEA 打开文件桥接正常。
- 延迟上一轮历史响应直到下一轮正在生成，旧响应没有删除新回复或清除 pending；下一轮结束后两轮 diff 均存在且不重复。
- 页面重载保留 diff，replay 不产生请求循环，430px 深色侧栏无横向溢出／未捕获页面异常。
- TypeScript、11 项相关前端回归及 Windows 本地 ZIP 构建通过。日志和截图见 `build/reports/turn-diff-live-*`。

## 验收边界

此缺陷在完整页面已确定复现并修复。没有取得用户 Windows 原会话的采集日志，不能据此断言该设备不存在其他采集失败；需用户安装 local.12 后实测。只提供 Windows x64 本地 ZIP，无 commit、push 或外部发布。
