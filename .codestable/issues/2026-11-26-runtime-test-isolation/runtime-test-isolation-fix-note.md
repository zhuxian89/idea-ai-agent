---
doc_type: issue-fix
issue: 2026-11-26-runtime-test-isolation
path: fast-track
fix_date: 2026-11-26
tags: [testing, configuration]
---

# 后端测试配置隔离

## 问题和根因

从已安装后台发起 Go 测试时，测试进程可能继承 `IDE_AGENT_DATA_DIR` 等配置路径。该变量优先于用户目录，仅更换 HOME 无法隔离。配置切换用例曾写入真实的备份清单和 Codex 配置备份。后续在模拟安装目录中也复现了 Web Push 测试把密钥写入继承目录。

## 修复

- `runtime/server/internal/api/test_main_test.go` 在 API 套件启动时建立临时目录并设置隔离默认值。需要特定目录的用例仍可用 `t.Setenv` 自定义。
- `runtime/server/internal/webpush/service_test.go` 为密钥生成用例显式设置临时数据目录，并核对生成文件的位置。
- `AGENTS.md` 记录测试配置路径优先级和隔离要求。

## 验证

给模拟安装目录、远程状态目录和 Agent 配置路径设置继承环境，在 `runtime/` 执行 `go test -race ./server/... -count=1`。31 个有测试的包全部通过。测试前后的目录文件清单与 SHA-256 完全一致。Go 工具链遥测只在模拟 HOME 中关闭，避免将工具链计数文件混入比对。[测试日志](../../../build/reports/runtime-test-isolation/go-race.log)
