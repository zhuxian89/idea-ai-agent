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
const reports = path.join(repo, 'build/reports/related-file-compare');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');

test('related file row separates IDEA open and native Git compare actions', async t => {
  mkdirSync(reports, { recursive: true });
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
        const session = {key:'related-files', name:'Related files', agent:'codex', pending:false,
          exchanges:[{seq:1, role:'user', content:'修改 note.txt。'}],
          related_files:[{root_id:'project', repo_path:'/repo', repo_kind:'git', path:'note.txt', name:'note.txt'}]};
        createRoot(document.getElementById('root')).render(<I18nProvider><main className="idea-workbench"><div className="idea-conversation">
          <SessionViewer rootId="project" session={session} connected={false} loading={false}
            gitFileStatsByPath={{ 'note.txt': { status:'M', additions:1, deletions:1 } }}
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
    await page.route(/http:\/\/related-files\.test\/$/, route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${styles}</style></head><body><div id="root"></div></body></html>`,
    }));
    await page.goto('http://related-files.test/');
    await page.addScriptTag({ content: script });
    
    await page.evaluate(() => {
      window.messages = [];
      window.opened = false;
      window.ideaAgent = { postMessage: payload => window.messages.push(payload) };
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const row = page.getByText('note.txt', { exact: true });
    await expect(row).toBeVisible();
    const button = page.getByRole('button', { name: '与 HEAD 对比' });
    await expect(button).toHaveCount(1);
    {
      await button.click();
      assert.deepEqual(await page.evaluate(() => window.messages.filter(item => item.action !== 'setLocale')), [{
        action: 'compareGitFile',
        rootId: 'project',
        path: 'note.txt',
        repoPath: '/repo',
        repoKind: 'git',
      }]);
      await row.click();
      assert.equal(await page.evaluate(() => window.opened), true);
      assert.equal(await page.evaluate(() => window.messages.filter(item => item.action !== 'setLocale').length), 1);
    }
    await page.screenshot({ path: path.join(reports, `related-${locale}.png`), fullPage: true });
    await context.close();
  }
});
