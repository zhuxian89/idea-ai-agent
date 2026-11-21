import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const fixture = `
  import { BarkMenuItem } from "./src/components/notifications/BarkSettings";
  function Fixture() { return <BarkMenuItem />; }
`;

function fakeNode() {
  const state = {
    configured: false,
    key_hint: "",
    server: "https://api.day.app",
    enabled: false,
    types: { approval: true, ask_user: true, failed: true, done: false },
    link_mode: "app",
    has_link: false,
  };
  const calls = [];
  const handler = (request) => {
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.endsWith("/api/bark/test")) {
      calls.push({ method, path: "test" });
      return { ok: true };
    }
    if (method === "PUT") {
      const body = request.postDataJSON();
      calls.push({ method, path: "bark", body });
      if (typeof body.device_key === "string") {
        state.configured = body.device_key !== "";
        state.key_hint = state.configured ? "…9xyz" : "";
        if (!state.configured) state.enabled = false;
      }
      if (typeof body.enabled === "boolean") state.enabled = body.enabled;
      if (body.types) Object.assign(state.types, body.types);
      if (body.open_base) state.has_link = true;
      if (body.link_mode) state.link_mode = body.link_mode;
    }
    return { ...state, types: { ...state.types } };
  };
  return { handler, calls };
}

test("Bark settings configure the device, switches and test push from the iOS App", async (t) => {
  const node = fakeNode();
  const page = await mount(t, fixture, node.handler, 420, "/n/N/");
  await page.evaluate(() => { window.MindFSIOSApp = { platform: "ios" }; });

  const menu = page.getByRole("button", { name: /Bark push/ });
  await expect(menu).toContainText("Not set up");
  await menu.click();

  const dialog = page.getByRole("dialog", { name: "Notification settings" });
  await expect(dialog).toBeVisible();
  // The page tells the node where a tapped notification leads (the App link here).
  await expect.poll(() => node.calls.some((c) => c.body?.open_base === "https://app-components.test/n/N/" && c.body?.link_mode === "app")).toBe(true);

  await expect(dialog.getByRole("switch", { name: "Bark push" })).toHaveCount(0);
  await dialog.getByLabel("Paste the Bark push URL or device key").fill("https://api.day.app/abcDEF1234567890xyz");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByText("Set up …9xyz")).toBeVisible();
  const saved = node.calls.find((c) => c.body?.device_key);
  assert.equal(saved.body.device_key, "https://api.day.app/abcDEF1234567890xyz");
  assert.equal(saved.body.enabled, true);
  await expect(dialog.getByRole("switch", { name: "Bark push" })).toHaveAttribute("aria-checked", "true");

  const approval = dialog.getByRole("switch", { name: "Approval needed" });
  const done = dialog.getByRole("switch", { name: "Task completed" });
  await expect(approval).toHaveAttribute("aria-checked", "true");
  await expect(done).toHaveAttribute("aria-checked", "false");
  await done.click();
  await expect(done).toHaveAttribute("aria-checked", "true");
  await approval.click();
  await expect(approval).toHaveAttribute("aria-checked", "false");
  assert.deepEqual(node.calls.filter((c) => c.body?.types).map((c) => c.body.types), [{ done: true }, { approval: false }]);

  await dialog.getByRole("button", { name: "Send test notification" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Test notification sent");
  assert.equal(node.calls.filter((c) => c.path === "test").length, 1);

  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(dialog.getByLabel("Paste the Bark push URL or device key")).toBeVisible();
  assert.equal(node.calls.at(-1).body.device_key, "");
});

test("Bark settings opened outside the App ask for the plain page link", async (t) => {
  const node = fakeNode();
  const page = await mount(t, fixture, node.handler, 420, "/n/N/p/P/");
  await page.getByRole("button", { name: /Bark push/ }).click();
  await expect.poll(() => node.calls.some((c) => c.body?.open_base === "https://app-components.test/n/N/p/P/" && c.body?.link_mode === "web")).toBe(true);
});

test("Bark settings never overwrite the link from a page that has no Relay address", async (t) => {
  const node = fakeNode();
  const page = await mount(t, fixture, node.handler, 420, "/");
  await page.getByRole("button", { name: /Bark push/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(150);
  assert.deepEqual(node.calls.filter((c) => c.body?.open_base !== undefined), []);
});
