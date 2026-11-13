# MindFS 会话菜单复用核对

2026-11-12。用户询问能否移植同级 `../mindfs` 中截图所示的会话菜单功能。本轮完成源码对比，未修改生产组件或预览。

| 功能 | 当前项目 | 需要的移植 |
| --- | --- | --- |
| 置顶、同步、重命名、删除 | SessionList 已有按钮和回调 | 保留现有实现 |
| 复制会话 ID | 会话数据已有 key/session_key，菜单未接入 | 复用 copyText，加菜单项和复制反馈 |
| 复制会话路径 | 底层已有 ExchangeLogAbsolutePath，缺 HTTP 入口及前端服务方法 | 移植 log-path 路由、GetSessionLogPath 用例和前端调用，返回后台机器的真实路径 |
| 会话接力包 | 缺弹窗和模板服务 | 复用 HandoffPackDialog、handoff 模板逻辑、上述日志路径接口及中英文文案 |
| 给当前会话设置定时任务 | 已有定时任务管理、API 和调度服务；缺固定会话绑定 | 移植 fixed_session_key、保存/运行逻辑及弹窗 session 参数和菜单回调 |

## 核对依据

- 对比双方 `web/src/components/SessionList.tsx`（当前项目对应 `runtime/web/src/`），截图多出的菜单恰为上述四项。
- 来源 `web/src/services/session.ts:getSessionLogPath` 调用 `/api/sessions/{key}/log-path`；来源 `server/internal/api/usecase/session.go:GetSessionLogPath` 读取已存在的会话日志绝对路径与原生 Agent 绑定 ID。当前项目缺这条路由与用例，底层 manager 能力已具备。
- 来源 `HandoffPackDialog.tsx` 提供编辑、复制和填入输入框，以及保存默认模板。接力包是带日志路径、会话 ID、原生 Agent 会话 ID 的交接文本。
- 当前 ActionBar 的 editDraftRequest 会替换输入框文字。移植“填入输入框”需支持 append，保留已有草稿；不改变中间区域布局和样式。来源的路径失败兜底、剪贴板仅 console 报错等行为需要按项目现有错误反馈适配，不能直接整文件覆盖后视为完成。
- `runtime/server/internal/scheduled/tasks.go` 与来源版本差异集中在固定会话绑定。来源已有固定会话保存/重载、旧请求不解除绑定、会话删除时报告失败且不另建会话、固定会话不轮换测试。
- IDEA 和远程的现有中间件未屏蔽 scheduled-agent-tasks 路由。此功能为按时间在指定聊天会话执行提示词，不涉及任务看板。
- 双方根目录 LICENSE 均为 AGPL-3.0。

## 接入边界

保留当前中间聊天区域和两侧设计，只移植缺少的四项及对应服务、接口和回归测试，不覆盖整个 App 或 SessionList。新增接口必须沿用当前鉴权与项目定位；定时任务固定绑定必须配套持久化兼容和运行行为验证。生产迁移尚未开始。
