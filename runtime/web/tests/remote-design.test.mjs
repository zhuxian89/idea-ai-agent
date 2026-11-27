import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const source = `import { RemoteDesignFixture as Fixture } from './tests/fixtures/remote-design';`;
const standalone = '<meta name="local-ai-agent-mode" content="standalone">';
const baseCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, "");
const css = readFileSync(new URL("../src/components/remoteui/remoteDesign.css", import.meta.url), "utf8");

async function setup(t, { path = "/", head = "" } = {}) {
  return mount(t, source, () => ({}), 1440, path, `${standalone}${head}`);
}
async function withStyles(page) {
  await page.addStyleTag({ content: baseCss });
  await page.addStyleTag({ content: css });
  await page.addStyleTag({ content: "body{margin:0}" });
  await page.evaluate(() => { document.body.removeAttribute("style"); document.documentElement.dataset.theme = "light"; });
}
const pseudoState = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const before = getComputedStyle(el, "::before");
  const after = getComputedStyle(el, "::after");
  return {
    hasGlowClass: el.classList.contains("remote-glow-frame"),
    beforeContent: before.content,
    beforeAnimation: before.animationName,
    beforeOpacity: Number(before.opacity),
    afterContent: after.content,
    afterAnimation: after.animationName,
  };
}, selector);

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

