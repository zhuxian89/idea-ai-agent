import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("App shows status errors without a retry loop and recovers on Retry", async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { App } from "./src/App";
      import { I18nProvider } from "./src/i18n";
      import { bootstrapService } from "./src/services/bootstrap";
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
  let failStatus=true, statusRequests=0;
  await page.route("**/api/**", route => {
    if (route.request().url().includes("/api/relay/status")) {
      statusRequests++;
      return route.fulfill({status:failStatus?502:200,contentType:"application/json",body:JSON.stringify({e2ee_required:false})});
    }
    return route.fulfill({contentType:"application/json",body:JSON.stringify({dirs:[],agents:[],shells:[],tasks:[],templates:[],items:[]})});
  });
  await page.goto("https://bootstrap.test/n/node/");
  for (const f of bundle.outputFiles.filter(f => f.path.endsWith(".css"))) await page.addStyleTag({content:f.text});
  await page.addScriptTag({content:bundle.outputFiles.find(f => f.path.endsWith(".js")).text});
  const dialog = page.getByRole("dialog", {name:"Connection could not be completed"});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveText("relay_status_failed_502");
  await expect(dialog.locator("input")).toHaveCount(0);
  // Keep the actual App effects running; a failed bootstrap must not retry itself.
  await page.waitForTimeout(400);
  assert.equal(statusRequests, 1);
  assert.equal(new URL(page.url()).hash, "");
  await page.screenshot({path:"/tmp/idea-bootstrap-error-mobile.png"});
  failStatus = false;
  await dialog.getByRole("button", {name:"Retry",exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.bootstrap.snapshot().phase)).toBe("ready");
  assert.equal(statusRequests, 2);
  assert.deepEqual(errors, []);
});
