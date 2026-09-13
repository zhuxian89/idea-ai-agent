import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("activity durations cross minute and hour boundaries in both languages", async (t) => {
  const result = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "activity-fixture.tsx", loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { SessionActivity } from "./src/components/SessionActivity";
      import { I18nProvider } from "./src/i18n";
      const startedAt = Date.now();
      const timeline = [{ id: "user", type: "user_text", content: "Task", timestamp: new Date(startedAt).toISOString() }];
      createRoot(document.getElementById("root")).render(<I18nProvider>
        <SessionActivity timeline={timeline} lastEventAt={startedAt} connected recoveryText="" />
      </I18nProvider>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  for (const locale of ["zh-CN", "en-US"]) {
    await t.test(locale, async (t) => {
      const context = await browser.newContext({ locale });
      t.after(() => context.close());
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.clock.install({ time: new Date("2026-09-14T01:00:00Z") });
      await page.setContent('<html><body><div id="root"></div></body></html>');
      await page.addScriptTag({ content: result.outputFiles[0].text });
      const timer = page.locator(".session-activity-time");
      await timer.waitFor();
      let elapsed = 0;
      const cases = [
        [0, "0 秒", "0s"], [59, "59 秒", "59s"], [60, "1 分钟 0 秒", "1m 0s"],
        [61, "1 分钟 1 秒", "1m 1s"], [121, "2 分钟 1 秒", "2m 1s"],
        [3599, "59 分钟 59 秒", "59m 59s"], [3600, "1 小时 0 分钟 0 秒", "1h 0m 0s"],
        [3661, "1 小时 1 分钟 1 秒", "1h 1m 1s"],
      ];
      for (const [seconds, zh, en] of cases) {
        if (seconds > elapsed) await page.clock.fastForward((seconds - elapsed) * 1000);
        elapsed = seconds;
        const duration = locale === "zh-CN" ? zh : en;
        await expect(timer).toHaveText(locale === "zh-CN"
          ? `已等待 ${duration} · 最近更新于 ${duration}前`
          : `Elapsed ${duration} · Last update ${duration} ago`);
        const note = page.locator(".session-activity-note");
        if (seconds < 60) await expect(note).toHaveCount(0);
        else await expect(note).toContainText(duration);
      }
      assert.deepEqual(errors, []);
    });
  }
});
