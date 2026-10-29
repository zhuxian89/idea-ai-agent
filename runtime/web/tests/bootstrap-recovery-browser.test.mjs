import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("App shows connection errors without a retry loop and reuses QR pairing on Retry", async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { App } from "./src/App";
      import { I18nProvider } from "./src/i18n";
      import { bootstrapService } from "./src/services/bootstrap";
      import { e2eeService } from "./src/services/e2ee";
      import "./src/index.css";
      window.handshakes = 0; window.failHandshake = true;
      let unlocked = false;
      const snapshot = e2eeService.snapshot.bind(e2eeService);
      e2eeService.snapshot = () => ({...snapshot(), unlocked});
      e2eeService.ensureSession = async () => {
        if (unlocked) return;
        window.handshakes++;
        if (window.failHandshake) throw new Error("Failed to fetch");
        unlocked = true;
      };
      e2eeService.protectedFetch = async (url, init) => {
        await e2eeService.ensureSession();
        return fetch(url, init);
      };
      e2eeService.parseProtectedJSONResponse = response => response.json();
      window.bootstrap = bootstrapService;
      createRoot(document.getElementById("root")).render(<I18nProvider><App /></I18nProvider>);
    ` }, bundle: true, write: false, outdir: "/tmp/idea-bootstrap-browser", format: "iife", jsx: "automatic",
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "en-US", viewport: {width:375,height:812} });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://bootstrap.test/**", route => route.fulfill({contentType:"text/html",body:'<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>'}));
  await page.route("**/api/**", route => route.fulfill({contentType:"application/json",body:JSON.stringify(
    route.request().url().includes("/api/relay/status") ? {e2ee_required:true,e2ee_node_id:"fixture-node"} : {dirs:[],agents:[],shells:[],tasks:[],templates:[],items:[]}
  )}));
  await page.goto("https://bootstrap.test/n/node/#mindfs_pairing=scan-key");
  for (const f of bundle.outputFiles.filter(f => f.path.endsWith(".css"))) await page.addStyleTag({content:f.text});
  await page.addScriptTag({content:bundle.outputFiles.find(f => f.path.endsWith(".js")).text});
  const dialog = page.getByRole("dialog", {name:"Connection could not be completed"});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveText("Failed to fetch");
  await expect(dialog.locator("input")).toHaveCount(0);
  // Keep the actual App effects running; a failed bootstrap must not retry itself.
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.handshakes), 1);
  assert.equal(new URL(page.url()).hash, "");
  await page.screenshot({path:"/tmp/idea-bootstrap-error-mobile.png"});
  await page.evaluate(() => {window.failHandshake = false;});
  await dialog.getByRole("button", {name:"Retry",exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.bootstrap.snapshot().phase)).toBe("ready");
  assert.equal(await page.evaluate(() => window.handshakes), 2);
  assert.deepEqual(errors, []);
});
