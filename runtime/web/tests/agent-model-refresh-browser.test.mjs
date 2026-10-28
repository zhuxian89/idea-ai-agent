import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');

test('composer refresh button uses startup discovery without changing session or draft', async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { ActionBar } from './src/components/ActionBar';
      import { I18nProvider } from './src/i18n';
      import { bootstrapService } from './src/services/bootstrap';
      bootstrapService.canUseProtectedAPI = () => true;
      window.ideaAgent = { locale: 'zh-CN' };
      window.calls = []; window.phase = 'old'; window.fail = false;
      const original = window.fetch;
      window.fetch = async (url, options = {}) => {
        const path = String(url);
        if (path.includes('/api/agents')) {
          window.calls.push({ path, method: options.method, body: options.body });
          if (path.endsWith('/probe')) {
            if (window.fail) return Response.json({ error: 'Discovery unavailable' }, { status: 503 });
            window.phase = 'pending';
            await new Promise(resolve => { window.acceptProbe = resolve; });
            return Response.json({ probing: true });
          }
          const model = window.phase === 'new' ? 'new-model' : 'old-model';
          return Response.json({ agents: ['codex', 'claude'].map(name => ({ name, installed: true,
            available: window.phase !== 'pending', probe_pending: window.phase === 'pending',
            models: [{ id: model, name: model }], default_model_id: model })), shells: [] });
        }
        if (path.includes('/api/')) return Response.json([]);
        return original(url, options);
      };
      function App() {
        const [version, setVersion] = useState(0);
        window.notifyStatus = () => setVersion(value => value + 1);
        return <I18nProvider><main className="idea-workbench" style={{paddingTop: 400}}><ActionBar compactWorkbench status="connected"
          agentsVersion={version} currentRootId="root" currentSession={{ key:'session', name:'Keep session', type:'chat', agent:'codex', model:'old-model', mode:'read-only' }}
          onSendMessage={() => { throw new Error('Refresh must not send a message'); }} /></main></I18nProvider>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` }, bundle: true, write: false, outdir: '/tmp/agent-model-refresh-fixture', format: 'iife', jsx: 'automatic',
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' },
  });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('http://model-refresh.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>' }));
  await page.route('**/assets/agents/*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: readFileSync(new URL(`../public${new URL(route.request().url()).pathname}`, import.meta.url)) }));
  await page.goto('http://model-refresh.test');
  await page.addStyleTag({ content: ['index.css', 'ide.css'].map(name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n') });
  for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  const trigger = page.locator('[data-onboarding="agent-selector"] > button');
  await expect(trigger).toContainText('Codex · old-model');
  const editor = page.locator('[contenteditable="true"]');
  await editor.fill('Keep my draft');
  await trigger.click();
  const menu = page.locator('[data-agent-menu]');
  const refresh = menu.getByRole('button', { name: '刷新 Codex 的模型列表', exact: true });
  await refresh.focus();
  await page.keyboard.press('Enter');
  await expect(refresh).toBeDisabled();
  await expect(refresh).toContainText('刷新中');
  await expect(menu.getByRole('button', { name: 'old-model', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.path.endsWith('/probe')).length), 1);
  await page.evaluate(() => window.acceptProbe());
  await expect(refresh).toBeDisabled();
  await page.evaluate(() => { window.phase = 'new'; window.notifyStatus(); });
  await expect(refresh).toBeEnabled();
  await expect(menu.getByRole('status')).toContainText('模型列表已更新');
  await expect(menu.getByRole('button', { name: 'new-model', exact: true })).toBeVisible();
  await expect(trigger).toContainText('Codex · old-model');
  await expect(editor).toHaveText('Keep my draft');
  assert.ok((await page.evaluate(() => window.calls)).every(call => !/restart|test-connection|refresh-models/.test(call.path)));

  await page.evaluate(() => { window.fail = true; });
  await refresh.click();
  await expect(menu.getByRole('alert')).toContainText('刷新失败');
  await expect(menu.getByRole('alert')).toContainText('Discovery unavailable');
  await expect(refresh).toBeEnabled();
  await expect(menu.getByRole('button', { name: 'new-model', exact: true })).toBeVisible();

  const directory = new URL('../../../output/playwright/model-refresh/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  for (const theme of ['light', 'dark']) {
    for (const width of [320, 420]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await refresh.focus();
      await expect(refresh).toBeFocused();
      await page.screenshot({ path: fileURLToPath(new URL(`${theme}-${width}.png`, directory)) });
      await expect.poll(async () => {
        const bounds = await refresh.boundingBox();
        return bounds.x >= 0 && bounds.x + bounds.width <= width;
      }).toBe(true);
      assert.equal(await menu.evaluate(el => el.scrollWidth > el.clientWidth), false);
      await page.screenshot({ path: fileURLToPath(new URL(`${theme}-${width}.png`, directory)) });
    }
  }
  await page.evaluate(() => { window.ideaAgent.locale = 'en-US'; window.dispatchEvent(new Event('ideaAgentReady')); });
  await expect(menu.getByRole('button', { name: 'Refresh Codex model list' })).toHaveText('Refresh models');
  await expect(menu.getByRole('alert')).toContainText('Refresh failed');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
