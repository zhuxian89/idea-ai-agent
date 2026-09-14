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
const reports = path.resolve(webDir, '../../build/reports/session-message-layout');
const phase = process.env.MESSAGE_LAYOUT_BASELINE ? 'baseline' : 'fixed';
const styles = ['src/index.css', 'src/ide.css'].map(file => readFileSync(path.join(webDir, file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n');

test('user messages align to the conversation edge across activity groups', async t => {
  const bundle = await build({ entryPoints: [path.join(webDir, 'tests/fixtures/activity-segment-grouping.tsx')],
    bundle: true, write: false, outdir: '/tmp/message-layout-fixture', platform: 'browser', format: 'iife', jsx: 'automatic', external: ['mermaid'],
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' } });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  mkdirSync(reports, { recursive: true });
  for (const agent of ['codex', 'claude']) for (const width of [375, 1080]) {
    await t.test(`${agent} at ${width}px: short text, long text and image attachments`, async t => {
      const page = await browser.newPage({ locale: 'zh-CN', viewport: { width, height: 760 }, reducedMotion: 'reduce' });
      t.after(() => page.close());
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(5000);
      await page.route('http://message-layout.test/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith('/assets/agents/')) return route.fulfill({ contentType: 'image/svg+xml', body: readFileSync(path.join(webDir, 'public', pathname)) });
        if (pathname === '/api/file') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><rect width="320" height="100" fill="#475569"/><text x="16" y="55" fill="white" font-size="18">Attachment fixture</text></svg>' });
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>' });
      });
      await page.goto('http://message-layout.test');
      await page.addStyleTag({ content: styles + '\n#fixture { height: 100vh; min-width: 0; }' });
      for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
      await page.locator('[data-user-message-index]').waitFor();
      await page.evaluate(agent => {
        const timestamp = new Date().toISOString();
        window.setSession({ agent, pending: false, exchanges: [
          { role: 'user', agent, seq: 1, timestamp, content: '今天有什么新闻？' },
          { role: 'assistant', agent, seq: 2, timestamp, content: '我会先查阅资料，再整理值得关注的消息。' },
          ...[3, 4, 5].map(seq => ({ role: 'tool', agent, seq, toolCall: window.call('layout-' + seq) })),
          { role: 'user', agent, seq: 6, timestamp, content: '请保留来源和具体日期。'.repeat(24) + '\n' + 'long-path/'.repeat(24) },
          { role: 'assistant', agent, seq: 7, timestamp, content: '已核对资料。' },
          { role: 'user', agent, seq: 8, timestamp, content: '这张图也看一下\n[file: .mindfs/upload/layout.png]' },
        ] });
      }, agent);
      const users = page.locator('[data-user-message-index]');
      await expect(users).toHaveCount(3);
      await expect(page.locator('[data-user-message-index="3"] img')).toHaveJSProperty('complete', true);
      await expect.poll(() => page.locator('[data-user-message-index="3"] img').evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
      await expect(page.locator('[data-activity-group]')).toHaveCount(1);
      await page.screenshot({ path: path.join(reports, `${phase}-${agent}-${width}.png`), fullPage: true });
      const checkAlignment = async () => {
        const content = await page.locator('[data-mindfs-session-content-width]').evaluate(el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
        });
        const boxes = await users.evaluateAll(nodes => nodes.map(node => {
          const rect = node.getBoundingClientRect();
          const bubble = node.querySelector(':scope > div > div').getBoundingClientRect();
          const meta = node.querySelector(':scope > div > span').getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width, top: rect.top, bottom: rect.bottom, bubbleRight: bubble.right, metaRight: meta.right };
        }));
        for (const box of boxes) {
          assert.ok(Math.abs(box.right - content.right) < 1, `user right edge ${box.right} must match conversation edge ${content.right}`);
          assert.ok(Math.abs(box.bubbleRight - content.right) < 1, 'bubble must reach the same right edge');
          assert.ok(Math.abs(box.metaRight - content.right) < 1, 'message actions must follow their bubble');
          assert.ok(box.width <= (content.right - content.left) * 0.8 + 1, 'long messages must retain their width limit');
        }
        for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].top >= boxes[i - 1].bottom, 'message order and vertical flow must be preserved');
        const assistant = await page.locator('[data-session-seq="2"]').boundingBox();
        assert.ok(Math.abs(assistant.x - content.left) < 1, 'assistant text remains aligned left');
        assert.ok(Math.abs(assistant.x + assistant.width - content.right) < 1, 'assistant text keeps full content width');
        assert.equal(await page.locator('[data-mindfs-session-content-width]').evaluate(el => el.scrollWidth > el.clientWidth), false);
      };
      await checkAlignment();
      const groupButton = page.locator('[data-activity-group] button');
      await groupButton.click();
      await expect(page.locator('[data-tool-activity]')).toHaveCount(3);
      await checkAlignment();
      await groupButton.click();
      for (const member of await page.locator('[data-activity-member]').all()) await expect(member).toBeHidden();
      await page.evaluate(() => window.append({ role: 'assistant', seq: 9, content: '图片已收到。' }));
      await checkAlignment();
      assert.deepEqual(errors, []);
    });
  }
});
