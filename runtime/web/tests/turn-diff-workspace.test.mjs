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
const reports = path.join(repo, 'build/reports/turn-diff');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');

test('command-only turn displays persisted file list, expandable diff and IDEA file navigation', async t => {
  mkdirSync(reports, { recursive: true });
  execFileSync(process.execPath, ['scripts/test-runtime.mjs', './server/internal/api/usecase', '-run', '^TestCommandOnlyTurnDiffSurvivesSendAndReload$', '-count=1'], {
    cwd: repo, env: { ...process.env, TURN_DIFF_FIXTURE_DIR: reports }, stdio: 'pipe',
  });
  const update = JSON.parse(readFileSync(path.join(reports, 'turn-diff.json'), 'utf8'));
  const bundle = await build({ stdin: { resolveDir: webDir, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { I18nProvider } from './src/i18n';
    import { IdeaWorkbench } from './src/layout/IdeaWorkbench';
    import { SessionViewer } from './src/components/SessionViewer';
    const session = {key:'turn-diff', name:'Turn diff', agent:'codex', pending:false,
      exchanges:[
        {seq:1, role:'user', content:'去掉多余的继承。'},
        {seq:2, role:'agent', content:'已修改并检查 Git 差异。', agent:'codex'},
        {seq:3, role:'user', content:'第二个用户问题'},
      ],
      exchange_aux: {2:[{seq:2, line:1, turn_diff:window.update}]}};
    createRoot(document.getElementById('root')).render(<I18nProvider>
      <IdeaWorkbench
        projectName="project"
        sessionName="Turn diff"
        onNewSession={() => {}}
        userMessageSummaries={[
          { id: 'user-1', seq: 1, summary: '去掉多余的继承。' },
          { id: 'user-3', seq: 3, summary: '第二个用户问题' },
        ]}
        chat={<SessionViewer rootId="project" session={session} connected={false} loading={false}/>}
        history={<div />}
        settings={<div />}
        footer={<div />}
        drawer={null}
      />
    </I18nProvider>);
  ` }, bundle: true, write: false, outdir: '/tmp/turn-diff-fixture', platform: 'browser', format: 'iife', jsx: 'automatic',
    external: ['mermaid'], loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' },
  });
  const styles = ['src/index.css', 'src/ide.css'].map(file => readFileSync(path.join(webDir, file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n') +
    bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  for (const [width, locale, theme] of [[420, 'zh-CN', 'dark'], [900, 'en-US', 'light']]) {
    const context = await browser.newContext({ viewport: { width, height: 750 }, locale });
    t.after(() => context.close());
    await context.route('**/*', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${styles}</style></head><body><div id="root"></div></body></html>` })
      : route.fulfill({ json: {} }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const mount = async () => {
      await page.goto('http://turn-diff.test');
      await page.evaluate(({ update, locale }) => {
        localStorage.setItem('mindfs-locale', locale);
        window.update = update;
        window.navigation = [];
        window.ideaAgent = { postMessage: payload => window.navigation.push(payload) };
      }, { update, locale });
      await page.addScriptTag({ content: script });
    };
    await mount();
    const summaryButton = page.getByRole('button', { name: locale === 'zh-CN' ? '显示用户消息摘要' : 'Show user message summary' });
    await expect(summaryButton).toBeVisible();
    await summaryButton.click();
    await expect(page.getByRole('dialog', { name: locale === 'zh-CN' ? '用户消息摘要' : 'User message summary' })).toContainText('第二个用户问题');
    const card = page.locator('[data-turn-diff]');
    await expect(card).toContainText(locale === 'zh-CN' ? '本轮修改了 1 个文件' : 'Changed 1 files this turn');
    await expect(card).toContainText(locale === 'zh-CN' ? '可能包含同期手动修改' : 'concurrent manual edits');
    const file = page.locator('[data-turn-diff-file="RuoYiApplication.java"]');
    await expect(file).toHaveCount(1);
    const nativeCompare = page.getByRole('button', { name: locale === 'zh-CN' ? '在 IDEA 中对比' : 'Compare in IDEA' }).first();
    await expect(nativeCompare).toBeVisible();
    const openInIdea = page.getByRole('button', { name: locale === 'zh-CN' ? '在 IDEA 中打开' : 'Open in IDEA' }).first();
    await expect(openInIdea).toBeVisible();
    const messagesBeforeExpand = await page.evaluate(() => window.navigation.length);
    const deletionStats = file.locator('xpath=following-sibling::span[1]/span[2]');
    const statsBox = await deletionStats.boundingBox();
    const openBox = await openInIdea.boundingBox();
    assert.ok(statsBox && openBox && statsBox.x + statsBox.width <= openBox.x + 1);
    await openInIdea.click();
    await nativeCompare.click();
    assert.deepEqual(await page.evaluate(count => window.navigation.slice(count), messagesBeforeExpand), [
      { action: 'openFile', rootId: 'project', path: 'RuoYiApplication.java' },
      { action: 'compareTurnDiff', rootId: 'project', sessionKey: 'turn-diff', snapshotId: update.snapshotId, path: 'RuoYiApplication.java' },
    ]);
    await file.click();
    const detail = page.locator('[data-turn-diff-detail]');
    await expect(detail).toContainText('public class RuoYiApplication extends RuoYiServletInitializer{');
    await expect(detail).toContainText('public class RuoYiApplication {');
    await expect(detail.getByRole('button', { name: locale === 'zh-CN' ? '在 IDEA 中对比' : 'Compare in IDEA' })).toHaveCount(1);
    await detail.getByRole('button', { name: locale === 'zh-CN' ? '在 IDEA 中对比' : 'Compare in IDEA' }).click();
    await detail.getByRole('button', { name: locale === 'zh-CN' ? '在 IDEA 中打开' : 'Open in IDEA' }).click();
    assert.deepEqual(await page.evaluate(() => window.navigation.filter(p => p.action !== 'setLocale')), [
      { action: 'openFile', rootId: 'project', path: 'RuoYiApplication.java' },
      { action: 'compareTurnDiff', rootId: 'project', sessionKey: 'turn-diff', snapshotId: update.snapshotId, path: 'RuoYiApplication.java' },
      { action: 'compareTurnDiff', rootId: 'project', sessionKey: 'turn-diff', snapshotId: update.snapshotId, path: 'RuoYiApplication.java' },
      { action: 'openFile', rootId: 'project', path: 'RuoYiApplication.java' },
    ]);
    await page.screenshot({ path: path.join(reports, `workspace-diff-${theme}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await mount();
    await expect(file).toHaveCount(1);
    assert.deepEqual(errors, []);
  }
});
