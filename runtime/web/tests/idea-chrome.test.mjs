import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Run from runtime/web: node --test tests/idea-chrome.test.mjs
// Renders the real IdeaWorkbench plus the composer ActionBar from a local
// esbuild bundle. No server, generated bundle files, browser downloads, or
// application/backend startup.
const webDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const styles = ["src/index.css", "src/ide.css"].map((file) =>
  // These components use inline/IDE CSS, not Tailwind utilities. Keep the real
  // global reset and IDE rules, without asking the browser to fetch build inputs.
  readFileSync(path.join(webDir, file), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, ""),
).join("\n");

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    // Only a missing installation can skip. Crashes or missing OS dependencies fail.
    if (!/Executable doesn't exist/i.test(String(error))) throw error;
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0"
    ? process.env.PLAYWRIGHT_BROWSERS_PATH
    : process.platform === "darwin" ? path.join(homedir(), "Library/Caches/ms-playwright")
      : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || homedir(), "ms-playwright")
        : path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache"), "ms-playwright");
  const candidates = [chromium.executablePath()];
  if (existsSync(cache)) {
    // Also support an existing older local Chromium (e.g. macOS chromium-1208).
    for (const entry of readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()) {
      for (const suffix of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux64/chrome", "chrome-linux/chrome", "chrome-win64/chrome.exe", "chrome-win/chrome.exe",
      ]) candidates.push(path.join(cache, entry, suffix));
    }
  }
  const executablePath = candidates.find((file) => existsSync(file));
  return executablePath ? chromium.launch({ headless: true, executablePath }) : null;
}

