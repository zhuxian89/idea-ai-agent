import assert from "node:assert/strict";
import { createCipheriv, createECDH, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite";
import { chromium, expect } from "@playwright/test";

const hash = value => createHash("sha256").update(value).digest();
const proof = (key, ...parts) => createHmac("sha256", key).update(hash(parts.join("\x1f"))).digest("base64");

test("shipped HTML entry pairs the computer, unlocks projects with separate keys, and preserves local/legacy entry", async t => {
  // The same browser check can also run against files extracted from a ZIP.
  const outDir = process.env.IDEA_REMOTE_ENTRY_DIST || await mkdtemp(path.join(os.tmpdir(), "idea-remote-entry-"));
  if (!process.env.IDEA_REMOTE_ENTRY_DIST) {
    t.after(() => rm(outDir, { recursive: true, force: true }));
    await build({ root: fileURLToPath(new URL("../", import.meta.url)), logLevel: "silent", build: { outDir, emptyOutDir: true } });
  }
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "en-US" });
  const errors = [], opens = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  const sessions = new Map();
  await page.route("https://entry.test/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const project = /^\/n\/N\/p\/([AB])\//.exec(url.pathname)?.[1];
    const canonical = url.pathname.replace(/^\/n\/[^/]+/, "");
    const api = url.pathname.replace(/^\/n\/[^/]+(?:\/p\/[^/]+)?/, "");
    const legacy = url.pathname.startsWith("/n/legacy/");
    const local = !url.pathname.startsWith("/n/");
    const nodeId = project ? `project-${project}` : legacy ? "legacy-node" : "computer-node";
    const secret = project ? `project-secret-${project}` : legacy ? "legacy-secret" : "computer-secret";
    const headers = request.headers();
    const json = (payload, status = 200, extra = {}) => route.fulfill({ status, contentType: "application/json", headers: extra, body: JSON.stringify(payload) });
    if (api.startsWith("/api/")) {
      requests.push(url.pathname);
      if (api === "/api/e2ee/open") {
        const input = request.postDataJSON();
        assert.equal(input.node_id, nodeId);
        assert.equal(input.proof, proof(secret, "mindfs-e2ee-open", nodeId, input.client_eph_pk, input.client_nonce));
        const ecdh = createECDH("prime256v1"), publicKey = ecdh.generateKeys().toString("base64");
        const nonce = randomBytes(16).toString("base64");
        const shared = ecdh.computeSecret(Buffer.from(input.client_eph_pk, "base64"));
        const master = hkdfSync("sha256", shared, hash(secret), hash([nodeId, input.client_eph_pk, publicKey, input.client_nonce, nonce].join("\x1f")), 32);
        sessions.set(`${nodeId}:${input.client_id}`, Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "transport", 32)));
        opens.push(nodeId);
        return json({ ok: true, node_eph_pk: publicKey, server_nonce: nonce,
          server_proof: proof(secret, "mindfs-e2ee-accept", nodeId, input.client_eph_pk, publicKey, input.client_nonce, nonce) });
      }
      let payload = { dirs: [], agents: [], shells: [], tasks: [], templates: [], items: [] };
      if (api === "/api/relay/status") payload = { remote_host: !project && !legacy && !local, e2ee_required: !local, e2ee_node_id: nodeId, node_name: "Test computer" };
      else if (api === "/api/remote/projects") payload = { projects: ["A", "B"].map(id => ({ project_id: id, name: `Project ${id}`, label: "", availability: "online" })) };
      else if (/^\/api\/remote\/projects\/[AB]\/access$/.test(api)) {
        const id = api.split("/").at(-2);
        payload = { project_id: id, e2ee_node_id: `project-${id}`, pairing_secret: `project-secret-${id}` };
      }
      if (!headers["x-mindfs-e2ee"]) {
        assert.ok(local || api === "/api/relay/status", `unprotected API: ${url.pathname}`);
        return json(payload);
      }
      const key = sessions.get(`${nodeId}:${headers["x-mindfs-client-id"]}`);
      assert.ok(key, "request must use the matching computer/project session");
      assert.equal(headers["x-mindfs-proof"], proof(key, "mindfs-request-proof", request.method(), canonical + url.search, headers["x-mindfs-ts"], headers["x-mindfs-client-id"]));
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()]);
      return json({ nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64") }, 200, { "X-MindFS-E2EE": "1" });
    }
    const file = api === "/" ? "index.html" : api.slice(1);
    const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
    return route.fulfill({ contentType, body: await readFile(path.join(outDir, file)) });
  });
  // A QR link carries the computer key, never the project key.
  await page.goto("https://entry.test/n/N/p/A/#mindfs_pairing=computer-secret");
  await expect(page.getByRole("button", { name: "Project A ▾" })).toBeVisible();
  await expect.poll(() => requests.includes("/n/N/p/A/api/dirs")).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal(new URL(page.url()).hash, "");
  assert.deepEqual(opens, ["computer-node", "project-A"]);
  await page.getByRole("button", { name: "Project A ▾" }).click();
  await page.getByRole("button", { name: "Project B Online" }).click();
  await expect(page.getByRole("button", { name: "Project B ▾" })).toBeVisible();
  await expect.poll(() => requests.includes("/n/N/p/B/api/dirs")).toBe(true);
  assert.deepEqual(opens, ["computer-node", "project-A", "computer-node", "project-B"]);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("mindfs.e2ee.secret."))), ["mindfs.e2ee.secret.computer-node"]);
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
  await expect(page.getByRole("heading", { name: "Use the access link from IDEA" })).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  await page.goto("https://entry.test/n/N/#mindfs_pairing=computer-secret");
  await expect(page.getByRole("button", { name: "Project A Online" })).toBeVisible();
  await page.goto("https://entry.test/n/legacy/");
  await expect(page.getByRole("heading", { name: "Use the access link from IDEA" })).toBeVisible();
  await expect(page.getByRole("dialog").locator("input")).toHaveCount(0);
  await page.goto("https://entry.test/n/legacy/#mindfs_pairing=legacy-secret");
  await expect.poll(() => requests.includes("/n/legacy/api/dirs")).toBe(true);
  await expect(page.getByRole("navigation", { name: "Remote project" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const beforeLocal = opens.length;
  await page.goto("https://entry.test/");
  await expect.poll(() => requests.includes("/api/dirs")).toBe(true);
  await expect(page.getByRole("navigation", { name: "Remote project" })).toHaveCount(0);
  assert.equal(opens.length, beforeLocal);
  assert.deepEqual(errors, []);
});
