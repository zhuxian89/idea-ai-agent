import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const webDir = fileURLToPath(new URL('../', import.meta.url));
const repo = path.resolve(webDir, '../..');
const reports = path.join(repo, 'build/reports/reply-metadata');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');

test('native reply metadata survives old cache reconciliation, reload and offline reading', async t => {
  mkdirSync(reports, { recursive: true });
  execFileSync(process.execPath, ['scripts/test-runtime.mjs', './server/internal/api/usecase', '-run', '^TestNativeReplyMetadataRoundTrip$', '-count=1'], {
    cwd: repo, env: { ...process.env, REPLY_METADATA_FIXTURE_DIR: reports }, stdio: 'pipe',
  });
  const native = JSON.parse(readFileSync(path.join(reports, 'native-replies.json'), 'utf8'));
  const full = { ...native, key: 'metadata', name: 'Reply metadata', agent: 'codex', pending: false,
    activity_history_version: 1, reply_metadata_version: 1,
    context_window: { totalTokens: 200000, modelContextWindow: 258000 },
    exchanges: native.exchanges.map(ex => ({ ...ex, model: 'gpt-6-astra' })),
  };
  const bundle = await build({ stdin: { resolveDir: webDir, sourcefile: 'reply-metadata-fixture.tsx', loader: 'tsx', contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { I18nProvider } from './src/i18n';
    import { SessionViewer } from './src/components/SessionViewer';
    import { sessionService, getCachedSession, syncSession } from './src/services/session';
    window.calls = [];
    sessionService.syncExternalSession = async () => { window.calls.push('full'); return window.offline ? null : window.native; };
    sessionService.getSession = async () => { window.calls.push('delta'); return window.offline ? null : { ...window.native, exchanges: [] }; };
    function App() {
      const [session, setSession] = useState(null);
      window.sync = async () => { const next = await syncSession('root', 'metadata'); setSession(next.session); };
      window.cached = async () => setSession(await getCachedSession('root', 'metadata'));
      window.variant = setSession;
      return <I18nProvider><main className="idea-workbench"><div className="idea-conversation">
        <SessionViewer rootId="root" session={session} connected={false} loading={false}/>
      </div></main></I18nProvider>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, outdir: '/tmp/reply-metadata-fixture', platform: 'browser', format: 'iife', jsx: 'automatic',
    external: ['mermaid'], loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' },
  });
  const styles = ['src/index.css', 'src/ide.css'].map(file => readFileSync(path.join(webDir, file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n') +
    bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  for (const [width, locale, theme] of [[375, 'zh-CN', 'light'], [900, 'en-US', 'dark']]) {
    await t.test(`${width}px ${locale} ${theme}`, async t => {
      const context = await browser.newContext({ viewport: { width, height: 850 }, locale });
      t.after(() => context.close());
      await context.route('**/*', route => new URL(route.request().url()).pathname === '/assets/agents/codex.svg'
        ? route.fulfill({ contentType: 'image/svg+xml', body: readFileSync(path.join(webDir, 'public/assets/agents/codex.svg')) })
        : route.request().resourceType() === 'document'
        ? route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${styles}</style></head><body><div id="root"></div></body></html>` })
        : route.fulfill({ json: {} }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const mount = async () => {
        await page.goto('http://reply-metadata.test');
        await page.evaluate(({ full, locale }) => { localStorage.setItem('mindfs-locale', locale); window.native = full; }, { full, locale });
        await page.addScriptTag({ content: script });
        await page.waitForFunction(() => !!window.sync);
      };
      await mount();
      await page.evaluate(async () => {
        await window.cached(); // Open the real cache schema.
        const db = await new Promise(resolve => { const request = indexedDB.open('mindfs-session-cache'); request.onsuccess = () => resolve(request.result); });
        const old = { ...window.native, reply_metadata_version: undefined, exchanges: window.native.exchanges.map(({ effort, context_window, ...ex }) => ex) };
        await new Promise(resolve => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put({ cacheKey: 'root::metadata', rootId: 'root', sessionKey: 'metadata', session: old }); tx.oncomplete = resolve; });
        db.close();
        await window.cached();
      });
      const row = seq => page.locator(`[data-session-seq="${seq}"] .mindfs-assistant-meta`);
      const missing = locale === 'zh-CN' ? 'Context 未提供' : 'Context unavailable';
      await expect(row(2)).toContainText(missing);
      await page.evaluate(() => window.sync());
      await expect(row(2)).toContainText('gpt-6-astra · high');
      await expect(row(2)).toContainText('Context 42% (109K/258K)');
      await expect(row(4)).toContainText('gpt-6-astra · xhigh');
      await expect(row(4)).toContainText('Context 21% (55K/258K)');
      await expect(row(6)).toContainText(missing);
      await expect(row(6)).toContainText(locale === 'zh-CN' ? '思考强度未提供' : 'Effort unavailable');
      assert.deepEqual(await page.evaluate(() => window.calls), ['full']);
      await page.screenshot({ path: path.join(reports, `replies-${width}-${theme}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await mount();
      await page.evaluate(() => window.cached());
      await expect(row(2)).toContainText('Context 42% (109K/258K)');
      await page.evaluate(() => window.sync());
      assert.deepEqual(await page.evaluate(() => window.calls), ['delta']);
      await page.evaluate(async () => { window.offline = true; await window.sync(); });
      await expect(row(4)).toContainText('Context 21% (55K/258K)');
      await page.evaluate(() => window.variant({ ...window.native, exchanges: window.native.exchanges.map(ex => ex.seq === 6 ? { ...ex, context_window: { totalTokens: 0, modelContextWindow: 258000 } } : ex) }));
      await expect(row(6)).toContainText('Context 0% (0/258K)');
      assert.deepEqual(errors, []);
    });
  }
});