let bundlePromise;
async function bundleFixture() {
  bundlePromise ||= build({
    stdin: {
      resolveDir: webDir,
      sourcefile: "idea-chrome-fixture.tsx",
      loader: "tsx",
      contents: `
        import React, { useRef, useState } from "react";
        import { createRoot } from "react-dom/client";
        import { IdeaWorkbench } from "./src/layout/IdeaWorkbench";
        import { IdeaAgentSettings } from "./src/components/IdeaAgentSettings";
        import { ActionBar } from "./src/components/ActionBar";

        const events = [];
        window.__ideaFixture = { events };
        function Fixture() {
          const [sessionKey, setSessionKey] = useState("first");
          window.__switchVoiceSession = () => setSessionKey("second");
          const [settingsOpen, setSettingsOpen] = useState(false);
          const [historyOpen, setHistoryOpen] = useState(false);
          // Record only real transitions: back-to-chat closes both views and
          // must stay silent for the one that was already closed.
          const settingsRef = useRef(false);
          const historyRef = useRef(false);
          return <IdeaWorkbench
            projectName="demo"
            onNewSession={() => events.push("new")}
            onOpenHistory={() => { if (!historyRef.current) { historyRef.current = true; events.push("open-history"); } setHistoryOpen(true); }}
            onCloseHistory={() => { if (historyRef.current) { historyRef.current = false; events.push("close-history"); } setHistoryOpen(false); }}
            onOpenSettings={() => { if (!settingsRef.current) { settingsRef.current = true; events.push("open-settings"); } setSettingsOpen(true); }}
            onCloseSettings={() => { if (settingsRef.current) { settingsRef.current = false; events.push("close-settings"); } setSettingsOpen(false); }}
            settingsOpen={settingsOpen}
            historyOpen={historyOpen}
            chat={<div data-testid="chat-view">chat body</div>}
            history={<div data-testid="history-view">history body</div>}
            settings={<div data-testid="settings-view"><IdeaAgentSettings agents={[{ name:"codex", installed:true, available:true, version:"1.0.0", update_check_supported:true, update_commands:["update codex"] }]} busy={false} projectReady={true} notice="" probingAgent="" error="" onProbe={() => {}} onRun={(agent, action) => events.push(action + ":" + agent.name)} /></div>}
            footer={<ActionBar compactWorkbench status="connecting" currentSession={{ key: sessionKey, name: "fixture", type: "chat", agent: "codex" }} />}
            drawer={null}
          />;
        }
        // Kept separate from the bundle evaluation so tests can fire native
        // commands before the view (and its bridge subscription) exists.
        window.__mountFixture = () => { createRoot(document.getElementById("root")).render(<Fixture />); };
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
    plugins: [{
      name: "isolate-workbench-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /\/i18n$/ }, () => ({ path: "english-i18n", namespace: "fixture" }));
        builder.onLoad({ filter: /^english-i18n$/, namespace: "fixture" }, () => ({
          resolveDir: webDir,
          contents: `import { enUS } from "./src/i18n/locales/en-US";
            import { zhCN } from "./src/i18n/locales/zh-CN";
            const locale = new URLSearchParams(location.search).get("locale") || "en-US";
            const messages = locale === "zh-CN" ? zhCN : enUS;
            export function translateNow(key, params = {}) {
              if (!(key in messages)) throw new Error("Missing message: " + key);
              return messages[key].replace(/\\{(\\w+)\\}/g, (_, name) => String(params[name] ?? "{" + name + "}"));
            }
            export function useI18n() { return { t: translateNow, locale, setLocale() {} }; }`,
        }));
        // Tool-card/markdown rendering is outside this chrome/composer fixture.
        builder.onResolve({ filter: /\/stream\/ToolCallCard$/ }, () => ({ path: "tool-icon", namespace: "fixture" }));
        builder.onLoad({ filter: /^tool-icon$/, namespace: "fixture" }, () => ({ contents: "export const renderToolIcon = () => null; export const ToolCallCard = () => null;" }));
        builder.onResolve({ filter: /\/services\/agents$/ }, () => ({ path: "agents", namespace: "fixture" }));
        builder.onLoad({ filter: /^agents$/, namespace: "fixture" }, () => ({ contents: `
          export async function fetchAgents() { return [{name:"codex", installed:true, protocol:"codex-sdk", available:true, current_model_id:"gpt-test", default_effort:"high", models:[{id:"gpt-test",name:"GPT Test",supportEffort:true,efforts:["low","medium","high","xhigh"]}], modes:[], efforts:["low","medium","high","xhigh"]}]; }
          export const fetchAgentCatalog = fetchAgents;
          export async function fetchShells() { return []; }
          export async function restartAgent() { return {}; }
          export async function probeAgent() { return {}; }
          export async function checkAgentUpdate() { return { agent:"codex", current_version:"1.0.0", latest_version:"1.1.0", has_update:true }; }
        ` }));
        // Keep IDE services and asset path formatting out of the fixture.
        builder.onResolve({ filter: /^\.\.\/services\/base$/ }, () => ({ path: "asset-path", namespace: "fixture" }));
        builder.onLoad({ filter: /^asset-path$/, namespace: "fixture" }, () => ({ contents: "export const appPath = (path) => path;" }));
      },
    }],
  });
  return (await bundlePromise).outputFiles[0].text;
}

async function openFixture(browser, bundle, t, query, mount = true, width = 900) {
  const context = await browser.newContext({
    viewport: { width, height: 640 },
    reducedMotion: "reduce", offline: true, serviceWorkers: "block",
  });
  const errors = [];
  await context.route("**/*", (route) => {
    if (route.request().resourceType() === "document") {
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html data-theme="dark"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>',
      });
    }
    if (route.request().url().endsWith("/assets/agents/codex.svg")) {
      return route.fulfill({ contentType: "image/svg+xml", body: readFileSync(path.join(webDir, "public/assets/agents/codex.svg")) });
    }
    // The composer probes agents/shells on mount; empty payloads keep it idle.
    return route.fulfill({ contentType: "application/json", body: '{"agents":[],"shells":[]}' });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "fixture must not throw browser errors");
  });
  await page.goto(`https://idea-agent.fixture.test/${query}`);
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
  if (mount) {
    await page.evaluate(() => window.__mountFixture());
    await expect(page.getByTestId("chat-view")).toBeVisible();
  }
  return page;
}

const command = (page, name) => page.evaluate((name) => window.ideaAgentNativeCommand(name), name);
const events = (page) => page.evaluate(() => window.__ideaFixture.events);
const view = (page) => page.locator(".idea-workbench");
const heading = (page) => page.locator(".idea-view-heading h1");
const voiceButton = (page) => page.getByRole("button", { name: "Voice input", exact: true });

test("IDE chrome workbench keeps one AI Agent title and serves native commands", { timeout: 120_000 }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) {
    t.skip("Playwright Chromium is not installed (including the local cache); no browser was downloaded.");
    return;
  }
  t.after(() => browser.close());
  const bundle = await bundleFixture();

  await t.test("the chrome host drops the embedded toolbar and duplicate chat heading", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_token=t&ide_theme=dark&ide_chrome=1");
    await expect(page.locator(".idea-toolbar")).toHaveCount(0);
    await expect(view(page)).toHaveAttribute("data-idea-chrome", "true");
    await expect(page.getByText("AI Agent", { exact: true })).toHaveCount(0);
    await expect(page.locator(".idea-view-heading")).toHaveCount(0);
    await expect(voiceButton(page)).toHaveCount(1);
  });

  await t.test("native commands open and return from history and settings", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1");
    await command(page, "new");
    await command(page, "history");
    await expect(view(page)).toHaveAttribute("data-idea-view", "history");
    await expect(heading(page)).toHaveText("Chat history");
    await expect(page.getByTestId("history-view")).toBeVisible();
    await command(page, "history");
    await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
    await expect(page.locator(".idea-view-heading")).toHaveCount(0);
    await command(page, "settings");
    await expect(view(page)).toHaveAttribute("data-idea-view", "settings");
    await expect(heading(page)).toHaveText("Agent settings");
    await expect(page.getByTestId("settings-view")).toBeVisible();
    await command(page, "settings");
    await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
    assert.deepEqual(await events(page), ["new", "open-history", "close-history", "open-settings", "close-settings"]);
  });

  await t.test("Agent settings check first and reveal update only after a newer version is found", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1");
    await command(page, "settings");
    await expect(page.getByRole("button", { name: "Configure", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add Agent config", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Restart", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Update to v1.1.0", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Check for updates", exact: true }).click();
    await expect(page.getByText("Version v1.1.0 is available", { exact: true })).toBeVisible();
    if (process.env.AGENT_SETTINGS_CAPTURE_SCREENSHOTS === "1") {
      const reports = path.join(webDir, "../../build/reports/agent-settings");
      mkdirSync(reports, { recursive: true });
      await page.screenshot({ path: path.join(reports, "update-available.png"), fullPage: true });
    }
    await page.getByRole("button", { name: "Update to v1.1.0", exact: true }).click();
    assert.deepEqual(await events(page), ["open-settings", "update:codex"]);
  });

  await t.test("native commands clicked before the view mounts are replayed, not lost", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1", false);
    await command(page, "new");
    await command(page, "history");
    await page.evaluate(() => window.__mountFixture());
    await expect(view(page)).toHaveAttribute("data-idea-view", "history");
    assert.deepEqual(await events(page), ["new", "open-history"]);
  });

  await t.test("repeated queued toggles preserve their order before React rerenders", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1", false);
    await command(page, "history");
    await command(page, "history");
    await page.evaluate(() => window.__mountFixture());
    await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
    assert.deepEqual(await events(page), ["open-history", "close-history"]);
  });

  await t.test("voice replaces add-code and inserts plain transcription at the original cursor", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1");
    await expect(page.getByRole("button", { name: "Add current code" })).toHaveCount(0);
    const input = page.locator('[contenteditable="true"]');
    await input.fill("before after");
    for (let n = 0; n < 5; n++) await input.press("ArrowLeft");
    assert.equal(await page.evaluate(() => window.getSelection()?.anchorOffset), 7);
    await page.evaluate(() => {
      window.__ideaHostMessages = [];
      window.ideaAgent = { postMessage: (payload) => window.__ideaHostMessages.push(payload) };
    });
    await voiceButton(page).click();
    const id = await page.evaluate(() => window.__ideaHostMessages.at(-1).id);
    assert.equal(await page.evaluate(() => window.__ideaHostMessages[0].action), "voiceStart");
    await page.evaluate((id) => window.ideaAgentVoiceEvent({ id, state: "recording", level: .8, elapsedMs: 12300, limitSeconds: 60 }), id);
    await expect(page.getByRole("dialog")).toContainText("00:12");
    await expect(page.getByRole("dialog")).toContainText("60s max");
    await expect(page.locator('[data-onboarding="message-input"] [contenteditable]')).toHaveAttribute("contenteditable", "false");
    await page.getByRole("button", { name: "Stop and transcribe", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__ideaHostMessages.at(-1).action), "voiceStop");
    await page.evaluate((id) => window.ideaAgentVoiceEvent({ id, state: "transcribing" }), id);
    await expect(page.getByRole("dialog")).toContainText("Transcribing");
    await page.evaluate((id) => window.ideaAgentVoiceEvent({ id, state: "done", text: "你好 @literal " }), id);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[contenteditable="true"]')).toHaveText("before 你好 @literal after");
    assert.deepEqual(await events(page), []);
    // Existing native code capture still reaches this same draft.
    await page.evaluate(() => window.ideaAgentReceiveContext("int captured = 1;"));
    await expect(page.locator('[data-onboarding="message-input"]')).toContainText("int captured = 1;");
  });

  await t.test("Escape, hidden chat and session switching cancel recording and discard late text", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1");
    await page.locator('[contenteditable="true"]').fill("keep draft");
    await page.evaluate(() => {
      window.__ideaHostMessages = [];
      window.ideaAgent = { postMessage: (payload) => window.__ideaHostMessages.push(payload) };
    });
    for (const cancel of ["escape", "history", "session"]) {
      await voiceButton(page).click();
      const id = await page.evaluate(() => window.__ideaHostMessages.at(-1).id);
      await page.evaluate((id) => window.ideaAgentVoiceEvent({ id, state: "recording", level: 0, elapsedMs: 100 }), id);
      if (cancel === "escape") await page.keyboard.press("Escape");
      else if (cancel === "history") await command(page, "history");
      else await page.evaluate(() => window.__switchVoiceSession());
      await expect(page.getByRole("dialog")).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.__ideaHostMessages.at(-1).action), "voiceCancel");
      await page.evaluate((id) => window.ideaAgentVoiceEvent({ id, state: "done", text: "must not appear" }), id);
      if (cancel === "history") await command(page, "chat");
      await expect(page.locator('[contenteditable="true"]')).toHaveText("keep draft");
    }
  });

  await t.test("unconfigured and failed recognition explain recovery without clearing the draft", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1");
    await page.locator('[contenteditable="true"]').fill("keep draft");
    await page.evaluate(() => {
      window.__ideaHostMessages = [];
      window.ideaAgent = { postMessage: (payload) => window.__ideaHostMessages.push(payload) };
    });
    await voiceButton(page).click();
    const id = await page.evaluate(() => window.__ideaHostMessages.at(-1).id);
    await page.evaluate((id) => window.ideaAgentVoiceEvent({ id, state: "configuration" }), id);
    await expect(page.getByRole("dialog")).toContainText("Choose a speech provider");
    await page.getByRole("button", { name: "Configure and test", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__ideaHostMessages.at(-1).action), "voiceConfigure");
    await voiceButton(page).click();
    const next = await page.evaluate(() => window.__ideaHostMessages.at(-1).id);
    await page.evaluate((id) => window.ideaAgentVoiceEvent({ id, state: "error", error: "tencentAuthentication" }), next);
    await expect(page.getByRole("alert")).toContainText("SecretId/SecretKey");
    await page.keyboard.press("Escape");
    await expect(page.locator('[contenteditable="true"]')).toHaveText("keep draft");
  });

  await t.test("persistent settings and recording gear open the same configuration without late insertion", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1");
    await page.locator('[contenteditable="true"]').fill("keep draft");
    await page.evaluate(() => {
      window.__ideaHostMessages = [];
      window.ideaAgent = { postMessage: payload => window.__ideaHostMessages.push(payload) };
    });
    for (const source of ["gear", "native-menu"]) {
      await voiceButton(page).click();
      const id = await page.evaluate(() => window.__ideaHostMessages.at(-1).id);
      await page.evaluate(id => window.ideaAgentVoiceEvent({ id, state: "recording", elapsedMs: 500 }), id);
      await expect(page.getByRole("button", { name: "Voice configuration and test", exact: true })).toBeVisible();
      if (source === "gear") {
        await page.getByRole("button", { name: "Voice configuration and test", exact: true }).click();
        assert.deepEqual(await page.evaluate(() => window.__ideaHostMessages.slice(-2).map(p => p.action)), ["voiceCancel", "voiceConfigure"]);
      } else await page.evaluate(() => window.dispatchEvent(new Event("ideaAgentVoiceSettingsOpening")));
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.evaluate(id => window.ideaAgentVoiceEvent({ id, state: "done", text: "late text" }), id);
      await expect(page.locator('[contenteditable="true"]')).toHaveText("keep draft");
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await command(page, "settings");
      await page.getByRole("button", { name: "Configure and test", exact: true }).click();
      assert.equal(await page.evaluate(() => window.__ideaHostMessages.at(-1).action), "voiceConfigure");
      if (process.env.VOICE_CAPTURE_SCREENSHOTS === "1" && attempt === 0) {
        const reports = path.join(webDir, "../../build/reports/voice-input");
        mkdirSync(reports, { recursive: true });
        await page.screenshot({ path: path.join(reports, "persistent-settings.png") });
      }
      await command(page, "chat");
    }
    await expect(page.locator('[contenteditable="true"]')).toHaveText("keep draft");
  });

  await t.test("settings show the saved provider on bridge readiness, save and reopening", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1&locale=zh-CN", true, 375);
    await command(page, "settings");
    const active = page.locator(".idea-voice-active");
    await expect(active).toContainText("正在读取语音服务");
    await page.evaluate(() => {
      window.ideaAgent = { voiceProvider: null, postMessage() {} };
      window.dispatchEvent(new Event("ideaAgentReady"));
    });
    await expect(active).toHaveText("当前供应商：未配置");
    for (const [provider, label] of [["tencent", "腾讯云"], ["siliconflow", "硅基流动"], ["custom", "自定义服务"], ["tencent", "腾讯云"]]) {
      await page.evaluate(provider => {
        window.ideaAgent.voiceProvider = provider;
        window.dispatchEvent(new Event("ideaAgentVoiceSettingsChanged"));
      }, provider);
      await expect(active).toHaveText(`当前供应商：${label}`);
      await page.getByRole("button", { name: "配置与测试", exact: true }).click();
      // Opening or cancelling configuration has no saved-settings event.
      await expect(active).toHaveText(`当前供应商：${label}`);
      await command(page, "chat");
      await command(page, "settings");
      await expect(active).toHaveText(`当前供应商：${label}`);
    }
    await expect(active).not.toContainText("16k_zh");
    await expect(active).not.toContainText("SenseVoiceSmall");
    if (process.env.VOICE_CAPTURE_SCREENSHOTS === "1") {
      const reports = path.join(webDir, "../../build/reports/voice-active-provider");
      mkdirSync(reports, { recursive: true });
      await page.evaluate(() => window.ideaAgentSetTheme("dark"));
      await page.locator(".idea-voice-settings").screenshot({ path: path.join(reports, "settings-375-dark.png") });
      await page.setViewportSize({ width: 900, height: 640 });
      await page.evaluate(() => window.ideaAgentSetTheme("light"));
      await page.locator(".idea-voice-settings").screenshot({ path: path.join(reports, "settings-900-light.png") });
    }
  });

  await t.test("recording shows only its actual provider and never a stale provider or model", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1&locale=zh-CN");
    await page.locator('[contenteditable="true"]').fill("保留草稿");
    await page.evaluate(() => {
      window.__ideaHostMessages = [];
      window.ideaAgent = { postMessage: payload => window.__ideaHostMessages.push(payload) };
    });
    const mic = page.getByRole("button", { name: "语音输入", exact: true });
    let previousId = "old";
    for (const [provider, label] of [["siliconflow", "硅基流动"], ["tencent", "腾讯云"], ["custom", "自定义服务"]]) {
      await mic.click();
      const id = await page.evaluate(() => window.__ideaHostMessages.at(-1).id);
      await expect(page.locator(".idea-voice-provider")).toHaveText("正在读取语音服务…");
      await page.evaluate(id => window.ideaAgentVoiceEvent({ id, state: "recording", provider: "siliconflow" }), previousId);
      await expect(page.locator(".idea-voice-provider")).toHaveText("正在读取语音服务…");
      for (const state of ["starting", "recording", "transcribing", "error"]) {
        await page.evaluate(({ id, state, provider }) => window.ideaAgentVoiceEvent({ id, state, provider, error: "service" }), { id, state, provider });
        await expect(page.locator(".idea-voice-provider")).toHaveText(label);
        await expect(page.getByRole("dialog")).not.toContainText("SenseVoiceSmall");
        await expect(page.getByRole("dialog")).not.toContainText("16k_zh");
        await expect(page.locator('[data-onboarding="input-controls"]')).not.toContainText(label);
      }
      await page.keyboard.press("Escape");
      await expect(page.locator('[contenteditable="true"]')).toHaveText("保留草稿");
      previousId = id;
    }
    await mic.click();
    const id = await page.evaluate(() => window.__ideaHostMessages.at(-1).id);
    await page.evaluate(id => window.ideaAgentVoiceEvent({ id, state: "configuration" }), id);
    await expect(page.locator(".idea-voice-provider")).toHaveText("语音服务尚未配置");
  });

  await t.test("adding a file preserves the current conversation and draft without sending", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1");
    const input = page.locator('[data-onboarding="message-input"]');
    await input.locator('[contenteditable="true"]').fill("Please review this file");
    await page.evaluate(() => {
      window.__ideaHostMessages = [];
      window.ideaAgent = { postMessage: (payload) => window.__ideaHostMessages.push(payload) };
    });
    const button = page.getByRole("button", { name: "Add current file", exact: true });
    await expect(button).toHaveText("Add current file");
    await button.click();
    assert.deepEqual(await page.evaluate(() => window.__ideaHostMessages), [{ action: "addFileContext" }]);
    await page.evaluate(() => {
      window.ideaAgentNativeCommand("chat");
      window.ideaAgentReceiveContext("文件：/project/src/第8个 file.kt");
    });
    await expect(input).toContainText("Please review this file");
    await expect(input).toContainText("文件：/project/src/第8个 file.kt");
    await expect(page.locator(".idea-view-heading")).toHaveCount(0);
    assert.deepEqual(await events(page), []);
    assert.deepEqual(await page.evaluate(() => window.__ideaHostMessages), [{ action: "addFileContext" }]);
    await page.evaluate(() => window.ideaAgentReceiveContext("int selected = 1;"));
    await expect(input).toContainText("int selected = 1;");
    for (const viewName of ["history", "settings"]) {
      await command(page, viewName);
      await command(page, "chat");
      await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
      await expect(input).toContainText("文件：/project/src/第8个 file.kt");
      await expect(page.locator(".idea-view-heading")).toHaveCount(0);
    }
    assert.equal((await events(page)).includes("new"), false);
  });

  await t.test("voice cannot start before the IDE bridge and is never queued for a later surprise recording", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1");
    await voiceButton(page).click();
    await expect(page.getByRole("alert")).toContainText("IDEA is not connected");
    await page.evaluate(() => {
      window.__ideaHostMessages = [];
      window.ideaAgent = { postMessage: (payload) => window.__ideaHostMessages.push(payload) };
      window.dispatchEvent(new Event("ideaAgentReady"));
    });
    assert.deepEqual(await page.evaluate(() => window.__ideaHostMessages), []);
  });

  for (const width of [320, 375, 400, 441, 812]) {
    await t.test(`native composer controls remain usable at ${width}px with permissions loaded`, async () => {
      const locale = width === 375 || width === 812 ? "zh-CN" : "en-US";
      const page = await openFixture(browser, bundle, t, `?ide_chrome=1&locale=${locale}`, true, width);
      if (width === 375) await page.evaluate(() => window.ideaAgentSetTheme("light"));
      await expect(page.getByRole("button", { name: /^(Execution permissions|执行权限):/ })).toBeVisible();
      await expect(page.locator(".idea-agent-selector-effort")).toHaveText(
        locale === "zh-CN" ? "思考：high" : "Effort: high",
      );
      const controls = page.locator('[data-onboarding="input-controls"] button:visible');
      for (let index = 0; index < await controls.count(); index += 1) {
        const button = controls.nth(index);
        const box = await button.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `control is outside ${width}px: ${JSON.stringify(box)}`);
        assert.equal(await button.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }), true, "composer controls must not cover one another");
      }
      assert.ok(await page.getByRole("button", { name: locale === "zh-CN" ? "添加附件" : "Add attachment" }).isVisible());
      assert.ok(await page.getByRole("button", { name: locale === "zh-CN" ? "语音输入" : "Voice input" }).isVisible());
      assert.ok(await page.locator('[data-onboarding="send-action"]').isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "composer must not overflow the viewport");
      if (width <= 480) {
        const [primaryBox, secondaryBox, placeholderBox] = await Promise.all([
          page.locator(".idea-input-primary-controls").boundingBox(),
          page.locator(".idea-input-secondary-controls").boundingBox(),
          page.getByText(locale === "zh-CN" ? "给 agent 发消息..." : "Message the agent...", { exact: true }).boundingBox(),
        ]);
        assert.ok(primaryBox && secondaryBox && placeholderBox);
        assert.ok(primaryBox.y + primaryBox.height <= secondaryBox.y + 1, "compact composer controls must use two distinct rows");
        assert.ok(placeholderBox.y + placeholderBox.height <= primaryBox.y + 1, "placeholder must stay above compact composer controls");
      }
      const fileButton = page.getByRole("button", { name: locale === "zh-CN" ? "加入当前文件" : "Add current file", exact: true });
      const fileBox = await fileButton.boundingBox();
      assert.ok(fileBox && fileBox.x >= 0 && fileBox.x + fileBox.width <= width);
      await fileButton.focus();
      await expect(fileButton).toBeFocused();
      if (width === 812) {
        await page.locator('[data-onboarding="agent-selector"] > button').click();
        await page.getByRole("button", { name: /^思考强度/ }).click();
        await page.getByRole("button", { name: "low", exact: true }).click();
        await expect(page.locator(".idea-agent-selector-effort")).toHaveText("思考：low");
      }
      const reports = path.join(webDir, "../../build/reports/file-context");
      mkdirSync(reports, { recursive: true });
      await page.screenshot({ path: path.join(reports, `composer-${width}.png`) });
    });
  }

  for (const [width, locale, theme] of [[375, "zh-CN", "light"], [900, "en-US", "dark"]]) {
    await t.test(`voice popover follows theme and viewport at ${width}px`, async () => {
      const page = await openFixture(browser, bundle, t, `?ide_chrome=1&locale=${locale}`, true, width);
      await page.evaluate((theme) => {
        window.ideaAgentSetTheme(theme);
        window.ideaAgent = { postMessage: (payload) => {
          if (payload.action === "voiceStart") {
            for (let n = 0; n < 21; n++) window.ideaAgentVoiceEvent({ id: payload.id, state: "recording", provider: "siliconflow", elapsedMs: 12300, level: Math.sin(n / 20 * Math.PI) * .85 });
          }
        } };
      }, theme);
      await page.getByRole("button", { name: locale === "zh-CN" ? "语音输入" : "Voice input", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const rect = await dialog.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0);
      const reports = path.join(webDir, "../../build/reports/voice-input");
      mkdirSync(reports, { recursive: true });
      const expectedPanel = theme === "dark" ? "rgb(41, 43, 49)" : "rgb(244, 245, 247)";
      assert.equal(await dialog.evaluate(node => getComputedStyle(node).backgroundColor), expectedPanel);
      // Captures are opt-in after the bounded visual review; functional reruns do not repolish.
      if (process.env.VOICE_CAPTURE_SCREENSHOTS === "1") await page.screenshot({ path: path.join(reports, `recording-${width}-${theme}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }

  await t.test("a plain browser preview keeps the embedded toolbar and actions", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_token=t&ide_theme=dark");
    await expect(page.locator(".idea-toolbar")).toHaveCount(1);
    await expect(page.locator(".idea-toolbar strong")).toHaveText("AI Agent");
    await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
    await expect(voiceButton(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add current file", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "New session" }).click();
    assert.deepEqual(await events(page), ["new"]);
    await page.getByRole("button", { name: "Chat history" }).click();
    await expect(view(page)).toHaveAttribute("data-idea-view", "history");
    await page.getByRole("button", { name: "Chat history" }).click();
    await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
    await page.getByRole("button", { name: "Agent settings" }).click();
    await expect(view(page)).toHaveAttribute("data-idea-view", "settings");
    await page.getByRole("button", { name: "Agent settings" }).click();
    await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
    assert.deepEqual(await events(page), ["new", "open-history", "close-history", "open-settings", "close-settings"]);
  });
});
