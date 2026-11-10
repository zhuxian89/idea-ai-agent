---
doc_type: issue-fix
issue: 2026-11-10-relay-test-directory-isolation
path: fast-track
fix_date: 2026-11-10
tags: [relay, tests, windows]
---

# Relay 测试数据目录隔离修复

## 问题与根因

凭据和服务测试将 `IDE_AGENT_DATA_DIR` 清空，再修改 HOME、XDG_CONFIG_HOME。
Windows 的 `os.UserConfigDir()` 使用 APPDATA，因此测试可能读写真实用户目录中的凭据和设备标识。

## 修复

`credentials_atomic_test.go` 的测试 store，以及 `service_test.go` 中 12 处测试初始化，
统一将 `IDE_AGENT_DATA_DIR` 指向各自的 `t.TempDir()`，移除 HOME、XDG_CONFIG_HOME 的替换。
配置目录读取优先使用此变量，测试文件随临时目录一起清理。

## 验证

- 在 macOS 执行 `go test ./server/internal/relay -count=1`：通过。
- 检查 Relay 包测试，所有数据目录初始化均显式指向临时目录。
- `git diff --check`：通过。
