# 重构工具

大文件拆分和前端组件拆解用的工具。**它们只搬代码，不改代码**：语句原文逐字移动，所以每一步都能用机器证明“只是搬家”。
原则：先用工具算出依赖关系，再拆；每一步之后都做等价性比对和整套测试，不凭感觉。

这些工具在 2026-11-24 的可维护性重构中使用（`App.tsx` 6743 → 509 行，`FileTree.tsx` 2149 → 300 行，15 个 Go 大文件按职责拆分），
重构记录见 `.codestable/features/2026-11-11-standalone-backend/README.md`。重构前的基线标签是 `pre-refactor-20261124`。

所有工具的路径都相对仓库根。TypeScript 工具用 `runtime/web/node_modules` 里的 TypeScript，
先在 `runtime/web` 执行 `corepack pnpm install --frozen-lockfile`。

## Go（`go/`，独立的 Go 模块，不属于 `runtime`）

```sh
cd scripts/refactor/go
go build -o ../../../build/refactor-tools/gosplit ./gosplit
go build -o ../../../build/refactor-tools/cmpdecl ./cmpdecl
```

| 工具 | 作用 |
|---|---|
| `gosplit <src.go> <new.go> <选择器>...` | 把同一个包里的声明（连同文档注释）移进新文件，原文不变，import 按使用情况重算。选择器可以是 `Name`、`Type.Method`、`lines:起-止`（首行落在范围内的所有声明）。同一个文件连续拆多次时，**从文件末尾往前拆**，因为每次移动后行号会变。 |
| `cmpdecl <基线根> <现状根> <包目录>...` | 证明包只是被重排：逐个顶层声明比对打印出的源码，再比对非 import 源码行的多重集。任何差异退出码为 1。 |

等价性验证的做法：

```sh
mkdir -p /tmp/base && git archive pre-refactor-20261124 runtime | tar -x -C /tmp/base
pkgs=$(cd runtime && find server -name '*.go' ! -name '*_test.go' -exec dirname {} \; | sort -u)
(cd runtime && ../build/refactor-tools/cmpdecl /tmp/base/runtime . $pkgs)
```

之后仍要跑：`go vet ./...`、`go test ./... -count=1`、`go test -race ./server/internal/kanban -run TestTaskStoreSnapshotMigration`，
并对六个目标平台交叉编译（`GOOS`/`GOARCH` 不同的文件会因拆分漏符号）。

## 前端（`web/`）

| 工具 | 作用 |
|---|---|
| `tsmap.cjs <文件>...` | 列出文件的顶层声明和行范围，用来规划拆分。 |
| `tsmove.cjs <源> <目标> <名字>...` | 把顶层声明搬到同目录的新文件，原文件会 import 回来并重新 export，调用方不用改。 |
| `analyze.cjs <文件> <函数> [--out graph.json]` | 一个组件函数体的语句级依赖图（用 TypeScript 检查器解析），报告向后引用和依赖环。**没有环的函数体可以沿依赖方向任意切。** |
| `appsplit.cjs <plan.json> [--apply]` | 按计划把组件函数体拆成按功能域划分的 hook。不加 `--apply` 只校验：hook 之间无环、不使用留在函数里的语句、哪些副作用的执行顺序变了。校验通过再加 `--apply`，由 `generate.cjs` 写文件并改写原函数。计划格式见文件头注释。 |
| `jsxmap.cjs <文件> <函数> [深度]` | 列出组件返回的 JSX 的结构和大小，用来挑可以抽成组件的子树。 |
| `jsxextract.cjs extract/finalize/cleanup` | 把 JSX 子树原文抽成独立组件。从文件下往上依次 `extract`，最后各跑一次 `finalize`（补 import）和 `cleanup`（去掉不再使用的解构），再做类型检查。 |
| `pruneimports.cjs <文件>...` | 删掉文件里不再使用的 import 成员（项目没开 `noUnusedLocals`，搬代码后不会报错，需要它清理）。 |
| `relocate.cjs <原路径> <新路径>` | 把一个新文件挪到别的目录，并重写它自己的相对 import。只适用于还没有被别处引用的文件。 |
| `deps.cjs trim <文件>...` | 对 `{ aApi, bApi }: Deps` 形式的 hook / 组件：删掉没人读的解构名，再删掉整个没用到的 `xApi` 参数（连同 `Deps` 字段、`import type`，并同步改所有调用处）。 |
| `deps.cjs stats <文件>...` | 每个 `xApi` 参数实际读了几个字段，用来判断依赖是粗是细。 |
| `deps.cjs pick <文件>...` | 把 `Deps` 字段收窄成 `Pick<ReturnType<typeof useX>, "a" \| "b">`。**试过，不建议使用**：每个字段会在 `Pick` 和解构里各写一遍，要手工保持一致，不减少真实依赖。 |
| `render-bench.mjs [--web <目录>]` | 在无头 Chrome 里用 React Profiler 挂载真实的 `<App />`，测一次 App 级状态更新的渲染耗时；对基线树和现状树各跑一次做 A/B（用法见文件头）。 |
| `webcmp.py <基线 src 目录> [现状 src 目录] [-v]` | 前端等价性：比对两个目录下所有 `.ts/.tsx` 的源码行多重集（忽略 import 行和 `export ` 前缀）。纯搬家只会丢失 import 成员名、被改写的函数签名和注释。 |

