# 项目开发约束

## 当前工作交接

独立后台接手前先读
[独立后端计划与进度](.codestable/features/2026-11-11-standalone-backend/README.md)，
再按其中的待验证事项继续。每完成一个步骤、遇到测试失败或结束一轮工作时，同步更新交接入口与 checklist；
验证证据写入 implementation。源码完成、验证通过和安装包生成分别记录，
后续代码有改动时重新标明待验证范围，不沿用旧版本的全通过结论。

提交和推送只在用户明确要求时进行。默认直接在 `main` 分支开发；发包用临时分支（见下节）。

## 测试数据隔离

读写 Agent 或独立后台配置的测试使用自己的临时目录。后端会话可能继承 `IDE_AGENT_DATA_DIR`、`IDE_AGENT_REMOTE_HOST_DIR` 和 `MINDFS_AGENTS_CONFIG`，这些路径优先于用户目录，单独设置临时 HOME 不够。按测试涉及的配置入口覆盖相关变量，用模拟安装目录验证，禁止把用户正在使用的配置作为测试夹具。

## 独立版发包规则

独立后台与插件独立发版，Release 标签为 `standalone-v<版本>`。

**自动化流水线。**
- **独立后台（`.github/workflows/release-standalone.yml`）**：手动触发（可从 `standalone-<版本>` 分支或 `main` 触发；未验证改动或修改了在线安装脚本时先推 `standalone-<版本>` 分支，已存在的版本号含草稿会被拒绝）。从干净检出构建、跑下面“发布前验证”的静态门禁（`scripts/standalone/verify-release-assets.mjs`）、在隔离环境安装最终包，并在 Windows PowerShell 5.1 与 Linux systemd 上验证。`mode` 支持三档：`draft`（默认，只生成草稿预发布）、`prerelease`（快进合并 `main`、公开预发布、云端匿名回读全部附件并在 Windows 5.1 验证公开下载）、`formal`（要求 `targets=all`，跑完 `prerelease` 后自动更新 `scripts/standalone/version.txt`、转正 Release、等 `raw.githubusercontent.com` 连续读到新值后验证无参数默认安装、留存旧版快照至工作流产物并下架旧 `standalone-v*` Release，保留 Git 标签与插件 `Latest`）。`targets` 可只出一个或几个平台（仅限 `draft` / `prerelease`）。
- **IDEA 插件（`.github/workflows/release-plugin.yml`）**：手动触发（从 `main` 或 `plugin-<版本>` 分支触发）。从干净检出运行旧库迁移测试、Gradle 测试与 `scripts/package-plugin.mjs release --online` 构建 5 个插件包（四平台 + 通用包）与 `SHA256SUMS.txt`，跑 `scripts/plugin/verify-plugin-assets.mjs` 静态门禁、在 `macos-latest` 与 `windows-latest` 双端隔离启动内嵌后台逐字节核验 305 个 HTTP 网页资源，并在真实 Windows PowerShell 5.1 对三个 Windows/通用插件包运行 `verify-windows-plugin-installer.ps1`。`mode=draft` 生成安全草稿（若 `v<版本>` 已公开则用 `plugin-draft-v<版本>`，不碰线上 `Latest`）；`mode=formal` 发布新版本或同版本更新 `v<版本>`（同版本替换须勾 `replace_existing=true`，自动归档替换前快照并匿名回读核验 6 个公开附件）。
- **仍需手工确认的范围**：Linux/Windows ARM64 与 macOS Intel 物理真机运行、macOS 真实服务升级与 Windows 真实登录自启、以及同版本替换插件后从磁盘重装并重启 IDEA。手工流程仍然有效，下面各条是两条流水线的依据。

**只保留一个正式版。** 新版本验证通过并成为默认安装版本后，下架所有旧的独立后台 Release（含测试预发布）：
先把旧 Release 的元数据快照（`gh release view --json ...`）存到 `build/reports/`，再 `gh release delete <标签> --yes`，
不加 `--cleanup-tag`，Git 标签保留。插件 Release（`v<版本>`）不动。

- **版本号**：内容有变化就升版本，不复用已公开的版本号。测试版发为预发布，不改 `scripts/standalone/version.txt`；
  用户确认成为正式版后才改 `version.txt`（固定安装命令的默认版本），同时 Release 取消预发布。
- **latest 标记**：独立后台 Release 不占仓库的 latest 标记（`--latest=false`），latest 留给插件 Release，
  `.github/workflows/windows-installer.yml` 依赖 `releases/latest` 取插件包。
