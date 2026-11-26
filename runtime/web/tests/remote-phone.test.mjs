import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const html = '<meta name="local-ai-agent-mode" content="standalone">';
const fixture = "import { PhoneFixture as Fixture } from './tests/fixtures/remote-phone';";
async function setup(t, path = "/?device=phone", handle = () => ({})) {
  const page = await mount(t, fixture, handle, 390, path, html);
  await page.setViewportSize({ width: 390, height: 700 });
  const styles = ["index.css", "components/workspaceSidebar.css", "components/remoteui/remoteDesign.css", "layout/remotePhone.css"];
  for (const file of styles) await page.addStyleTag({ content: readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, "") });
  await page.evaluate(() => document.body.removeAttribute("style"));
  return page;
}

test("phone keeps chat chrome compact and navigates cards, quick switching, projects and settings", async t => {
  const page = await setup(t);
  const shell = page.locator(".remote-phone");
  await expect(shell).toHaveAttribute("data-page", "chat");
  await expect(shell.locator("nav")).toHaveCount(0);
  await expect(page.getByLabel("Composer")).toBeVisible();
  await expect(shell.getByRole("button", { name: /Another session needs an answer/ })).toBeVisible();
  const glowFrame = shell.locator(".remote-phone-activity");
  const activity = glowFrame.locator("[data-session-activity]");
  const glowStyle = property => glowFrame.evaluate((frame, name) => getComputedStyle(frame, "::before")[name], property);
  await expect(activity).toHaveAttribute("data-activity-kind", "wait");
  assert.equal(await glowStyle("visibility"), "hidden");
  await shell.getByRole("button", { name: "Sessions", exact: true }).click();
  const quick = page.getByRole("dialog", { name: "Sessions", exact: true });
  await expect(quick).toBeVisible();
  const bounds = await quick.boundingBox();
  assert.equal(bounds.x, 0);
  assert.ok(bounds.width < 390 && bounds.height >= 690);
  await page.mouse.click(375, 120);
  await expect(quick).toBeHidden();
  await shell.locator(".remote-phone-leading").click();
  const choices = quick.getByRole("list").getByRole("button");
  await expect(choices.locator("strong")).toHaveText([
    "Other conversation", "Main conversation", "Pinned finished", "Recently finished", "Older finished",
  ]);
  await expect(choices.first()).toContainText("Beta project");
  await expect(choices.first()).toContainText("Needs an answer");
  const current = quick.locator('[aria-current="true"]');
  await expect(current).toContainText("Main conversation");
  await expect(current).toContainText("Running");
  await quick.getByRole("searchbox").fill("missing session");
  await expect(quick.getByText("No matching sessions")).toBeVisible();
  await quick.getByRole("searchbox").fill(" beta project ");
  await expect(choices).toHaveCount(1);
  await quick.getByRole("button", { name: /Other conversation/ }).click();
  await expect(shell.locator(".remote-phone-title")).toContainText("Other conversation");
  await expect(activity).toHaveAttribute("data-activity-kind", "work");
  await expect.poll(() => glowStyle("visibility")).toBe("visible");
  assert.equal(await glowStyle("animationName"), "glow-breathe");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await glowStyle("animationName"), "none");
  assert.equal(await glowStyle("visibility"), "visible");
  await shell.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("dialog", { name: "Sessions" }).getByRole("button", { name: "All sessions" }).click();
  await expect(shell).toHaveAttribute("data-page", "sessions");
  await expect(shell.locator(".workspace-session-row")).toHaveCount(1);
  await expect(shell.locator(".remote-phone-card-preview")).toHaveText("Recent preview");
  await shell.getByRole("button", { name: "More", exact: true }).click();
  await expect(shell.getByRole("group", { name: "Device type" }).getByRole("button", { name: "Phone", exact: true })).toHaveAttribute("aria-pressed", "true");
  await shell.getByRole("switch", { name: "Multi-project session list" }).click();
  await shell.locator("nav").getByRole("button", { name: "Sessions", exact: true }).click();
  await shell.getByRole("button", { name: "Needs an answer 1" }).click();
  await expect(shell.locator(".workspace-session-row")).toHaveCount(1);
  await expect(shell.locator(".workspace-session-row")).toContainText("Other conversation");
  await shell.locator("nav").getByRole("button", { name: "Projects", exact: true }).click();
  await expect(shell.locator(".remote-phone-projects .workspace-projects")).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("phone header aligns the one-line title with the compact sessions and projects icons", async t => {
  const page = await setup(t);
  const header = page.locator(".remote-phone-chat-header");
  await expect(header).toBeVisible();
  await expect(header.locator(".remote-phone-title")).toHaveText("Main conversation");
  const measured = await header.evaluate(element => {
    const middle = node => { const box = node.getBoundingClientRect(); return box.top + box.height / 2; };
    const icons = element.querySelectorAll(".remote-phone-icon");
    const leading = icons[0].querySelector("svg");
    const title = element.querySelector(".remote-phone-title strong");
    const colorOf = value => { const probe = document.createElement("i"); probe.style.color = value; document.body.append(probe); const out = getComputedStyle(probe).color; probe.remove(); return out; };
    return {
      sessions: middle(leading), folder: middle(icons[1].querySelector("svg")),
      title: middle(title),
      leadingOffset: leading.getBoundingClientRect().left - element.getBoundingClientRect().left,
      leadingTarget: icons[0].getBoundingClientRect().toJSON(),
      titleWrapping: getComputedStyle(title).whiteSpace,
      leadingLines: leading.querySelector("path").getAttribute("d").match(/M/g)?.length,
      iconColor: getComputedStyle(icons[0]).color, folderColor: getComputedStyle(icons[1]).color,
      accent: colorOf("var(--accent-color)"), secondary: colorOf("var(--text-secondary)"),
    };
  });
  await expect(header.locator("button.remote-phone-title, .remote-phone-title svg")).toHaveCount(0);
  for (const name of ["folder", "title"]) assert.ok(Math.abs(measured[name] - measured.sessions) <= 1, `${name} is ${measured[name] - measured.sessions}px off the sessions button's axis`);
  assert.ok(measured.leadingOffset <= 12, "the sessions icon should sit close to the leading edge");
  assert.ok(measured.leadingTarget.width >= 44 && measured.leadingTarget.height >= 44);
  assert.equal(measured.titleWrapping, "nowrap");
  assert.equal(measured.leadingLines, 3);
  assert.notEqual(measured.iconColor, measured.accent, "the sessions button must not use the accent colour");
  assert.notEqual(measured.folderColor, measured.accent, "the projects button must not use the accent colour");
  assert.equal(measured.iconColor, measured.secondary);
  assert.equal(measured.folderColor, measured.secondary);
});

test("phone keeps approval above the composer and submits the original request from its sheet", async t => {
  const page = await setup(t);
  const activity = page.locator(".remote-phone-activity");
  await activity.getByRole("button", { name: /Tap to respond/ }).click();
  const sheet = page.getByRole("dialog", { name: "Needs an answer" });
  await expect(sheet).toBeVisible();
  const details = sheet.locator(".remote-phone-request");
  await expect(details.locator("pre")).toContainText("echo line-3");
  await expect(details.locator("pre")).toHaveAttribute("data-collapsed", "true");
  assert.equal(await details.locator("pre").evaluate(el => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight))), 3);
  await details.getByRole("button", { name: /Expand.*18 lines/ }).click();
  await expect(details.locator("pre")).toContainText("echo line-18");
  assert.equal(await details.locator("pre").evaluate(el => el.scrollHeight > el.clientHeight), true);
  await sheet.getByRole("radio", { name: /allow.*turn/i }).check();
  await sheet.getByRole("button", { name: /submit/i }).click();
  await expect(sheet).toBeHidden();
  assert.deepEqual((await page.evaluate(() => window.answer)).answers, { q_0: "allow_turn" });
});

