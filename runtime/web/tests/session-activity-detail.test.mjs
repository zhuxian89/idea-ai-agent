import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve("vite"))("esbuild");
const bundle = buildSync({
  stdin: { contents: `export { sessionActivityDetail } from "./src/services/sessionActivityDetail";
    export { buildToolActivityView } from "./src/services/toolActivity";`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "activity",
  define: { "process.env.NODE_ENV": '"production"' },
});
const sandbox = {};
vm.runInNewContext(bundle.outputFiles[0].text, sandbox);
const { sessionActivityDetail, buildToolActivityView } = sandbox.activity;
const user = { id: "user", type: "user_text", content: "Task" };
const todo = items => ({ id: "todo", type: "todo", todoUpdate: { items } });
const step = (content, status = "in_progress", activeForm) => ({ content, status, activeForm });
const context = { rootId: "root", sessionKey: "session", locale: "zh-CN", requiresInteraction: false };
const view = call => buildToolActivityView({ callId: "tool", kind: "execute", status: "running", title: "", ...call }, context);
const detail = (timeline, tool = null, locale = "zh-CN") => sessionActivityDetail({ timeline, tool, locale });

test("specific native descriptions and targets beat the plan; generic operations do not", () => {
  const timeline = [user, todo([step("补充回归测试")])];
  for (const call of [
    { meta: { description: "检查数据库兼容性" } },
    { kind: "read", meta: { filePath: "README.md" } },
    { kind: "search", meta: { query: "template_snapshot_json" } },
    { meta: { command: "go test ./..." } },
    { kind: "web_search", meta: { query: "IDEA console API" } },
    { kind: "other", title: "mcp__docs__search" },
  ]) {
    const tool = view(call);
    assert.equal(tool.summaryIsSpecific, true);
    assert.equal(detail(timeline, tool), tool.summary);
  }
  for (const call of [{}, { kind: "read" }, { meta: { command: "echo a && echo b" } }, { kind: "task", meta: { tool: "wait" } }]) {
    const tool = view(call);
    assert.equal(tool.summaryIsSpecific, false);
    assert.equal(detail(timeline, tool), "Agent 当前计划：补充回归测试");
  }
});

test("only explicitly in-progress steps from the latest snapshot are displayed", () => {
  assert.equal(detail([user, todo([step("定位问题", "completed"), step("测试", "pending")])]), "");
  assert.equal(detail([user, todo([step("修复代码", "in_progress", "正在修复代码")])]), "Agent 当前计划：正在修复代码");
  assert.equal(detail([user, todo([step("A"), step("B")])]), "Agent 当前计划：A · B");
  assert.equal(detail([user, todo([step("A")]), todo([])]), "");
  assert.equal(detail([user, todo([step("A")]), todo([step("A", "completed")])]), "");
  assert.equal(detail([user, todo([step("old")]), todo([step("new")])], null, "en-US"), "Agent’s active plan: new");
});

test("no old-turn or unbounded-history plan leaks; no reasoning/prose is interpreted", () => {
  const old = todo([step("old plan")]);
  assert.equal(detail([old]), "");
  assert.equal(detail([user, old, { ...user, id: "next-user" }]), "");
  assert.equal(detail([user, { type: "plan", planUpdate: { content: "Currently deploying" } }]), "");
  assert.equal(detail([user, { type: "thought", content: "Maybe run the tests" }]), "");
  assert.equal(detail([user, { type: "assistant_text", content: "All tests passed" }]), "");
});

test("missing specifics remain generic; neither output nor elapsed time invents a task", () => {
  const tool = view({ meta: { command: "python - <<'PY'\nprint('all tests passed')\nPY" }, content: [{ text: "Deployed successfully" }] });
  assert.equal(detail([user], tool), "运行脚本");
  assert.equal(detail([user]), "");
  assert.equal(detail([user, todo([step("  修复\n  空格  ")])]), "Agent 当前计划：修复 空格");
});
