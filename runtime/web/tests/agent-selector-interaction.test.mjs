import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');

test('remote and plugin composers allow continuous agent settings selection and send effective defaults', async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { ActionBar } from './src/components/ActionBar';
      import { I18nProvider } from './src/i18n';
      import { bootstrapService } from './src/services/bootstrap';
      bootstrapService.canUseProtectedAPI = () => true;
      window.ideaAgent = { locale: 'zh-CN' };
      window.sent = [];
      const agents = ['codex', 'claude', 'acp'].map(name => ({ name, installed: true, available: true,
        protocol: name === 'codex' ? 'codex-sdk' : name === 'claude' ? 'claude-sdk' : 'acp',
        default_model_id: 'model-one', current_model_id: 'model-one', default_effort: 'medium',
        supports_fast_service: true, default_fast_service: 'on', efforts: ['low', 'medium', 'high'],
        models: [{id:'model-one', name:'Model One', supportEffort:true}, {id:'model-two', name:'Model Two', supportEffort:true},
          {id:'limited', name:'Limited', supportEffort:true, efforts:['low', 'medium']}, {id:'no-effort', name:'No Effort'}],
        modes: [{id:'first-mode', name:'First Mode'}, {id:'second-mode', name:'Second Mode'}], current_mode_id:'second-mode',
      }));
      const original = window.fetch;
      window.fetch = async (url, options) => String(url).includes('/api/agents')
        ? Response.json({ agents, shells: [] }) : String(url).includes('/api/') ? Response.json([]) : original(url, options);
      function App() {
        const [session, setSession] = useState(null);
        window.setSession = setSession;
        return <I18nProvider><main className={location.search ? 'idea-workbench' : ''} style={{padding:16, paddingTop:420}}>
          <ActionBar compactWorkbench={!!location.search} status="connected" currentRootId="root" currentSession={session}
            onSendMessage={async (...args) => {window.sent.push(args)}} />
        </main></I18nProvider>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` }, bundle: true, write: false, outdir: '/tmp/agent-selector-interaction', format: 'iife', jsx: 'automatic',
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' },
  });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  for (const [name, width, touch, compact] of [['remote-touch', 375, true, false], ['remote-desktop', 1280, false, false], ['plugin', 420, false, true]]) {
    await t.test(name, async t => {
      const context = await browser.newContext({ viewport: { width, height: 850 }, hasTouch: touch });
      t.after(() => context.close());
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://selector.test/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith('/assets/agents/')) return route.fulfill({ contentType: pathname.endsWith('.png') ? 'image/png' : 'image/svg+xml', body: readFileSync(new URL('../public' + pathname, import.meta.url)) });
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>' });
      });
      await page.goto('http://selector.test/' + (compact ? '?plugin' : ''));
      await page.addStyleTag({ content: ['index.css', 'ide.css'].map(name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n') });
      for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
      const click = locator => touch ? locator.tap() : locator.click();
      const trigger = page.locator('[data-onboarding="agent-selector"] > button');
      await expect(trigger).toHaveAttribute('title', /codex/);
      const editor = page.locator('[contenteditable="true"]');
      const send = async text => {
        await editor.fill(text);
        await click(page.locator('[data-onboarding="send-action"]'));
        await expect(editor).toHaveText('');
        return page.evaluate(() => window.sent.at(-1).slice(2, 7));
      };
      assert.deepEqual(await send('defaults'), ['codex', undefined, 'first-mode', 'high', 'off']);
      await editor.fill('keep this draft');
      await click(trigger);
      const menu = page.locator('[data-agent-menu]');
      await click(menu.locator('[data-agent-row="claude"] > button').first());
      await expect(menu.getByRole('button', {name:'Model One', exact:true})).toBeVisible();
      await click(menu.getByRole('button', {name:'Model Two', exact:true}));
      await expect(menu).toBeVisible();
      await click(menu.getByRole('button', {name:/^思考强度/}));
      await click(menu.getByRole('button', {name:'low', exact:true}));
      await expect(menu).toBeVisible();
      await click(menu.getByRole('button', {name:/^Fast 模式/}));
      await click(menu.getByRole('button', {name:'开启', exact:true}));
      await expect(menu).toBeVisible();
      await click(menu.getByRole('button', {name:/^模式/}));
      await click(menu.getByRole('button', {name:'Second Mode', exact:true}));
      await expect(menu).toBeVisible();
      // Switching models must retain settings already chosen in the same panel.
      await click(menu.getByRole('button', {name:'Model One', exact:true}));
      await expect(menu.getByRole('button', {name:/^思考强度/})).toContainText('low');
      await expect(menu.getByRole('button', {name:/^Fast 模式/})).toContainText('开启');
      await expect(menu.getByRole('button', {name:/^模式/})).toContainText('second-mode');
      await expect(editor).toHaveText('keep this draft');
      mkdirSync(new URL('../../../output/playwright/agent-selector/', import.meta.url), {recursive:true});
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        await page.screenshot({ path: fileURLToPath(new URL('../../../output/playwright/agent-selector/' + name + '-' + theme + '.png', import.meta.url)) });
        const bounds = await menu.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, JSON.stringify(bounds));
        assert.equal(await menu.evaluate(el => el.scrollWidth > el.clientWidth), false);
      }
      const outside = page.locator('body');
      if (touch) await outside.tap({position:{x:width - 10, y:10}});
      else await outside.click({position:{x:width - 10, y:10}});
      await expect(menu).toHaveCount(0);
      assert.deepEqual(await send('chosen settings'), ['claude', 'model-one', 'second-mode', 'low', 'on']);
      await click(trigger);
      await expect(menu.getByRole('button', {name:'Model One', exact:true})).toBeVisible();
      await click(menu.locator('[data-agent-row="acp"] > button').first());
      await expect(menu.getByRole('button', {name:/^思考强度/})).toContainText('high');
      await expect(menu.getByRole('button', {name:/^Fast 模式/})).toContainText('关闭');
      await expect(menu.getByRole('button', {name:/^模式/})).toContainText('first-mode');
      await click(menu.getByRole('button', {name:'Limited', exact:true}));
      await expect(menu.getByRole('button', {name:/^思考强度/})).toContainText('medium');
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      assert.deepEqual(await send('limited effort'), ['acp', 'limited', 'first-mode', 'medium', 'off']);
      await page.evaluate(() => window.setSession({key:'existing', type:'chat', agent:'codex', model:'model-two', mode:'second-mode', effort:'low', fast_service:'on'}));
      assert.deepEqual(await send('restored session'), ['codex', 'model-two', 'second-mode', 'low', 'on']);
      await click(trigger);
      await click(menu.getByRole('button', {name:'No Effort', exact:true}));
      await expect(menu.getByRole('button', {name:/^思考强度/})).toHaveCount(0);
      await page.keyboard.press('Escape');
      assert.deepEqual(await send('no effort support'), ['codex', 'no-effort', 'second-mode', undefined, 'on']);
      assert.deepEqual(errors, []);
    });
  }
});
