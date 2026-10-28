import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("desktop offline and answered-question lifecycle regressions", async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx", contents: `
      import React, { useEffect, useState } from "react";
      import { createRoot } from "react-dom/client";
      import { SessionViewer } from "./src/components/SessionViewer";
      import { IdeaWorkbench } from "./src/layout/IdeaWorkbench";
      import { sessionService } from "./src/services/session";
      import { applyAnsweredQuestion } from "./src/services/answeredQuestion";
      import { I18nProvider } from "./src/i18n";
      const question = { callId: "ask", kind: "ask_user", status: "running", title: "Choose",
        meta: { toolUseId: "ask", questions: [{ question: "Choose", options: [{ label: "A" }, { label: "B" }] }] } };
      const initial = { key: "s", agent: "codex", pending: true, exchanges: [
        { role: "user", seq: 1, content: "Task", timestamp: new Date().toISOString() },
        { role: "tool", toolCall: question },
      ] };
      window.emit = (type, event) => sessionService.handleMessage({ type,
        payload: { root_id: "root", session_key: "s", event } });
      window.failOther = () => sessionService.handleMessage({ type: "session.stream",
        payload: { root_id: "root", session_key: "other", event: { type: "error", data: { message: "failed" } } } });
      window.correct = () => window.emit("session.stream", { type: "question_answered", data: {
        ...question, status: "complete", meta: { ...question.meta, answers: { q_0: "A" } },
      } });
      window.accept = () => {
        sessionService.handleMessage({ type: "session.answer_question.accepted", id: window.request.id, payload: {} });
        window.correct();
      };
      window.requests = [];
      sessionService.ws = { readyState: 1, send(raw) { window.request = JSON.parse(raw); window.requests.push(window.request); }, close() {} };
      window.socketState = () => sessionService.ws.readyState;
      window.streaming = () => sessionService.isSessionStreaming("s");
      function App() {
        const [session, setSession] = useState(initial);
        const [visible, setVisible] = useState(true);
        const [connected, setConnected] = useState(true);
        window.setConnected = setConnected;
        window.show = setVisible;
        window.pending = session.pending;
        window.nextTurn = () => {
          window.emit("session.user_message");
          setSession(old => ({ ...old, pending: true, exchanges: [...old.exchanges,
            { role: "user", seq: 3, content: "Next", timestamp: new Date().toISOString() },
            { role: "tool", toolCall: { ...question, callId: "new", meta: { ...question.meta, toolUseId: "new" } } },
          ] }));
        };
        useEffect(() => sessionService.subscribeEvents(({ type, payload }) => {
          if (type === "session.done" || type === "session.error" || (type === "session.stream" && payload.event.type === "error"))
            setSession(old => ({ ...old, pending: false }));
          if (type === "session.stream" && payload.event.type === "question_answered")
            setSession(old => applyAnsweredQuestion(old, payload.event.data));
        }), []);
        const chat = visible ? <SessionViewer session={session} rootId="root" connected={connected}
          onAskUserAnswer={input => sessionService.answerQuestion(input.rootId, input.sessionKey, input.agent, input.toolUseId, input.answers)} /> : null;
        return <I18nProvider><IdeaWorkbench projectName="Fixture" onNewSession={() => {}} chat={chat}
          history={null} settings={null} footer={<textarea aria-label="Draft" defaultValue="Keep my draft" />}
          drawer={null} settingsOpen={false} historyOpen={false} /></I18nProvider>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  async function open(t, locale = "zh-CN", offline = false) {
    const context = await browser.newContext({ locale, viewport: { width: 375, height: 760 }, offline });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.clock.install({ time: new Date("2026-10-23T00:59:00Z") });
    await page.clock.pauseAt(new Date("2026-10-23T01:00:00Z"));
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    const styles = ["index.css", "ide.css"].map(name => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8").replace(/^@(?:import|source).*$/gm, "")).join("\n");
    await page.addStyleTag({ content: styles });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.locator(".session-activity-label")).toBeVisible();
    return page;
  }

  await t.test("accepted answers clear the waiting label and keep the current turn active", async t => {
    const page = await open(t);
    await expect(page.locator(".session-activity-label")).toContainText("等待你的回答");
    await page.getByRole("radio", { name: "A", exact: true }).check();
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect(page.locator(".session-activity-label")).toContainText("等待你的回答");
    await page.evaluate(() => window.accept());
    await expect(page.locator(".session-activity-label")).not.toContainText("等待你的回答");
    assert.equal(await page.evaluate(() => window.pending), true);
    await expect(page.getByRole("button", { name: "提交回答", exact: true })).toHaveCount(0);
  });

  await t.test("a late correction after done cannot revive the clock, including remount and the next question", async t => {
    const page = await open(t);
    await page.evaluate(() => window.emit("session.done"));
    await expect(page.locator(".session-activity-emoji")).toHaveText("👍");
    await page.evaluate(() => window.correct());
    await page.clock.fastForward(2000);
    await expect(page.locator("[data-session-activity]")).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.streaming()), false);
    assert.equal(await page.evaluate(() => window.pending), false);
    await page.evaluate(() => window.show(false));
    await page.evaluate(() => { window.correct(); window.show(true); });
    await expect(page.locator("[data-session-activity]")).toHaveCount(0);
    await page.evaluate(() => window.nextTurn());
    await expect(page.locator(".session-activity-label")).toContainText("等待你的回答");
    await page.evaluate(() => window.correct());
    await expect(page.locator(".session-activity-label")).toContainText("等待你的回答");
  });

  await t.test("physical-network offline indication overrides a healthy localhost socket and recovers without losing draft", async t => {
    const page = await open(t);
    await page.context().setOffline(true);
    await expect(page.locator(".idea-network-notice")).toContainText("网络已离线");
    await expect(page.locator(".session-activity-label")).toContainText("网络已离线");
    assert.equal(await page.evaluate(() => window.socketState()), 1);
    await page.clock.fastForward(120000);
    await expect(page.locator(".session-activity-emoji")).toHaveText("🔌");
    await expect(page.locator(".session-activity-note")).toHaveCount(0);
    await page.context().setOffline(false);
    await expect(page.locator(".idea-network-notice")).toContainText("网络连接已恢复");
    await expect(page.locator("[data-session-recovery]")).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.requests.length), 0, "reconnect never resends a running turn");
    await page.clock.fastForward(8000);
    await expect(page.locator(".idea-network-notice")).toHaveCount(0);
    await expect(page.locator(".session-activity-label")).toContainText("等待你的回答");
    await expect(page.getByRole("textbox", { name: "Draft" })).toHaveValue("Keep my draft");
    await page.evaluate(() => window.emit("session.done"));
    await page.clock.fastForward(2000);
    await page.context().setOffline(true);
    await expect(page.locator("[data-session-activity]")).toHaveCount(0);
    await expect(page.locator(".idea-network-notice")).toBeVisible();
  });

  await t.test("opening while offline shows the English notice immediately", async t => {
    const page = await open(t, "en-US", true);
    await expect(page.locator(".idea-network-notice")).toContainText("Network offline");
    await expect(page.locator(".session-activity-label")).toContainText("Network offline");
    await page.context().setOffline(false);
    await expect(page.locator(".session-activity-label")).toContainText("Waiting for your answer");
  });

  await t.test("a failed turn keeps a scoped manual continuation across remount, disabling offline and double clicks", async t => {
    const page = await open(t);
    await page.context().setOffline(true);
    await page.evaluate(() => { window.emit("session.stream", { type: "error", data: { message: "Network request failed" } }); window.emit("session.done"); });
    const button = page.getByRole("button", { name: "继续此会话", exact: true });
    await expect(button).toBeDisabled();
    await page.evaluate(() => window.show(false));
    await page.evaluate(() => window.show(true));
    await expect(button).toBeDisabled();
    await page.context().setOffline(false);
    await expect(button).toBeEnabled();
    await page.evaluate(() => window.setConnected(false));
    await expect(button).toBeDisabled();
    await page.evaluate(() => window.setConnected(true));
    await expect(button).toBeEnabled();
    await expect(page.locator("[data-session-recovery]")).toContainText("不是断点重放");
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await button.focus();
      await expect(button).toBeFocused();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.CAPTURE_RECOVERY) await page.screenshot({ path: `../../output/playwright/recovery-${theme}.png` });
    }
    // Native synchronous clicks exercise the lock before React rerenders.
    await button.evaluate(element => { element.click(); element.click(); });
    await expect(page.getByRole("button", { name: "正在发送" })).toBeDisabled();
    const requests = await page.evaluate(() => window.requests);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].payload.root_id, "root");
    assert.equal(requests[0].payload.session_key, "s");
    assert.equal(requests[0].payload.agent, "codex");
    assert.match(requests[0].payload.content, /不要重复执行/);
    await expect(page.getByRole("textbox", { name: "Draft" })).toHaveValue("Keep my draft");
    await page.evaluate(() => window.nextTurn());
    await expect(page.locator("[data-session-recovery]")).toHaveCount(0);
  });

  await t.test("other-session failures and successful completion never offer continuation in this view", async t => {
    const page = await open(t, "en-US");
    await page.evaluate(() => window.emit("session.done"));
    await page.evaluate(() => window.failOther());
    await expect(page.locator("[data-session-recovery]")).toHaveCount(0);
    await page.evaluate(() => window.emit("session.stream", { type: "error", data: { message: "failed" } }));
    await expect(page.getByRole("button", { name: "Continue conversation" })).toBeEnabled();
    await page.evaluate(() => window.nextTurn());
    await expect(page.locator("[data-session-recovery]")).toHaveCount(0);
  });
});
