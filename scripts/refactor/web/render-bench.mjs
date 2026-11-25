#!/usr/bin/env node
// render-bench.mjs [--web <runtime/web dir>] [--rounds N]
//
// Mounts the real <App /> in headless Chrome under a React Profiler (development build, mocked /api) and
// measures the commit time of an App level state change: the viewport is flipped between a desktop and a phone
// width, which changes responsive state held in App and re-runs every hook in it.
// Run it on two source trees (for example a `git archive <tag> runtime/web` copy and the working tree) and
// compare. Absolute numbers are for a nearly empty project; the comparison is what matters.
//
//   mkdir -p /tmp/base && git archive pre-refactor-20261124 runtime/web | tar -x -C /tmp/base
//   ln -s "$PWD/runtime/web/node_modules" /tmp/base/runtime/web/node_modules
//   node scripts/refactor/web/render-bench.mjs --web /tmp/base/runtime/web
//   node scripts/refactor/web/render-bench.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const web = path.resolve(opt('--web', path.join(repoRoot, 'runtime/web')));
const rounds = +opt('--rounds', 30);
const require = createRequire(path.join(repoRoot, 'runtime/web/package.json'));
const { build } = createRequire(require.resolve('vite'))('esbuild');
const { chromium } = require('@playwright/test');

const bundle = await build({
  stdin: { resolveDir: web, loader: 'tsx', contents: `
    import React, { Profiler } from "react";
    import { createRoot } from "react-dom/client";
    import { App } from "./src/App";
    import { I18nProvider } from "./src/i18n";
    window.__commits = [];
    createRoot(document.getElementById("root")).render(
      <I18nProvider><Profiler id="app" onRender={(id, phase, actual) => window.__commits.push({ phase, actual })}><App /></Profiler></I18nProvider>);
  ` }, bundle: true, write: false, outdir: '/tmp/render-bench', format: 'iife', jsx: 'automatic',
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}' },
});
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://bench.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>' }));
  await page.route('**/api/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(r.request().url().includes('/api/relay/status') ? { e2ee_required: false } : { dirs: [], agents: [], shells: [], tasks: [], templates: [], items: [] }) }));
  await page.goto('https://bench.test/');
  for (const f of bundle.outputFiles.filter((f) => f.path.endsWith('.css'))) await page.addStyleTag({ content: f.text });
  await page.addScriptTag({ content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text });
  await page.waitForTimeout(1500); // let bootstrap requests settle
  const settle = async () => { let last = -1; for (let i = 0; i < 20; i++) { const n = await page.evaluate(() => window.__commits.length); if (n === last) return; last = n; await page.waitForTimeout(60); } };
  await settle();
  await page.evaluate(() => { window.__commits.length = 0; });
  const flips = [];
  for (let i = 0; i < rounds; i++) {
    for (const width of [600, 1200]) {
      const before = await page.evaluate(() => window.__commits.length);
      await page.setViewportSize({ width, height: 800 });
      await settle();
      const all = await page.evaluate((b) => window.__commits.slice(b), before);
      flips.push({ commits: all.length, total: all.reduce((a, c) => a + c.actual, 0) });
    }
  }
  const totals = flips.map((f) => f.total).sort((a, b) => a - b);
  const q = (p) => totals[Math.min(totals.length - 1, Math.floor(totals.length * p))];
  const commits = flips.map((f) => f.commits).reduce((a, b) => a + b, 0) / flips.length;
  console.log(`${web}`);
  console.log(`  flips=${flips.length}  commits per flip=${commits.toFixed(1)}  render ms per flip: median=${q(0.5).toFixed(2)} p90=${q(0.9).toFixed(2)} max=${totals[totals.length - 1].toFixed(2)}`);
  if (errors.length) console.log('  page errors:', errors.slice(0, 3));
} finally { await browser.close(); }