test("narrow desktop stays desktop, and manually selecting a phone switches to the phone layout", async t => {
  const page = await setup(t, "/");
  await expect(page.locator("html")).toHaveAttribute("data-device", "desktop");
  await expect(page.locator(".remote-shell")).toBeVisible();
  await page.evaluate(() => window.setTestDevice("phone"));
  await expect(page.locator(".remote-phone")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-device", "phone");
});


test("More exposes grouped settings directly and opens the existing actions without changing page", async t => {
  const requests = [];
  const page = await setup(t, "/?device=phone", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/agents") return { agents: [{ name: "codex", available: true, installed: true }], shells: [] };
    if (path === "/api/agent-config/defaults") return { agent: "codex", file_sources: ["/fixtures/config.toml"], env_keys: [] };
    if (path === "/api/agent-config/backups" && request.method() === "POST") {
      requests.push(request.postDataJSON());
      return { id: "saved", agent: "codex", name: "My config" };
    }
    return {};
  });
  const shell = page.locator(".remote-phone");
  await shell.getByRole("button", { name: "Projects", exact: true }).click();
  await shell.getByRole("button", { name: "More", exact: true }).click();
  const more = shell.getByRole("region", { name: "More" });
  await expect(more.getByText("Standalone test")).toBeVisible();
  await expect(more.getByText("WebSocket connected")).toBeVisible();
  await expect(more.getByRole("heading", { name: "Agent" })).toBeVisible();
  await expect(more.getByRole("button", { name: "Export Agent configuration" })).toBeVisible();
  await expect(more.getByRole("button", { name: "Send test notification" })).toBeVisible();
  await expect(more.getByRole("group", { name: "Global sort" }).getByRole("button").first()).toBeVisible();
  await expect(more.getByRole("group", { name: "Language" }).getByRole("button", { name: "English" })).toBeVisible();
  await more.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(more.getByRole("button", { name: "Tools and settings in the project menu" })).toHaveCount(0);
  const glowSettings = more.getByRole("button", { name: /Agent status border glow/ });
  await glowSettings.click();
  const glowDialog = page.getByRole("dialog", { name: "Agent status border glow" });
  await glowDialog.getByRole("button", { name: "Orbit", exact: true }).click();
  await glowDialog.getByRole("button", { name: "Teal", exact: true }).click();
  await glowDialog.getByRole("button", { name: "Very slow", exact: true }).click();
  await glowDialog.getByRole("switch").click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("mindfs-remote-glow"))), {
    on: false, fx: "orbit", color: "teal", custom: "#6366f1", speed: "slow",
  });
  await glowDialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(glowDialog).toHaveCount(0);
  await expect(glowSettings).toContainText("Off");
  await expect(shell).toHaveAttribute("data-page", "more");

  await more.getByRole("button", { name: "Agent config switch & restart" }).click();
  const dialog = page.getByRole("dialog", { name: "Agent config switch & restart" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Choose an agent to switch config")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(shell).toHaveAttribute("data-page", "more");

  await more.getByRole("button", { name: "Add Agent config" }).click();
  const backup = page.getByRole("dialog", { name: "Add Agent config" });
  await backup.getByText("codex", { exact: true }).click();
  await expect(backup.getByLabel("Config sources")).toHaveValue("/fixtures/config.toml");
  await backup.getByLabel("Backup name").fill("My config");
  await backup.getByRole("button", { name: "Save", exact: true }).click();
  await expect(backup).toBeHidden();
  assert.deepEqual(requests[0], { agent: "codex", name: "My config", file_sources: ["/fixtures/config.toml"], env_lines: [], overwrite: false });
});
