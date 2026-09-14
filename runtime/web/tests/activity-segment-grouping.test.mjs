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
const reportDir = path.resolve(webDir, '../../build/reports/activity-segment-grouping');
const styles = ['src/index.css', 'src/ide.css'].map(file => readFileSync(path.join(webDir, file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n');

test('completed activity groups in the real SessionViewer', async t => {
  const bundle = await build({ entryPoints: [path.join(webDir, 'tests/fixtures/activity-segment-grouping.tsx')], bundle: true, write: false,
    outdir: '/tmp/activity-grouping-fixture', platform: 'browser', format: 'iife', jsx: 'automatic', external: ['mermaid'],
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' } });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  async function open(t, width = 375, theme = 'light') {
    const context = await browser.newContext({ viewport: { width, height: 760 }, reducedMotion: 'reduce' });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.clock.install({ time: new Date('2026-09-14T00:59:00Z') });
    await page.clock.pauseAt(new Date('2026-09-14T01:00:00Z'));
    await page.setContent('<!doctype html><html data-theme="' + theme + '"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: styles + '\n#fixture { height: 100vh; min-width: 0; }' });
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    await page.locator('[data-session-activity]').waitFor();
    return page;
  }
  const groups = page => page.locator('[data-activity-group]');
  const groupButton = page => groups(page).first().locator('button');
  const tool = (page, id) => page.locator(`[data-tool-activity="${id}"]`);
  const header = (page, id) => tool(page, id).locator('button[aria-expanded]').first();
  const count = page => page.evaluate(() => window.requests.length);
  const closeSegment = page => page.evaluate(() => window.append({ role: 'assistant', content: '项目说明已核对，接下来检查测试。', seq: 3 }));

  for (const agent of ['codex', 'claude']) await t.test(`${agent}: open tail stays stable, closed groups are quiet and do not fetch child logs`, async t => {
    const page = await open(t);
    await page.evaluate(agent => { window.setSession({ agent, exchanges: window.exchanges([1, 2, 3].map(i => window.call('call-' + i)), agent) }); }, agent);
    await page.evaluate(() => window.event());
    await page.clock.runFor(15000);
    await expect(groups(page)).toHaveCount(0);
    await expect(page.locator('[data-tool-activity]')).toHaveCount(3);
    await expect(page.locator('.session-activity-time')).toHaveText('已等待 15 秒 · 最近更新于 15 秒前');
    await closeSegment(page);
    await expect(groupButton(page)).toHaveText('运行了 3 条命令');
    await expect(groupButton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-tool-activity]')).toHaveCount(0);
    assert.equal(await count(page), 0);
    await groupButton(page).focus(); await page.keyboard.press('Enter');
    await expect(page.locator('[data-tool-activity]')).toHaveCount(3);
    assert.equal(await count(page), 0);
    const controlled = await groupButton(page).getAttribute('aria-controls');
    assert.equal(await page.evaluate(ids => ids.split(' ').every(id => document.getElementById(id)?.hidden === false), controlled), true);
    await page.keyboard.press('Tab');
    await expect(header(page, 'call-1')).toBeFocused();
    await header(page, 'call-2').click();
    await expect(tool(page, 'call-2')).toContainText('原始完整日志 call-2');
    assert.equal(await count(page), 1);
    await expect(page.locator('.session-activity-time')).toHaveText('已等待 15 秒 · 最近更新于 15 秒前');
    await groupButton(page).focus(); await page.keyboard.press('Space');
    await expect(groupButton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-activity-details]')).toHaveCount(0);
    await expect(groupButton(page)).toBeFocused();
    await page.clock.runFor(5000);
    await expect(page.locator('.session-activity-time')).toHaveText('已等待 20 秒 · 最近更新于 20 秒前');
    await page.evaluate(() => window.finish());
    await expect(page.locator('[data-session-activity]')).toHaveCount(0);
  });

  await t.test('focused closed child keeps its DOM/focus when the segment groups and stays visible after blur', async t => {
    const page = await open(t);
    await header(page, 'call-2').focus();
    await header(page, 'call-2').evaluate(el => { window.savedHeader = el; });
    await closeSegment(page);
    await expect(groupButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(header(page, 'call-2')).toBeFocused();
    assert.equal(await header(page, 'call-2').evaluate(el => window.savedHeader === el), true);
    await page.evaluate(() => document.activeElement.blur());
    await expect(groupButton(page)).toHaveAttribute('aria-expanded', 'true');
    assert.equal(await count(page), 0);
  });

  await t.test('opened child retains DOM, scroll and selection through auto-grouping; group/session switches restore choices', async t => {
    const page = await open(t, 720);
    await page.evaluate(() => { window.detailText['call-2'] = '长日志\n'.repeat(180); });
    await header(page, 'call-2').click();
    const detail = tool(page, 'call-2').locator('[data-activity-details]');
    await expect(detail).toContainText('长日志');
    await detail.evaluate(el => { window.savedDetail = el; el.scrollTop = 80; el.dispatchEvent(new Event('scroll')); el.focus(); });
    await closeSegment(page);
    await expect(groupButton(page)).toHaveAttribute('aria-expanded', 'true');
    assert.equal(await detail.evaluate(el => el === window.savedDetail && el.scrollTop === 80 && document.activeElement === el), true);
    assert.equal(await count(page), 1);
    await groupButton(page).click();
    await expect(detail).toHaveCount(0);
    await groupButton(page).click();
    await expect(detail).toContainText('长日志');
    assert.equal(await count(page), 2);
    await expect(header(page, 'call-1')).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => window.setSession({ key: 'B' }));
    await expect(groupButton(page)).toHaveAttribute('aria-expanded', 'false');
    assert.equal(await count(page), 2);
    await page.evaluate(() => window.setSession({ key: 'A' }));
    await expect(groupButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(detail).toContainText('长日志');
    assert.equal(await count(page), 3);
    await page.evaluate(() => window.setScope({ rootId: 'other' }));
    await expect(groupButton(page)).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => window.setScope({ rootId: 'root' }));
    await expect(groupButton(page)).toHaveAttribute('aria-expanded', 'true');
  });

  await t.test('updates, appended members and language preserve group identity; mixed operations get the right count', async t => {
    const page = await open(t);
    await page.evaluate(() => window.setSession({ pending: false }));
    await expect(groups(page)).toHaveCount(1);
    const key = await groups(page).getAttribute('data-activity-group');
    await page.evaluate(() => { for (let i = 0; i < 20; i++) window.append({ role: 'tool', toolCall: window.call('call-2', { title: '更新 ' + i }) }); });
    await expect(groupButton(page)).toHaveText('运行了 3 条命令');
    await page.evaluate(() => window.append({ role: 'tool', toolCall: window.call('call-4', { kind: 'read', title: 'README.md' }) }));
    await expect(groupButton(page)).toHaveText('完成了 4 项操作');
    assert.equal(await groups(page).getAttribute('data-activity-group'), key);
    await page.evaluate(() => window.locale('en-US'));
    await expect(groupButton(page)).toHaveText('Completed 4 operations');
    assert.equal(await groups(page).getAttribute('data-activity-group'), key);
    assert.equal(await count(page), 0);
  });

  await t.test('mixed-agent and missing-identity history do not cross boundaries; a fresh app restores default groups', async t => {
    const page = await open(t);
    await page.evaluate(() => window.setSession({ pending: false, exchanges: [
      ...window.exchanges([1, 2, 3].map(i => window.call('c' + i))),
      ...[1, 2, 3].map(i => ({ role: 'tool', agent: 'claude', toolCall: window.call('a' + i) })),
      { role: 'user', seq: 4, content: '新的轮次', agent: 'claude' },
      ...[1, 2, 3].map(i => ({ role: 'tool', agent: 'claude', toolCall: window.call('n' + i) })),
      ...[1, 2, 3].map(i => ({ role: 'tool', toolCall: window.call('unknown' + i) })),
    ] }));
    await expect(groups(page)).toHaveCount(3);
    await expect(page.locator('[data-tool-activity]')).toHaveCount(3);
    const keys = await groups(page).evaluateAll(els => els.map(el => el.dataset.activityGroup));
    assert.equal(new Set(keys).size, 3);
    await groupButton(page).click();
    await expect(groupButton(page)).toHaveAttribute('aria-expanded', 'true');
    const fresh = await open(t);
    await fresh.evaluate(() => window.setSession({ pending: false }));
    await expect(groupButton(fresh)).toHaveAttribute('aria-expanded', 'false');
  });

  await t.test('failure, shell, diff, task and actionable questions remain outside groups', async t => {
    const page = await open(t, 720);
    await page.evaluate(() => window.setSession({ exchanges: [
      ...window.exchanges([1, 2, 3].map(i => window.call('call-' + i))),
      { role: 'tool', agent: 'codex', toolCall: window.call('failed', { status: 'failed' }) },
      { role: 'tool', agent: 'codex', toolCall: window.call('shell', { meta: { source: 'userShell', command: 'echo shell' }, content: [{ type: 'text', text: 'user shell output' }] }) },
      { role: 'tool', agent: 'codex', toolCall: window.call('diff', { kind: 'edit', title: '修改文件', content: [{ type: 'diff', path: 'src/app.ts', oldText: 'before', newText: 'after' }] }) },
      { role: 'tool', agent: 'codex', toolCall: window.call('task', { kind: 'task', title: '检查子任务' }) },
      { role: 'tool', agent: 'codex', toolCall: window.call('question', { kind: 'ask_user', status: 'running', title: '选择验证方式', meta: { questions: [{ question: '如何验证？', options: [{ label: '运行测试' }, { label: '检查类型' }] }] } }) },
    ] }));
    await expect(groups(page)).toHaveCount(1);
    await expect(header(page, 'failed')).toContainText('失败');
    await expect(page.getByText('user shell output', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '修改文件' })).toBeVisible();
    await expect(page.getByRole('button', { name: /子任务/ }).first()).toBeVisible();
    await expect(page.getByRole('radio', { name: '运行测试' })).toBeVisible();
    await groupButton(page).click(); await groupButton(page).click();
    await page.getByRole('radio', { name: '运行测试' }).check();
    await page.getByRole('button', { name: '提交回答' }).click();
    const answers = await page.evaluate(() => window.answers);
    assert.equal(answers.length, 1); assert.equal(answers[0].toolUseId, 'question');
    assert.equal(answers[0].answers.q_0, '运行测试');
  });

  await t.test('loading and disconnection do not close active tails; ending without successful tool evidence stays unknown', async t => {
    const page = await open(t);
    await page.evaluate(() => { window.setScope({ connected: false }); window.updateCall('call-3', { status: 'running' }); });
    await expect(groups(page)).toHaveCount(0);
    await page.evaluate(() => { window.setScope({ loading: true }); window.setSession({ pending: false }); });
    await expect(groups(page)).toHaveCount(0);
    await page.evaluate(() => window.setScope({ loading: false }));
    await expect(groups(page)).toHaveCount(0);
    await expect(header(page, 'call-3')).toContainText('状态未知');
  });

  await t.test('1000 collapsed activities mount no log DOM and request no full details', async t => {
    const page = await open(t, 720);
    await page.evaluate(() => window.setSession({ pending: false, exchanges: window.exchanges(Array.from({ length: 1000 }, (_, i) => window.call('many-' + i))) }));
    await expect(groupButton(page)).toHaveText('运行了 1,000 条命令');
    assert.equal(await count(page), 0);
    await expect(page.locator('[data-tool-activity], [data-activity-details], pre')).toHaveCount(0);
  });

  await t.test('light/dark 320/375/720 show progress, groups and results with keyboard access and no overflow', async t => {
    mkdirSync(reportDir, { recursive: true });
    for (const theme of ['light', 'dark']) for (const width of [320, 375, 720]) {
      const page = await open(t, width, theme);
      await page.evaluate(() => window.setSession({ pending: false, exchanges: [
        ...window.exchanges([1, 2, 3].map(i => window.call('call-' + i))),
        { role: 'assistant', agent: 'codex', seq: 3, content: '项目结构已确认，我会继续核对相关文件。' },
        ...[window.call('read', { kind: 'read', title: '/project/很长的目录/'.repeat(12) + '/README.md' }), window.call('search', { kind: 'search', title: '搜索 activity' }), window.call('mcp', { kind: 'mcp', title: '查询项目文档' })].map(toolCall => ({ role: 'tool', agent: 'codex', toolCall })),
        { role: 'tool', agent: 'codex', toolCall: window.call('failed', { status: 'failed', meta: { command: 'node scripts/verify.mjs' } }) },
        { role: 'assistant', agent: 'codex', seq: 4, content: '文件检查已完成。验证命令失败，具体原因可展开查看。' },
      ] }));
      await expect(groups(page)).toHaveCount(2);
      await groups(page).nth(1).locator('button').focus(); await page.keyboard.press('Enter');
      await expect(groups(page).nth(1).locator('button')).toHaveAttribute('aria-expanded', 'true');
      assert.equal(await page.locator('#fixture').evaluate(el => el.scrollWidth > el.clientWidth), false);
      assert.equal(await groups(page).nth(1).locator('button').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      if (process.env.ACTIVITY_CAPTURE === '1') await page.screenshot({ path: path.join(reportDir, `${theme}-${width}.png`), fullPage: true });
    }
  });
});
