import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Run from runtime/web: node --test tests/tool-activity.test.mjs
// Actual card, Markdown, i18n, stream hook and session service; only the remote
// detail response is supplied by this fixture. Native JSON comes from focused
// Go adapter tests; no agent or IDE is started.
const webDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const styles = ["src/index.css", "src/ide.css"].map(file =>
  readFileSync(path.join(webDir, file), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, ""),
).join("\n");
const reportDir = path.resolve(webDir, "../../build/reports/activity-semantic-summaries");
const command = "/bin/zsh -lc '" + "echo 检查项目; ".repeat(35) + "'";

test("compact tool activity preserves details, interaction and the session clock", async (t) => {
  const bundle = await build({
    stdin: { resolveDir: webDir, sourcefile: "tool-activity-fixture.tsx", loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { ToolCallCard } from "./src/components/stream/ToolCallCard";
      import { MarkdownViewer } from "./src/components/MarkdownViewer";
      import { SessionActivity } from "./src/components/SessionActivity";
      import { useSessionStream } from "./src/hooks/useSessionStream";
      import { sessionService } from "./src/services/session";
      import { buildToolActivityView } from "./src/services/toolActivity";
      import { mergeActivityFacts, mergeToolStatus } from "./src/services/activityFacts";
      import { I18nProvider } from "./src/i18n";
      const initial = [{ role: "user", content: "检查项目并运行验证", timestamp: new Date().toISOString() }];
      window.detailRequests = [];
      window.remoteDetails = {};
      window.projectActivity = buildToolActivityView;
      sessionService.getToolCallDetails = async ({ rootId, sessionKey, callId }) => {
        window.detailRequests.push({ rootId, sessionKey, callId });
        return window.remoteDetails[callId] ? { kind: "loaded", toolCall: window.remoteDetails[callId] } : { kind: "missing" };
      };
      window.emitTool = (data, update = false) => {
        // App owns exchanges; the hook reads them and subscribes to service
        // activity. Supply that parent boundary without mounting the whole app.
        window.updateExchanges(data);
        sessionService.handleMessage({
          type: "session.stream", payload: { root_id: "root", session_key: "session",
            event: { type: update ? "tool_call_update" : "tool_call", data } },
        });
      };
      function App() {
        const [pending, setPending] = useState(true);
        const [exchanges, setExchanges] = useState(initial);
        const [standalone, setStandalone] = useState(false);
        const [activityOverride, setActivityOverride] = useState(null);
        const [agentLabel, setAgentLabel] = useState("");
        const [, rerender] = useState(0);
        const state = useSessionStream("session", exchanges, {}, undefined, pending);
        window.updateExchanges = call => setExchanges(previous => {
          const found = previous.some(item => item.toolCall?.callId === call.callId);
          return found ? previous.map(item => item.toolCall?.callId === call.callId
            ? { ...item, toolCall: { ...item.toolCall, ...call,
              meta: { ...item.toolCall.meta, ...call.meta },
              activity: mergeActivityFacts(item.toolCall.activity, call.activity),
              status: mergeToolStatus(item.toolCall.status, call.status),
            } } : item)
            : [...previous, { role: "tool", toolCall: call }];
        });
        window.refreshFixture = () => rerender(value => value + 1);
        window.showStandalone = () => setStandalone(true);
        window.setActivityOverride = setActivityOverride;
        window.setAgentLabel = setAgentLabel;
        window.changeFixtureLocale = locale => {
          window.ideaAgent = { ...window.ideaAgent, locale };
          window.dispatchEvent(new Event("ideaAgentReady"));
        };
        window.finishSession = () => {
          sessionService.handleMessage({ type: "session.done", payload: { root_id: "root", session_key: "session" } });
          setPending(false);
        };
        return <I18nProvider><main className="idea-workbench"><article id="activity-fixture">
          <MarkdownViewer content="我会先查看项目说明，再运行检查确认当前状态。" />
          {agentLabel && <h3>{agentLabel}</h3>}
          <section aria-label="工具活动">
            {standalone && <ToolCallCard callId="no-details" kind="read" title="读取文件" status="complete" />}
            {state.timeline.filter(item => item.type === "tool").map(item => {
              const call = item.toolCall;
              return <div key={item.id} data-fixture-call={call.callId}>
                <ToolCallCard {...call} rootId="root" sessionKey="session" rootPath="/project"
                  defaultExpanded={call.kind === "execute" && call.meta?.source === "userShell"} />
              </div>;
            })}
          </section>
          {!pending && <MarkdownViewer content="检查已完成，项目结构清晰，验证通过。" />}
          {(pending || state.isStreaming) && <SessionActivity timeline={activityOverride?.timeline || state.timeline}
            lastEventAt={state.lastEventAt} recoveryText={activityOverride?.recoveryText ?? state.streamStatusText}
            connected={activityOverride?.connected ?? true} rootId="root" sessionKey="session" rootPath="/project" />}
        </article></main></I18nProvider>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    ` },
    bundle: true, write: false, outdir: "/tmp/tool-activity-fixture", platform: "browser", format: "iife", jsx: "automatic",
    // No math or Mermaid content in this fixture. Keep Markdown itself real.
    external: ["mermaid"], loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const open = async (t, { width = 375, theme = "dark", locale = "zh-CN" } = {}) => {
    const context = await browser.newContext({ viewport: { width, height: 650 }, locale, reducedMotion: "reduce" });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    const start = new Date("2026-09-14T01:00:00Z");
    await page.clock.install({ time: new Date(start.getTime() - 60_000) });
    await page.clock.pauseAt(start);
    await page.setContent('<!doctype html><html data-theme="' + theme + '"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: styles + `
      #activity-fixture { padding: 20px 16px; overflow: auto; min-width: 0; }
      #activity-fixture > section { display: flex; flex-direction: column; gap: 8px; margin: 16px 0; }
    ` });
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith(".css"))) await page.addStyleTag({ content: file.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js")).text });
    await page.locator("[data-session-activity]").waitFor();
    return page;
  };
  const emit = (page, data, update = false) => page.evaluate(({ data, update }) => window.emitTool(data, update), { data, update });
  const row = (page, id) => page.locator(`[data-tool-activity="${id}"]`);
  const header = (page, id) => row(page, id).locator(".tool-activity-header");

  for (const agent of ["codex", "claude"]) {
    await t.test(`${agent} starts collapsed, expands by keyboard and stays open when complete`, async (t) => {
      const page = await open(t);
      const meta = { command, ...(agent === "claude" ? { description: "检查项目配置", toolName: "Bash" } : { rawType: "commandExecution" }) };
      const call = { callId: agent, kind: "execute", title: command, status: "running", meta,
        content: [{ type: "text", text: "verification passed" }] };
      await page.clock.fastForward(10_000);
      await emit(page, call);
      const button = header(page, agent);
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(button).toContainText(agent === "claude" ? "检查项目配置" : "运行脚本");
      await expect(button).toContainText("进行中");
      await expect(row(page, agent).locator("pre")).toHaveCount(0);
      assert.deepEqual(await page.evaluate(() => window.detailRequests), []);
      await page.clock.fastForward(5_000);
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-expanded", "true");
      const detailsId = await button.getAttribute("aria-controls");
      assert.equal(await page.evaluate(id => !!document.getElementById(id), detailsId), true);
      assert.equal(await row(page, agent).locator("pre").first().textContent(), command);
      await expect(row(page, agent)).toContainText("verification passed");
      await expect(page.locator(".session-activity-time")).toHaveText("已等待 15 秒 · 最近更新于 5 秒前");
      await page.clock.fastForward(5_000);
      await emit(page, { ...call, status: "complete" }, true);
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(button).not.toContainText("进行中");
      await page.clock.fastForward(5_000);
      await page.keyboard.press("Space");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await page.evaluate(() => window.refreshFixture());
      await expect(page.locator(".session-activity-time")).toHaveText("已等待 25 秒 · 最近更新于 5 秒前");
      await expect(page.locator("[data-session-activity]")).toBeVisible();
      await page.evaluate(() => window.finishSession());
      await expect(page.locator("[data-session-activity]")).toHaveCount(0);
    });
  }

  await t.test("remote details load only on expansion and retain the original text", async (t) => {
    const page = await open(t);
    const call = { callId: "remote", kind: "read", title: "读取 README.md", status: "complete" };
    await page.evaluate(call => { window.remoteDetails.remote = { ...call, content: [{ type: "text", text: "Original remote file content" }] }; }, call);
    await emit(page, call);
    await expect(header(page, "remote")).toHaveAttribute("aria-expanded", "false");
    assert.deepEqual(await page.evaluate(() => window.detailRequests), []);
    await header(page, "remote").click();
    await expect(row(page, "remote")).toContainText("Original remote file content");
    assert.deepEqual(await page.evaluate(() => window.detailRequests), [{ rootId: "root", sessionKey: "session", callId: "remote" }]);
    await header(page, "remote").click();
    await header(page, "remote").click();
    assert.equal(await page.evaluate(() => window.detailRequests.length), 1);
  });

  await t.test("failure, cancellation, denial and interruption remain readable", async (t) => {
    const page = await open(t);
    for (const [status, label] of [["failed", "失败"], ["cancelled", "已取消"], ["declined", "未批准"], ["interrupted", "已中断"], ["unexpected", "状态未知"]]) {
      await emit(page, { callId: status, kind: "execute", title: command, status, meta: { command } });
      await expect(header(page, status)).toContainText(label);
      await expect(header(page, status)).toHaveAttribute("aria-expanded", "false");
    }
  });

  await t.test("user shell, file changes and child tasks keep the existing branches", async (t) => {
    const page = await open(t);
    const calls = [
      { callId: "shell", kind: "execute", title: "echo user", status: "complete", meta: { command: "echo user", source: "userShell" }, content: [{ type: "text", text: "user output" }] },
      { callId: "edit", kind: "edit", title: "README.md", status: "complete", content: [{ type: "diff", path: "README.md", oldText: "before", newText: "after" }] },
      { callId: "task", kind: "task", title: "检查子任务", status: "running", meta: { rawType: "collabToolCall", tool: "spawn_agent", prompt: "Inspect the module" }, content: [{ type: "text", text: "Task started" }] },
    ];
    for (const call of calls) await emit(page, call);
    await expect(page.locator(".tool-activity-header")).toHaveCount(0);
    await expect(page.locator('[data-fixture-call="shell"]')).toContainText("user output");
    await page.locator('[data-fixture-call="edit"] > div > button').click();
    await expect(page.locator('[data-fixture-call="edit"]')).toContainText("before");
    await expect(page.locator('[data-fixture-call="edit"]')).toContainText("after");
    await page.locator('[data-fixture-call="task"] > div > button').click();
    await expect(page.locator('[data-fixture-call="task"]')).toContainText("Inspect the module");
  });

  await t.test("view projection handles legacy fields, Unicode and English", async (t) => {
    const page = await open(t, { locale: "en-US" });
    const projected = await page.evaluate(() => {
      const context = { rootId: "root", sessionKey: "session", locale: "en-US", requiresInteraction: false };
      return [
        window.projectActivity({ kind: "execute", status: "complete", callId: "command", title: "raw command" }, context),
        window.projectActivity({ kind: "read", status: "complete", callId: "unicode", title: "📄".repeat(110) }, context),
        window.projectActivity({ kind: "other", status: "complete", callId: "mcp", title: "", meta: { rawType: "mcpToolCall" } }, context),
      ];
    });
    assert.equal(projected[0].summary, "Ran a command");
    assert.equal(Array.from(projected[1].summary).length, 100);
    assert.equal(projected[2].operation, "mcp");
    await emit(page, { callId: "english", kind: "execute", title: command, status: "complete", meta: { command }, content: [{ type: "text", text: "done" }] });
    await expect(header(page, "english")).toHaveText("Ran a script");
    await emit(page, { callId: "claude-mcp", kind: "other", title: "mcp__github__get_issue", status: "complete", meta: { input: "{}" } });
    await expect(header(page, "claude-mcp")).toHaveText("github / get_issue");
    await page.evaluate(() => window.showStandalone());
    await expect(header(page, "no-details")).toHaveText("Read file");
    assert.equal(await header(page, "no-details").evaluate(el => el.tagName), "DIV");
    await expect(row(page, "no-details").locator("button")).toHaveCount(0);
  });

  await t.test("native Go adapter JSON preserves outcome, duration and the independent session clocks", async (t) => {
    mkdirSync(reportDir, { recursive: true });
    execFileSync("go", ["test", "-count=1", "-run", "^TestNativeActivityFixtures$", "./server/internal/agent/codex", "./server/internal/agent/claude"], {
      cwd: path.resolve(webDir, ".."), env: { ...process.env, ACTIVITY_FIXTURE_DIR: reportDir }, stdio: "pipe",
    });
    const codex = JSON.parse(readFileSync(path.join(reportDir, "codex.json"), "utf8"));
    const claude = JSON.parse(readFileSync(path.join(reportDir, "claude.json"), "utf8"));
    const page = await open(t);
    await emit(page, codex.start);
    await expect(header(page, "command")).toContainText("进行中");
    await expect(header(page, "command").locator(".tool-activity-duration")).toHaveCount(0);
    await page.clock.fastForward(12_000);
    await emit(page, codex.complete, true);
    await expect(header(page, "command")).toContainText("0 毫秒");
    await header(page, "command").click();
    await expect(row(page, "command")).toContainText("project documentation");
    await page.clock.fastForward(5_000);
    await expect(page.locator(".session-activity-time")).toHaveText("已等待 17 秒 · 最近更新于 5 秒前");
    // No terminal evidence in a replay may erase the completed result/duration.
    await emit(page, codex.start, true);
    await expect(header(page, "command")).toContainText("0 毫秒");
    await expect(header(page, "command")).not.toContainText("进行中");
    await expect(header(page, "command")).toHaveAttribute("aria-expanded", "true");
    await emit(page, claude["bash-start"]);
    await expect(header(page, "bash")).toContainText("检查测试结果");
    await emit(page, claude.bash, true);
    await expect(header(page, "bash")).toContainText("失败");
    await expect(header(page, "bash").locator(".tool-activity-duration")).toHaveCount(0);
    for (const [key, label] of [["declined", "未批准"], ["cancelled", "已取消"], ["interrupted", "已中断"], ["failed", "失败"]]) {
      await emit(page, codex[key]);
      await expect(header(page, codex[key].callId)).toContainText(label);
    }
    await expect(header(page, "failed")).toContainText("1.25 秒");
    await emit(page, { ...codex.complete, callId: "future", activity: { ...codex.complete.activity, schemaVersion: 2 } });
    await expect(header(page, "future")).toHaveText("运行了 cat README.md");
    await emit(page, claude.search);
    await page.evaluate(() => window.finishSession());
    await expect(header(page, "search")).toContainText("状态未知");
    await expect(page.locator("[data-session-activity]")).toHaveCount(0);

    for (const theme of ["light", "dark"]) {
      const visual = await open(t, { theme, width: 320 });
      for (const call of [codex.complete, codex.failed, codex.mcp, claude.bash, claude.read, claude.search]) await emit(visual, call);
      await visual.clock.fastForward(28_000);
      await expect(visual.locator(".session-activity-time")).toHaveText("已等待 28 秒 · 最近更新于 28 秒前");
      assert.equal(await visual.locator("#activity-fixture").evaluate(el => el.scrollWidth > el.clientWidth), false);
      await visual.screenshot({ path: path.join(reportDir, `${theme}-native.png`), fullPage: true });
    }
  });

  await t.test("semantic rows and the bottom label stay aligned through locale, tool and output changes", async (t) => {
    for (const agent of ["codex", "claude"]) {
      const page = await open(t);
      const call = { callId: "semantic", kind: agent === "codex" ? "execute" : "read", status: "running", title: "long original title",
        meta: { command: "cat /project/src/app.ts" }, content: [{ type: "text", text: "original source" }],
        activity: { schemaVersion: 1, agent, origin: "live", source: "agent", operation: agent === "codex" ? "execute" : "read", actions: [{ type: "read", path: "/project/src/app.ts" }] },
      };
      await emit(page, call);
      await expect(header(page, "semantic").locator(".tool-activity-summary")).toHaveText("读取 src/app.ts");
      await expect(page.locator(".session-activity-label")).toHaveText("正在执行工具：读取 src/app.ts");
      await header(page, "semantic").click();
      await expect(row(page, "semantic")).toContainText("original source");
      await page.clock.fastForward(10_000);
      await page.evaluate(() => window.changeFixtureLocale("en-US"));
      await expect(header(page, "semantic").locator(".tool-activity-summary")).toHaveText("Read src/app.ts");
      await expect(header(page, "semantic")).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".session-activity-label")).toHaveText("Running tool: Read src/app.ts");
      await expect(page.locator(".session-activity-time")).toHaveText("Elapsed 10s · Last update 10s ago");
      await emit(page, { ...call, content: [{ type: "text", text: "updated original source" }] }, true);
      await page.clock.fastForward(5_000);
      await expect(page.locator(".session-activity-time")).toHaveText("Elapsed 15s · Last update 5s ago");
      await emit(page, { ...call, status: "complete" }, true);
      await emit(page, { callId: "next", kind: "search", status: "running", meta: { query: "activity", path: "/project/src" } });
      await expect(page.locator(".session-activity-label")).toHaveText("Running tool: Search for activity in src");
      await page.clock.fastForward(5_000);
      await page.evaluate(() => { window.refreshFixture(); window.changeFixtureLocale("zh-CN"); });
      await expect(page.locator(".session-activity-time")).toHaveText("已等待 20 秒 · 最近更新于 5 秒前");
      await expect(page.locator(".session-activity-label")).toHaveText("正在执行工具：在 src 中搜索 activity");
    }
  });

  await t.test("status priority keeps disconnection, questions, sending and recovery ahead of summaries", async (t) => {
    const page = await open(t);
    const user = { id: "user", type: "user_text", timestamp: "2026-09-14T01:00:00Z", content: "test", pendingAck: true };
    const tool = { id: "tool", type: "tool", toolCall: { callId: "tool", kind: "execute", status: "running", meta: { command: "npm test" } } };
    const question = { id: "question", type: "tool", toolCall: { callId: "question", kind: "ask_user", status: "running" } };
    const scenarios = [
      [{ timeline: [user, tool, question], connected: false, recoveryText: "恢复提示" }, "连接已中断，正在重新连接…"],
      [{ timeline: [user, tool, question], connected: true, recoveryText: "恢复提示" }, "等待你的回答"],
      [{ timeline: [user, tool], connected: true, recoveryText: "恢复提示" }, "正在发送，等待确认"],
      [{ timeline: [{ ...user, pendingAck: false }, tool], connected: true, recoveryText: "恢复提示" }, "恢复提示"],
      [{ timeline: [{ ...user, pendingAck: false }, tool], connected: true, recoveryText: "" }, "正在执行工具：运行 npm test"],
    ];
    for (const [scenario, label] of scenarios) {
      await page.evaluate(scenario => window.setActivityOverride(scenario), scenario);
      await expect(page.locator(".session-activity-label")).toHaveText(label);
      await expect(page.locator(".session-activity-time")).toBeVisible();
    }
  });

  await t.test("semantic catalogue uses matching component labels for Codex and Claude", async (t) => {
    mkdirSync(reportDir, { recursive: true });
    for (const agent of ["codex", "claude"]) for (const theme of ["light", "dark"]) {
      const page = await open(t, { theme, width: 375 });
      await page.evaluate(agent => window.setAgentLabel(agent === "codex" ? "Codex" : "Claude Code"), agent);
      const native = operation => ({ schemaVersion: 1, agent, origin: "live", source: "agent", operation });
      const calls = [
        { callId: "read", kind: agent === "codex" ? "execute" : "read", title: "README.md", status: "complete", activity: { ...native(agent === "codex" ? "execute" : "read"), actions: [{ type: "read", path: "/project/README.md" }] } },
        { callId: "list", kind: "list", status: "complete", activity: { ...native("list"), actions: [{ type: "list", path: "/project/src" }] } },
        { callId: "mcp", kind: "other", status: "complete", activity: { ...native("mcp"), tool: { name: "get_issue", server: "github" } } },
        { callId: "script", kind: "execute", status: "failed", meta: { command: "python3 - <<'PY'\nprint('fixture')\nPY" } },
        { callId: "edit", kind: "edit", status: "complete", locations: [{ path: "/project/src/app.ts" }], content: [{ type: "diff", path: "/project/src/app.ts", oldText: "before", newText: "after" }] },
        { callId: "search", kind: "search", status: "running", activity: { ...native("search"), actions: [{ type: "search", query: "activity", path: "/project/src" }] } },
      ];
      for (const call of calls) await emit(page, call);
      await expect(page.locator('[data-fixture-call="edit"] > div > button')).toHaveText("修改 src/app.ts");
      await page.clock.fastForward(28_000);
      await expect(page.locator(".session-activity-time")).toHaveText("已等待 28 秒 · 最近更新于 28 秒前");
      assert.equal(await page.locator("#activity-fixture").evaluate(el => el.scrollWidth > el.clientWidth), false);
      assert.deepEqual(await page.evaluate(() => window.detailRequests), []);
      await page.screenshot({ path: path.join(reportDir, theme + "-" + agent + ".png"), fullPage: true });
    }
  });

  await t.test("light/dark narrow layouts keep summaries quiet, readable and within the sidebar", async (t) => {
    mkdirSync(reportDir, { recursive: true });
    for (const theme of ["dark", "light"]) {
      for (const width of [320, 375, 720]) {
        const page = await open(t, { theme, width });
        for (const call of [
          { callId: "read", kind: "read", title: "读取项目说明 README.md", status: "complete" },
          { callId: "command", kind: "execute", title: command, status: "complete", meta: { command }, content: [{ type: "text", text: "checks passed" }] },
          { callId: "search", kind: "search", title: "搜索组件引用、状态来源与界面中的调用关系 ".repeat(8), status: "complete" },
          { callId: "mcp", kind: "other", title: "读取 GitHub 集成信息", status: "complete", meta: { rawType: "mcpToolCall" } },
          { callId: "running", kind: "execute", title: command, status: "running", meta: { command, description: "检查插件构建结果" }, content: [{ type: "text", text: "checking…" }] },
        ]) await emit(page, call);
        await page.clock.fastForward(12_000);
        await expect(page.locator(".tool-activity-header")).toHaveCount(5);
        await header(page, "read").focus();
        await page.keyboard.press("Tab");
        const geometry = await page.evaluate(() => {
          const container = document.querySelector("#activity-fixture");
          const headers = [...document.querySelectorAll(".tool-activity-header")];
          return {
            overflow: container.scrollWidth > container.clientWidth,
            rows: headers.map(el => ({ height: el.getBoundingClientRect().height, right: el.getBoundingClientRect().right, border: getComputedStyle(el.parentElement).borderWidth })),
            foreground: getComputedStyle(headers[0]).color,
            background: getComputedStyle(document.querySelector(".idea-workbench")).backgroundColor,
            focus: getComputedStyle(document.activeElement).outlineStyle,
          };
        });
        assert.equal(geometry.overflow, false);
        for (const item of geometry.rows) {
          assert.ok(item.height >= 24 && item.right <= width, JSON.stringify(item));
          assert.equal(item.border, "0px");
        }
        const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const values = [luminance(geometry.foreground), luminance(geometry.background)].sort((a, b) => a - b);
        assert.ok((values[1] + 0.05) / (values[0] + 0.05) >= 4.5);
        assert.equal(geometry.focus, "solid");
        await page.screenshot({ path: path.join(reportDir, `${theme}-${width}.png`), fullPage: true });
        if (width === 375) {
          await header(page, "command").click();
          assert.equal(await row(page, "command").locator("pre").first().textContent(), command);
          assert.equal(await page.locator("#activity-fixture").evaluate(el => el.scrollWidth > el.clientWidth), false);
          await page.screenshot({ path: path.join(reportDir, `${theme}-${width}-expanded.png`), fullPage: true });
          await header(page, "command").click();
          await page.evaluate(() => window.finishSession());
          await expect(page.locator("[data-session-activity]")).toHaveCount(0);
          await page.screenshot({ path: path.join(reportDir, `${theme}-${width}-finished.png`), fullPage: true });
        }
      }
    }
  });
});
