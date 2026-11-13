import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const webDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const styles = ["src/index.css", "src/ide.css"].map(file => readFileSync(path.join(webDir, file), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, "")).join("\n");

async function open(t) {
  const bundle = await build({ entryPoints: [path.join(webDir, "tests/fixtures/session-settings-change.tsx")],
    bundle: true, write: false, outdir: "/tmp/session-settings-change-fixture", platform: "browser", format: "iife", jsx: "automatic", external: ["mermaid"],
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' } });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "en-US", viewport: { width: 900, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  page.setDefaultTimeout(5000);
  await page.route("http://settings.test/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>' }));
  await page.goto("http://settings.test");
  await page.addStyleTag({ content: styles + "\n#fixture { height: 100vh; min-width: 0; }" });
  for (const file of bundle.outputFiles.filter(file => file.path.endsWith(".css"))) await page.addStyleTag({ content: file.text });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js")).text });
  return page;
}

test("a notice names every setting that changed, and only where it changed", async (t) => {
  const page = await open(t);
  const notices = page.locator("[data-session-settings-change]");
  await expect(page.getByText("all three change")).toBeVisible();
  await expect(notices).toHaveCount(1);
  await expect(notices).toHaveText(
    "Switched from this message: Model Model 1 → Model 2 · Reasoning effort high → low · Fast mode Off → On");
  // The notice belongs to the message that was sent with the new settings.
  const owner = page.locator("[data-user-message-index]", { has: notices });
  await expect(owner).toContainText("all three change");
});
