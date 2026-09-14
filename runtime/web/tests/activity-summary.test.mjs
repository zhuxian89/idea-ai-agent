import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve("vite"))("esbuild");
const bundle = buildSync({
  stdin: { contents: 'export { buildToolActivityView } from "./src/services/toolActivity";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "activity",
  define: { "process.env.NODE_ENV": '"production"' },
});
const sandbox = { console };
vm.runInNewContext(bundle.outputFiles[0].text, sandbox);
const context = { rootId: "root", sessionKey: "session", rootPath: "/project", locale: "zh-CN", requiresInteraction: false };
const facts = (operation, extra = {}) => ({ schemaVersion: 1, agent: "codex", origin: "live", source: "agent", operation, ...extra });
const project = (call = {}, overrides = {}) => sandbox.activity.buildToolActivityView({ callId: "call", kind: "execute", status: "running", title: "", ...call }, { ...context, ...overrides });

test("native descriptions precede actions and remain untranslated for both agents", () => {
  for (const agent of ["codex", "claude"]) for (const locale of ["zh-CN", "en-US"]) {
    const call = { activity: facts("execute", { agent, displayLabel: { text: "检查 project 配置", source: "tool_argument" }, actions: [{ type: "read", path: "/project/a.ts" }] }), meta: { description: "old", command: "cat a.ts" } };
    assert.equal(project(call, { locale }).summary, "检查 project 配置");
    assert.equal(project(call, { locale }).preview, "cat a.ts");
  }
});

test("semantic catalogue covers native actions, web, changes, tasks and MCP in both languages", () => {
  const cases = [
    [{ activity: facts("execute", { actions: [{ type: "read", path: "/project/README.md" }] }) }, "读取 README.md", "Read README.md"],
    [{ activity: facts("execute", { actions: [{ type: "list", path: "/project/src" }] }) }, "查看目录 src", "List files in src"],
    [{ kind: "search", activity: facts("search", { agent: "claude", actions: [{ type: "search", query: "activity", path: "/project/src" }] }) }, "在 src 中搜索 activity", "Search for activity in src"],
    [{ activity: facts("execute", { actions: [{ type: "read", name: "README.md" }, { type: "read", name: "app.ts" }] }) }, "读取 2 项", "Read 2 items"],
    [{ activity: facts("execute", { actions: [{ type: "read" }, { type: "search", query: "x" }] }) }, "执行 2 项操作", "Perform 2 actions"],
    [{ kind: "web_search", meta: { query: "Codex SDK" } }, "搜索网页：Codex SDK", "Search the web: Codex SDK"],
    [{ kind: "fetch", meta: { input: '{"url":"https://example.com/docs"}' } }, "获取 https://example.com/docs", "Fetch https://example.com/docs"],
    [{ kind: "edit", meta: { filePath: "/project/src/app.ts" } }, "修改 src/app.ts", "Change src/app.ts"],
    [{ kind: "edit", locations: [{ path: "a.ts" }, { path: "b.ts" }, { path: "a.ts" }] }, "修改 2 个文件", "Change 2 files"],
    [{ kind: "task", meta: { tool: "spawn_agent" } }, "启动子任务", "Start subtask"],
    [{ kind: "task", meta: { tool: "wait" } }, "等待子任务", "Wait for subtask"],
    [{ kind: "task", meta: { subject: "检查配置" } }, "执行任务：检查配置", "Run task: 检查配置"],
    [{ kind: "other", activity: facts("mcp", { tool: { displayName: "项目文档", name: "get", server: "docs" } }) }, "项目文档", "项目文档"],
    [{ kind: "other", activity: facts("mcp", { tool: { name: "get_issue", server: "github" } }) }, "github / get_issue", "github / get_issue"],
    [{ kind: "other", title: "mcp__github__get_issue" }, "github / get_issue", "github / get_issue"],
    [{ kind: "mcp", title: "get_issue" }, "get_issue", "get_issue"],
    [{ kind: "other", title: "get_issue", meta: { rawType: "mcpToolCall" } }, "get_issue", "get_issue"],
    [{ kind: "other", title: "mcp_tool", meta: { rawType: "mcpToolCall" } }, "调用集成工具", "Use integration"],
    [{ kind: "other", meta: { rawType: "mcpToolCall" } }, "调用集成工具", "Use integration"],
  ];
  for (const [call, zh, en] of cases) {
    assert.equal(project(call).summary, zh);
    assert.equal(project(call, { locale: "en-US" }).summary, en);
  }
  for (const kind of ["read", "list", "search", "web_search", "fetch", "edit", "task", "other"]) {
    assert.ok(project({ kind }).summary);
    assert.ok(!project({ kind }).summary.includes("toolActivity."));
  }
});

test("old structured fields work without facts and invalid new facts fall back", () => {
  const call = { kind: "read", meta: { filePath: "/project/README.md" }, activity: { schemaVersion: 2 } };
  assert.equal(project(call).summary, "读取 README.md");
  assert.equal(project({ kind: "search", meta: { input: '{"pattern":"name","path":"src"}' } }).summary, "在 src 中搜索 name");
  assert.equal(project({ meta: { input: '{"command":"npm test","description":"测试配置"}' } }).summary, "测试配置");
  for (const input of ["{", [], true, ' '.repeat(32769), { description: { toString: () => "fake" } }]) {
    assert.equal(project({ meta: { input } }).summary, "运行命令");
  }
  const mixed = { meta: { command: "cat README.md && npm test" }, activity: facts("execute", { actions: [] }) };
  assert.equal(project(mixed).summary, "运行脚本");
  assert.equal(project({ ...mixed, activity: facts("execute", { actions: [{ type: "unknown" }] }) }).summary, "运行脚本");
});

test("command previews are bounded text and scripts never imply a business result", () => {
  assert.equal(project({ meta: { command: "npm test" } }).summary, "运行 npm test");
  assert.equal(project({ status: "complete", meta: { command: "npm test" } }).summary, "运行了 npm test");
  assert.equal(project({ meta: { command: "/bin/zsh -lc 'npm test'" } }).preview, "npm test");
  assert.equal(project({ meta: { command: "/bin/zsh -lc 'npm test'" } }).summary, "运行 npm test");
  const scripts = [
    "python3 - <<'PY'\nprint('ok')\nPY", "echo first\necho second", "cat README.md && npm test",
    'pwsh -Command "Get-ChildItem"', "powershell.exe -Command Get-Content a.txt",
    "bash -lc 'sh -c echo'", "python3 -c 'print(1)'", "echo $(touch impossible)", "echo `date`",
  ];
  for (const command of scripts) {
    const call = Object.freeze({ meta: Object.freeze({ command }), status: "failed" });
    const view = project(call);
    assert.equal(view.summary, "运行脚本", command);
    assert.equal(view.state, "failed");
    assert.ok(Array.from(view.preview).length <= 100);
    assert.ok(!view.preview.includes("\n"));
    assert.equal(project({ ...call, status: "complete" }, { locale: "en-US" }).summary, "Ran a script");
  }
  assert.equal(project({ meta: { command: "echo 'unterminated" } }).summary, "运行命令");
  const preview = project({ meta: { command: "echo " + "📄".repeat(150) } }).preview;
  assert.equal(Array.from(preview).length, 100);
  assert.ok(preview.endsWith("…"));
  assert.equal(project({ meta: { command: "\n  npm test\n" } }).preview, "npm test");
});

test("path roots use segment boundaries and support Windows paths without changing identity", () => {
  const read = path => ({ kind: "read", activity: facts("read", { actions: [{ type: "read", path }] }) });
  assert.equal(project(read("/project-extra/a.ts")).summary, "读取 /project-extra/a.ts");
  assert.equal(project(read("/project")).summary, "读取 .");
  assert.equal(project(read("/src/a.ts"), { rootPath: "/" }).summary, "读取 src/a.ts");
  assert.equal(project(read("C:\\src\\a.ts"), { rootPath: "c:\\" }).summary, "读取 src/a.ts");
  assert.equal(project(read("C:\\Repo\\src\\a.ts"), { rootPath: "c:\\repo" }).summary, "读取 src/a.ts");
  assert.equal(project(read("D:\\Repo\\a.ts"), { rootPath: "C:\\Repo" }).summary, "读取 D:/Repo/a.ts");
  const call = read("/project/" + "📄".repeat(140));
  assert.equal(Array.from(project(call).summary).length, 100);
  assert.equal(project(call).key, project({ ...call, status: "complete", title: "changed" }, { locale: "en-US" }).key);
});

test("summary never reads output or details and does not modify native facts", () => {
  const meta = Object.freeze({ filePath: "/project/a.ts", get output() { throw new Error("read large output"); } });
  const content = [{ get text() { throw new Error("read detail body"); } }];
  const action = Object.freeze({ type: "read", path: "/project/a.ts" });
  const activity = Object.freeze(facts("read", { actions: Object.freeze([action]) }));
  assert.equal(project(Object.freeze({ kind: "read", meta, content, activity })).summary, "读取 a.ts");
  assert.equal(action.path, "/project/a.ts");
});
