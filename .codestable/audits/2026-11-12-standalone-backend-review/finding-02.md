---
doc_type: audit-finding
audit: 2026-11-12-standalone-backend-review
finding_id: "bug-02"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: resolved
resolved: 2026-11-12
---

# Finding 02：已有别名路径项目再次打开真实路径会重复登记

已修复：共用目录身份查找并复用原 RootInfo，Registry 写锁内去重；旧 alias 的项目内/home 历史保留及并发登记回归通过，见 [修复记录](../../issues/2026-11-12-standalone-review-fixes/standalone-review-fixes-fix-note.md)。以下为修复前证据。

## 速答

打开项目只规范化新输入，没有按真实目录复用旧注册记录；旧库保存符号链接路径时，同一物理目录会产生两个项目 ID。

## 关键证据

- `runtime/server/app/standalone.go:51`：`path, err = filepath.EvalSymlinks(path)`，将新输入转换为真实路径。
- `runtime/server/app/standalone.go:81`：直接执行 `c.services.UpsertRootWithMetaLocation(path, location)`，未先查找真实路径相同的旧项目。
- `runtime/server/internal/fs/registry.go:140-155`：按 `filepath.Base(root)` 选择 ID，已有路径比较不解析符号链接；旧 alias 和实际目录名称不同时直接新增另一条记录。
- `runtime/server/app/standalone_migration.go:77-85`：迁移已有 `standaloneRootByPath` 可识别别名，但只用于决定是否新增，不会将旧 alias 记录改成真实路径。第 118-128 行的查找结果未用于后续 open-project。
- `runtime/server/internal/api/usecase/fs.go:859-865`：浏览器添加目录也只解析新输入，面临相同的旧记录问题。
- 实际启动临时 Core：旧 `registry.json` 仅含 `alias-project -> real-project` 的 alias 路径，再通过 `/control/open-project` 打开 real-project。返回 ID `real-project`，注册表条数从 1 变 2。证据为 `build/reports/standalone-review-alias.json`。

## 影响

旧注册表保存了符号链接目录时，IDEA 再次打开该目录或浏览器按真实路径添加，会违背“同一目录只注册一次”的升级约定。项目元数据位于 `.mindfs` 时两个项目身份指向相同历史；home 元数据按 ID 分目录时会出现不同历史入口。已复现重复登记，尚未观察到历史文件损坏。

现有 `TestStandaloneReaddingProjectThroughAliasKeepsOneProject` 从空注册表先登记真实路径再打开别名，不覆盖已有 alias 记录的升级方向。

## 修复方向

在登记前按实际目录查找并复用旧 RootInfo，保留原 ID 和元数据位置；补充“旧 alias 注册记录 → 再次打开真实目录”的升级回归。

## 建议动作

`cs-issue`：这是旧项目身份与数据入口的兼容问题，需要验证旧记录保留和重复打开行为。
