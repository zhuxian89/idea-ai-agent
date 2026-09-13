import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
        import { ActionBar } from "./src/components/ActionBar";

        const events = [];
        window.__ideaFixture = { events };
        function Fixture() {
          const [settingsOpen, setSettingsOpen] = useState(false);
          const [historyOpen, setHistoryOpen] = useState(false);
          // Record only real transitions: back-to-chat closes both views and
          // must stay silent for the one that was already closed.
          const settingsRef = useRef(false);
          const historyRef = useRef(false);
          return <IdeaWorkbench
            projectName="demo"
            sessionName="Fix session"
            onNewSession={() => events.push("new")}
            onOpenHistory={() => { if (!historyRef.current) { historyRef.current = true; events.push("open-history"); } setHistoryOpen(true); }}
            onCloseHistory={() => { if (historyRef.current) { historyRef.current = false; events.push("close-history"); } setHistoryOpen(false); }}
            onOpenSettings={() => { if (!settingsRef.current) { settingsRef.current = true; events.push("open-settings"); } setSettingsOpen(true); }}
            onCloseSettings={() => { if (settingsRef.current) { settingsRef.current = false; events.push("close-settings"); } setSettingsOpen(false); }}
            settingsOpen={settingsOpen}
            historyOpen={historyOpen}
            chat={<div data-testid="chat-view">chat body</div>}
            history={<div data-testid="history-view">history body</div>}
            settings={<div data-testid="settings-view">settings body</div>}
            footer={<ActionBar compactWorkbench status="connecting" />}
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
            export function translateNow(key, params = {}) {
              if (!(key in enUS)) throw new Error("Missing English message: " + key);
              return enUS[key].replace(/\\{(\\w+)\\}/g, (_, name) => String(params[name] ?? "{" + name + "}"));
            }
            export function useI18n() { return { t: translateNow, locale: "en-US", setLocale() {} }; }`,
        }));
        // Tool-card/markdown rendering is outside this chrome/composer fixture.
        builder.onResolve({ filter: /\/stream\/ToolCallCard$/ }, () => ({ path: "tool-icon", namespace: "fixture" }));
        builder.onLoad({ filter: /^tool-icon$/, namespace: "fixture" }, () => ({ contents: "export const renderToolIcon = () => null; export const ToolCallCard = () => null;" }));
        builder.onResolve({ filter: /\/services\/agents$/ }, () => ({ path: "agents", namespace: "fixture" }));
        builder.onLoad({ filter: /^agents$/, namespace: "fixture" }, () => ({ contents: `
          export async function fetchAgents() { return [{name:"fixture-agent", protocol:"claude-sdk", available:true, models:[], modes:[], efforts:[]}]; }
          export async function fetchShells() { return []; }
          export async function restartAgent() { return {}; }
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
const addCodeButton = (page) => page.getByRole("button", { name: "Add current code" });

test("IDE chrome workbench keeps one AI Agent title and serves native commands", { timeout: 120_000 }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) {
    t.skip("Playwright Chromium is not installed (including the local cache); no browser was downloaded.");
    return;
  }
  t.after(() => browser.close());
  const bundle = await bundleFixture();

  await t.test("the chrome host drops the embedded toolbar but keeps meaningful headings", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_token=t&ide_theme=dark&ide_chrome=1");
    await expect(page.locator(".idea-toolbar")).toHaveCount(0);
    await expect(view(page)).toHaveAttribute("data-idea-chrome", "true");
    await expect(page.getByText("AI Agent", { exact: true })).toHaveCount(0);
    await expect(heading(page)).toHaveText("Fix session");
    await expect(addCodeButton(page)).toHaveCount(1);
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
    await expect(heading(page)).toHaveText("Fix session");
    await command(page, "settings");
    await expect(view(page)).toHaveAttribute("data-idea-view", "settings");
    await expect(heading(page)).toHaveText("Agent configuration and installation");
    await expect(page.getByTestId("settings-view")).toBeVisible();
    await command(page, "settings");
    await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
    assert.deepEqual(await events(page), ["new", "open-history", "close-history", "open-settings", "close-settings"]);
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

  await t.test("the composer add-code entry asks the IDE to capture the current editor", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1");
    await page.evaluate(() => {
      window.__ideaHostMessages = [];
      window.ideaAgent = { postMessage: (payload) => window.__ideaHostMessages.push(payload) };
    });
    await addCodeButton(page).click();
    await expect.poll(async () => page.evaluate(() => window.__ideaHostMessages))
      .toEqual([{ action: "addContext" }]);
    // The captured context returns through the existing receive path.
    await page.evaluate(() => window.ideaAgentReceiveContext("int captured = 1;"));
    await expect(page.locator('[data-onboarding="message-input"]')).toContainText("int captured = 1;");
  });

  await t.test("add-code clicks queued before the bridge injects flush on ideaAgentReady", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_chrome=1");
    await addCodeButton(page).click();
    await page.evaluate(() => {
      window.__ideaHostMessages = [];
      window.ideaAgent = { postMessage: (payload) => window.__ideaHostMessages.push(payload) };
      window.dispatchEvent(new Event("ideaAgentReady"));
    });
    assert.deepEqual(await page.evaluate(() => window.__ideaHostMessages), [{ action: "addContext" }]);
  });

  for (const width of [320, 400]) {
    await t.test(`native composer controls remain usable at ${width}px with permissions loaded`, async () => {
      const page = await openFixture(browser, bundle, t, "?ide_chrome=1", true, width);
      await expect(page.getByRole("button", { name: /^Execution permissions:/ })).toBeVisible();
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
    });
  }

  await t.test("a plain browser preview keeps the embedded toolbar and actions", async () => {
    const page = await openFixture(browser, bundle, t, "?ide_token=t&ide_theme=dark");
    await expect(page.locator(".idea-toolbar")).toHaveCount(1);
    await expect(page.locator(".idea-toolbar strong")).toHaveText("AI Agent");
    await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
    await expect(addCodeButton(page)).toHaveCount(0);
    await page.getByRole("button", { name: "New session" }).click();
    assert.deepEqual(await events(page), ["new"]);
    await page.getByRole("button", { name: "Chat history" }).click();
    await expect(view(page)).toHaveAttribute("data-idea-view", "history");
    await page.getByRole("button", { name: "Chat history" }).click();
    await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
    await page.getByRole("button", { name: "Agent configuration and installation" }).click();
    await expect(view(page)).toHaveAttribute("data-idea-view", "settings");
    await page.getByRole("button", { name: "Agent configuration and installation" }).click();
    await expect(view(page)).toHaveAttribute("data-idea-view", "chat");
    assert.deepEqual(await events(page), ["new", "open-history", "close-history", "open-settings", "close-settings"]);
  });
});
