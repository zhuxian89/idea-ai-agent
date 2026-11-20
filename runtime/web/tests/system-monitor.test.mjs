import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const written = [];
after(() => { for (const file of written) rmSync(file, { force: true }); });
async function load(entry) {
  const bundle = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node',
    jsx: 'automatic', loader: { '.css': 'empty' }, external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'],
    absWorkingDir: new URL('..', import.meta.url).pathname,
  });
  const dir = new URL('../node_modules/.cache/', import.meta.url);
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  const file = new URL(`system-monitor-${Math.random().toString(36).slice(2)}.mjs`, dir);
  writeFileSync(file, bundle.outputFiles[0].text);
  written.push(file);
  return import(file.href);
}

const stats = await load('../src/services/systemStats.ts');
const view = await load('../src/components/SystemMonitor.tsx');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const zh = (await load('../src/i18n/locales/zh-CN.ts')).zhCN;
const translate = (key, params = {}) => String(zh[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));

test('load levels follow the agreed thresholds', () => {
  assert.equal(stats.loadLevel(0), 'ok');
  assert.equal(stats.loadLevel(69.9), 'ok');
  assert.equal(stats.loadLevel(70), 'warn');
  assert.equal(stats.loadLevel(89.9), 'warn');
  assert.equal(stats.loadLevel(90), 'crit');
  assert.equal(stats.loadLevel(100), 'crit');
});

test('polling is slower when only the collapsed card is shown', () => {
  assert.equal(stats.pollDelay(true), 2000);
  assert.equal(stats.pollDelay(false), 5000);
  assert.ok(stats.RETRY_MS >= 30000, 'a backend without the endpoint must not be hit every few seconds');
});

test('a page that is not ready yet retries quickly and is not treated as a failure', () => {
  assert.deepEqual(stats.retryDelay(new Error('api_not_ready')), { delay: 1000, failed: false });
  assert.deepEqual(stats.retryDelay(new Error('HTTP 404')), { delay: stats.RETRY_MS, failed: true });
  assert.deepEqual(stats.retryDelay('boom'), { delay: stats.RETRY_MS, failed: true });
});

test('history keeps only the last minute and never mutates its input', () => {
  const start = [{ t: 0, v: 1 }, { t: 30_000, v: 2 }];
  const next = stats.pushHistory(start, { t: 61_000, v: 3 });
  assert.deepEqual(next.map(p => p.v), [2, 3], 'the point from 61 s ago is dropped');
  assert.equal(start.length, 2);
  assert.equal(stats.pushHistory([], { t: 5, v: 9 }).length, 1);
});

test('sparkline places points by real time, so sparse points are not stretched', () => {
  assert.deepEqual(stats.sparkPaths([], 1000, 260, 44), { line: '', area: '' });
  const now = 120_000;
  const sparse = stats.sparkPaths([{ t: now - 5_000, v: 50 }, { t: now, v: 50 }], now, 260, 44);
  const xs = [...sparse.line.matchAll(/[ML]([\d.]+) /g)].map(m => Number(m[1]));
  assert.ok(xs[0] > 230 && xs[1] === 260, `two points five seconds apart sit at the right edge: ${xs}`);
  const wide = stats.sparkPaths([{ t: now - 60_000, v: 0 }, { t: now, v: 100 }], now, 260, 44);
  assert.match(wide.line, /^M0 41 L260 3$/, '0% at the bottom, 100% at the top, with padding');
  assert.ok(wide.area.endsWith('Z') && wide.area.includes('L260 44 L0 44'), 'the area is closed along the bottom');
  assert.equal(stats.sparkPaths([{ t: now - 90_000, v: 10 }], now, 260, 44).line, '', 'points older than the window are not drawn');
  assert.match(stats.sparkPaths([{ t: now, v: 250 }], now, 260, 44).line, /M260 3$/, 'values are clamped to 100%');
});

test('memory is shown in GB of 1024³ bytes with one decimal', () => {
  assert.equal(stats.formatGB(16 * 1024 ** 3), '16.0');
  assert.equal(stats.formatGB(11.5 * 1024 ** 3), '11.5');
});

const sample = (cpu, mem) => ({ host: 'mac-idea', cpu_percent: cpu, cpu_cores: 12, mem_percent: mem, mem_used: 11.5 * 1024 ** 3, mem_total: 16 * 1024 ** 3, sampled_at_ms: 1000 });
const render = (props) => renderToStaticMarkup(React.createElement(view.SystemMonitorView, {
  stats: sample(41, 67), cpuHistory: [{ t: 900, v: 41 }], memHistory: [{ t: 900, v: 67 }], now: 1000, expanded: false, onToggle() {}, t: translate, uid: 'u1', ...props,
}));

