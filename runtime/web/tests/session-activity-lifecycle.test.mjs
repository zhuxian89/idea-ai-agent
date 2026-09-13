import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("session activity survives viewer lifecycle with the real hook and service", async (t) => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "activity-lifecycle-fixture.tsx", loader: "tsx", contents: `
      import React, { useLayoutEffect, useState } from "react";
      import { createRoot } from "react-dom/client";
      import { SessionActivity } from "./src/components/SessionActivity";
      import { useSessionStream } from "./src/hooks/useSessionStream";
      import { sessionService } from "./src/services/session";
      import { I18nProvider } from "./src/i18n";
      const initialUser = { role: "user", content: "Task", timestamp: new Date().toISOString() };
      const sessions = Object.fromEntries(["A", "B"].map(key => [key, { pending: true, exchanges: [initialUser] }]));
      window.emitSession = (type, key, payload = {}) => sessionService.handleMessage({
        type, payload: { root_id: "root", session_key: key, ...payload }, error: { message: "Agent exited" },
      });
      window.clearReplayCursor = key => sessionService.clearEventCursor("root", key);
      window.activityFrames = [];
      function Viewer({ sessionKey, pending }) {
        const state = useSessionStream(sessionKey, sessions[sessionKey].exchanges, {}, undefined, pending);
        useLayoutEffect(() => { window.activityFrames.push({ key: sessionKey, lastEventAt: state.lastEventAt }); });
        return <>
          <output data-streaming>{String(state.isStreaming)}</output>
          {(pending || state.isStreaming) && <SessionActivity key={sessionKey} timeline={state.timeline}
            lastEventAt={state.lastEventAt} recoveryText={state.streamStatusText} connected />}
        </>;
      }
      function App() {
        const [view, setView] = useState({ key: "A" });
        window.showSession = (key, pending) => setView({ key, pending });
        window.refreshSession = () => setView(value => ({ ...value }));
        return <I18nProvider>{view.key && <Viewer sessionKey={view.key}
          pending={view.pending ?? sessions[view.key].pending} />}</I18nProvider>;
      }
      sessionService.subscribeEvents(({ type, sessionKey, payload }) => {
        const session = sessions[sessionKey];
        if (!session) return;
        if (type === "session.done" || type === "session.error" || (type === "session.stream" && payload.event.type === "error")) session.pending = false;
        if (type === "session.user_message") {
          session.pending = true;
          if (!session.exchanges.some(ex => ex.timestamp === payload.exchange.timestamp)) {
            session.exchanges = [...session.exchanges, payload.exchange];
          }
        }
        window.refreshSession?.();
      });
      createRoot(document.getElementById("root")).render(<App />);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const open = async (t) => {
    const context = await browser.newContext({ locale: "zh-CN" });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    const start = new Date("2026-09-14T01:00:00Z");
    // install starts a running clock; leave room for the separate pause command
    // before mounting React, even when other browser tests load the machine.
    await page.clock.install({ time: new Date(start.getTime() - 60_000) });
    await page.clock.pauseAt(start);
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator("[data-session-activity]").waitFor();
    return page;
  };
  const show = (page, key, pending) => page.evaluate(({ key, pending }) => window.showSession(key, pending), { key, pending });
  const emit = (page, type, key, payload) => page.evaluate(({ type, key, payload }) => window.emitSession(type, key, payload), { type, key, payload });
  const stream = (page, key, type = "thought_chunk", event_cursor, data = { content: "Working" }) => emit(page, "session.stream", key, { event: { type, data, event_cursor } });
  const timer = page => page.locator(".session-activity-time");

  await t.test("switching away and back retains each session's elapsed and last-update time", async (t) => {
    const page = await open(t);
    await page.clock.fastForward(10000);
    await stream(page, "A", "thought_chunk", "1:1");
    await expect(timer(page)).toHaveText("已等待 10 秒 · 最近更新于 0 秒前");
    await page.clock.fastForward(15000);
    await show(page, "B");
    await expect(timer(page)).toHaveText("已等待 25 秒");
    assert.ok((await page.evaluate(() => window.activityFrames.filter(frame => frame.key === "B")))
      .every(frame => frame.lastEventAt === 0), "even the first render must not borrow the previous session's timestamp");
    await page.clock.fastForward(5000);
    await stream(page, "B");
    await page.clock.fastForward(40000);
    await page.evaluate(() => { window.activityFrames = []; });
    await show(page, "A");
    await expect(timer(page)).toHaveText("已等待 1 分钟 10 秒 · 最近更新于 1 分钟 0 秒前");
    await expect(page.locator(".session-activity-note")).toContainText("1 分钟 0 秒");
    assert.ok((await page.evaluate(() => window.activityFrames.filter(frame => frame.key === "A")))
      .every(frame => frame.lastEventAt === Date.parse("2026-09-14T01:00:10Z")), "returning must restore the timestamp from the first render");
    await show(page, "A", false);
    await show(page, "A", true);
    await expect(timer(page)).toContainText("最近更新于 1 分钟 0 秒前");
    await show(page, "B");
    await expect(timer(page)).toContainText("最近更新于 40 秒前");
  });

  await t.test("background progress and recovery retain arrival times across remount and replay", async (t) => {
    const page = await open(t);
    await show(page, null);
    await expect(timer(page)).toHaveCount(0);
    await page.clock.fastForward(10000);
    await stream(page, "A", "recovery", "1:1", { message: "正在恢复会话" });
    await page.clock.fastForward(30000);
    await show(page, "A");
    await expect(timer(page)).toHaveText("已等待 40 秒 · 最近更新于 30 秒前");
    await expect(page.locator(".session-activity-label")).toHaveText("正在恢复会话");
    await show(page, "B");
    await expect(page.locator(".session-activity-label")).not.toContainText("正在恢复会话");
    await page.clock.fastForward(10000);
    await stream(page, "A", "tool_call", "1:2", { callId: "tool", status: "running", title: "Read file" });
    await page.clock.fastForward(20000);
    await show(page, "A");
    await expect(timer(page)).toContainText("最近更新于 20 秒前");
    await expect(page.locator(".session-activity-label")).not.toContainText("正在恢复会话");
    await page.evaluate(() => window.clearReplayCursor("A"));
    await stream(page, "A", "recovery", "1:1", { message: "正在恢复会话" });
    await stream(page, "A", "tool_call", "1:2", { callId: "tool", status: "running", title: "Read file" });
    await expect(timer(page)).toContainText("最近更新于 20 秒前");
    await expect(page.locator(".session-activity-label")).not.toContainText("正在恢复会话");
    await stream(page, "A", "thought_chunk", "1:3");
    await expect(timer(page)).toContainText("最近更新于 0 秒前");
  });

  await t.test("a new turn clears old activity, while duplicate user delivery preserves current progress", async (t) => {
    const page = await open(t);
    await stream(page, "A", "recovery", "1:1", { message: "正在恢复会话" });
    await page.clock.fastForward(10000);
    const exchange = { role: "user", content: "Next turn", timestamp: "2026-09-14T01:00:10Z" };
    await emit(page, "session.user_message", "A", { exchange });
    await expect(timer(page)).toHaveText("已等待 0 秒");
    await expect(page.locator(".session-activity-label")).not.toContainText("正在恢复会话");
    await page.clock.fastForward(5000);
    await stream(page, "A", "thought_chunk", "3:1");
    await page.clock.fastForward(15000);
    await emit(page, "session.user_message", "A", { exchange });
    await expect(timer(page)).toHaveText("已等待 20 秒 · 最近更新于 15 秒前");
    await show(page, null);
    await show(page, "A");
    await expect(timer(page)).toHaveText("已等待 20 秒 · 最近更新于 15 秒前");
  });

  await t.test("waiting without any received event does not restart its silence timer on remount", async (t) => {
    const page = await open(t);
    await show(page, "B");
    await page.clock.fastForward(65000);
    await show(page, "A");
    await expect(timer(page)).toHaveText("已等待 1 分钟 5 秒");
    await expect(page.locator(".session-activity-note")).toContainText("1 分钟 5 秒");
  });

  for (const terminal of ["session.done", "session.error", "stream.error"]) {
    await t.test(`${terminal} in the background keeps the activity bar hidden on return`, async (t) => {
      const page = await open(t);
      await show(page, "B");
      await stream(page, "A", "recovery", "1:1", { message: "正在恢复会话" });
      if (terminal === "stream.error") await stream(page, "A", "error", "1:2", { message: "Agent exited" });
      else await emit(page, terminal, "A", {});
      await show(page, "A");
      await expect(timer(page)).toHaveCount(0);
      await expect(page.locator("[data-streaming]")).toHaveText("false");
      await show(page, null);
      await show(page, "A");
      await expect(timer(page)).toHaveCount(0);
    });
  }
});
