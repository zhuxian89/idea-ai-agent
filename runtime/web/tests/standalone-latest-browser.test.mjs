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

import { readFileSync } from "node:fs";

const rowFixture = `
  import { RemotePublishedUpdate } from "./src/components/remote/RemoteBrowserUpdate";
  function Fixture() { return <div className="remote-access-panel" style={{ width: 216 }}><RemotePublishedUpdate version="0.1.60-standalone.2" /></div>; }
`;

for (const width of [320, 433]) {
  test(`an up-to-date published version is one tidy line at ${width}px: version, a check mark, and the button on one axis`, async (t) => {
    const node = backend({ latest: () => ({ version: "0.1.60-standalone.2" }), github: () => ({ __status: 503, __text: "" }) });
    const page = await mount(t, rowFixture.replace("width: 216", `width: ${width}`), node.handler, 460, "/n/N/");
    await page.addStyleTag({ content: readFileSync(new URL("../src/components/remote/remoteAccess.css", import.meta.url), "utf8") });
    await page.getByRole("button", { name: "Check for updates" }).click();
    await expect(page.getByRole("status")).toHaveText("Up to date");
    const boxes = await measure(page);
    for (const name of ["status", "button"]) assert.ok(Math.abs(boxes[name].mid - boxes.version.mid) <= 2, `${name} is ${boxes[name].mid - boxes.version.mid}px off the version's line`);
    assert.ok(boxes.row.bottom - boxes.row.top <= 40, `the row is ${boxes.row.bottom - boxes.row.top}px tall: the status wrapped onto its own line`);
    assert.ok(boxes.status.left >= boxes.version.right - 1, "the check mark follows the version");
    assert.ok(boxes.button.left >= boxes.status.right - 1, "the button stays at the end");
    assert.ok(boxes.status.right - boxes.status.left <= 24, "the status is a small mark, not a sentence");
    assert.ok(boxes.row.right >= boxes.button.right - 0.5 && boxes.version.left >= boxes.row.left - 0.5, "nothing overflows the row");
    assert.equal(boxes.versionClipped, false, "the version number was cut off");
  });
}

test("in a row too narrow for one line the button drops down on the right and the version is never clipped", async (t) => {
  const node = backend({ latest: () => ({ version: "0.1.60-standalone.2" }), github: () => ({ __status: 503, __text: "" }) });
  const page = await mount(t, rowFixture.replace("width: 216", "width: 190"), node.handler, 460, "/n/N/");
  await page.addStyleTag({ content: readFileSync(new URL("../src/components/remote/remoteAccess.css", import.meta.url), "utf8") });
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByRole("status")).toHaveText("Up to date");
  const boxes = await measure(page);
  assert.equal(boxes.versionClipped, false, "the version number was cut off");
  assert.ok(boxes.row.right >= boxes.button.right - 0.5, "the button overflows the row");
  assert.ok(boxes.button.top >= boxes.version.bottom - 1, "the button should have moved to its own line");
  assert.ok(Math.abs(boxes.status.mid - boxes.version.mid) <= 2, "the check mark stays with the version");
});

async function measure(page) {
  return page.evaluate(() => {
    const box = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, mid: r.top + r.height / 2 }; };
    const row = document.querySelector(".remote-published-update");
    const version = row.querySelector(".remote-version");
    return {
      row: box(row), version: box(version), status: box(row.querySelector("[role=status]")), button: box(row.querySelector("button")),
      versionClipped: version.scrollWidth > version.clientWidth + 1,
    };
  });
}

for (const theme of ["dark", "light"]) {
  test(`the up-to-date mark is a quiet check, not a bright filled badge (${theme})`, async (t) => {
    const node = backend({ latest: () => ({ version: "0.1.60-standalone.2" }), github: () => ({ __status: 503, __text: "" }) });
    const page = await mount(t, rowFixture.replace("width: 216", "width: 320"), node.handler, 460, "/n/N/");
    const css = ["index.css", "components/remote/remoteAccess.css"].map(f => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, "")).join("\n");
    await page.addStyleTag({ content: css });
    await page.evaluate(name => { document.documentElement.setAttribute("data-theme", name); document.body.removeAttribute("style"); }, theme);
    await page.getByRole("button", { name: "Check for updates" }).click();
    await expect(page.getByRole("status")).toHaveText("Up to date");
    const mark = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector(".remote-up-to-date"), "::before");
      const [r, g, b] = style.backgroundColor.match(/[\d.]+/g).map(Number);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), lightness = (max + min) / 2 / 255;
      const saturation = max === min ? 0 : (max - min) / 255 / (1 - Math.abs(2 * lightness - 1));
      return { color: style.backgroundColor, saturation, alpha: style.backgroundColor.startsWith("rgba") ? Number(style.backgroundColor.match(/[\d.]+/g)[3]) : 1, mask: style.maskImage || style.webkitMaskImage, radius: style.borderRadius };
    });
    assert.ok(mark.alpha > 0.5, `the mark has no colour at all (${mark.color}): a theme variable is missing`);
    assert.ok(mark.saturation <= 0.4, `the mark is too vivid for ${theme}: ${mark.color} (saturation ${mark.saturation.toFixed(2)})`);
    assert.notEqual(mark.mask, "none", "the mark should be a thin check shape, not a filled disc");
    assert.ok(parseFloat(mark.radius) === 0 || mark.radius === "0px", `the mark is still a round badge (radius ${mark.radius})`);
  });
}
