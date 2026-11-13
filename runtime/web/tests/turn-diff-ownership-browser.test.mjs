import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const webDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const diff = file => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-before\n+after\n`;

test("remote viewer keeps previous diffs with their replies during streaming, completion and reload", async t => {
  const bundle = await build({
    stdin: { resolveDir: webDir, loader: "tsx", contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { I18nProvider } from './src/i18n';
      import { SessionViewer } from './src/components/SessionViewer';
      const root = createRoot(document.getElementById('root'));
      window.renderSession = session => root.render(<I18nProvider>
        <SessionViewer rootId="project" session={session} connected={false} loading={false}/>
      </I18nProvider>);
    ` },
    bundle: true, write: false, outdir: "/tmp/turn-diff-ownership-fixture", platform: "browser", format: "iife", jsx: "automatic",
    external: ["mermaid"], loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
  });
  const styles = readFileSync(path.join(webDir, "src/index.css"), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, "") +
    bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 480, height: 850 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://turn-diff.test/**", route => route.fulfill({ contentType: "text/html", body:
    `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${styles}</style></head><body><div id="root" style="height:100vh;display:flex"></div></body></html>` }));
  const mount = async () => {
    await page.goto("http://turn-diff.test/");
    await page.evaluate(() => localStorage.setItem("mindfs-locale", "zh-CN"));
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js")).text });
  };
  await mount();
  const history = [
    { seq: 3, role: "user", content: "修改文件" },
    { seq: 4, role: "agent", content: "第一轮已完成。" },
  ];
  const aux = { 4: [{ seq: 4, line: 1, turn_diff: { turnId: "previous-turn", diff: diff("previous.txt") } }] };
  const show = (exchanges, pending = false, exchange_aux = aux) => page.evaluate(session => window.renderSession(session), {
    key: "turn-diff", name: "Turn diff", agent: "codex", exchanges, exchange_aux, pending,
  });
  const cards = page.locator("[data-turn-diff]");
  await show(history);
  await expect(cards).toHaveCount(1);
  const pendingUser = { role: "user", content: "只解释一下，不修改文件" };
  await show([...history, pendingUser], true);
  await expect(page.getByText(pendingUser.content, { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(1);
  const reply = { role: "agent", content: "这是本轮的解释。" };
  await show([...history, pendingUser, reply], true);
  await expect(page.getByText(reply.content, { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(1);
  await show([...history, pendingUser, reply,
    { role: "thought", content: "进一步检查" },
    { role: "agent", content: "解释完毕。" },
  ], true);
  await expect(page.getByText("解释完毕。", { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(1);
  const completed = [...history, { ...pendingUser, seq: 5 }, { ...reply, seq: 6 }];
  await show(completed);
  await expect(page.getByText("解释完毕。", { exact: true })).toHaveCount(0);
  await expect(cards).toHaveCount(1);
  await cards.getByRole("button", { name: /本轮修改/ }).click();
  await expect(page.locator('[data-turn-diff-file="previous.txt"]')).toBeVisible();
  assert.ok(await page.getByText(pendingUser.content, { exact: true }).evaluate(node =>
    !!(document.querySelector("[data-turn-diff]").compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)));

  const finalHistory = [...completed,
    { seq: 7, role: "user", content: "修改另一个文件" },
    { seq: 8, role: "agent", content: "新的修改已完成。" },
  ];
  const finalAux = { ...aux, 8: [{ seq: 8, line: 1, turn_diff: { turnId: "new-turn", diff: diff("current.txt") } }] };
  await show(finalHistory, false, finalAux);
  await expect(cards).toHaveCount(2);
  await mount();
  await show(finalHistory, false, finalAux);
  await expect(cards).toHaveCount(2);
  for (const [index, file] of ["previous.txt", "current.txt"].entries()) {
    await cards.nth(index).getByRole("button", { name: /本轮修改/ }).click();
    await expect(cards.nth(index).locator(`[data-turn-diff-file="${file}"]`)).toBeVisible();
  }
  assert.deepEqual(errors, []);
});
