import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Run from runtime/web: node --test tests/menu-controls.test.mjs
// No server, generated bundle files, browser downloads, or application/backend startup.
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

async function bundleFixture() {
  const result = await build({
    stdin: {
      resolveDir: webDir,
      sourcefile: "menu-controls-fixture.tsx",
      loader: "tsx",
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { PermissionSelector } from "./src/components/PermissionSelector";
        import { AgentSelector } from "./src/components/AgentSelector";
        import { enUS } from "./src/i18n/locales/en-US";

        const options = window.__fixtureOptions;
        const choices = [
          { id: "default", label: enUS["permission.standard"] },
          { id: "acceptEdits", label: enUS["permission.acceptEdits"] },
          { id: "bypassPermissions", label: enUS["permission.full"] },
        ];
        // An unbranded fixture agent uses the real AgentIcon fallback (no fetch).
        const agents = [{
          name: "fixture", available: true,
          models: [{ id: "test-model", name: "Test model", supportEffort: true, efforts: ["high", "xhigh"] }],
          default_model_id: "test-model", current_model_id: "test-model",
          modes: [{ id: "default", name: "Standard" }, { id: "bypassPermissions", name: "bypassPermissions" }],
          efforts: ["high", "xhigh"], default_effort: "high", supports_fast_service: true,
        }];
        agents.push({ ...agents[0], name: "second-fixture" });
        if (options.distinctModes) {
          agents[0].modes = [{ id: "full-access", name: "First full access" }];
          agents[1].modes = [{ id: "bypassPermissions", name: "Second full access" }, { id: "default", name: "Standard" }];
        }
        function Fixture() {
          const [value, setValue] = useState(options.value || "default");
          const [disabled, setDisabled] = useState(options.disabled || false);
          const [agent, setAgent] = useState("fixture");
          const [model, setModel] = useState("test-model");
          const [effort, setEffort] = useState(options.effort || "high");
          const [mode, setMode] = useState(options.distinctModes ? "full-access" : "bypassPermissions");
          const [fastService, setFastService] = useState("off");
          const [changes, setChanges] = useState([]);
          window.__menuFixture = { setDisabled };
          return <main className="idea-workbench">
            <div id="fixture-state">
              <output data-testid="value">{value}</output>
              <output data-testid="changes">{JSON.stringify(changes)}</output>
              <output data-testid="agent">{agent}</output>
              <output data-testid="mode">{mode}</output>
            </div>
            <div id="fixture-controls" style={{ justifyContent: options.edge === "right" ? "flex-end" : "flex-start" }}>
              <button data-testid="before">Before</button>
              {options.kind === "agent" ? <AgentSelector
                agent={agent} model={model} mode={mode} effort={effort} agents={agents}
                onAgentChange={(name, nextModel) => {
                  setAgent(name); setModel(nextModel || "");
                  if (options.distinctModes && name !== agent) setMode("");
                }}
                onModeChange={setMode} onEffortChange={setEffort}
                fastService={fastService} onFastServiceChange={setFastService}
                compact showLabel showChevron stableLayout viewportMenu allowDefaultModel
                closeOnSelect={options.closeOnSelect ?? false}
                defaultExpandOptions onboardingId="fixture-agent-selector"
              /> : <PermissionSelector
                value={value} choices={choices} label={enUS["permission.label"]}
                description={enUS["permission.description"]} disabled={disabled}
                onChange={(next) => { setValue(next); setChanges((previous) => [...previous, next]); }}
              />}
              <button data-testid="after">After</button>
            </div>
          </main>;
        }
        createRoot(document.getElementById("root")).render(<Fixture />);
      `,
    },
    bundle: true,
    write: false,
    loader: { ".css": "empty" },
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
    plugins: [{
      name: "isolate-menu-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/i18n$/ }, () => ({ path: "english-i18n", namespace: "fixture" }));
        builder.onLoad({ filter: /^english-i18n$/, namespace: "fixture" }, () => ({
          resolveDir: webDir,
          contents: `import { enUS } from "./src/i18n/locales/en-US";
            export function useI18n() { return { t: (key, params = {}) => {
              if (!(key in enUS)) throw new Error("Missing English message: " + key);
              return enUS[key].replace(/\\{(\\w+)\\}/g, (_, name) => String(params[name] ?? "{" + name + "}"));
            } }; }`,
        }));
        // AgentIcon only needs asset path formatting. Do not import app runtime/IDE services.
        builder.onResolve({ filter: /^\.\.\/services\/base$/ }, () => ({ path: "asset-path", namespace: "fixture" }));
        builder.onLoad({ filter: /^asset-path$/, namespace: "fixture" }, () => ({ contents: "export const appPath = (path) => path;" }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

async function openFixture(browser, bundle, t, options = {}) {
  const context = await browser.newContext({
    viewport: { width: options.width || 400, height: 700 },
    reducedMotion: "reduce", offline: true, serviceWorkers: "block",
  });
  const requests = [];
  const errors = [];
  await context.route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "fixture must not throw browser errors");
    assert.deepEqual(requests, [], "isolated menu fixture must not request any network resource");
  });
  await page.setContent('<!doctype html><html data-theme="dark"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: styles });
  // Only place the host; never override the selectors' menu/text layout rules.
  await page.addStyleTag({ content: `
    #fixture-state { padding: 16px; }
    #fixture-state output { display: block; }
    #fixture-controls { position: fixed; bottom: 20px; left: 0; right: 0; height: 44px;
      display: flex; align-items: center; overflow: hidden; padding: 0 8px; }
    #fixture-controls > button[data-testid] { width: 40px; flex: 0 0 40px; font-size: 10px; }
  ` });
  await page.evaluate((value) => { window.__fixtureOptions = value; }, options);
  await page.addScriptTag({ content: bundle });
  await expect(page.getByTestId("value")).toBeVisible();
  return page;
}

const trigger = (page) => page.getByRole("button", { name: /^Execution permissions:/ });
const listbox = (page) => page.getByRole("listbox", { name: "Execution permissions" });
const option = (page, name) => page.getByRole("option", { name, exact: true });

async function expectPermission(page, value, changes) {
  await expect(page.getByTestId("value")).toHaveText(value);
  await expect(page.getByTestId("changes")).toHaveText(JSON.stringify(changes));
}

async function expectWithinViewport(menu) {
  const rect = await menu.boundingBox();
  assert.ok(rect && rect.width > 0 && rect.height > 0, "menu must have a visible box");
  const viewport = menu.page().viewportSize();
  assert.ok(rect.x >= 7.5, `menu left ${rect.x} must retain its viewport gutter`);
  assert.ok(rect.x + rect.width <= viewport.width - 7.5, `menu right ${rect.x + rect.width} exceeds viewport ${viewport.width}`);
  assert.ok(await menu.evaluate((node) => document.documentElement.scrollWidth <= window.innerWidth), "document must not scroll horizontally");
}

async function expectUnclippedText(locator) {
  await expect(locator).toBeVisible();
  const metrics = await locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    return {
      text: node.textContent, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
      textOverflow: style.textOverflow, whiteSpace: style.whiteSpace, direction: style.direction,
      outside: Array.from(range.getClientRects()).some((line) =>
        line.left < rect.left - 1 || line.right > rect.right + 1 || line.top < rect.top - 1 || line.bottom > rect.bottom + 1),
    };
  });
  const detail = JSON.stringify(metrics);
  assert.ok(metrics.clientWidth > 0 && metrics.scrollWidth <= metrics.clientWidth + 1, detail);
  assert.ok(metrics.scrollHeight <= metrics.clientHeight + 1, detail);
  assert.notEqual(metrics.textOverflow, "ellipsis", detail);
  assert.notEqual(metrics.whiteSpace, "nowrap", detail);
  assert.equal(metrics.direction, "ltr", detail);
  assert.equal(metrics.outside, false, detail);
}

test("isolated menu controls in headless Chromium", { timeout: 90_000 }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) {
    t.skip("Playwright Chromium is not installed (including the local cache); no browser was downloaded.");
    return;
  }
  t.after(() => browser.close());
  t.diagnostic(`Running local headless Chromium ${browser.version()}; real selectors, English locale, and IDE CSS.`);
  const bundle = await bundleFixture();

  await t.test("permission portal opens above an overflow:hidden host and opening never grants permissions", async (t) => {
    const page = await openFixture(browser, bundle, t);
    await trigger(page).click();
    await expect(listbox(page)).toBeVisible();
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
    await expect(trigger(page)).toHaveAttribute("aria-controls", await listbox(page).getAttribute("id"));
    await expect(option(page, "Standard")).toBeFocused();
    await expectPermission(page, "default", []);
    const buttonRect = await trigger(page).boundingBox();
    const menuRect = await listbox(page).boundingBox();
    const hostRect = await page.locator("#fixture-controls").boundingBox();
    assert.ok(menuRect.y + menuRect.height <= buttonRect.y - 5, "menu must open above the trigger with a gap");
    assert.ok(menuRect.y < hostRect.y, "menu must extend outside the clipping host");
    assert.equal(await page.locator("#fixture-controls").evaluate((node) => getComputedStyle(node).overflow), "hidden");
    assert.equal(await listbox(page).evaluate((node) => node.parentElement === document.body), true, "menu must portal to body");
    for (const name of ["Standard", "Accept edits", "Full access"]) {
      assert.equal(await option(page, name).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), true, `${name} must be hit-testable, not merely present beyond overflow:hidden`);
    }
    await page.getByTestId("value").click();
    await expect(listbox(page)).toHaveCount(0);
    await expectPermission(page, "default", []);
  });

  await t.test("choosing a permission updates its controlled value, closes, and restores focus", async (t) => {
    const page = await openFixture(browser, bundle, t);
    await trigger(page).click();
    await option(page, "Full access").click();
    await expectPermission(page, "bypassPermissions", ["bypassPermissions"]);
    await expect(listbox(page)).toHaveCount(0);
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
    await expect(trigger(page)).toHaveAccessibleName("Execution permissions: Full access");
    await expect(trigger(page)).toBeFocused();
    await trigger(page).click();
    await expect(option(page, "Full access")).toHaveAttribute("aria-selected", "true");
    await expect(option(page, "Full access")).toBeFocused();
    await expectPermission(page, "bypassPermissions", ["bypassPermissions"]);
  });

  await t.test("Arrow keys, Home, End, Enter, and Escape preserve focus and commit only on selection", async (t) => {
    const page = await openFixture(browser, bundle, t);
    await trigger(page).focus();
    await page.keyboard.press("ArrowDown");
    await expect(option(page, "Standard")).toBeFocused();
    for (const [key, name] of [
      ["ArrowUp", "Full access"], ["ArrowDown", "Standard"], ["ArrowDown", "Accept edits"],
      ["End", "Full access"], ["Home", "Standard"], ["ArrowUp", "Full access"],
    ]) {
      await page.keyboard.press(key);
      await expect(option(page, name)).toBeFocused();
      await expectPermission(page, "default", []);
    }
    await page.keyboard.press("Escape");
    await expect(listbox(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    await expectPermission(page, "default", []);
    await page.keyboard.press("ArrowUp");
    await expect(option(page, "Standard")).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expectPermission(page, "bypassPermissions", ["bypassPermissions"]);
    await expect(listbox(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });

  await t.test("Tab and Shift+Tab dismiss without changing permissions or trapping focus", async (t) => {
    const page = await openFixture(browser, bundle, t);
    for (const [key, target] of [["Tab", "after"], ["Shift+Tab", "before"]]) {
      await trigger(page).focus();
      await page.keyboard.press("Enter");
      await expect(option(page, "Standard")).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press(key);
      await expect(listbox(page)).toHaveCount(0);
      await expect(page.getByTestId(target)).toBeFocused();
      await expectPermission(page, "default", []);
    }
  });

  await t.test("disabled permissions cannot open and disabling an open menu removes it", async (t) => {
    const page = await openFixture(browser, bundle, t, { disabled: true });
    await expect(trigger(page)).toBeDisabled();
    const rect = await trigger(page).boundingBox();
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.keyboard.press("ArrowDown");
    await expect(listbox(page)).toHaveCount(0);
    await page.getByTestId("before").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("after")).toBeFocused();
    await page.evaluate(() => window.__menuFixture.setDisabled(false));
    await expect(trigger(page)).toBeEnabled();
    await trigger(page).click();
    await expect(listbox(page)).toBeVisible();
    await page.evaluate(() => window.__menuFixture.setDisabled(true));
    await expect(trigger(page)).toBeDisabled();
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
    await expect(listbox(page)).toHaveCount(0);
    await expectPermission(page, "default", []);
    await page.evaluate(() => window.__menuFixture.setDisabled(false));
    await expect(trigger(page)).toBeEnabled();
    await expect(listbox(page)).toHaveCount(0);
  });

  await t.test("IDE Agent selections keep the panel open for configuring the next option", async (t) => {
    const page = await openFixture(browser, bundle, t, { kind: "agent" });
    const button = page.locator('[data-onboarding="fixture-agent-selector"] > button');
    const menu = page.locator('[data-agent-menu="true"]');
    await button.click();
    await menu.getByText("second-fixture", { exact: true }).click();
    await expect(menu).toBeVisible();
    await expect(button).toContainText("second-fixture");
    await menu.getByRole("button", { name: "Test model", exact: true }).click();
    await expect(menu).toBeVisible();
    await expect(button).toContainText("test-model");
    await menu.getByText("second-fixture", { exact: true }).click();
    await expect(button).toContainText("test-model");
    await expect(menu).toBeVisible();

    await menu.getByRole("button", { name: /^Mode / }).click();
    await menu.getByRole("button", { name: "Standard", exact: true }).click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "Mode default", exact: true })).toHaveAttribute("aria-expanded", "true");
    await menu.getByRole("button", { name: /^Reasoning effort / }).click();
    await menu.getByRole("button", { name: "xhigh", exact: true }).click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "Reasoning effort xhigh", exact: true })).toHaveAttribute("aria-expanded", "true");
    await menu.getByRole("button", { name: /^Fast mode / }).click();
    await menu.getByRole("button", { name: "On", exact: true }).click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "Fast mode On", exact: true })).toHaveAttribute("aria-expanded", "true");

    await menu.getByRole("button", { name: "Collapse second-fixture model list", exact: true }).click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "Expand second-fixture model list", exact: true })).toBeVisible();
    await button.click();
    await expect(menu).toHaveCount(0);
    await button.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
    await button.click();
    await page.getByTestId("before").click();
    await expect(menu).toHaveCount(0);
  });

  for (const closeOnSelect of [false, true]) {
    await t.test(`a mode from another Agent selects that Agent before its mode (close=${closeOnSelect})`, async (t) => {
      const page = await openFixture(browser, bundle, t, { kind: "agent", distinctModes: true, closeOnSelect });
      const button = page.locator('[data-onboarding="fixture-agent-selector"] > button');
      const menu = page.locator('[data-agent-menu="true"]');
      await button.click();
      await menu.getByRole("button", { name: "Expand second-fixture model list", exact: true }).click();
      await expect(page.getByTestId("agent")).toHaveText("fixture");
      await menu.getByRole("button", { name: /^Mode\b/ }).click();
      await menu.getByRole("button", { name: "Second full access", exact: true }).click();
      await expect(page.getByTestId("agent")).toHaveText("second-fixture");
      await expect(page.getByTestId("mode")).toHaveText("bypassPermissions");
      if (closeOnSelect) await button.click();
      await menu.getByRole("button", { name: "Expand fixture model list", exact: true }).click();
      await menu.getByRole("button", { name: /^Mode\b/ }).click();
      await menu.getByRole("button", { name: "First full access", exact: true }).click();
      await expect(page.getByTestId("agent")).toHaveText("fixture");
      await expect(page.getByTestId("mode")).toHaveText("full-access");
    });
  }

  await t.test("Agent selector clients can still opt into closing after selection", async (t) => {
    const page = await openFixture(browser, bundle, t, { kind: "agent", closeOnSelect: true });
    await page.locator('[data-onboarding="fixture-agent-selector"] > button').click();
    const menu = page.locator('[data-agent-menu="true"]');
    await menu.getByText("second-fixture", { exact: true }).click();
    await expect(menu).toHaveCount(0);
  });

  for (const width of [320, 400]) {
    for (const edge of ["left", "right"]) {
      await t.test(`permission menu stays within a ${width}px viewport at the ${edge} edge`, async (t) => {
        const page = await openFixture(browser, bundle, t, { width, edge });
        await trigger(page).click();
        await expect(listbox(page)).toBeVisible();
        await expectWithinViewport(listbox(page));
        await page.setViewportSize({ width: width === 400 ? 320 : 400, height: 700 });
        await expect.poll(async () => {
          const rect = await listbox(page).boundingBox();
          return rect.x >= 7.5 && rect.x + rect.width <= page.viewportSize().width - 7.5;
        }).toBe(true);
        await expectWithinViewport(listbox(page));
      });
    }
    for (const effort of ["high", "xhigh"]) {
      await t.test(`AgentSelector at ${width}px shows reasoning effort=${effort} and mode=bypassPermissions without truncation`, async (t) => {
        const page = await openFixture(browser, bundle, t, { kind: "agent", width, effort });
        await page.locator('[data-onboarding="fixture-agent-selector"] > button').click();
        const menu = page.locator('[data-agent-menu="true"]');
        await expect(menu).toBeVisible();
        await expectWithinViewport(menu);
        for (const [title, value] of [["Reasoning effort", effort], ["Mode", "bypassPermissions"]]) {
          const header = menu.getByRole("button", { name: `${title} ${value}`, exact: true });
          await expect(header).toHaveAttribute("aria-expanded", "false");
          await expectUnclippedText(header.locator(":scope > span").first());
          await expectUnclippedText(header.locator("span[title]").filter({ hasText: value }));
          await header.click();
          await expect(header).toHaveAttribute("aria-expanded", "true");
          await expectUnclippedText(header.locator("span[title]").filter({ hasText: value }));
          await header.click();
        }
      });
    }
  }
});
