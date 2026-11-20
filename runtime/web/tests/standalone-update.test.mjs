import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { after, test } from 'node:test';

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
  mkdirSync(dir, { recursive: true });
  const file = new URL(`standalone-update-${Math.random().toString(36).slice(2)}.mjs`, dir);
  writeFileSync(file, bundle.outputFiles[0].text);
  written.push(file);
  return import(file.href);
}

const service = await load('../src/services/standaloneUpdate.ts');
const view = await load('../src/components/remote/StandaloneUpdateAction.tsx');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { nextUpdateUi: next, initialUpdateUi: start } = service;
const status = (phase, extra = {}) => ({ type: 'status', status: { supported: true, phase, current: '0.1.52', ...extra } });

test('a backend without the endpoint offers no button, only the release link', () => {
  const ui = next(start, { type: 'unsupported' });
  assert.deepEqual([ui.step, ui.supported], ['idle', false]);
});

test('an idle backend that supports updates is ready for a request', () => {
  const ui = next(start, status('idle'));
  assert.deepEqual([ui.step, ui.supported], ['idle', true]);
});

test('an update already running is shown again after the page is reloaded', () => {
  const ui = next(start, status('installing', { target: '0.1.53' }));
  assert.deepEqual([ui.step, ui.target], ['installing', '0.1.53']);
});

test('losing the connection during an update means the backend is restarting, not that it failed', () => {
  let ui = next(start, status('installing', { target: '0.1.53' }));
  ui = next(ui, { type: 'unreachable', at: 1000 });
  assert.equal(ui.step, 'reconnecting');
  ui = next(ui, { type: 'unreachable', at: 60_000 });
  assert.equal(ui.step, 'reconnecting', 'a minute of silence is normal while the service restarts');
  ui = next(ui, status('done', { target: '0.1.53', current: '0.1.53' }));
  assert.equal(ui.step, 'done');
  assert.equal(ui.lostAt, 0);
});

test('a backend that never comes back is reported after the limit', () => {
  let ui = next(start, status('installing', { target: '0.1.53' }));
  ui = next(ui, { type: 'unreachable', at: 1000 });
  ui = next(ui, { type: 'unreachable', at: 1000 + service.RECONNECT_LIMIT_MS + 1 });
  assert.deepEqual([ui.step, ui.error], ['failed', 'reconnect_timeout']);
});

test('a page already served by the new version does not reload again', () => {
  const completed = status('done', { target: '0.1.53', current: '0.1.53' });
  assert.equal(next(start, { ...completed, pageVersion: '0.1.52' }).step, 'done');
  assert.equal(next(start, { ...completed, pageVersion: '0.1.53' }).step, 'idle');
});

test('a lost connection while nothing is updating changes nothing', () => {
  const idle = next(start, status('idle'));
  assert.equal(next(idle, { type: 'unreachable', at: 5 }), idle);
});

test('a failed update shows the installer output and can be dismissed for a retry', () => {
  let ui = next(start, status('failed', { target: '0.1.53', error: 'the installer exited with code 1', log: 'cp: NOTICE.md: No such file' }));
  assert.deepEqual([ui.step, ui.error, ui.log], ['failed', 'the installer exited with code 1', 'cp: NOTICE.md: No such file']);
  ui = next(ui, { type: 'dismiss' });
  assert.deepEqual([ui.step, ui.error], ['idle', '']);
  ui = next(start, { type: 'startFailed', error: 'HTTP 409' });
  assert.deepEqual([ui.step, ui.error], ['failed', 'HTTP 409']);
});

const props = (ui, extra = {}) => ({ ui: { ...start, supported: true, step: 'idle', ...ui }, latest: '0.1.53', available: true, zh: true, onStart() {}, onDismiss() {}, releaseURL: 'https://example.invalid/r', ...extra });
const render = (p) => renderToStaticMarkup(React.createElement(view.StandaloneUpdateAction, p));

test('with a new version the primary action is the update and the release link stays secondary', () => {
  const html = render(props({}));
  assert.match(html, /remote-update-primary[^>]*>立即更新</);
  assert.match(html, /remote-update-secondary[^>]*>查看新版</);
  assert.ok(html.includes('更新会重启后台，进行中的会话会中断，聊天记录保留。'));
  for (const text of ['更新到 0.1.53？', '正在运行的会话会中断', '聊天记录、端口和远程绑定保留', '安装失败时会尝试恢复后台', '更新并重启', '取消']) {
    assert.ok(html.includes(text), `the confirmation says: ${text}`);
  }
});

test('while updating there is progress and no second way to start', () => {
  const html = render(props({ step: 'installing', target: '0.1.53' }));
  assert.ok(html.includes('正在更新到 0.1.53…') && html.includes('remote-update-bar'));
  assert.ok(!html.includes('立即更新') && !html.includes('<dialog'));
  assert.ok(render(props({ step: 'reconnecting', target: '0.1.53' })).includes('后台正在重启，页面会自动重新连接…'));
});

test('done confirms the new version and failure keeps the old one and offers a retry', () => {
  assert.ok(render(props({ step: 'done', target: '0.1.53' })).includes('已更新到 0.1.53，聊天记录已保留。'));
  const failed = render(props({ step: 'failed', error: 'the installer exited with code 1', log: 'boom' }));
  assert.ok(failed.includes('更新没有完成。') && failed.includes('重试') && failed.includes('boom'));
  const lost = render(props({ step: 'failed', error: 'reconnect_timeout' }));
  assert.ok(lost.includes('更新后一直连不上这台电脑。') && !lost.includes('reconnect_timeout'));
});

test('the English texts exist too', () => {
  const html = render(props({}, { zh: false }));
  assert.ok(html.includes('Update now') && html.includes('Update to 0.1.53?') && html.includes('Update and restart'));
});

test('the update action replaces the link only when the backend supports it, in both places the row is used', () => {
  const source = readFileSync(new URL('../src/components/remote/RemoteBrowserUpdate.tsx', import.meta.url), 'utf8');
  assert.match(source, /update\.ui\.supported && \(update\.ui\.step !== "idle" \|\| \(available && !error\)\)/);
  assert.match(source, /<StandaloneUpdateAction/);
  assert.match(source, /: available && !error \? <div className="remote-update-action">[\s\S]*查看新版/, 'the plain link remains for backends without the endpoint');
  const service = readFileSync(new URL('../src/services/standaloneUpdate.ts', import.meta.url), 'utf8');
  assert.match(service, /\/api\/standalone\/update/);
});
