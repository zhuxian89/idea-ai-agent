import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const webDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const styles = ["src/index.css", "src/ide.css"].map(file => readFileSync(path.join(webDir, file), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, "")).join("\n");

async function open(t) {
  const bundle = await build({ entryPoints: [path.join(webDir, "tests/fixtures/running-subagents.tsx")],
    bundle: true, write: false, outdir: "/tmp/running-subagents-fixture", platform: "browser", format: "iife", jsx: "automatic", external: ["mermaid"],
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' } });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "en-US", viewport: { width: 900, height: 760 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  page.setDefaultTimeout(5000);
  await page.route("http://subagents.test/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>' }));
  await page.goto("http://subagents.test");
  await page.addStyleTag({ content: styles + "\n#fixture { height: 100vh; min-width: 0; }" });
  for (const file of bundle.outputFiles.filter(file => file.path.endsWith(".css"))) await page.addStyleTag({ content: file.text });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js")).text });
  return page;
}

test("lists only the subagents that are still running", async (t) => {
  const page = await open(t);
  const list = page.locator(".running-subagents");
  await expect(list).toContainText("Running subagents: 2");
  await expect(list.locator(".running-subagent")).toHaveCount(2);
  await expect(list).toContainText("Search toolu-a");
  await expect(list).toContainText("Review tests");
  await expect(list).not.toContainText("Already done");
});

test("a finished subagent leaves the list and the count follows", async (t) => {
  const page = await open(t);
  await page.evaluate(() => window.finishSubagent("toolu-a"));
  await expect(page.locator(".running-subagents")).toContainText("Running subagents: 1");
  await expect(page.locator(".running-subagent")).toHaveCount(1);
  await page.evaluate(() => window.finishSubagent("toolu-b"));
  await expect(page.locator(".running-subagents")).toHaveCount(0);
});

test("stop sends the task id of that subagent only", async (t) => {
  const page = await open(t);
  await page.getByRole("button", { name: "Stop subagent: Review tests" }).click();
  const sent = await page.evaluate(() => window.stopped);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "session.task.stop");
  assert.deepEqual(sent[0].payload, { root_id: "root", session_key: "parent", task_id: "task-toolu-b" });
  await expect(page.locator(".running-subagent")).toHaveCount(2); // the list changes only when the agent reports it stopped
});

test("an accepted stop resolves without an error", async (t) => {
  const page = await open(t);
  await page.getByRole("button", { name: "Stop subagent: Review tests" }).click();
  await page.evaluate(() => window.reply("session.task.stopped"));
  await expect.poll(() => page.evaluate(() => window.stopResults)).toEqual([{ ok: true }]);
});

test("a refused stop gives the reason the server reported", async (t) => {
  const page = await open(t);
  await page.getByRole("button", { name: "Stop subagent: Review tests" }).click();
  await page.evaluate(() => window.reply("session.error", { code: "session.task_stop_failed", message: "session has no running turn" }));
  await expect.poll(() => page.evaluate(() => window.stopResults)).toEqual([{ ok: false, reason: "session has no running turn" }]);
});

test("a stop that was never answered fails when the connection closes", async (t) => {
  const page = await open(t);
  await page.getByRole("button", { name: "Stop subagent: Review tests" }).click();
  await page.evaluate(() => window.sessionClosed());
  await expect.poll(() => page.evaluate(() => window.stopResults.length)).toBe(1);
  const [result] = await page.evaluate(() => window.stopResults);
  assert.equal(result.ok, false);
  assert.match(result.reason, /连接已断开/);
});

test("the stop request does not wait for a reply before the next click is possible", async (t) => {
  const page = await open(t);
  await page.getByRole("button", { name: "Stop subagent: Review tests" }).click();
  await page.getByRole("button", { name: "Stop subagent: Search toolu-a" }).click();
  const sent = await page.evaluate(() => window.stopped.map(item => item.payload.task_id));
  assert.deepEqual(sent, ["task-toolu-b", "task-toolu-a"]);
});

test("clicking a subagent asks the host to open it", async (t) => {
  const page = await open(t);
  await page.locator(".running-subagent-open", { hasText: "Search toolu-a" }).click();
  const opened = await page.evaluate(() => window.opened.map(item => [item.callId, item.stopRef]));
  assert.deepEqual(opened, [["toolu-a", "task-toolu-a"]]);
});

test("the list is hidden when the turn is not running", async (t) => {
  const page = await open(t);
  await page.evaluate(() => window.setSession({ pending: false }));
  await expect(page.locator(".running-subagents")).toHaveCount(0);
});
