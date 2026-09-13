import assert from 'node:assert/strict';
import path from 'node:path';

// Exercise the host's real authentication URL and the complete application.
// Component-only fixtures bypass the redirect that can lose ide_chrome.
export async function smokeNativeChrome(browser, bootstrapURL, rootId, reports) {
  const page = await browser.newPage({locale: 'en-US', viewport: {width: 430, height: 850}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const item = {
    key: 'native-chrome-history', session_key: 'native-chrome-history', name: 'Native toolbar regression',
    root_id: rootId, type: 'chat', agent: 'codex', pending: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    exchanges: [
      {seq: 1, role: 'user', content: 'Existing native conversation', timestamp: new Date().toISOString()},
      {seq: 2, role: 'assistant', content: 'Existing native answer', timestamp: new Date().toISOString()},
    ],
  };
  await page.route('**/api/sessions**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/sessions') return route.fulfill({json: {items: [item], total_count: 1}});
    if (url.pathname === `/api/sessions/${item.key}`) {
      const afterSeq = Number(url.searchParams.get('seq') || 0);
      return route.fulfill({json: {...item, exchanges: item.exchanges.filter(exchange => exchange.seq > afterSeq)}});
    }
    if (url.pathname.endsWith('/related-files')) return route.fulfill({json: []});
    return route.continue();
  });
  const command = value => page.evaluate(command => window.ideaAgentNativeCommand(command), value);
  const visible = view => page.locator(`.idea-${view}:visible`).waitFor();
  const assertHost = async () => {
    await page.waitForFunction(() => document.querySelector('.idea-workbench')?.dataset.ideaChrome === 'true', null, {timeout: 5000});
    assert.equal(await page.locator('.idea-toolbar').count(), 0, 'the host already provides the title and toolbar');
    const query = new URL(page.url()).searchParams;
    assert.equal(query.get('ide_chrome'), '1', 'navigation must preserve native chrome mode');
    assert.equal(query.get('ide_theme'), 'light', 'navigation must preserve the host startup theme');
    assert.equal(query.has('ide_token'), false, 'the page URL must not retain the bootstrap token');
  };
  try {
    await page.goto(`${bootstrapURL}&ide_theme=light&ide_chrome=1`);
    await page.locator('[contenteditable="true"]').first().waitFor({timeout: 30000});
    await assertHost();
    await command('history');
    await visible('history');
    await page.getByText(item.name, {exact: true}).click();
    await page.locator('.idea-chat:visible').getByText('Existing native answer', {exact: true}).waitFor();
    await page.waitForFunction(key => new URLSearchParams(location.search).get('session') === key, item.key);
    await assertHost();

    // This reload uses the URL rewritten when the history item was selected.
    await page.reload();
    await page.locator('.idea-chat:visible').getByText('Existing native answer', {exact: true}).waitFor();
    await assertHost();
    await command('settings');
    await visible('settings');
    await command('settings');
    await visible('chat');
    await command('history');
    await visible('history');
    await command('history');
    await visible('chat');
    await command('settings');
    await visible('settings');
    await command('new');
    await page.locator('.idea-chat:visible .idea-empty-chat').waitFor();
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('session'));
    await assertHost();
    await page.reload();
    await page.locator('.idea-chat:visible .idea-empty-chat').waitFor();
    await assertHost();

    // A reconnect starts at the authenticated URL again, like the native gear action.
    await page.goto(`${bootstrapURL}&ide_theme=light&ide_chrome=1`);
    await page.locator('[contenteditable="true"]').first().waitFor({timeout: 30000});
    await assertHost();
    await command('history');
    await visible('history');
    await command('new');
    await visible('chat');
    await page.setViewportSize({width: 375, height: 850});
    await page.screenshot({path: path.join(reports, 'ide-native-chrome.png'), animations: 'disabled'});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS: real IDE bootstrap redirect, one toolbar, native new/history/settings commands, session URL changes, reload and reconnect.');
  } finally {
    await page.context().close();
  }
}
