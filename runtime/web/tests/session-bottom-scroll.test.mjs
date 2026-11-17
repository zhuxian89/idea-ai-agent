import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const webDir = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const bundle = await build({ entryPoints: [path.join(webDir, 'tests/fixtures/activity-segment-grouping.tsx')],
  bundle: true, write: false, outdir: '/tmp/session-bottom-scroll', platform: 'browser', format: 'iife', jsx: 'automatic', external: ['mermaid'],
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' } });

test('return-to-bottom follows distance, not activity focus or exact pixel alignment', async t => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  for (const width of [375, 1080]) {
    async function open(t) {
      const page = await browser.newPage({ locale: 'zh-CN', viewport: { width, height: 760 }, hasTouch: width === 375, reducedMotion: 'reduce' });
      t.after(() => page.close());
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      t.after(() => assert.deepEqual(errors, []));
      await page.setContent('<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>');
      await page.addStyleTag({ content: ['index.css', 'ide.css'].map(file => readFileSync(path.join(webDir, 'src', file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n') + '\n#fixture { height:100vh; min-width:0; }' });
      for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
      await page.waitForFunction(() => typeof window.setSession === 'function');
      await page.evaluate(() => {
        window.locale('zh-CN');
        window.setSession({ pending: false, exchanges: [
          { role:'assistant', seq:1, agent:'codex', content:'这是会话中的历史消息。\n\n'.repeat(80) },
          { role:'tool', agent:'codex', toolCall:window.call('last-tool') },
        ] });
      });
      const scroll = page.locator('[data-mindfs-session-content-width]').locator('..');
      await expect.poll(() => scroll.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(600);
      await expect.poll(() => distance(scroll)).toBeLessThan(1);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return {page, scroll, button:page.getByRole('button', {name:'回到底部最新消息', exact:true}), activity:page.locator('[data-activity-reading]').last()};
    }
    const distance = scroll => scroll.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
    const move = async (scroll, gap) => {
      await scroll.evaluate((el, gap) => { el.scrollTop = el.scrollHeight - el.clientHeight - gap; el.dispatchEvent(new Event('scroll')); }, gap);
      if (gap > 120) await expect.poll(() => distance(scroll)).toBeCloseTo(gap, 0);
      else await expect.poll(() => distance(scroll)).toBeLessThanOrEqual(gap);
    };

    await t.test(`${width}px: touching or focusing activity at the bottom does not show the button`, async t => {
      const {activity, button} = await open(t);
      await activity.dispatchEvent('pointerdown', {pointerType:width === 375 ? 'touch' : 'mouse'});
      await expect(button).toHaveCount(0);
      await activity.dispatchEvent('focusin');
      await expect(button).toHaveCount(0);
    });

    await t.test(`${width}px: returning within 120px hides the button while reading activity`, async t => {
      const {page, scroll, activity, button} = await open(t);
      await move(scroll, 350);
      await activity.dispatchEvent('pointerdown', {pointerType:'touch'});
      await expect(button).toBeVisible();
      await move(scroll, 80);
      await expect(button).toHaveCount(0);
      mkdirSync(path.join(webDir, '../../output/playwright/session-bottom'), {recursive:true});
      await page.screenshot({path:path.join(webDir, `../../output/playwright/session-bottom/near-${width}.png`)});
      // A small upward correction near the bottom must not flash the button.
      await move(scroll, 110);
      await expect(button).toHaveCount(0);
      await move(scroll, 300);
      await expect(button).toBeVisible();
      await button.click();
      await expect.poll(() => distance(scroll)).toBeLessThan(1);
      await expect(button).toHaveCount(0);
    });

    await t.test(`${width}px: paused reading stays put as content grows and resumes after returning near bottom`, async t => {
      const {page, scroll, activity, button} = await open(t);
      await activity.dispatchEvent('pointerdown', {pointerType:'touch'});
      const original = await scroll.evaluate(el => el.scrollTop);
      await page.evaluate(() => window.append({role:'assistant', seq:2, content:'新的回复内容。\n\n'.repeat(35)}));
      await expect(button).toBeVisible();
      assert.equal(await scroll.evaluate(el => el.scrollTop), original, 'reading activity must not be pulled away by new content');
      await move(scroll, 80);
      await expect(button).toHaveCount(0);
      await page.evaluate(() => window.append({role:'assistant', seq:3, content:'继续追加一条消息。'}));
      await expect.poll(() => distance(scroll)).toBeLessThan(1);
      await expect(button).toHaveCount(0);
    });
  }
});
