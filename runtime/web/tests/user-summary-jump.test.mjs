import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const webDir = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const styles = ['src/index.css', 'src/ide.css'].map(file => readFileSync(path.join(webDir, file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n');

test('user message summary jumps to the chosen message in a 120-turn conversation', async t => {
  const bundle = await build({ entryPoints: [path.join(webDir, 'tests/fixtures/user-summary-jump.tsx')],
    bundle: true, write: false, outdir: '/tmp/user-summary-jump-fixture', platform: 'browser', format: 'iife', jsx: 'automatic', external: ['mermaid'],
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' } });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1080, height: 760 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.route('http://summary-jump.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>' }));
  await page.goto('http://summary-jump.test');
  await page.addStyleTag({ content: styles + '\n#fixture { height: 100vh; min-width: 0; }' });
  for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.locator('[data-user-message-index]').first().waitFor();

  // Summary entries carry the message seq (1, 3, 5, ...), not "n-th user message".
  // Entries near the end have a seq larger than the number of user messages (120).
  for (const turn of [10, 60, 119]) {
    await page.locator('.idea-user-summary-button').click();
    await page.locator('.idea-user-summary-menu button', { hasText: new RegExp(`^问题 ${turn}$`) }).click();
    const target = page.locator(`[data-session-seq="${(turn - 1) * 2 + 1}"]`);
    await expect.poll(async () => {
      const box = await target.boundingBox();
      return box ? box.y > 0 && box.y + box.height < 760 : false;
    }, { message: `问题 ${turn} must be scrolled into view` }).toBe(true);
  }
  if (errors.length) throw new Error(errors.join('\n'));
});
