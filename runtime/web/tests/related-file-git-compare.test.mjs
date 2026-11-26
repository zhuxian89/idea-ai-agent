import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const webDir = fileURLToPath(new URL('../', import.meta.url));
const repo = path.resolve(webDir, '../..');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');

test('SessionViewer omits related files section and diff requests in both IDEA and remote views', async t => {
  execFileSync(process.execPath, ['scripts/test-runtime.mjs', './server/internal/gitview', '-run', '^TestReadHeadWorktreeFileCompareSupportsWorktreeStates$', '-count=1'], {
    cwd: repo, stdio: 'pipe',
  });
  const bundle = await build({
    stdin: {
      resolveDir: webDir,
      loader: 'tsx',
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { I18nProvider } from './src/i18n';
        import { SessionViewer } from './src/components/SessionViewer';
        import './src/services/remoteUi';
        const session = {key:'related-files', name:'Related files', agent:'codex', pending:false,
          exchanges:[{seq:1, role:'user', content:'修改 note.txt。'}],
          related_files:[{root_id:'project', repo_path:'/repo', repo_kind:'git', head:'abc1234', path:'note.txt', name:'note.txt'}]};
        createRoot(document.getElementById('root')).render(<I18nProvider><main className="idea-workbench"><div className="idea-conversation">
          <SessionViewer rootId="project" session={session} connected={false} loading={false}
            onFileClick={() => { window.opened = true; }}/>
        </div></main></I18nProvider>);
      `,
    },
    bundle: true,
    write: false,
    outdir: '/tmp/related-file-compare-fixture',
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    external: ['mermaid'],
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' },
  });
  const styles = ['src/index.css', 'src/ide.css']
    .map(file => readFileSync(path.join(webDir, file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, ''))
    .join('\n') + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  for (const locale of ['zh-CN']) {
    const context = await browser.newContext({ viewport: { width: 900, height: 650 }, locale });
    t.after(() => context.close());
    const page = await context.newPage();
    await page.addInitScript(locale => {
      localStorage.setItem('mindfs-locale', locale);
    }, locale);
    const diffRequests = [];
    await page.route(/\/api\/git\/related-file\/diff/, route => {
      diffRequests.push(route.request().url());
      return route.abort();
    });
    await page.route(/http:\/\/related-files\.test\/(?:\?remote=1)?$/, route => {
      const standalone = new URL(route.request().url()).searchParams.has('remote')
        ? '<meta name="local-ai-agent-mode" content="standalone">' : '';
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html data-theme="dark"><head><meta charset="utf-8">${standalone}<style>${styles}</style></head><body><div id="root"></div></body></html>`,
      });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('http://related-files.test/');
    await page.addScriptTag({ content: script });
    await expect(page.getByText('修改 note.txt。', { exact: true })).toBeVisible();
    await expect(page.getByText('关联文件 1', { exact: true })).toHaveCount(0);
    await expect(page.getByText('note.txt', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '与 HEAD 对比' })).toHaveCount(0);

    await page.goto('http://related-files.test/?remote=1');
    await page.addScriptTag({ content: script });
    await expect(page.locator('html')).toHaveAttribute('data-remote-ui', '1');
    await expect(page.getByText('修改 note.txt。', { exact: true })).toBeVisible();
    await expect(page.getByText('关联文件 1', { exact: true })).toHaveCount(0);
    await expect(page.getByText('note.txt', { exact: true })).toHaveCount(0);

    assert.deepEqual(diffRequests, []);
    assert.deepEqual(errors, []);
    await context.close();
  }
});