- **构建**：从发布提交的干净克隆构建（Go 构建信息 `vcs.modified=false`），不用有未提交改动的工作区。
  前端依赖用 `corepack pnpm install --frozen-lockfile`，不用 `npm ci`（锁文件是 pnpm 的，npm 会装出不同版本导致类型检查失败）。
  设置 `LOCAL_AI_AGENT_VERSION=<版本>`，对六个目标运行 `node scripts/package-standalone.mjs <目标>`，
  目标为 `linux-amd64`、`linux-arm64`、`windows-amd64`、`windows-arm64`、`macos-arm64`、`macos-amd64`；
  第一个目标构建前端，其余加 `--skip-web`。
- **附件**：24 个，均上传到同一个 Release——六个压缩包（macOS、Linux 为 `.tar.gz`，Windows 为 `.zip`）、
  macOS 与 Linux 四个自解压 `.sh`、在线入口 `install.sh` 与 `install.ps1`，每个都带 `.sha256`。
- **发布前验证**（对最终压缩包，不是对源码）：校验文件全部通过；程序架构与平台一致；包内 `install.sh`、`install.ps1`
  与源码逐字节一致，PowerShell 脚本有 UTF-8 BOM；网页 305 个文件且无 `/mindfs-assets/` 引用；
  自解压安装器的内嵌归档与对应压缩包一致；在线入口与 `scripts/install.sh`、`scripts/standalone/download.ps1` 一致。
  在临时 HOME 与临时前缀中端到端：新装、同包升级、故意缺文件的升级失败后自动恢复。**不得碰用户已装的服务。**
- **Windows 真机门槛**：Windows 包必须在真实 Windows PowerShell 5.1 验证后才能发布，macOS、PowerShell 7 与交叉编译不能替代。
  做法：把验证提交推到分支 `standalone-<版本>`（不要直接推 `main`），建草稿 Release
  （`gh release create standalone-v<版本> --draft --prerelease --target <提交> --notes-file ...`，文件列表用 bash 数组，zsh 不会按换行拆分），
  `Windows standalone package` 工作流（`.github/workflows/windows-standalone-package.yml`，需要 `contents: write` 才能读草稿）
  会下载草稿里的 Windows x64 包并运行 `scripts/standalone/verify-windows-standalone-package.ps1`；
  同一推送也会触发 `Windows installer` 工作流。两者都通过后才能继续。真实登录自启仍需实机，按实际结果记录。
- **发布顺序**：分支验证通过 → 快进合并并推送 `main`（此时 `version.txt` 不变）→ 发布草稿（`gh release edit --draft=false`）
  → 匿名重新下载全部附件与构建产物逐字节比较 → 用公开在线入口在临时 HOME 里安装验证 → 需要时再改 `version.txt` 并下架旧版 → 删除临时分支。
- **在线入口缓存**：`raw.githubusercontent.com` 推送后会有约 10 分钟缓存，期间读到的新旧内容会摇摆。
  改 `version.txt` 后要等连续多次读到新值再验证默认安装。
- **发布说明必须写安装方法**：macOS 与 Linux 的 `curl ... | sh` 命令、Windows 的 `irm ... | iex` 命令、默认安装目录、
  升级方式（重复执行同一命令，或在 IDEA 远程面板更新）、Linux 绑定链接与开机自启、手动安装方法，再加本版更新内容。
  标题用“独立后台 <版本>”。
- 修改 Windows 安装脚本或下载脚本后，固定在线入口使用的脚本随 `main` 立即生效，必须先通过上面的 5.1 验证再推送 `main`。

## Windows 安装脚本

插件实际调用 `powershell.exe`（Windows PowerShell 5.1），固定在线入口 `scripts/install.ps1` 通过 `irm | iex`
调用 UTF-8 BOM 的 `scripts/standalone/download.ps1`。插件从自身 JAR 的 `installers/install.ps1` 解出临时脚本执行，
不从独立后台附件加载脚本，所以只替换独立后台不能修复已安装插件的内嵌脚本。

- Windows 包内执行的 PowerShell 脚本统一 UTF-8 BOM，不转 GBK；`.gitattributes` 固定 `.ps1` 为 LF。
  在线入口用 ASCII，读取下载脚本后去掉开头的 BOM。打包检查最终 JAR 或压缩包内脚本与源码逐字节一致且有 BOM。
  根因：无 BOM 的 UTF-8 被 Windows ANSI 936 误读，中文注释吞掉下一行赋值，随后对空对象设属性。
- 每次生成或替换 Windows 可用安装包（含通用插件包），即使没有修改安装器，也必须从最终包提取脚本，在真实 5.1 验证后才能发布。
  缺少环境或测试跳过时不得替换正式附件或记为验证通过。验证真实 GitHub 下载、相对及连续重定向、二进制内容和 SHA-256，
  保留逐跳 HTTPS 校验和“校验成功后才安装”的顺序。请求使用 `WebRequest.CreateHttp([Uri]$current)`。
