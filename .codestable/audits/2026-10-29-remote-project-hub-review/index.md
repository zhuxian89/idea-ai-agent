---
doc_type: audit-index
audit: 2026-10-29-remote-project-hub-review
scope: 本次统一电脑远程入口实现及交付回归
created: 2026-10-29
status: fixed
total_findings: 4
---

# 多项目统一入口复核

按用户“有问题直接修复，然后出 Windows 包”授权，复核了 RemoteHost 进程与目录、项目迁移、控制/公共监听、HTTP/WS 原始签名路径、撤销、Kotlin 生命周期、浏览器配对/草稿/刷新和测试夹具。对照已批准 remote-project-hub design；现有 architecture 索引只覆盖 UI，不将未记录模块误判为架构偏离。

发现并修复 1 个产品竞态、3 个测试问题；没有发现新的权限绕过或第二 writer 路径。未扩展 Relay 云协议或重构业务执行。未新增依赖，未作全仓依赖安全审计。

| 条目 | 性质 | 严重度 | 置信度 | 状态 |
| --- | --- | --- | --- | --- |
| [慢网目录请求重叠与过期响应](finding-01.md) | bug | P1 | high | 已修复 |
| [测试复用单请求 Relay stream](finding-02.md) | bug | P1 | high | 已修复 |
| [测试空配置仍发现本机 CLI](finding-03.md) | bug | P1 | high | 已修复 |
| [完整冒烟仍依赖旧设置界面](finding-04.md) | maintainability | P2 | high | 已修复 |

性质分布：bug P1 三条，maintainability P2 一条；security/performance/arch-drift 无新增独立发现。置信度均为 high，因为均有实际失败或可观察的异步调用证据，未列推测项。

验证：慢网/重连浏览器用例通过；真实双项目进程与单 Connector 连续 20 次通过；完整 runtime 冒烟已通过。最终全量、旧库迁移和 ZIP 验证写入 docs/validation.md。生产环境 Windows IDEA 与手机公网访问交由此本地测试包验收，不能用交叉编译替代实机测试。
