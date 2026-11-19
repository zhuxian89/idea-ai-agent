import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const source = `import { RemoteDesignFixture as Fixture } from './tests/fixtures/remote-design';`;
const standalone = '<meta name="local-ai-agent-mode" content="standalone">';
const css = readFileSync(new URL("../src/components/remoteui/remoteDesign.css", import.meta.url), "utf8");

async function setup(t, { path = "/" } = {}) {
  return mount(t, source, () => ({}), 1440, path, standalone);
}
async function withStyles(page) {
  await page.addStyleTag({ content: css });
  await page.addStyleTag({ content: "body{margin:0}" });
  await page.evaluate(() => { document.body.removeAttribute("style"); document.documentElement.dataset.theme = "light"; });
}
const opacity = page => page.evaluate(() => Number(getComputedStyle(document.querySelector(".remote-center"), "::before").opacity));

test("remote web ui is only enabled outside the IDEA page, and glow defaults to on/breathe", async t => {
  const page = await setup(t);
  await withStyles(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.remoteUi), "1");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.glow), "on");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.glowFx), "breathe");
  await expect(page.locator(".remote-shell")).toHaveCount(1);
});

test("IDEA page (?ide=1) never gets the remote ui attributes", async t => {
  const page = await setup(t, { path: "/?ide=1" });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.remoteUi ?? null), null);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.glow ?? null), null);
});

test("sidebar toggles keep both panes mounted and let the chat panel fill the window", async t => {
  const page = await setup(t);
  await withStyles(page);
  const left = page.getByRole("button", { name: "Collapse files" });
  const right = page.getByRole("button", { name: "Collapse sessions" });
  await expect(left).toHaveAttribute("aria-expanded", "true");
  await left.click();
  await expect(page.getByRole("button", { name: "Expand files" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".remote-side-left")).toHaveAttribute("data-open", "false");
  await expect(page.locator("#files-pane")).toHaveCount(1); // 收起不卸载，里面的状态不丢
  await right.click();
  await expect.poll(() => page.evaluate(() => Math.round(document.querySelector(".remote-center").getBoundingClientRect().width))).toBe(1440);
  await page.getByRole("button", { name: "Expand files" }).click();
  await expect(page.locator(".remote-side-left")).toHaveAttribute("data-open", "true");
});

test("top bar: multi-project switch, theme select and the agent-config shortcut", async t => {
  const page = await setup(t);
  await withStyles(page);
  const multi = page.getByRole("switch");
  await expect(multi).toHaveAttribute("aria-checked", "false");
  await multi.click();
  await expect(multi).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Theme").selectOption("dark");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.getByRole("button", { name: "Collapse files" }).click();
  await page.locator(".remote-topbar-action:not(.remote-topbar-switch)").click();
  await expect.poll(() => page.evaluate(() => window.configSwitchEvents)).toBe(1);
  await expect(page.locator(".remote-side-left")).toHaveAttribute("data-open", "false");
});

test("glow lights only while the agent is working, and never when switched off", async t => {
  const page = await setup(t);
  await withStyles(page);
  await expect.poll(() => opacity(page)).toBeGreaterThan(0.05);
  await page.evaluate(() => { document.getElementById("activity").dataset.activityKind = "wait"; });
  await expect.poll(() => opacity(page), { timeout: 4000 }).toBeLessThan(0.02);
  for (const kind of ["done", "error", "offline"]) {
    await page.evaluate(k => { document.getElementById("activity").dataset.activityKind = k; }, kind);
    await expect.poll(() => opacity(page), { timeout: 4000 }).toBeLessThan(0.02);
  }
  await page.evaluate(() => { document.getElementById("activity").dataset.activityKind = "work"; });
  await expect.poll(() => opacity(page), { timeout: 4000 }).toBeGreaterThan(0.05);
  await page.evaluate(() => { document.documentElement.dataset.glow = "off"; });
  await expect.poll(() => opacity(page), { timeout: 4000 }).toBeLessThan(0.02);
  await page.evaluate(() => { document.getElementById("activity").remove(); document.documentElement.dataset.glow = "on"; });
  await expect.poll(() => opacity(page), { timeout: 4000 }).toBeLessThan(0.02); // 没有活动块 = 空闲
});

test("all panes share a background and the active border fits above the visual viewport edge", async t => {
  const page = await setup(t);
  await withStyles(page);
  await page.setViewportSize({ width: 1080, height: 640 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.setProperty("--mindfs-viewport-height", "590px");
    const shell = document.querySelector(".remote-shell");
    shell.style.marginTop = "42px";
    shell.style.setProperty("--remote-host-toolbar-height", "42px");
  });
  const center = page.locator(".remote-center");
  const result = await center.evaluate(el => {
    const shell = el.closest(".remote-shell");
    const background = getComputedStyle(shell).backgroundColor;
    return {
      bottom: el.getBoundingClientRect().bottom,
      background,
      center: getComputedStyle(el).backgroundColor,
      header: getComputedStyle(el).getPropertyValue("--mindfs-topbar-bg").trim(),
      sidebars: [...shell.querySelectorAll(".remote-side")].map(side => getComputedStyle(side).getPropertyValue("--mindfs-topbar-bg").trim()),
    };
  });
  assert.equal(result.center, result.background);
  assert.deepEqual(result.sidebars, [result.header, result.header]);
  assert.ok(result.bottom <= 586, `bottom edge is at ${result.bottom}px`);
  await expect.poll(() => opacity(page)).toBeGreaterThan(0.05);
});

test("glow settings dialog saves effect, colour, speed and restores defaults", async t => {
  const page = await setup(t);
  await withStyles(page);
  await page.evaluate(() => window.fixture.openGlow());
  const dialog = page.getByRole("dialog", { name: "Chat border glow" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Orbit" }).click();
  await dialog.getByRole("button", { name: "Teal" }).click();
  await dialog.getByRole("button", { name: "Very slow" }).click();
  const read = () => page.evaluate(() => ({
    fx: document.documentElement.dataset.glowFx,
    g1: document.documentElement.style.getPropertyValue("--glow1"),
    dur: document.documentElement.style.getPropertyValue("--glow-dur"),
    saved: JSON.parse(localStorage.getItem("mindfs-remote-glow")),
  }));
  let state = await read();
  assert.equal(state.fx, "orbit");
  assert.equal(state.g1, "#14b8a6");
  assert.equal(state.dur, "24s");
  assert.deepEqual({ ...state.saved, custom: undefined }, { on: true, fx: "orbit", color: "teal", speed: "slow", custom: undefined });
  await dialog.getByRole("switch").click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.glow), "off");
  await dialog.getByRole("button", { name: "Follow theme" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--glow1")), "");
  await dialog.getByRole("button", { name: "Restore defaults" }).click();
  state = await read();
  assert.deepEqual([state.fx, state.dur, state.saved.on], ["breathe", "14s", true]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("invalid glow settings fall back to the defaults instead of breaking the page", async t => {
  const page = await setup(t);
  const normalized = await page.evaluate(() => window.fixture.normalize({ on: "yes", fx: "disco", color: "pink", custom: "red", speed: 9 }));
  assert.deepEqual(normalized, { on: true, fx: "breathe", color: "theme", custom: "#6366f1", speed: "normal" });
  const kept = await page.evaluate(() => window.fixture.normalize({ on: false, fx: "sweep", color: "custom", custom: "#ff0066", speed: "rapid" }));
  assert.deepEqual(kept, { on: false, fx: "sweep", color: "custom", custom: "#ff0066", speed: "rapid" });
});
