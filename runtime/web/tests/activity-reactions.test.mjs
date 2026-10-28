import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("quiet workbench follows real activity without silence-based overrides", async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { SessionActivity } from "./src/components/SessionActivity";
      import { sessionService } from "./src/services/session";
      import { I18nProvider } from "./src/i18n";
      window.user = { id: "user", type: "user_text", content: "Task", timestamp: new Date().toISOString() };
      window.emit = (type, payload = {}, key = "A") => sessionService.handleMessage({
        type, payload: { root_id: "root", session_key: key, ...payload }, error: { message: "Agent exited" },
      });
      function App() {
        const [props, setProps] = useState({ timeline: [window.user], connected: true, recoveryText: "",
          lastEventAt: Date.now(), active: true, sessionKey: "A", rootId: "root" });
        window.patch = patch => setProps(old => ({ ...old, ...patch }));
        return <I18nProvider><SessionActivity key={props.sessionKey} {...props} /></I18nProvider>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  async function open(t, locale = "zh-CN") {
    const context = await browser.newContext({ locale, viewport: { width: 420, height: 360 } });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.clock.install({ time: new Date("2026-10-23T01:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-23T01:00:01Z"));
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: readFileSync(new URL("../src/index.css", import.meta.url), "utf8").replace(/^@import.*$/gm, "") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.locator(".session-activity-emoji")).toHaveText("👀");
    return page;
  }
  const emoji = page => page.locator(".session-activity-emoji");
  const label = page => page.locator(".session-activity-label");
  const patch = (page, value) => page.evaluate(value => window.patch(value), value);
  const progress = (page, items) => page.evaluate(items => window.patch({
    timeline: [window.user, ...items], lastEventAt: Date.now(),
  }), items);
  const tool = (kind, agent = "codex") => ({ id: "tool", type: "tool", agent, toolCall: {
    callId: "tool", kind, status: "running", title: "Build and deploy to the web",
  } });

  await t.test("30/90 seconds retain real activity and both independent clocks", async t => {
    const page = await open(t);
    await progress(page, [{ id: "thought", type: "thought", content: "Working" }]);
    await expect(emoji(page)).toHaveText("🤔");
    await page.clock.fastForward(29000);
    await expect(emoji(page)).toHaveText("🤔");
    await page.clock.fastForward(1000);
    await expect(emoji(page)).toHaveText("🤔");
    await page.clock.fastForward(59000);
    await expect(emoji(page)).toHaveText("🤔");
    await page.clock.fastForward(1000);
    await expect(emoji(page)).toHaveText("🤔");
    await expect(page.locator(".session-activity-time")).toHaveText("已等待 1 分钟 30 秒 · 最近更新于 1 分钟 30 秒前");
    await progress(page, [tool("fetch")]);
    await expect(emoji(page)).toHaveText("⚡");
    await expect(page.locator(".session-activity-time")).toHaveText("已等待 1 分钟 30 秒 · 最近更新于 0 秒前");
    await expect(page.locator(".session-activity-note")).toHaveCount(0);
    await patch(page, { lastEventAt: 0 });
    await expect(page.locator(".session-activity-time")).toContainText("尚未收到进展更新");
  });

  await t.test("offline, answering, sending and recovery override stale activity", async t => {
    const page = await open(t);
    await page.clock.fastForward(120000);
    await patch(page, { connected: false });
    await expect(label(page)).toContainText("连接已中断");
    await expect(emoji(page)).toHaveText("🔌");
    await expect(page.locator(".session-activity-note")).toHaveCount(0);
    await patch(page, { connected: true });
    await page.evaluate(item => window.patch({ timeline: [window.user, item] }), tool("ask_user"));
    await expect(label(page)).toContainText("等待你的回答");
    await expect(emoji(page)).toHaveText("💬");
    await expect(page.locator(".session-activity-note")).toHaveCount(0);
    await page.evaluate(() => window.patch({ timeline: [{ ...window.user, pendingAck: true }] }));
    await expect(label(page)).toContainText("正在发送");
    await expect(page.locator(".session-activity-note")).toHaveCount(0);
    await page.evaluate(() => window.patch({ timeline: [window.user], recoveryText: "正在恢复会话" }));
    await expect(label(page)).toContainText("正在恢复会话");
    await expect(page.locator(".session-activity-note")).toHaveCount(0);
    await patch(page, { recoveryText: "" });
    await progress(page, [{ ...tool("ask_user"), toolCall: { ...tool("ask_user").toolCall, status: "complete" } }, tool("read")]);
    await expect(emoji(page)).toHaveText("👨‍💻");
    await expect(label(page)).not.toContainText("等待你的回答");
  });

  await t.test("both agents use structured tool operations, and only running compaction is active", async t => {
    const page = await open(t);
    for (const agent of ["codex", "claude"]) {
      for (const [kind, reaction] of [["read", "👨‍💻"], ["edit", "👨‍💻"], ["execute", "🔥"], ["mcp", "🔥"], ["web_search", "⚡"], ["fetch", "⚡"]]) {
        await progress(page, [tool(kind, agent)]);
        await expect(emoji(page)).toHaveText(reaction);
        await expect(page.locator(".session-activity-tool-summary")).toHaveCount(1);
      }
    }
    await progress(page, [{ id: "compact", type: "compact", compactNotice: { status: "running" } }]);
    await expect(label(page)).toContainText("正在收拾桌面");
    await expect(emoji(page)).toHaveText("✍️");
    await page.clock.fastForward(120000);
    await expect(emoji(page)).toHaveText("✍️");
    await progress(page, [{ id: "compact", type: "compact", compactNotice: { status: "complete" } }]);
    await expect(emoji(page)).toHaveText("👀");
    await expect(label(page)).toContainText("下一步");
    await progress(page, [{ id: "answer", type: "assistant_text", content: "Reply" }]);
    await expect(emoji(page)).toHaveText("✏️");
    await expect(label(page)).toContainText("正在生成");
  });

  for (const type of ["session.done", "session.error", "session.stream"]) {
    await t.test(`${type} briefly shows a terminal state with frozen time, never on history reopen`, async t => {
      const page = await open(t);
      await page.clock.fastForward(35000);
      await page.evaluate(type => {
        window.emit(type, type === "session.stream" ? { event: { type: "error", data: { message: "Failed" } } } : {});
        window.patch({ active: false, lastEventAt: 0 });
      }, type);
      const done = type === "session.done";
      await expect(emoji(page)).toHaveText(done ? "👍" : "😱");
      await expect(label(page)).toContainText(done ? "本轮已结束" : "本轮执行遇到问题");
      await page.clock.fastForward(1000);
      await expect(page.locator(".session-activity-time")).toHaveText("已等待 35 秒 · 最近更新于 0 秒前");
      await page.clock.fastForward(done ? 500 : 1500);
      await expect(page.locator("[data-session-activity]")).toHaveCount(0);
      await patch(page, { sessionKey: "B" });
      await patch(page, { sessionKey: "A" });
      await expect(page.locator("[data-session-activity]")).toHaveCount(0);
    });
  }

  await t.test("errors survive a following done event; new turns and other sessions never inherit them", async t => {
    const page = await open(t);
    await page.evaluate(() => { window.emit("session.error"); window.emit("session.done"); });
    await expect(emoji(page)).toHaveText("😱");
    await page.evaluate(() => {
      window.user = { ...window.user, id: "next", timestamp: new Date().toISOString() };
      window.patch({ timeline: [window.user], lastEventAt: 0 });
      window.emit("session.user_message", { exchange: { timestamp: window.user.timestamp } });
    });
    await expect(emoji(page)).toHaveText("👀");
    await page.evaluate(() => window.emit("session.error", {}, "B"));
    await expect(emoji(page)).toHaveText("👀");
  });

  await t.test("English copy and narrow desktop layout keep real tool details and timers readable", async t => {
    const page = await open(t, "en-US");
    await progress(page, [tool("fetch")]);
    await expect(label(page)).toContainText("Build and deploy to the web");
    await expect(page.locator(".session-activity-time")).toContainText("Elapsed 0s · Last update 0s ago");
    await page.clock.fastForward(90000);
    await expect(label(page)).toContainText("Build and deploy to the web");
    await expect(page.locator(".session-activity-note")).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });

  await t.test("running and completed scripts remain truthful in light and dark narrow sidebars", async t => {
    const page = await open(t);
    const directory = new URL("../../../output/playwright/quiet-workbench/", import.meta.url);
    mkdirSync(directory, { recursive: true });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [320, 420]) {
        await page.setViewportSize({ width, height: 300 });
        await progress(page, [tool("execute")]);
        await page.clock.fastForward(30000);
        await expect(emoji(page)).toHaveText("🔥");
        await page.screenshot({ path: fileURLToPath(new URL(`${theme}-${width}-30s.png`, directory)) });
        await page.clock.fastForward(60000);
        await expect(emoji(page)).toHaveText("🔥");
        await expect(label(page)).toContainText("运行命令");
        await page.screenshot({ path: fileURLToPath(new URL(`${theme}-${width}-90s.png`, directory)) });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await expect(page.locator(".session-activity-tool-summary")).toBeVisible();
        await expect(page.locator(".session-activity-time")).toBeVisible();
        await progress(page, [{ ...tool("execute"), toolCall: { ...tool("execute").toolCall, status: "complete" } }]);
        await page.clock.fastForward(148000);
        await expect(emoji(page)).toHaveText("👀");
        await expect(label(page)).toContainText("等待 Agent 的下一步");
        await expect(page.locator(".session-activity-note")).toHaveCount(0);
        await expect(page.locator(".session-activity-tool-summary")).toHaveCount(0);
        await page.screenshot({ path: fileURLToPath(new URL(`${theme}-${width}-completed-148s.png`, directory)) });
      }
    }
  });

  await t.test("activity stays exactly two rows for long details, timers and focused text", async t => {
    const page = await open(t);
    const description = "检查 template_snapshot_json 旧库迁移兼容性，验证已有记录保留并补充回归测试";
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [320, 420]) {
        await page.setViewportSize({ width, height: 300 });
        await progress(page, [{ ...tool("execute"), toolCall: { ...tool("execute").toolCall, meta: { description } } }]);
        await page.clock.fastForward(3661000);
        const text = page.locator(".session-activity-text");
        await expect(text).toHaveText(description);
        await expect(text).toHaveAttribute("title", description);
        await text.focus();
        assert.deepEqual(await page.locator("[data-session-activity]").evaluate(el => {
          const [status, time] = el.children;
          const text = status.querySelector(".session-activity-text");
          return {
            rows: el.children.length,
            statusSingleLine: status.getBoundingClientRect().height <= 25,
            timeSingleLine: time.getBoundingClientRect().height <= 20,
            textSingleLine: getComputedStyle(text).whiteSpace === "nowrap",
            fullTimerTitle: time.title === time.textContent,
            clocksOutsideLiveRegion: !time.closest("[aria-live]"),
            noOverflow: el.scrollWidth <= el.clientWidth,
          };
        }), { rows: 2, statusSingleLine: true, timeSingleLine: true, textSingleLine: true,
          fullTimerTitle: true, clocksOutsideLiveRegion: true, noOverflow: true });
      }
    }
  });

  await t.test("normalized running states and terminal facts take precedence over stale status", async t => {
    const page = await open(t);
    for (const status of ["pending", "in_progress", "inProgress", " RUNNING "]) {
      await progress(page, [{ ...tool("execute"), toolCall: { ...tool("execute").toolCall, status } }]);
      await page.clock.fastForward(120000);
      await expect(emoji(page)).toHaveText("🔥");
    }
    for (const kind of ["execute", "ask_user"]) {
      for (const outcome of ["completed", "failed", "cancelled", "declined", "interrupted"]) {
        await progress(page, [{ ...tool(kind), toolCall: { ...tool(kind).toolCall,
          activity: { schemaVersion: 1, agent: "codex", origin: "live", source: "agent", operation: kind === "execute" ? "execute" : "other", outcome },
        } }]);
        await expect(emoji(page)).toHaveText("👀");
        await expect(label(page)).toContainText("等待 Agent 的下一步");
        await expect(page.locator(".session-activity-tool-summary")).toHaveCount(0);
      }
    }
  });
});