- 安装进程在加载脚本前统一 UTF-8 输出，与插件读取日志的编码一致。安装失败要展示原始下载或执行错误，
  不能让日志解码异常或清理错误覆盖原因（插件按替换字符解码日志，清理临时目录用 `-ErrorAction SilentlyContinue`）。
- 升级先把新文件复制到安装目录的 `.upgrade` 暂存再逐项换入；失败时清理暂存并重启原后台，原有文件不受影响。
  首次安装用 `-DeferStart`，失败后必须能直接重试（`-install` 注册成功后才写安装记录，延迟启动失败时删除已复制的程序）。
  首次安装与升级分别验证；临时安装桩通过不能记为真实计划任务注册、登录自启或重启接入已通过。
- 属性不存在等错误，先复现实际请求类型、脚本读取编码和完整报错，不要仅凭属性名断定版本或跳转是根因；不用增加等待或重试掩盖错误。
- 最终插件包的 5.1 验证命令：
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/standalone/verify-windows-plugin-installer.ps1 -PluginZip <插件ZIP> -Version <独立后台版本>`。
  同版本替换插件时要告知用户需从磁盘重装并重启 IDEA。

回归入口：`scripts/standalone/` 下的 `download-redirect.test.mjs`、`install.test.mjs`、`install-recovery.test.mjs`、
`package-install.test.mjs`、`verify-windows-plugin-installer.ps1`、`verify-windows-standalone-package.ps1`，
`.github/workflows/windows-installer.yml`、`windows-standalone-package.yml`，以及 `StandaloneInstallerTest.kt`、
`WindowsStandaloneInstallerCommandTest.kt`。故障记录见
[UTF-8 安装修复记录](.codestable/issues/2026-11-16-windows-installer-request/windows-installer-request-fix-note.md)。

## 网页资源必须随对应后台发布

独立后台 0.1.28 曾把自身 JS/CSS 指向 Relay 的 `/mindfs-assets/`，Relay 没有对应文件，远程页面 404 却提示“版本太老”。

- 内置和独立后台的 HTML、JS/CSS、图标、manifest 和 Service Worker 缓存资源必须来自各自配套安装包；经 Relay 访问时保留节点或项目路径。
- 不依赖 Relay 部署相同版本的前端，不得把资源改写到 `/mindfs-assets/` 等 Relay 公共路径，也不加这类 fallback。保留 Relay 的 HTTP/WebSocket 转发；后台发版不要求改动共享 Relay。
- 修改资源路径、构建或打包时，验证正式与开发版本、内置与独立模式、本地与远程入口；检查实际返回的 HTML、Service Worker 引用和资源 HTTP 响应，磁盘文件齐全或构建成功都不能替代。
- 资源加载失败要报告实际失败的资源；只有版本兼容检查有明确证据时才提示版本过旧。

回归入口：`runtime/server/internal/api/http_test.go` 的 `TestFrontendAssetsStayWithBackend`、`runtime/web/tests/remote-entry-build.test.mjs`。
记录见 [远程资源路由故障记录](.codestable/issues/2026-11-14-standalone-relay-assets/standalone-relay-assets-fix-note.md)。

## 数据库升级必须兼容旧库

旧项目 `.mindfs/tasks/task-kanban.db` 的 `tasks` 表缺 `template_snapshot_json`，新版启动报
`no such column`。`CREATE TABLE IF NOT EXISTS` 不会更新已有表结构，新建库测试通过不等于升级兼容。
修复在 `runtime/server/internal/kanban/task_store.go` 的 `TaskStore.migrate()`，不要删除这条迁移。

- 修改持久化表结构、查询字段或读写模型时，必须同时检查已发布版本的旧库升级路径，新库建表与旧库迁移都要覆盖。
- 新增字段提供幂等迁移和适合历史数据的默认值或回填，在依赖它的查询、索引和读写之前执行；重复启动不报错、不覆盖已有值。
- 不得删除用户数据库、删表重建、清空任务或要求重装来规避兼容问题，不得吞掉数据库错误制造启动成功的假象。
- 必须有旧库回归测试：缺列旧库可读写、重复迁移成功、已有字段与任务/阶段/事件保留、新库正常；表结构再变化时继续补对应旧结构用例。
- 迁移测试只用临时数据库，不拿用户真实项目数据库做破坏性验证。
- 任务加载失败报告 `task.load_failed` 并保留诊断，不误报为 `file.write_failed`。

每次版本打包前在 `runtime/` 执行并确认通过：

```sh
go test ./server/internal/kanban -count=1
go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration -count=1
```

回归测试在 `runtime/server/internal/kanban/task_store_migration_test.go`；涉及其他数据库时另跑对应模块的迁移测试。
迁移验证失败或未做，不得宣称版本可交付；交付时说明迁移验证结果。
记录见 [启动数据库报错与活动状态误导修复](.codestable/issues/2026-10-23-task-migration-activity-status/task-migration-activity-status-fix-note.md)。
