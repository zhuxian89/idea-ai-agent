import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const webDir = fileURLToPath(new URL("../../", import.meta.url));

export async function mount(
  t,
  contents,
  handleRequest,
  width = 900,
  path = "/",
  head = "",
) {
  const bundle = await build({
    stdin: {
      resolveDir: webDir,
      loader: "tsx",
      contents: `
      import React, { useState, useRef, useEffect, useCallback } from "react";
      import { createRoot } from "react-dom/client";
      import { I18nProvider, useI18n } from "./src/i18n";
      import { bootstrapService } from "./src/services/bootstrap";
      import { e2eeService } from "./src/services/e2ee";
      bootstrapService.canUseProtectedAPI = () => true;
      e2eeService.isRequired = () => false;
      e2eeService.protectedFetch = (input, init) => fetch(input, init);
      e2eeService.parseProtectedJSONResponse = response => response.json();
      ${contents}
      createRoot(document.getElementById("root")).render(<I18nProvider><Fixture /></I18nProvider>);
    `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": "{}",
    },
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({
    locale: "en-US",
    viewport: { width, height: 850 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "document") {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head>${head}</head><body style="margin:16px;font:14px system-ui;--text-color:#222;--text-primary:#222;--text-secondary:#666;--border-color:#ccc;--menu-bg:#fff;--input-bg:#fff;--accent-color:#2563eb"><div id="root"></div></body></html>`,
      });
    }
    const result = await handleRequest(route.request());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto(`https://app-components.test${path}`);
  await page.evaluate(() => localStorage.setItem("mindfs-locale", "en-US"));
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return page;
}
