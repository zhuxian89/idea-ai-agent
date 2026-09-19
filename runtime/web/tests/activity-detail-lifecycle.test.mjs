import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
const webDir = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const reportDir = path.resolve(webDir, '../../build/reports/activity-detail-lifecycle');
const styles = ['src/index.css', 'src/ide.css'].map(file => readFileSync(path.join(webDir, file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n');
const call = (text, status = 'running') => ({ kind: 'loaded', toolCall: { callId: 'call', kind: 'execute', status, content: [{ type: 'text', text }] } });

test('detail lifecycle in real shared cards and SessionViewer', async t => {
  const bundle = await build({ entryPoints: [path.join(webDir, 'tests/fixtures/activity-detail-lifecycle.tsx')],
    bundle: true, write: false, outdir: '/tmp/activity-detail-fixture', platform: 'browser', format: 'iife', jsx: 'automatic', external: ['mermaid'],
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' } });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  async function open(t, width = 375, theme = 'light') {
    const context = await browser.newContext({ viewport: { width, height: 720 }, reducedMotion: 'reduce' });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.clock.install({ time: new Date('2026-09-14T01:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-14T01:00:01Z'));
    await page.setContent('<!doctype html><html data-theme="' + theme + '"><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: styles + '\n#fixture { height: 700px; min-width: 0; } #fixture > article { padding: 12px; }' });
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    await page.locator('[data-card="primary"]').waitFor();
    return page;
  }
  const primary = page => page.locator('[data-card="primary"]');
  const header = page => primary(page).locator('button[aria-expanded]').first();
  const details = page => primary(page).locator('[data-activity-details]');
  const count = page => page.evaluate(() => window.requests.length);

  await t.test('explicit choices survive updates, locale, remount and session/root switches; shell closes explicitly', async t => {
    const page = await open(t);
    await expect(header(page)).toHaveAttribute('aria-expanded', 'false');
    await header(page).focus(); await page.keyboard.press('Enter');
    await expect(details(page)).toContainText('full output');
    await page.evaluate(() => { window.set({ visible: false }); });
    await expect(primary(page)).toHaveCount(0);
    await page.evaluate(() => window.set({ visible: true, sessionKey: 'B' }));
    await expect(header(page)).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => window.set({ sessionKey: 'A' }));
    await expect(header(page)).toHaveAttribute('aria-expanded', 'true');
    await page.evaluate(() => window.set({ rootId: 'other' }));
    await expect(header(page)).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => window.set({ rootId: 'root' }));
    await expect(header(page)).toHaveAttribute('aria-expanded', 'true');
    await header(page).click();
    await page.evaluate(() => { window.set({ defaultExpanded: true }); window.updateCall({ status: 'failed', meta: { command: 'echo shell', source: 'userShell' } }); window.locale('en-US'); });
    await expect(header(page)).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => window.updateCall({ callId: 'shell-new' }));
    await expect(header(page)).toHaveAttribute('aria-expanded', 'true');
    await header(page).click();
    await page.evaluate(() => window.updateCall({ content: [{ type: 'text', text: 'updated shell' }], status: 'complete' }));
    await expect(header(page)).toHaveAttribute('aria-expanded', 'false');
  });

  await t.test('no-call-ID uses local timeline identity and never requests remote detail', async t => {
    const page = await open(t);
    await page.evaluate(() => window.updateCall({ callId: '' }));
    await header(page).click();
    await page.evaluate(() => window.set({ localKey: 'local-2' }));
    await expect(header(page)).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => window.set({ localKey: 'local-1' }));
    await expect(header(page)).toHaveAttribute('aria-expanded', 'true');
    assert.equal(await count(page), 0);
  });

  await t.test('same call shares I/O; unmount cancels only its consumer; reused identities reject late data', async t => {
    const page = await open(t);
    await page.evaluate(() => { window.controlled = true; window.set({ duplicate: true }); });
    await header(page).click();
    await expect.poll(() => count(page)).toBe(1);
    await page.evaluate(() => window.set({ visible: false }));
    await expect(primary(page)).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.requests[0].signal.aborted), false);
    await page.evaluate(result => window.reply(0, result), call('first line\nA private output', 'complete'));
    await expect(page.locator('[data-card="duplicate"]')).toContainText('A private output');
    await page.evaluate(() => window.set({ visible: true, duplicate: false, sessionKey: 'B', defaultExpanded: true }));
    await expect.poll(() => count(page)).toBe(2);
    await expect(primary(page)).not.toContainText('A private output');
    await page.evaluate(() => window.set({ sessionKey: 'C' }));
    await expect.poll(() => count(page)).toBe(3);
    await page.evaluate(result => window.reply(1, result), call('first line\nB late output', 'complete'));
    await expect(primary(page)).not.toContainText('B late output');
    await page.evaluate(result => window.reply(2, result), call('first line\nC current output', 'complete'));
    await expect(primary(page)).toContainText('C current output');
    assert.equal(await page.evaluate(() => window.requests[1].signal.aborted), true);
  });

  await t.test('loading keeps inline content; missing/error stop polling; retry and terminal checks recover', async t => {
    const page = await open(t);
    await page.evaluate(() => { window.controlled = true; window.updateCall({ status: 'running' }); });
    await header(page).click();
    await expect(details(page)).toContainText('first line');
    await expect(details(page)).toContainText('加载中');
    await page.evaluate(() => window.reply(0, { kind: 'missing' }));
    await expect(details(page)).toContainText('暂未找到详情');
    await page.clock.runFor(5000);
    assert.equal(await count(page), 1);
    await header(page).click(); await header(page).click();
    assert.equal(await count(page), 1);
    const retry = details(page).getByRole('button', { name: '重试' });
    await retry.focus(); await page.keyboard.press('Enter');
    await page.evaluate(() => window.reply(1, { kind: 'unavailable', retryable: true, message: 'private error' }));
    await expect(retry).toBeFocused();
    await expect(details(page)).toContainText('详情加载失败');
    await expect(details(page)).not.toContainText('private error');
    await page.clock.runFor(3000);
    assert.equal(await count(page), 2);
    await page.evaluate(() => window.updateCall({ status: 'declined' }));
    await expect.poll(() => count(page)).toBe(3);
    await page.evaluate(result => window.reply(2, result), { ...call('first line\nfinal detail'), toolCall: { ...call('first line\nfinal detail').toolCall, activity: { schemaVersion: 1, agent: 'codex', origin: 'live', operation: 'execute', source: 'agent', outcome: 'completed' } } });
    await expect(header(page)).toContainText('未批准');
    await expect(details(page)).toContainText('final detail');
    await page.clock.runFor(3000);
    assert.equal(await count(page), 3);
    assert.equal(await page.evaluate(() => window.sessionEvents), 0);
  });

  await t.test('running logs poll once per second, preserve reading and fetch final after pending I/O', async t => {
    const page = await open(t);
    const log = 'first line\n' + Array.from({ length: 140 }, (_, i) => '日志 ' + i).join('\n');
    await page.evaluate(result => { window.remoteResult = result; window.updateCall({ status: 'running' }); }, call(log));
    await header(page).click();
    await expect(details(page)).toContainText('日志 139');
    assert.equal(await details(page).evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop < 48), true);
    await details(page).evaluate(el => { el.scrollTop = 80; el.dispatchEvent(new Event('scroll')); });
    await page.evaluate(result => { window.remoteResult = result; }, call(log + '\nnew output'));
    await page.clock.runFor(999);
    assert.equal(await count(page), 1);
    await page.clock.runFor(1);
    await expect(details(page)).toContainText('new output');
    assert.equal(await details(page).evaluate(el => el.scrollTop), 80);
    await page.evaluate(() => { window.controlled = true; });
    await page.clock.runFor(1000);
    await expect.poll(() => count(page)).toBe(3);
    await expect(details(page)).not.toContainText('加载中');
    assert.equal(await details(page).evaluate(el => el.scrollTop), 80);
    await page.evaluate(text => window.updateCall({ status: 'interrupted', content: [{ type: 'text', text }] }), log + '\nnew output\nlatest stream');
    await page.evaluate(result => window.reply(2, result), call(log));
    await expect(details(page)).toContainText('latest stream');
    await page.clock.runFor(1);
    await expect.poll(() => count(page)).toBe(4);
    await page.evaluate(result => window.reply(3, result), call(log + '\nnew output\nlatest stream\nfinal snapshot', 'complete'));
    await expect(header(page)).toContainText('已中断');
    await expect(details(page)).toContainText('final snapshot');
    await header(page).click();
    await page.clock.runFor(5000);
    assert.equal(await count(page), 4);
  });

  await t.test('collapsing running detail stops future reads; access errors remain readable without retry loops', async t => {
    const page = await open(t);
    await page.evaluate(result => { window.remoteResult = result; window.updateCall({ status: 'running' }); }, call('first line\nactive output'));
    await header(page).click();
    await expect(details(page)).toContainText('active output');
    await header(page).click();
    const stoppedAt = await count(page);
    await page.clock.runFor(5000);
    assert.equal(await count(page), stoppedAt);
    await page.evaluate(() => { window.remoteResult = { kind: 'unavailable', retryable: false, message: 'private' }; });
    await header(page).click();
    await expect(details(page)).toContainText('当前无法访问详情');
    await expect(details(page)).toContainText('active output');
    await expect(details(page).getByRole('button', { name: '重试' })).toHaveCount(0);
    await page.clock.runFor(3000);
    assert.equal(await count(page), stoppedAt + 1);
    await header(page).click();
    await page.evaluate(() => window.updateCall({ status: 'failed', content: [{ type: 'text', text: 'latest failed output' }] }));
    await expect(header(page)).toHaveAttribute('aria-expanded', 'false');
    assert.equal(await count(page), stoppedAt + 1);
  });

  await t.test('copy preserves full raw text and focus, with localized success and failure', async t => {
    const page = await open(t);
    const output = 'first line\n' + '\u001b[32m完整原始输出\u001b[0m\n'.repeat(400);
    await page.evaluate(result => { window.remoteResult = result; }, call(output, 'complete'));
    await header(page).click();
    const commandButton = details(page).getByRole('button', { name: '复制命令' });
    await commandButton.focus(); await page.keyboard.press('Enter');
    await expect(commandButton).toBeFocused();
    await expect(details(page)).toContainText('已复制');
    const outputButton = details(page).getByRole('button', { name: '复制输出' });
    await outputButton.click();
    assert.deepEqual(await page.evaluate(() => window.copied), ["  printf '原始命令'\n  ", output]);
    await page.evaluate(() => { window.failCopy = true; window.locale('en-US'); });
    await details(page).getByRole('button', { name: 'Copy output' }).click();
    await expect(details(page)).toContainText('Copy failed');
    await expect(details(page).getByRole('button', { name: 'Copy output' })).toBeFocused();
    assert.equal(await page.evaluate(() => window.sessionEvents), 0);
  });

  await t.test('SessionViewer suspends outer following while reading, then jump-latest resumes it', async t => {
    const page = await open(t, 720);
    await page.evaluate(() => window.set({ viewer: true }));
    const tool = page.locator('[data-activity-reading]');
    await tool.locator('button[aria-expanded]').click();
    await expect(page.getByRole('button', { name: '回到底部最新消息' })).toBeVisible();
    // Select the actual SessionViewer scroll root, independent of decorative wrappers.
    await page.evaluate(() => {
      let el = document.querySelector('[data-activity-reading]');
      while (el && !(getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight)) el = el.parentElement;
      window.outerScroll = el;
      window.beforeScroll = el.scrollTop;
      window.append('新的进展文字\n\n'.repeat(20));
    });
    await expect(tool).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.outerScroll.scrollTop)).toBe(await page.evaluate(() => window.beforeScroll));
    await page.getByRole('button', { name: '回到底部最新消息' }).click();
    await page.clock.runFor(1000);
    await page.evaluate(() => window.append('最后一条进展'));
    await expect.poll(() => page.evaluate(() => window.outerScroll.scrollHeight - window.outerScroll.clientHeight - window.outerScroll.scrollTop)).toBeLessThan(40);
  });

  await t.test('SessionViewer exits reading mode after manually scrolling to the latest message', async t => {
    const page = await open(t, 720);
    await page.evaluate(() => window.set({ viewer: true }));
    await page.locator('[data-activity-reading] button[aria-expanded]').click();
    const jumpToLatest = page.getByRole('button', { name: '回到底部最新消息' });
    await expect(jumpToLatest).toBeVisible();
    await page.evaluate(() => {
      let el = document.querySelector('[data-activity-reading]');
      while (el && !(getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight)) el = el.parentElement;
      window.outerScroll = el;
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(jumpToLatest).toHaveCount(0);
    await page.evaluate(() => window.append('手动到底后的新进展'));
    await expect.poll(() => page.evaluate(() => window.outerScroll.scrollHeight - window.outerScroll.clientHeight - window.outerScroll.scrollTop)).toBeLessThan(40);
  });

  await t.test('light/dark 320/375/720 layouts keep feedback, logs and keyboard controls within the sidebar', async t => {
    mkdirSync(reportDir, { recursive: true });
    for (const theme of ['light', 'dark']) for (const width of [320, 375, 720]) {
      const page = await open(t, width, theme);
      await page.evaluate(() => { window.remoteResult = { kind: 'unavailable', retryable: true, message: 'hidden' }; window.updateCall({ meta: { command: 'node scripts/check-project.mjs --all --verbose' }, content: [{ type: 'text', text: '读取配置…\n' + '长路径/'.repeat(80) + '\n已检查 28 个文件。' }] }); });
      await header(page).click();
      await expect(details(page)).toContainText('详情加载失败');
      await details(page).getByRole('button', { name: '重试' }).focus();
      assert.equal(await page.locator('#fixture').evaluate(el => el.scrollWidth > el.clientWidth), false);
      if (process.env.ACTIVITY_CAPTURE !== '0') await page.screenshot({ path: path.join(reportDir, `${theme}-${width}.png`), fullPage: true });
    }
  });
});
