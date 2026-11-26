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
  let standalone = false;
  let publishedVersion = "0.1.59";
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
      else if (api === "/api/standalone/latest") return publishedVersion
        ? json({ version: publishedVersion }) : json({ error: "Could not read the published version" }, 502);
      return json(payload);
    }
    const file = api === "/" ? "index.html" : api.slice(1);
    const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
    const body = await readFile(path.join(outDir, file));
    return route.fulfill({ contentType, body: standalone && file === "index.html"
      ? body.toString().replace("</head>", '<meta name="local-ai-agent-mode" content="standalone"><meta name="local-ai-agent-version" content="0.1.58"></head>')
      : body });
  });
  // The Relay homepage and plain project links need no browser pairing data.
  await page.goto("https://entry.test/n/N/p/A/");
  const resourcePaths = await page.locator("script[src], link[href]").evaluateAll(elements =>
    elements.map(element => new URL(element.getAttribute("src") || element.getAttribute("href"), location.href).pathname));
  for (const resourcePath of resourcePaths) {
    assert.ok(resourcePath.startsWith("/n/N/p/A/"), `resource escaped the node: ${resourcePath}`);
  }
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

  await t.test("public standalone update checks are available on desktop, tablet, and phone", async () => {
    standalone = true;
    for (const [device, width, height] of [["desktop", 1440, 900], ["tablet", 820, 1180], ["phone", 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`https://entry.test/n/N/p/A/?device=${device}`);
      if (device === "phone") {
        await page.getByRole("button", { name: "Projects", exact: true }).click();
        await page.getByRole("button", { name: "More", exact: true }).click();
      }
      const update = page.getByRole("region", { name: "Standalone updates" });
      await expect(update.getByText("0.1.58", { exact: true })).toBeVisible();
      await expect(update.getByRole("status")).toHaveText("New version: 0.1.59");
      await expect(update.getByRole("button", { name: "Check for updates" })).toBeInViewport();
      await expect(update.getByRole("link", { name: "View release" })).toHaveAttribute("href", /standalone-v0\.1\.59$/);
      await page.getByRole("button", { name: "Connect your phone", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
    }
    const update = page.getByRole("region", { name: "Standalone updates" });
    publishedVersion = "0.1.58";
    await update.getByRole("button", { name: "Check for updates" }).click();
    await expect(update.getByRole("status")).toHaveText("Up to date");
    publishedVersion = "";
    await update.getByRole("button", { name: "Check for updates" }).click();
    await expect(update.getByRole("alert")).toBeVisible();
    assert.equal(requests.some(url => url.includes("/api/idea/remote")), false);
    assert.deepEqual(errors, []);
    standalone = false;
  });

  await t.test("the phone composer follows the visible viewport when a keyboard covers the page", async () => {
    await page.setViewportSize({ width: 430, height: 795 });
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), { width: innerWidth, height: innerHeight, offsetTop: 0 });
      Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
      window.setTestViewport = (height, offsetTop, event) => {
        Object.assign(viewport, { height, offsetTop });
        viewport.dispatchEvent(new Event(event));
      };
    });
    await page.goto("https://entry.test/n/N/p/A/?device=phone");
    const footer = page.locator(".remote-phone-composer");
    const textbox = footer.locator('[contenteditable="true"]');
    await expect(textbox).toBeVisible();
    await expect(footer.getByTitle(/^WebSocket /)).toHaveCount(0);
    await textbox.focus();
    for (const [height, offsetTop, event] of [[432, 0, "resize"], [432, 38, "scroll"], [795, 0, "resize"]]) {
      await page.evaluate(([height, offsetTop, event]) => window.setTestViewport(height, offsetTop, event), [height, offsetTop, event]);
      assert.equal(await page.evaluate(() => innerHeight), 795);
      await expect.poll(async () => {
        const box = await footer.boundingBox();
        return box ? Math.round(box.y + box.height) : null;
      }).toBe(height + offsetTop);
      await expect(textbox).toBeFocused();
    }
  });

  const notices = [];
  page.on("dialog", dialog => {
    notices.push(dialog.message());
    void dialog.dismiss();
  });
  for (const [index, extension] of ["js", "css"].entries()) {
    const pattern = `**/assets/index-*.${extension}`;
    await page.route(pattern, route => route.abort());
    await page.goto("https://entry.test/n/N/");
    await expect.poll(() => notices.length).toBe(index + 1);
    assert.match(notices[index], /^页面资源加载失败，请刷新页面重试。\n/);
    assert.match(notices[index], new RegExp(`/n/N/assets/index-[^/]+\\.${extension}$`));
    await page.unroute(pattern);
  }

  await t.test("the iOS App renews on foreground and only redirects to login on a confirmed 401", async () => {
    await page.addInitScript(() => {
      window.MindFSIOSApp = { platform: "ios" };
    });
    const project = "https://entry.test/n/N/p/A/?device=phone";
    await page.route("https://entry.test/n/N/p/A/api/dirs", route =>
      route.fulfill({ status: 401, json: { error: "unauthorized" } }));
    await page.route("https://entry.test/login?*", route => route.fulfill({ body: "Relay login" }));
    let authStatus = 503;
    let probes = 0;
    await page.route("https://entry.test/api/auth/me", route => {
      probes++;
      return authStatus ? route.fulfill({ status: authStatus, json: { error: "auth_probe" } }) : route.abort("failed");
    });
    for (authStatus of [503, 0]) {
      const previous = probes;
      await page.goto(project);
      await expect.poll(() => probes).toBeGreaterThanOrEqual(previous + 2);
      const login = await page.waitForURL("**/login?*", { timeout: 600 }).then(() => true, () => false);
      assert.equal(login, false, `temporary auth failure (${authStatus}) opened login`);
      await expect(page).toHaveURL(project);
    }
    authStatus = 200;
    const previous = probes;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => probes).toBeGreaterThan(previous);
    authStatus = 401;
    await page.reload();
    await expect(page).toHaveURL(url => url.pathname === "/login" && url.searchParams.get("next") === "/n/N/p/A/?device=phone");
  });
});
