import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const web = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const reports = path.resolve(web, '../../build/reports/activity-ide-readiness');
const styles = ['src/index.css', 'src/ide.css'].map(file => readFileSync(path.join(web, file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n');

test('activity readiness: layout, access and bounded large histories', async t => {
  mkdirSync(reports, { recursive: true });
  const bundle = await build({ entryPoints: [path.join(web, 'tests/fixtures/activity-segment-grouping.tsx')], bundle: true, write: false,
    outdir: '/tmp/activity-readiness', platform: 'browser', format: 'iife', jsx: 'automatic', external: ['mermaid'],
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' } });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  async function open(t, width = 720, theme = 'light', zoom = 1) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.setContent(`<html data-theme="${theme}"><body><div id="root"></div></body></html>`);
    await page.addStyleTag({ content: styles + `\n#fixture {height:100vh;min-width:0} body {zoom:${zoom}}` });
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    await page.locator('[data-tool-activity]').first().waitFor();
    return page;
  }
  const button = page => page.locator('[data-activity-group] button').first();

  await t.test('16 width/theme/zoom combinations and keyboard/contrast targets', async t => {
    const matrix = [];
    for (const theme of ['light', 'dark']) for (const width of [320, 375, 480, 720]) for (const zoom of [1, 1.5]) {
      const page = await open(t, width, theme, zoom);
      await page.evaluate(() => window.setSession({ pending: false, exchanges: [
        ...window.exchanges([1, 2, 3].map(i => window.call('c' + i))),
        {role: 'assistant', seq: 3, agent: 'codex', content: '检查完成。验证结果如下。'},
        {role: 'tool', agent: 'codex', toolCall: window.call('long', {title: '/项目/很长的目录/'.repeat(25), status: 'failed'})},
      ] }));
      await expect(button(page)).toHaveAttribute('aria-expanded', 'false');
      // Reach the disclosure through the actual tab order, then exercise both keys.
      for (let i = 0; i < 15 && !(await button(page).evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab');
      await expect(button(page)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(button(page)).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Space');
      await expect(button(page)).toHaveAttribute('aria-expanded', 'false');
      const measurement = await button(page).evaluate(el => {
        const style = getComputedStyle(el), rect = el.getBoundingClientRect();
        const luminance = rgb => rgb.slice(0, 3).map(v => {v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;}).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        let parent = el, background;
        while (parent) { const color = getComputedStyle(parent).backgroundColor; if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { background = color; break; } parent = parent.parentElement; }
        const bg = luminance((background || 'rgb(255,255,255)').match(/[\d.]+/g).map(Number));
        const fg = luminance(style.color.match(/[\d.]+/g).map(Number));
        return {contrast: (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05), width: rect.width, height: rect.height,
          outline: style.outlineStyle, overflow: document.documentElement.scrollWidth > innerWidth || document.querySelector('#fixture').scrollWidth > document.querySelector('#fixture').clientWidth};
      });
      assert.equal(measurement.overflow, false, `${theme}/${width}/${zoom} overflow`);
      assert.equal(measurement.outline, 'solid');
      assert.ok(measurement.width >= 24 && measurement.height >= 24);
      assert.ok(measurement.contrast >= 4.5, JSON.stringify(measurement));
      matrix.push({theme, width, zoom, ...measurement});
      if (process.env.ACTIVITY_CAPTURE === '1' && [320, 480].includes(width) && zoom === 1.5) await page.screenshot({path: path.join(reports, `${theme}-${width}-150.png`)});
      await page.close();
    }
    writeFileSync(path.join(reports, 'layout.json'), JSON.stringify(matrix, null, 2));
  });

  await t.test('1000 items: alternating same-machine flat/grouped render measurements', async t => {
    const page = await open(t);
    const samples = [];
    for (let round = 0; round < 6; round++) for (const grouped of (round % 2 ? [true, false] : [false, true])) {
      await page.evaluate(() => window.setSession({exchanges: []}));
      await expect(page.locator('[data-activity-group], [data-tool-activity]')).toHaveCount(0);
      const sample = await page.evaluate(async grouped => {
        const calls = Array.from({length: 1000}, (_, i) => window.call('many-' + i));
        const exchanges = window.exchanges(calls);
        // The flat baseline is the same F1–F6 UI with the tail still open.
        const start = performance.now();
        window.setSession({pending: !grouped, exchanges});
        const selector = grouped ? '[data-activity-group]' : '[data-tool-activity]';
        await new Promise(resolve => {
          const check = () => document.querySelectorAll(selector).length === (grouped ? 1 : 1000) ? requestAnimationFrame(resolve) : requestAnimationFrame(check);
          requestAnimationFrame(check);
        });
        return {grouped, renderMs: performance.now() - start, nodes: document.querySelectorAll('#fixture *').length,
          details: document.querySelectorAll('[data-activity-details], pre').length, requests: window.requests.length};
      }, grouped);
      assert.equal(sample.requests, 0); assert.equal(sample.details, 0);
      samples.push({round, ...sample});
    }
    const median = values => values.sort((a,b) => a-b)[Math.floor(values.length/2)];
    const result = {baseline: 'same current UI, open flat tail versus completed grouped tail; first round warmup excluded; one animation frame after DOM commit; not a pre-F1 benchmark',
      browser: browser.version(), samples,
      medianMs: Object.fromEntries([false,true].map(grouped => [grouped ? 'grouped' : 'flat', median(samples.filter(s => s.round > 0 && s.grouped === grouped).map(s => s.renderMs))]))};
    writeFileSync(path.join(reports, 'performance.json'), JSON.stringify(result, null, 2));
  });

  await t.test('1 MiB running log: exact snapshots, reading position and zero collapsed polling', async t => {
    const page = await open(t);
    await page.clock.install();
    await page.evaluate(() => { window.detailText.large = ('x'.repeat(127) + '\n').repeat(8192); window.setSession({pending: true, exchanges: window.exchanges([window.call('large', {status: 'running'})])}); });
    const header = page.locator('[data-tool-activity="large"] button[aria-expanded]').first();
    const detail = page.locator('[data-activity-details]');
    await page.clock.runFor(3000);
    assert.equal(await page.evaluate(() => window.requests.length), 0);
    await expect(detail).toHaveCount(0);
    await header.click();
    await expect(detail).toBeVisible();
    const pre = detail.locator('pre').last();
    await expect.poll(() => pre.textContent().then(s => s.length)).toBe(1024 * 1024);
    for (let i = 1; i <= 3; i++) {
      await page.evaluate(i => { window.detailText.large += '\nupdate-' + i; window.updateCall('large', {title: '日志更新 ' + i}); }, i);
      await detail.evaluate(el => {el.scrollTop = 50; el.dispatchEvent(new Event('scroll'));});
      await page.clock.runFor(1100);
      await expect.poll(() => pre.textContent()).toBe(await page.evaluate(() => window.detailText.large));
      assert.equal(await detail.evaluate(el => el.scrollTop), 50);
    }
    await header.click();
    await expect(detail).toHaveCount(0);
    const requests = await page.evaluate(() => window.requests.length);
    await page.clock.runFor(4000);
    assert.equal(await page.evaluate(() => window.requests.length), requests);
    writeFileSync(path.join(reports, 'large-log.json'), JSON.stringify({bytes: 1024*1024, updates: 3, exactContent: true, scrollTop: 50, collapsedRequests: 0}, null, 2));
  });
});