test('the card names both resources and tells them apart without text', () => {
  const html = render({});
  assert.match(html, /data-kind="cpu"[\s\S]*CPU[\s\S]*41%/);
  assert.match(html, /data-kind="mem"[\s\S]*内存[\s\S]*67%/);
  assert.ok(html.includes('M9 2v3'), 'the CPU ring carries the chip icon');
  assert.ok(html.includes('M6 15v3'), 'the memory ring carries the memory-module icon');
  assert.match(html, /aria-label="这台电脑：CPU 41%，内存 67%"/);
  assert.match(html, /aria-expanded="false"/);
  assert.ok(!html.includes('sysmon-pop'), 'details stay closed until the card is opened');
});

test('colour levels reach the card and the details', () => {
  assert.match(render({ stats: sample(78, 82) }), /data-lv="warn"[^>]*data-kind="cpu"/);
  const high = render({ stats: sample(96, 93), expanded: true });
  assert.match(high, /data-lv="crit"[^>]*data-kind="mem"/);
  assert.ok(high.includes('负载很高，Agent 响应可能变慢') && high.includes('data-k="crit"'));
  const warn = render({ stats: sample(78, 40), expanded: true });
  assert.ok(warn.includes('负载偏高') && !warn.includes('负载很高'));
  assert.ok(!render({ expanded: true }).includes('sysmon-warn'), 'no warning while both are normal');
});

test('details show cores, memory in GB, the host and where the numbers come from', () => {
  const html = render({ expanded: true });
  assert.ok(html.includes('12 核 · 当前 41%'));
  assert.ok(html.includes('已用 11.5 / 16.0 GB') && html.includes('可用 4.5 GB'));
  assert.ok(html.includes('mac-idea') && html.includes('每 2 秒更新'));
  assert.ok(html.includes('不是你正在看的手机或浏览器所在的设备'));
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /role="dialog"/);
});

test('while the first reading is pending the card spins and cannot open', () => {
  const html = render({ stats: null, expanded: true });
  assert.match(html, /data-state="loading"/);
  assert.ok(html.includes('--') && !html.includes('sysmon-pop'));
  assert.match(html, /aria-expanded="false"/);
});

test('the monitor is wired into the sidebar footer above the phone button, desktop only', () => {
  const tree = readFileSync(new URL('../src/components/FileTree.tsx', import.meta.url), 'utf8');
  assert.ok(tree.indexOf('{footerTop}') > 0 && tree.indexOf('{footerTop}') < tree.indexOf('file-tree-relay-action"'));
  assert.match(tree, /!!footerTop \|\|/);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /footerTop=\{isStandaloneRuntime && !isMobile \? <SystemMonitor \/> : null\}/);
});

test('every monitor string exists in both languages', async () => {
  const en = (await load('../src/i18n/locales/en-US.ts')).enUS;
  const keys = Object.keys(zh).filter(key => key.startsWith('sysmon.'));
  assert.ok(keys.length >= 15);
  for (const key of keys) assert.ok(en[key], `en-US lacks ${key}`);
});

test('the footer shares one left axis: card, phone-QR button, version and notes', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const sidebar = read('../src/components/workspaceSidebar.css');
  const monitor = read('../src/components/systemMonitor.css');
  const update = read('../src/components/remote/remoteAccess.css');
  const tree = read('../src/components/FileTree.tsx');
  // The card and the button carry the same 10px inset (the button's 1px border is taken off its padding).
  assert.match(monitor, /\.sysmon-card \{[^}]*padding: 0 10px;[^}]*background: transparent;/, 'the card has no fill of its own');
  assert.match(sidebar, /\.remote-shell \.file-tree-relay-action \{[^}]*justify-content: flex-start;[^}]*padding: 0 9px;/);
  assert.ok(!/\.remote-shell \.file-tree-relay-action \{[^}]*color:[^}]*accent/.test(sidebar), 'the button text colour is unchanged');
  assert.match(sidebar, /\.remote-shell \.file-tree-footer-note \{[^}]*text-align: left;[^}]*padding: 0 10px;/);
  assert.match(update, /\.remote-published-update \{[^}]*padding: 8px 10px 0;/);
  // Markup: icon, label, arrow; and both footer notes use the shared class instead of inline centring.
  assert.match(tree, /className="rel-ico"[\s\S]*<span>\{relayActionLabel\}<\/span>[\s\S]*className="rel-ico rel-go"/);
  assert.equal((tree.match(/className="file-tree-footer-note"/g) || []).length, 2);
});

test('the version is shown on its own, without a product prefix', async () => {
  const [zhCN, enUS] = [(await load('../src/i18n/locales/zh-CN.ts')).zhCN, (await load('../src/i18n/locales/en-US.ts')).enUS];
  assert.equal(zhCN['standalone.version'], '{version}');
  assert.equal(enUS['standalone.version'], '{version}');
});