test("desktop web puts one glowing status bar above the composer like phone and keeps the outer chat frame free of glow", async t => {
  const page = await setup(t);
  await withStyles(page);

  // Outer .remote-center never mounts glow frame (only the compact status bar glows, matching phone)
  const centerGlow = await pseudoState(page, ".remote-center");
  assert.deepEqual(centerGlow, {
    hasGlowClass: false,
    beforeContent: "none",
    beforeAnimation: "none",
    beforeOpacity: 1,
    afterContent: "none",
    afterAnimation: "none",
  });

  // Exactly one status bar, placed above the composer inside .remote-footer with default-on glow
  const statusHost = page.locator(".remote-footer .remote-status-activity");
  const statusBar = statusHost.locator("[data-session-activity]");
  const statusGlowStyle = (prop) => statusHost.evaluate((el, name) => getComputedStyle(el, "::before")[name], prop);
  await expect(page.locator("[data-session-activity]")).toHaveCount(1);
  await expect(statusHost).toHaveClass(/remote-glow-frame/);
  await expect(statusBar).toBeVisible();
  await expect(statusBar).toHaveAttribute("data-activity-kind", "work");
  await expect(page.locator(".remote-main [data-session-activity]")).toHaveCount(0);
  await expect.poll(() => statusGlowStyle("visibility")).toBe("visible");
  assert.equal(await statusGlowStyle("animationName"), "glow-breathe");

  const composer = page.getByLabel("Composer");
  const barBox = await statusBar.boundingBox();
  const composerBox = await composer.boundingBox();
  assert.ok(barBox && composerBox && barBox.y + barBox.height <= composerBox.y + 1, "status bar must sit above composer");

  // Desktop settings menu exposes the status-bar glow dialog just like phone and toggles glow live
  await page.locator('[data-onboarding="sidebar-menu"]').click();
  const glowMenuBtn = page.getByRole("button", { name: /Agent status border glow/ });
  await expect(glowMenuBtn).toBeVisible();
  await glowMenuBtn.click();
  const glowDialog = page.getByRole("dialog", { name: "Agent status border glow" });
  await expect(glowDialog).toBeVisible();
  await glowDialog.getByRole("button", { name: "Orbit", exact: true }).click();
  await expect.poll(() => statusGlowStyle("animationName")).toContain("glow-flow");
  await glowDialog.getByRole("switch").click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.glow), "off");
  await expect.poll(() => statusGlowStyle("visibility")).toBe("hidden");
  await glowDialog.getByRole("button", { name: "Restore defaults" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.glow), "on");
  await expect.poll(() => statusGlowStyle("visibility")).toBe("visible");
  await glowDialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(glowDialog).toHaveCount(0);

  // Check layout stability when switching between work, long summary, offline, recovery in light/dark & narrow width
  const initialComposerTop = Math.round(composerBox.y);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(next => { document.documentElement.dataset.theme = next; }, theme);
    for (const nextMode of ["long", "offline", "recovery", "work"]) {
      await page.evaluate(m => window.fixture.setMode(m), nextMode);
      await expect(page.locator("[data-session-activity]")).toHaveCount(1);
      if (nextMode === "offline") {
        await expect.poll(() => statusGlowStyle("visibility")).toBe("hidden");
      }
      const nextComposerBox = await composer.boundingBox();
      assert.equal(Math.round(nextComposerBox.y), initialComposerTop, `composer jumped in ${theme}/${nextMode}`);
    }
  }

  // Narrow desktop window with expanded sidebars keeps single status bar and zero horizontal overflow
  await page.setViewportSize({ width: 780, height: 700 });
  await page.evaluate(() => window.fixture.setMode("long"));
  await expect(page.locator("[data-session-activity]")).toHaveCount(1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  // Waiting-for-answer turns off work glow and can be opened & submitted via keyboard
  await page.evaluate(() => window.fixture.setMode("wait"));
  await expect(statusBar).toHaveAttribute("data-activity-kind", "wait");
  await expect.poll(() => statusGlowStyle("visibility")).toBe("hidden");
  const answerButton = statusBar.getByRole("button", { name: /Tap to respond/ });
  await answerButton.focus();
  await expect(answerButton).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Needs an answer" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: "Staging" }).check();
  await dialog.getByRole("button", { name: /submit/i }).click();
  await expect(dialog).toBeHidden();
  assert.deepEqual((await page.evaluate(() => window.desktopAnswer)).answers, { q_0: "Staging" });

  // Terminal done / error states render in the same status bar host without work glow
  await page.evaluate(() => window.fixture.setMode("work"));
  await expect(statusBar).toHaveAttribute("data-activity-kind", "work");
  await expect.poll(() => statusGlowStyle("visibility")).toBe("visible");
  await page.evaluate(() => window.fixture.emitTerminal("error"));
  await expect(statusBar).toHaveAttribute("data-activity-kind", "error");
  await expect(statusBar.locator(".session-activity-emoji")).toHaveAttribute("data-emoji", "😱");
  await expect.poll(() => statusGlowStyle("visibility")).toBe("hidden");
  await page.evaluate(() => window.fixture.setMode("work"));
  await expect(statusBar).toHaveAttribute("data-activity-kind", "work");
  await page.evaluate(() => window.fixture.emitTerminal("done"));
  await expect(statusBar).toHaveAttribute("data-activity-kind", "done");
  await expect(statusBar.locator(".session-activity-emoji")).toHaveAttribute("data-emoji", "👍");
  await expect.poll(() => statusGlowStyle("visibility")).toBe("hidden");

  // Idle hides the status bar host cleanly with no glow on .remote-center
  await page.evaluate(() => window.fixture.setMode("idle"));
  await expect(page.locator("[data-session-activity]")).toHaveCount(0);
  assert.equal((await pseudoState(page, ".remote-center")).beforeContent, "none");
});

test("iOS App tablet runtime uses the same status-bar glow host above the composer", async t => {
  const iosHead = `<script>window.MindFSIOSApp = { platform: "ios" };</script>`;
  const page = await setup(t, { head: iosHead });
  await withStyles(page);
  const centerGlow = await pseudoState(page, ".remote-center");
  assert.equal(centerGlow.hasGlowClass, false);
  const statusHost = page.locator(".remote-footer .remote-status-activity");
  await expect(statusHost).toHaveClass(/remote-glow-frame/);
  await expect.poll(() => statusHost.evaluate(el => getComputedStyle(el, "::before").visibility)).toBe("visible");
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
  assert.equal((await pseudoState(page, ".remote-center")).beforeContent, "none");
});

test("glow settings dialog saves effect, colour, speed and restores defaults", async t => {
  const page = await setup(t);
  await withStyles(page);
  await page.evaluate(() => window.fixture.openGlow());
  const dialog = page.getByRole("dialog", { name: "Chat border glow" });
  await expect(dialog).toBeVisible();
  const demoGlow = await pseudoState(page, ".remote-glow-demo");
  assert.equal(demoGlow.hasGlowClass, true);
  assert.notEqual(demoGlow.beforeContent, "none");
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
