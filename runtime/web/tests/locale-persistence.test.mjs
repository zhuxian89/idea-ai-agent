import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const webDir = fileURLToPath(new URL("../", import.meta.url));

test("IDE language and appearance survive fresh webviews, port changes, and host theme updates", async (t) => {
  const bundle = await build({
    stdin: { resolveDir: webDir, sourcefile: "locale-fixture.tsx", loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { I18nProvider } from "./src/i18n";
      import { IdeaAgentSettings } from "./src/components/IdeaAgentSettings";
      import "./src/services/ideaBridge";
      createRoot(document.getElementById("root")).render(<I18nProvider><IdeaAgentSettings
        agents={[]} busy={false} projectReady notice="" restartingAgent="" error="" configuration={null}
        onRefresh={() => {}} onConfigure={() => {}} onRestart={() => {}} onRun={() => {}}
      /></I18nProvider>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const open = async (port, storedLocale, storedAppearance) => {
    const context = await browser.newContext({ locale: "en-US", serviceWorkers: "block" });
    const errors = [];
    t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
    await context.route("**/*", (route) => route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' })
      : route.abort());
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/?ide=1`);
    if (storedLocale) await page.evaluate(value => localStorage.setItem("mindfs-locale", value), storedLocale);
    if (storedAppearance) await page.evaluate(value => localStorage.setItem("mindfs-appearance-mode", value), storedAppearance);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator(".idea-preferences select").first().waitFor();
    return page;
  };
  const injectHost = (page, locale, appearance = null, theme = "dark") => page.evaluate(value => {
    window.__hostPosts = [];
    window.ideaAgent = { ...value, postMessage: payload => window.__hostPosts.push(payload) };
    window.dispatchEvent(new Event("ideaAgentReady"));
  }, { locale, appearance, theme });
  const language = page => page.locator(".idea-preferences select").nth(1);
  const appearance = page => page.locator(".idea-preferences select").nth(0);

  const original = await open(43111);
  await injectHost(original, null);
  assert.deepEqual(await original.evaluate(() => window.__hostPosts), [], "an inferred English default must not become a saved preference");
  await expect(appearance(original)).toHaveValue("system");
  await appearance(original).selectOption("light");
  assert.deepEqual(await original.evaluate(() => window.__hostPosts.at(-1)), { action: "setAppearance", appearance: "light" });
  await language(original).selectOption("zh-CN");
  const saved = await original.evaluate(() => window.__hostPosts.at(-1));
  assert.deepEqual(saved, { action: "setLocale", locale: "zh-CN" });

  // New browser storage and a new origin emulate reinstalling/restarting the
  // plugin. Only the IDE's persisted preference survives.
  const reinstalled = await open(43112);
  assert.equal(await reinstalled.evaluate(() => localStorage.getItem("mindfs-locale")), null);
  await injectHost(reinstalled, saved.locale, "light");
  await expect(language(reinstalled)).toHaveValue("zh-CN");
  await expect(reinstalled.locator("html")).toHaveAttribute("lang", "zh-CN");
  assert.equal(await reinstalled.evaluate(() => localStorage.getItem("mindfs-locale")), "zh-CN");
  await expect(appearance(reinstalled)).toHaveValue("light");
  await reinstalled.evaluate(() => window.ideaAgentSetTheme("dark"));
  await expect(reinstalled.locator("html")).toHaveAttribute("data-theme", "light");
  assert.equal(await reinstalled.evaluate(() => localStorage.getItem("mindfs-appearance-mode")), "light");
  await appearance(reinstalled).selectOption("system");
  assert.deepEqual(await reinstalled.evaluate(() => window.__hostPosts.at(-1)), { action: "setAppearance", appearance: "system" });
  await expect(reinstalled.locator("html")).toHaveAttribute("data-theme", "dark");
  await reinstalled.evaluate(() => window.ideaAgentSetTheme("light"));
  await expect(reinstalled.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(appearance(reinstalled)).toHaveValue("system");
  assert.equal(await reinstalled.evaluate(() => localStorage.getItem("mindfs-appearance-mode")), "system");
  await language(reinstalled).selectOption("en-US");
  assert.deepEqual(await reinstalled.evaluate(() => window.__hostPosts.at(-1)), { action: "setLocale", locale: "en-US" });

  const stale = await open(43113, "zh-CN", "dark");
  await injectHost(stale, "en-US", "system", "light");
  await expect(language(stale)).toHaveValue("en-US");
  await expect(appearance(stale)).toHaveValue("system");
  await expect(stale.locator("html")).toHaveAttribute("data-theme", "light");
  assert.deepEqual(await stale.evaluate(() => window.__hostPosts), [], "stale web storage must not overwrite the IDE preference");

  const legacy = await open(43114, "zh-CN", "dark");
  await injectHost(legacy, null);
  await expect(language(legacy)).toHaveValue("zh-CN");
  await expect(appearance(legacy)).toHaveValue("dark");
  assert.deepEqual(await legacy.evaluate(() => window.__hostPosts.sort((a, b) => a.action.localeCompare(b.action))),
    [{ action: "setAppearance", appearance: "dark" }, { action: "setLocale", locale: "zh-CN" }], "migrate both explicit preferences");

  const early = await open(43115);
  for (const mode of ["dark", "light", "dark"]) await appearance(early).selectOption(mode);
  await language(early).selectOption("zh-CN");
  await injectHost(early, "en-US", "light");
  await expect(language(early)).toHaveValue("zh-CN");
  await expect(appearance(early)).toHaveValue("dark");
  assert.deepEqual(await early.evaluate(() => window.__hostPosts.sort((a, b) => a.action.localeCompare(b.action))),
    [{ action: "setAppearance", appearance: "dark" }, { action: "setLocale", locale: "zh-CN" }], "early settings retain the latest choice independently");
});
