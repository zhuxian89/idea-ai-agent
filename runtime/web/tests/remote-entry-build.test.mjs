import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite";
import { chromium, expect } from "@playwright/test";

test("shipped HTML opens Relay nodes and projects without pairing and preserves local entry", async t => {
  // The same browser check can also run against files extracted from a ZIP.
  const outDir = process.env.IDEA_REMOTE_ENTRY_DIST || await mkdtemp(path.join(os.tmpdir(), "idea-remote-entry-"));
  if (!process.env.IDEA_REMOTE_ENTRY_DIST) {
    t.after(() => rm(outDir, { recursive: true, force: true }));
    await build({ root: fileURLToPath(new URL("../", import.meta.url)), logLevel: "silent", build: { outDir, emptyOutDir: true } });
  }
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "en-US" });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://entry.test/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const project = /^\/n\/N\/p\/([AB])\//.exec(url.pathname)?.[1];
    const api = url.pathname.replace(/^\/n\/[^/]+(?:\/p\/[^/]+)?/, "");
    const legacy = url.pathname.startsWith("/n/legacy/");
    const local = !url.pathname.startsWith("/n/");
    const headers = request.headers();
    const json = (payload, status = 200, extra = {}) => route.fulfill({ status, contentType: "application/json", headers: extra, body: JSON.stringify(payload) });
    if (api.startsWith("/api/")) {
      requests.push(url.pathname);
      assert.equal(api.includes("/e2ee/") || api.endsWith("/access"), false, `unexpected browser authorization: ${api}`);
      assert.equal(headers["x-mindfs-e2ee"], undefined);
      assert.equal(headers["x-mindfs-proof"], undefined);
      let payload = { dirs: [], agents: [], shells: [], tasks: [], templates: [], items: [] };
      if (api === "/api/relay/status") payload = { remote_host: !project && !legacy && !local, e2ee_required: false, node_name: "Test computer" };
      else if (api === "/api/remote/projects") payload = { projects: ["A", "B"].map(id => ({ project_id: id, name: `Project ${id}`, label: "", availability: "online" })) };
      return json(payload);
    }
    const file = api === "/" ? "index.html" : api.slice(1);
    const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
    return route.fulfill({ contentType, body: await readFile(path.join(outDir, file)) });
  });
  // The Relay homepage and plain project links need no browser pairing data.
  await page.goto("https://entry.test/n/N/p/A/");
  await expect(page.getByRole("button", { name: "Project A ▾" })).toBeVisible();
  await expect.poll(() => requests.includes("/n/N/p/A/api/dirs")).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal(new URL(page.url()).hash, "");
  await page.getByRole("button", { name: "Project A ▾" }).click();
  await page.getByRole("button", { name: "Project B Online" }).click();
  await expect(page.getByRole("button", { name: "Project B ▾" })).toBeVisible();
  await expect.poll(() => requests.includes("/n/N/p/B/api/dirs")).toBe(true);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("mindfs.e2ee.secret."))), []);
  // Returning from either project or the relay node list must show the same
  // complete catalog without requiring another access link or pairing input.
  await page.getByRole("button", { name: "Project B ▾" }).click();
  await expect(page.getByRole("button", { name: "Project A Online" })).toBeVisible();
  await page.getByRole("button", { name: "All projects", exact: true }).click();
  await expect(page.getByRole("button", { name: "Project A Online" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Project B Online" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Project A Online" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Project B Online" })).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  await page.evaluate(() => localStorage.clear());
  await page.goto("https://entry.test/n/N/");
  await expect(page.getByRole("button", { name: "Project A Online" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Project B Online" })).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  await page.goto("https://entry.test/n/legacy/");
  await expect.poll(() => requests.includes("/n/legacy/api/dirs")).toBe(true);
  await expect(page.getByRole("navigation", { name: "Remote project" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("https://entry.test/");
  await expect.poll(() => requests.includes("/api/dirs")).toBe(true);
  await expect(page.getByRole("navigation", { name: "Remote project" })).toHaveCount(0);
  assert.deepEqual(errors, []);
});
