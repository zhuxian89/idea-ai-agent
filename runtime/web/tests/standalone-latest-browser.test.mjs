import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const fixture = `
  import { RemotePublishedUpdate } from "./src/components/remote/RemoteBrowserUpdate";
  function Fixture() { return <RemotePublishedUpdate version="0.1.52" />; }
`;
const PUBLISHED = "raw.githubusercontent.com";

function backend({ latest, github }) {
  const calls = [];
  const handler = (request) => {
    const url = new URL(request.url());
    calls.push(url.host + url.pathname);
    if (url.host === PUBLISHED) return github();
    if (url.pathname.endsWith("/api/standalone/latest")) return latest();
    return { __status: 404 }; // no self-update route: only the release check is under test
  };
  return { handler, calls };
}

test("a phone that cannot reach GitHub still learns the latest version from the node", async (t) => {
  const node = backend({
    latest: () => ({ version: "0.1.53" }),
    github: () => ({ __status: 503, __text: "blocked on this network" }),
  });
  const page = await mount(t, fixture, node.handler, 420, "/n/N/");
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByRole("status")).toHaveText("New version: 0.1.53");
  assert.equal(node.calls.some((call) => call.startsWith(PUBLISHED)), false, "the browser must not need GitHub");
});

test("a backend without the latest route is checked from the browser as before", async (t) => {
  const node = backend({
    latest: () => ({ __status: 404, __json: { error: "not found" } }),
    github: () => ({ __status: 200, __text: "0.1.52\n" }),
  });
  const page = await mount(t, fixture, node.handler, 420, "/n/N/");
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByRole("status")).toHaveText("Up to date");
  assert.equal(node.calls.some((call) => call.startsWith(PUBLISHED)), true);
});

test("when the node cannot reach GitHub the page shows that reason instead of a browser error", async (t) => {
  const node = backend({
    latest: () => ({ __status: 502, __json: { error: "could not reach the published version: dial tcp: i/o timeout" } }),
    github: () => ({ __status: 200, __text: "0.1.99\n" }),
  });
  const page = await mount(t, fixture, node.handler, 420, "/n/N/");
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not check for updates. Try again.");
  await page.getByText("Details").click();
  await expect(page.locator("pre")).toContainText("could not reach the published version: dial tcp: i/o timeout");
  assert.equal(node.calls.some((call) => call.startsWith(PUBLISHED)), false, "a node failure is reported, not hidden by a second source");
});
