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
const reports = path.resolve(webDir, '../../build/reports/agent-discovery');

test('selector shows discovery, receives models while open, and retains real errors', async t => {
  const bundle = await build({ entryPoints: [path.join(webDir, 'tests/fixtures/agent-discovery.tsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' } });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 375, height: 650 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('http://agent-discovery.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/assets/agents/')) return route.fulfill({ contentType: 'image/svg+xml', body: readFileSync(path.join(webDir, 'public', pathname)) });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>' });
  });
  await page.goto('http://agent-discovery.test');
  const styles = ['src/index.css', 'src/ide.css'].map(file => readFileSync(path.join(webDir, file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => document.querySelector('button') || document.querySelector('#root')?.textContent);
  const trigger = page.getByRole('button').filter({ has: page.locator('.idea-agent-selector-label') });
  await expect(trigger).not.toContainText('!');
  await trigger.click();
  const menu = page.locator('[data-agent-menu]');
  await expect(menu.getByRole('status')).toHaveAccessibleName('正在识别 codex 的模型和运行选项…');
  await expect(menu).not.toContainText('probe pending');
  await expect(menu.getByRole('button', { name: '查看详情：codex' })).toHaveCount(0);
  const claudeRow = menu.locator('[data-agent-row="claude"]');
  await expect(claudeRow).toContainText('需要登录');
  await expect(claudeRow.locator('[data-agent-error-summary]')).toHaveText('Sign in required');
  await expect(claudeRow.getByRole('button', { name: '查看详情：claude' })).toHaveText('查看详情');
  await expect(menu.getByRole('status')).toHaveText('正在识别模型…');
  mkdirSync(reports, { recursive: true });
  await page.screenshot({ path: path.join(reports, 'pending.png') });
  await page.evaluate(() => window.setAgents([
    { name: 'codex', installed: true, available: true, models: [{ id: 'native', name: 'Native model' }] },
    { name: 'claude', installed: true, available: false, error: 'Sign in required' },
  ]));
  await expect(menu.getByRole('status')).toHaveCount(0);
  await menu.getByRole('button', { name: /展开 codex/ }).click();
  await expect(menu.getByRole('button', { name: 'Native model', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(reports, 'ready.png') });
  assert.equal(await page.evaluate(() => (window.restarts || []).length), 0, 'automatic discovery must not require restart');
  const detailsButton = menu.getByRole('button', { name: '查看详情：claude' });
  await detailsButton.focus();
  await page.keyboard.press('Enter');
  await expect(menu.locator('[data-agent-error-details="claude"]')).toContainText('Sign in required');
  await expect(detailsButton).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.setAgent('claude'));
  await expect(trigger).toContainText('需要登录');
  await trigger.click();
  await expect(menu.locator('[data-agent-error-details="claude"]')).toContainText('Sign in required');
  const restart = menu.getByRole('button', { name: '重启 Agent：claude' });
  await expect(restart).toHaveText('重启 Agent');
  await restart.click();
  await expect(menu.getByRole('button', { name: '正在重启…' })).toBeDisabled();
  assert.deepEqual(await page.evaluate(() => window.restarts), ['claude']);
  await page.evaluate(() => {
    window.finishRestart();
    window.setAgents([{ name: 'claude', installed: true, available: true, models: [{ id: 'recovered', name: 'Recovered model' }] }]);
  });
  await expect(menu.locator('[data-agent-error-details]')).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Recovered model', exact: true })).toBeVisible();
  const bounds = await menu.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375);

  for (const [width, theme, locale] of [[320, 'light', 'zh-CN'], [375, 'dark', 'en-US']]) {
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width, height: 650 });
    await page.evaluate(({ theme, locale }) => {
      document.documentElement.dataset.theme = theme;
      window.ideaAgent = { locale };
      window.dispatchEvent(new Event('ideaAgentReady'));
      window.setAgents([
        { name: 'codex', installed: true, available: false, error: JSON.stringify({ message: 'Agent startup timed out. Check your CLI configuration and try again.', data: { reason: 'Initialization deadline exceeded' } }) },
        { name: 'claude', installed: true, available: false, error: 'Sign in required' },
        { name: 'a-very-long-custom-agent-name', installed: true, available: false, probe_pending: true },
      ]);
      window.setAgent('codex');
    }, { theme, locale });
    await trigger.click();
    const row = menu.locator('[data-agent-row="codex"]');
    await expect(row.locator('[data-agent-error-summary]')).toContainText('Agent startup timed out.');
    await expect(menu.locator('[data-agent-error-details="codex"]')).toContainText('Initialization deadline exceeded');
    for (const control of await menu.locator('[data-agent-row="codex"] button, [data-agent-error-details] button').all()) {
      const rect = await control.boundingBox();
      if (rect && rect.width > 0) assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
    }
    assert.equal(await menu.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: path.join(reports, `visible-errors-${locale}-${width}.png`) });
  }
  assert.deepEqual(errors, []);
});