### 使用流程（拆一个大组件）

1. `analyze.cjs` 看函数体有没有环、有几处向后引用。
2. 写计划：给每条语句指定功能域（hook）。`analyze.cjs --out` 输出的语句编号就是计划里的 `stmts`。
3. `appsplit.cjs plan.json` 校验。**重点看 `EFFECT ORDER` 警告**：`useEffect` 和自定义 hook 的执行顺序搬家后会变，
   状态和回调不受顺序影响，副作用受影响。对每一对共享 ref 或 setter 的副作用，读代码判断顺序是否有关，
   无关的写进 `acceptedEffectSwaps`；有关的把它们放进同一个 hook 并保持原顺序。
4. `appsplit.cjs plan.json --apply`，然后 `corepack pnpm typecheck`。
5. 用 `webcmp.py` 对比基线，`corepack pnpm build`，整套网页测试。
6. 按源码文本匹配的测试（读 `App.tsx` 等文件内容做正则断言）会因代码搬走而失败：把它们改成读新位置，断言内容不要改。

### 把“返回 JSX 的 hook”改成组件

hook 应该返回数据和回调，不该返回 JSX。改法：

1. 该 hook 里是否有 effect 或 `useState`？有的话要看组件会不会被条件渲染：组件重新挂载会丢状态（例如未保存的文件编辑存在 `FileEditStore` 里，必须留在整个应用生命周期都在的 hook 里）。
2. 把 JSX 之外的派生数据留作 hook（例如 `useSessionSidebarModel`），把 JSX 部分改成组件（`SessionSidebar`），派生数据作为一个 `xApi` 参数传进组件。
3. 被别处也要用的纯函数（例如 `slashCommandResultForSession`）提成独立的纯函数文件，不要留在 hook 里。
4. `relocate.cjs` 把新组件文件挪到 `components/workbench/`，在 `App.tsx` 里把 `{xView}` 换成 `<XView ...Api />`，
   然后 `deps.cjs trim` + `pruneimports.cjs`，最后类型检查。

### 已知限制

- `jsxextract` 要求函数里的每个 `xApi` 是 `const xApi = useX(...)` 直接声明的；经由别的 hook 返回值解构得来的不支持。
- 函数体里有 `let`、用到模块级非常量声明、或语句内部有闭包互相引用且是急切求值（`useMemo` 等）时，`appsplit` 会报错，需要先手工调整。
- 工具只保证“语句原文没变”和“依赖方向正确”，**不保证副作用顺序等价**；顺序要按上面第 3 点人工审。
- 重构后必须在真实界面里手点：自动化测试覆盖不到弹窗保存、复制、Git 面板这类交互。

### 踩过的坑

- 在本机已装独立后台之下运行冒烟测试（`scripts/smoke-runtime.mjs`）前，要清掉继承来的环境变量，否则会撞已装服务的数据锁：
  `env -u IDE_AGENT_REMOTE_HOST_DIR -u MINDFS_STATIC_DIR -u IDE_AGENT_DATA_DIR HOME=<临时目录> node scripts/smoke-runtime.mjs`。
- macOS 的 `sed -i` 需要一个空字符串参数（`sed -i '' ...`）；zsh 不会把变量按空格拆成多个参数，批量参数用 `while read` 循环。
- 删除整条语句时要连同它前面的缩进一起删，否则缩进会粘到下一行（`jsxextract cleanup` 已处理）。
- 自动重排长 import 可能把原本单行的 import 拆成多行，导致按正则匹配 import 的测试失败。
