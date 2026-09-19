import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const webDir = fileURLToPath(new URL("../", import.meta.url));
const reports = path.resolve(webDir, "../../build/reports/session-search");
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("IDE history keeps a full-width search field and filters on the first character", { timeout: 120_000 }, async (t) => {
  mkdirSync(reports, { recursive: true });
  const bundle = await build({
    stdin: {
      resolveDir: webDir,
      sourcefile: "session-search-fixture.tsx",
      loader: "tsx",
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { I18nProvider } from "./src/i18n";
        import { SessionList } from "./src/components/SessionList";

        const sessions = [
          { key: "voice", session_key: "voice", name: "Voice notes", agent: "codex", type: "chat", updated_at: "2026-09-19T10:00:00Z" },
          { key: "attachments", session_key: "attachments", name: "Attachment support", agent: "codex", type: "chat", updated_at: "2026-09-19T09:00:00Z" },
        ];
        window.__queryEvents = [];
        function Fixture() {
          const [query, setQuery] = useState("");
          const normalized = query.trim().toLowerCase();
          const visible = normalized ? sessions.filter((session) => session.name.toLowerCase().includes(normalized)) : sessions;
          return <I18nProvider><div className="idea-workbench" style={{height:480}}>
            <SessionList
              persistentSearch
              sessions={visible}
              searchQuery={query}
              searchResultsMode={!!normalized}
              emptyText="没有匹配的会话"
              headerAction={<button type="button" className="idea-icon-button" aria-label="导入会话" title="导入会话">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
              </button>}
              onSearchQueryChange={(value) => { window.__queryEvents.push(value); setQuery(value); }}
            />
          </div></I18nProvider>;
        }
        createRoot(document.getElementById("root")).render(<Fixture />);
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
  });

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 900, height: 480 }, reducedMotion: "reduce" });
  t.after(() => context.close());
  await context.route("**/*", (route) => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="dark"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' })
    : route.fulfill({ status: 404, body: "" }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://session-search.test");
  await page.evaluate(() => localStorage.setItem("mindfs-locale", "zh-CN"));
  await page.addStyleTag({
    content: ["src/index.css", "src/ide.css"]
      .map((file) => readFileSync(path.join(webDir, file), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, ""))
      .join("\n"),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const input = page.getByRole("searchbox", { name: "搜索会话" });
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: "搜索会话" })).toHaveCount(0);
  await input.click();
  await expect(input).toBeFocused();
  const searchField = page.locator(".mindfs-session-search-field");
  await expect(searchField).toHaveCSS("border-top-color", "rgb(145, 175, 255)");
  const focusStyles = await searchField.evaluate((field) => {
    const input = field.querySelector("input");
    const fieldStyles = getComputedStyle(field);
    const inputStyles = getComputedStyle(input);
    const accentProbe = document.createElement("span");
    accentProbe.style.color = "var(--accent-color)";
    field.appendChild(accentProbe);
    const accentColor = getComputedStyle(accentProbe).color;
    accentProbe.remove();
    return {
      focusWithin: field.matches(":focus-within"),
      borderTopWidth: fieldStyles.borderTopWidth,
      borderTopColor: fieldStyles.borderTopColor,
      accentColor,
      boxShadow: fieldStyles.boxShadow,
      outlineStyle: inputStyles.outlineStyle,
    };
  });
  assert.equal(focusStyles.focusWithin, true, JSON.stringify(focusStyles));
  assert.equal(focusStyles.borderTopWidth, "1px");
  assert.equal(focusStyles.borderTopColor, focusStyles.accentColor, JSON.stringify(focusStyles));
  assert.equal(focusStyles.boxShadow, "none");
  assert.equal(focusStyles.outlineStyle, "none");
  const layout = await page.locator('[role="search"]').evaluate((node) => {
    const field = node.querySelector(".mindfs-session-search-field").getBoundingClientRect();
    const action = node.querySelector('[aria-label="导入会话"]').getBoundingClientRect();
    return { field: { width: field.width, height: field.height, top: field.top }, action: { top: action.top } };
  });
  assert.equal(layout.field.height, 40);
  assert.ok(layout.field.width > 800, `expected a full-width field, received ${layout.field.width}px`);
  assert.ok(Math.abs(layout.field.top - layout.action.top) <= 4, "search and history action should share one row");

  await input.fill("V");
  await expect(page.getByText("Voice notes", { exact: true })).toBeVisible();
  await expect(page.getByText("Attachment support", { exact: true })).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => window.__queryEvents), ["V"]);
  await expect(page.getByRole("button", { name: "清空搜索" })).toBeVisible();
  await page.screenshot({ path: path.join(reports, "dark-900.png"), fullPage: true });

  await page.getByRole("button", { name: "清空搜索" }).click();
  await expect(page.getByText("Voice notes", { exact: true })).toBeVisible();
  await expect(page.getByText("Attachment support", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 420, height: 480 });
  await page.locator("html").evaluate((node) => node.setAttribute("data-theme", "light"));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const lightTheme = await page.locator(".idea-workbench").evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      content: styles.getPropertyValue("--content-bg").trim(),
      text: styles.getPropertyValue("--text-primary").trim(),
      topbar: styles.getPropertyValue("--mindfs-topbar-bg").trim(),
    };
  });
  assert.deepEqual(lightTheme, { theme: "light", content: "#ffffff", text: "#252933", topbar: "#ffffff" });
  const narrowField = await page.locator(".mindfs-session-search-field").boundingBox();
  assert.ok(narrowField && narrowField.width > 330, `search field is too narrow: ${narrowField?.width}px`);
  await page.screenshot({ path: path.join(reports, "light-420.png"), fullPage: true });
  assert.deepEqual(errors, []);
});
