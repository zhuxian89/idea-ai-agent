import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const webDir = fileURLToPath(new URL("../", import.meta.url));
const reports = path.resolve(webDir, "../../build/reports/session-tabs");
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("IDE-style session tabs switch, close, navigate, and overflow", { timeout: 120_000 }, async (t) => {
  mkdirSync(reports, { recursive: true });
  const bundle = await build({
    stdin: {
      resolveDir: webDir,
      sourcefile: "session-tabs-fixture.tsx",
      loader: "tsx",
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { SessionTabs } from "./src/components/SessionTabs";

        const initialTabs = [
          { key: "one", label: "Investigate websocket reconnect behavior", pending: true },
          { key: "two", label: "Fix settings panel" },
          { key: "three", label: "Add native diff" },
          { key: "four", label: "Verify attachments" },
          { key: "five", label: "Polish voice input" },
        ];
        window.__tabEvents = [];
        function Fixture() {
          const [tabs, setTabs] = useState(initialTabs);
          const [activeKey, setActiveKey] = useState("one");
          const select = (key) => { window.__tabEvents.push(["select", key]); setActiveKey(key); };
          const close = (key) => {
            window.__tabEvents.push(["close", key]);
            const index = tabs.findIndex((tab) => tab.key === key);
            const next = tabs[index + 1] || tabs[index - 1];
            setTabs((current) => current.filter((tab) => tab.key !== key));
            if (key === activeKey) setActiveKey(next?.key || "");
          };
          return <div className="idea-workbench" style={{ width: "100%", maxWidth: 720 }}>
            <SessionTabs
              tabs={tabs}
              activeKey={activeKey}
              ariaLabel="Open sessions"
              previousLabel="Scroll session tabs left"
              nextLabel="Scroll session tabs right"
              closeLabel={(label) => "Close session tab: " + label}
              runningLabel="Replying"
              onSelect={select}
              onClose={close}
            />
            <div data-testid="active">{activeKey}</div>
          </div>;
        }
        createRoot(document.getElementById("root")).render(<Fixture />);
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 320 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html data-theme="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({
    content: ["src/index.css", "src/ide.css"]
      .map((file) => readFileSync(path.join(webDir, file), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, ""))
      .join("\n"),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(5);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(tabs.first()).toHaveAttribute("title", "Investigate websocket reconnect behavior");
  await expect(page.getByLabel("Replying")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Scroll session tabs right" })).toBeVisible();
  await expect(page.locator(".idea-session-tabs-action")).toHaveCount(0);
  const narrowLayout = await page.locator(".idea-session-tabs-shell").evaluate((node) => {
    const scroll = node.querySelector(".idea-session-tabs-scroll-right").getBoundingClientRect();
    const shell = node.getBoundingClientRect();
    return { scrollRight: scroll.right, shellRight: shell.right };
  });
  assert.ok(narrowLayout.scrollRight <= narrowLayout.shellRight + 1, "overflow control must stay inside the tab strip");
  await page.screenshot({ path: path.join(reports, "dark-320.png"), fullPage: true });

  await page.getByRole("tab", { name: "Fix settings panel" }).click();
  await expect(page.getByTestId("active")).toHaveText("two");
  await page.getByRole("tab", { name: "Fix settings panel" }).press("ArrowRight");
  await expect(page.getByTestId("active")).toHaveText("three");
  await expect(page.getByRole("tab", { name: "Add native diff" })).toBeFocused();

  await page.getByRole("button", { name: "Close session tab: Add native diff" }).click();
  await expect(tabs).toHaveCount(4);
  await expect(page.getByTestId("active")).toHaveText("four");
  assert.deepEqual(await page.evaluate(() => window.__tabEvents.slice(-3)), [
    ["select", "two"],
    ["select", "three"],
    ["close", "three"],
  ]);
  await page.setViewportSize({ width: 760, height: 320 });
  await page.getByRole("button", { name: "Close session tab: Polish voice input" }).click();
  await expect(tabs).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Scroll session tabs right" })).toHaveCount(0);
  const filledLayout = await page.locator(".idea-session-tabs-shell").evaluate((node) => {
    const region = node.querySelector(".idea-session-tabs-region").getBoundingClientRect();
    const tabs = Array.from(node.querySelectorAll(".idea-session-tab"), (tab) => tab.getBoundingClientRect());
    return {
      region: { left: region.left, right: region.right },
      tabs: tabs.map((tab) => ({ left: tab.left, right: tab.right, width: tab.width })),
    };
  });
  assert.ok(Math.abs(filledLayout.tabs[0].left - filledLayout.region.left) <= 1);
  assert.ok(Math.abs(filledLayout.tabs.at(-1).right - filledLayout.region.right) <= 1);
  assert.ok(Math.max(...filledLayout.tabs.map((tab) => tab.width)) - Math.min(...filledLayout.tabs.map((tab) => tab.width)) <= 1);
  await page.locator("html").evaluate((node) => node.setAttribute("data-theme", "light"));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator(".idea-session-tabs-shell")).toHaveCSS("background-color", "rgb(244, 245, 247)");
  assert.deepEqual(await page.locator("html").evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      theme: node.getAttribute("data-theme"),
      panel: styles.getPropertyValue("--panel-bg").trim(),
      sidebar: styles.getPropertyValue("--sidebar-bg").trim(),
    };
  }), { theme: "light", panel: "#ffffff", sidebar: "rgba(255, 255, 255, 0.65)" });
  const lightTabState = await page.locator(".idea-session-tabs-shell").evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      background: styles.backgroundColor,
      panel: styles.getPropertyValue("--panel-bg").trim(),
      sidebar: styles.getPropertyValue("--sidebar-bg").trim(),
      content: styles.getPropertyValue("--content-bg").trim(),
    };
  });
  const lightTabStrip = lightTabState.background;
  const lightChannels = lightTabStrip.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
  assert.equal(lightChannels.length, 3, `expected an RGB tab strip color, received ${lightTabStrip}`);
  assert.ok(lightChannels.every((channel) => channel >= 240), `light tab strip is unexpectedly dark: ${JSON.stringify(lightTabState)}`);
  await page.screenshot({ path: path.join(reports, "light-760.png"), fullPage: true });
  assert.deepEqual(errors, []);
});
