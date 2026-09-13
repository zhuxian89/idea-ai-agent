import assert from 'node:assert/strict';
import path from 'node:path';

async function smokeWorkbenchControls(page, reports) {
  const failures = [];
  const toolbar = page.locator('.idea-toolbar');
  for (const name of ['New session', 'Chat history', 'Agent configuration and installation']) {
    const button = toolbar.getByRole('button', {name, exact: true});
    await button.hover();
    try {
      await page.getByRole('tooltip').filter({hasText: name}).waitFor({timeout: 1500});
      const tooltipBounds = await page.getByRole('tooltip').boundingBox();
      assert.ok(tooltipBounds.x >= 0 && tooltipBounds.x + tooltipBounds.width <= page.viewportSize().width);
      if (name === 'Agent configuration and installation') {
        await page.screenshot({path: path.join(reports, 'ide-toolbar-tooltip.png'), animations: 'disabled'});
      }
      await page.mouse.move(0, 0);
      await button.focus();
      await page.getByRole('tooltip').filter({hasText: name}).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('tooltip').isVisible(), false);
    } catch { failures.push(`Missing visible/dismissible tooltip: ${name}`); }
  }
  await page.mouse.move(0, 0);
  for (const name of ['Chat history', 'Agent configuration and installation']) {
    const button = toolbar.getByRole('button', {name, exact: true});
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    await button.click();
    if (await page.locator('.idea-workbench').getAttribute('data-idea-view') !== 'chat') {
      failures.push(`Second click must close: ${name}`);
      await page.getByRole('button', {name: 'Back to chat', exact: true}).click();
    }
  }
  const selector = page.locator('[data-onboarding="agent-selector"]');
  await selector.locator(':scope > button').click();
  const collapse = page.getByRole('button', {name: /Collapse codex/});
  await collapse.waitFor();
  const before = await collapse.boundingBox();
  const menu = page.locator('[data-agent-menu]');
  try {
    await collapse.click({timeout: 1500});
    const expand = page.getByRole('button', {name: /Expand codex/});
    const after = await expand.boundingBox();
    if (Math.abs(before.x - after.x) > 1) failures.push(`Agent column moved on collapse: ${before.x} -> ${after.x}`);
    await expand.click();
  } catch { failures.push('Model list controls must be clickable above the composer'); }
  if (await menu.count()) {
    const initialMenu = await menu.boundingBox();
    await menu.getByRole('button', {name: /^Model\b/}).click();
    const collapsedMenu = await menu.boundingBox();
    assert.ok(Math.abs(initialMenu.x - collapsedMenu.x) < 1 && Math.abs(initialMenu.width - collapsedMenu.width) < 1);
    await menu.getByRole('button', {name: /^Model\b/}).click();
    await page.getByRole('button', {name: 'View claude error details', exact: true}).click();
    const errorMenu = await menu.boundingBox();
    assert.ok(Math.abs(initialMenu.x - errorMenu.x) < 1 && Math.abs(initialMenu.width - errorMenu.width) < 1);
    await page.getByRole('button', {name: /Expand codex/}).click();
    const originalViewport = page.viewportSize();
    await page.setViewportSize({width: 375, height: 650});
    await page.waitForFunction(() => {
      const rect = document.querySelector('[data-agent-menu]').getBoundingClientRect();
      return rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight;
    });
    await page.screenshot({path: path.join(reports, 'ide-agent-selector-375.png'), animations: 'disabled'});
    await page.setViewportSize(originalViewport);
    await page.evaluate(() => window.ideaAgentSetTheme('light'));
    await page.screenshot({path: path.join(reports, 'ide-agent-selector-light.png'), animations: 'disabled'});
    await page.evaluate(() => window.ideaAgentSetTheme('dark'));
  }
  await page.screenshot({path: path.join(reports, 'ide-agent-selector.png'), animations: 'disabled'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-agent-menu]').count(), 0);
  assert.equal(await selector.locator(':scope > button').evaluate(element => element === document.activeElement), true);
  assert.deepEqual(failures, [], 'Workbench interaction regressions');
  console.log('PASS: toolbar hover/focus tooltips and Escape; history/settings toggles; stable Agent/model columns, error details, live resize and popup dismissal.');
}

// Use the shipped workbench with controlled native API responses. Never run a
// real CLI installer, write Agent configs or call a model during these checks.
// The installation flow uses only a harmless echo command in the smoke project.
export async function smokeAgentManagement(page, reports) {
  page.setDefaultTimeout(10000);
  const manage = page.getByRole('button', {name: 'Agent configuration and installation', exact: true});
  let catalogReads = 0;
  let failCatalog = false;
  let releaseRestart;
  const restarts = [];
  const frames = [];
  page.on('websocket', socket => socket.on('framereceived', frame => {
    try { frames.push(JSON.parse(String(frame.payload))); } catch { /* Non-JSON transport frame. */ }
  }));
  const agents = [
    {name: 'codex', installed: true, available: true, version: 'test', models: [{id: 'test-model', name: 'Test Model'}, {id: 'test-long-model', name: 'A longer model name'}], update_commands: ['echo test-only']},
    {name: 'claude', installed: true, available: false, error: 'Sign in required (test)', models: [], update_commands: ['echo test-only']},
    {name: 'gemini', installed: false, available: false, models: [], install_commands: ['echo test-only']},
  ];
  const session = {
    key: 'ide-ui-history', session_key: 'ide-ui-history', name: 'Order idempotency', type: 'chat', agent: 'codex',
    created_at: '2026-09-12T10:00:00Z', updated_at: '2026-09-12T10:02:00Z',
    exchanges: [
      {seq: 1, role: 'user', content: 'Check duplicate orders.', timestamp: '2026-09-12T10:00:00Z'},
      {seq: 2, role: 'assistant', agent: 'codex', model: 'test-model', model_display_name: 'Test Model', effort: 'xhigh', content: 'Existing native reply preserved.', timestamp: '2026-09-12T10:02:00Z', context_window: {totalTokens: 98000, modelContextWindow: 258000}},
    ],
  };
  const agentRoute = async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/agents/restart') {
      restarts.push(route.request().postDataJSON());
      if (restarts.length === 1) {
        await new Promise(resolve => { releaseRestart = resolve; });
        await route.fulfill({status: 400, json: {error: 'Simulated restart failure'}});
      } else await route.fulfill({json: {restarting: true, agent: 'codex'}});
    } else if (url.pathname === '/api/agents') {
      const all = url.searchParams.get('all') === '1';
      if (all) catalogReads++;
      if (all && failCatalog) await route.fulfill({status: 500, json: {error: 'Simulated catalog failure'}});
      else await route.fulfill({json: {agents: all ? agents : agents.filter(agent => agent.installed), shells: []}});
    } else await route.continue();
  };
  const sessionRoute = async route => {
    const url = new URL(route.request().url());
    const item = {...session, root_id: url.searchParams.get('root')};
    if (route.request().method() !== 'GET') return route.continue();
    if (url.pathname === '/api/sessions') await route.fulfill({json: {items: [item], total_count: 1}});
    else if (url.pathname === '/api/sessions/ide-ui-history') await route.fulfill({json: item});
    else if (url.pathname === '/api/sessions/ide-ui-history/related-files') await route.fulfill({json: []});
    else await route.continue();
  };
  await page.route('**/api/agents**', agentRoute);
  await page.route('**/api/sessions**', sessionRoute);
  await page.route('**/api/agent-config/backups?*', route => route.fulfill({json: []}));
  try {
    await page.reload();
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({state: 'visible'});
    await page.waitForFunction(() => document.querySelector('.idea-view-heading p')?.textContent.includes('with spaces'), null, {timeout: 30000});
    await page.locator('[data-agent="codex"]').waitFor({state: 'attached'});
    await editor.evaluate(element => {
      const data = new DataTransfer();
      data.items.add(new File(['fixture content'], 'pasted-document.txt', {type: 'text/plain'}));
      element.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}));
    });
    await page.getByRole('button', {name: 'Remove attachment pasted-document.txt', exact: true}).waitFor({timeout: 2000});
    await page.getByRole('button', {name: 'Remove attachment pasted-document.txt', exact: true}).click();
    const permissions = page.getByRole('button', {name: /^Execution permissions:/});
    const permissionMenu = page.getByRole('listbox', {name: 'Execution permissions', exact: true});
    const assertPermission = async label => {
      await page.getByRole('button', {name: `Execution permissions: ${label}`, exact: true}).waitFor();
      await permissions.click();
      assert.equal(await permissionMenu.getByRole('option', {name: label, exact: true}).getAttribute('aria-selected'), 'true');
      assert.equal(await permissionMenu.getByRole('option', {selected: true}).count(), 1);
      await page.keyboard.press('Escape');
      assert.equal(await permissions.getAttribute('aria-expanded'), 'false');
    };
    const selectPermission = async label => {
      await permissions.click();
      await permissionMenu.getByRole('option', {name: label, exact: true}).click();
      assert.equal(await permissions.getAttribute('aria-expanded'), 'false');
      await assertPermission(label);
    };
    await assertPermission('Full access');
    await selectPermission('Standard');
    const agentSelector = page.locator('[data-onboarding="agent-selector"] > button');
    await agentSelector.click();
    await page.getByRole('button', {name: 'Test Model', exact: true}).click();
    await page.keyboard.press('Escape');
    await assertPermission('Standard');
    await agentSelector.click();
    await page.locator('[data-agent-menu]').getByRole('button').filter({hasText: /^claude$/}).click();
    await page.keyboard.press('Escape');
    await assertPermission('Full access');
    await selectPermission('Standard');
    await agentSelector.click();
    await page.locator('[data-agent-menu]').getByRole('button').filter({hasText: /^codex$/}).click();
    await page.keyboard.press('Escape');
    await assertPermission('Full access');
    console.log('PASS: document paste; visible Codex/Claude native permission choices; full-access default and explicit downgrade retained across model changes.');
    assert.equal(await page.locator('[data-onboarding="project-tabs"]').count(), 0);
    assert.equal(await page.getByRole('button', {name: /Open file sidebar|Expose local services/}).count(), 0);
    assert.equal(await page.getByText('Pending', {exact: true}).count(), 0);
    await smokeWorkbenchControls(page, reports);
    await page.evaluate(() => window.ideaAgentReceiveContext('DRAFT_PRESERVED'));
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent.includes('DRAFT_PRESERVED'));
    await manage.click();
    const codex = page.locator('[data-agent="codex"]');
    await codex.getByRole('button', {name: 'Restart', exact: true}).waitFor();
    assert.equal(await page.locator('[data-agent="gemini"]').isVisible(), false);
    await page.locator('.idea-more-agents summary').click();
    await page.getByText('Not detected', {exact: true}).waitFor();
    await page.getByText('Sign in required (test)', {exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Update', exact: true}).count(), 2);
    assert.equal(await page.getByRole('button', {name: 'Install', exact: true}).count(), 1);
    await codex.getByRole('button', {name: 'Restart', exact: true}).click();
    await codex.getByRole('button', {name: 'Restarting', exact: true}).waitFor();
    assert.equal(restarts.length, 1);
    releaseRestart();
    await page.getByRole('alert').filter({hasText: 'Simulated restart failure'}).waitFor();
    const restarted = page.waitForResponse(response => response.url().endsWith('/api/agents/restart') && response.status() === 200);
    await codex.getByRole('button', {name: 'Restart', exact: true}).click();
    await restarted;
    assert.deepEqual(restarts, [{agent: 'codex'}, {agent: 'codex'}]);

    const readsBeforeRefresh = catalogReads;
    failCatalog = true;
    await page.getByRole('button', {name: 'Refresh Agent list', exact: true}).click();
    await page.getByRole('alert').filter({hasText: 'Simulated catalog failure'}).waitFor();
    assert.ok(catalogReads > readsBeforeRefresh);
    failCatalog = false;
    await page.getByRole('button', {name: 'Refresh Agent list', exact: true}).click();
    await page.getByText('Simulated catalog failure', {exact: false}).waitFor({state: 'hidden'});
    await codex.getByRole('button', {name: 'Configure', exact: true}).click();
    await page.locator('.idea-config-form').waitFor({state: 'visible'});
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();
    await page.getByRole('button', {name: 'Add Agent config', exact: true}).click();
    await page.getByText('Choose an agent to back up config', {exact: true}).waitFor();
    // Return to the workbench with no form writes.
    await page.getByRole('button', {name: 'Back to chat', exact: true}).click();
    assert.ok((await editor.innerText()).includes('DRAFT_PRESERVED'));
    await page.getByRole('button', {name: 'Chat history', exact: true}).click();
    await page.getByText('Order idempotency', {exact: true}).click();
    await page.locator('.idea-chat:visible').waitFor();
    await page.getByText('Existing native reply preserved.', {exact: false}).waitFor();
    await page.getByText('Test Model · xhigh', {exact: true}).waitFor();
    await page.locator('[title="Context Window 38% used (98000/258000 used)"]').waitFor();
    await page.screenshot({path: path.join(reports, 'ide-workbench-chat.png'), animations: 'disabled'});
    await page.getByRole('button', {name: 'Chat history', exact: true}).click();
    await page.screenshot({path: path.join(reports, 'ide-workbench-history.png'), animations: 'disabled'});
    // Fresh mount clears the intentionally unfinished config form for screenshots.
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.idea-view-heading p')?.textContent.includes('with spaces'), null, {timeout: 30000});
    await manage.click();
    await codex.waitFor();
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => window.ideaAgentSetTheme(value), theme);
      await page.screenshot({path: path.join(reports, 'ide-workbench-settings-' + theme + '.png'), animations: 'disabled'});
    }
    await page.setViewportSize({width: 375, height: 850});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(await codex.getByRole('button', {name: 'Configure', exact: true}).isVisible());
    await page.getByRole('button', {name: 'Back to chat', exact: true}).click();
    await editor.waitFor({state: 'visible'});
    const bounds = await editor.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 375 && bounds.y + bounds.height <= 850);
    await page.screenshot({path: path.join(reports, 'ide-workbench-375.png'), animations: 'disabled'});
    // Observe the install dispatch and allow only the harmless fixture command.
    await page.evaluate(() => {
      window.__ideaTestCommands = [];
      window.__ideaTestTypes = [];
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function(data) {
        if (typeof data === 'string') {
          const message = JSON.parse(data);
          window.__ideaTestTypes.push(message.type || 'encrypted');
          if (message.type === 'session.message') {
            window.__ideaTestCommands.push(message.payload);
            if (message.payload.type !== 'command' || message.payload.content !== 'echo test-only') return;
          }
        }
        return send.call(this, data);
      };
    });
    await manage.click();
    await page.locator('.idea-more-agents summary').click();
    await page.locator('[data-agent="gemini"]').getByRole('button', {name: 'Install', exact: true}).click();
    await page.waitForFunction(() => window.__ideaTestCommands.length === 1, null, {timeout: 5000}).catch(async error => {
      console.error('Install UI:', await page.locator('body').innerText());
      console.error('Message types:', await page.evaluate(() => window.__ideaTestTypes));
      throw error;
    });
    const command = await page.evaluate(() => window.__ideaTestCommands[0]);
    assert.equal(command.type, 'command');
    assert.equal(command.content, 'echo test-only');
    await page.locator('[data-idea-view="chat"] .idea-active-conversation').waitFor({state: 'visible'});
    // A new command session receives its key from the server.
    const completedCommand = () => frames.find(frame => frame.type === 'session.stream' &&
      frame.payload?.root_id === command.root_id && frame.payload?.event?.data?.meta?.phase === 'final' &&
      frame.payload.event.data.meta.command === 'echo test-only');
    const commandFinished = () => {
      const completed = completedCommand();
      return completed && frames.some(frame => frame.type === 'session.done' && frame.payload?.session_key === completed.payload.session_key);
    };
    for (let attempt = 0; attempt < 100 && !commandFinished(); attempt++) {
      await page.waitForTimeout(100);
    }
    assert.ok(commandFinished(),
      'The installation command must finish through the native command session: ' + JSON.stringify(frames.slice(-5)));
    assert.equal(completedCommand().payload.event.data.meta.exitCode, 0);
    assert.ok(completedCommand().payload.event.data.content.some(item => item.text?.includes('test-only')),
      'The command session must retain the installation output');
    await page.screenshot({path: path.join(reports, 'ide-workbench-install-command.png'), animations: 'disabled'});
    agents[2].installed = true;
    agents[2].update_commands = ['echo test-only'];
    await manage.click();
    const installed = page.locator('[data-agent="gemini"]');
    await installed.getByText('Detected', {exact: true}).waitFor();
    assert.equal(await installed.getByRole('button', {name: 'Install', exact: true}).count(), 0);
    assert.ok(await installed.getByRole('button', {name: 'Restart', exact: true}).isEnabled());
    console.log('PASS: single-pane navigation, no project/kanban UI, draft retention, native config/restart/error/refresh and install command dispatch, history reply/model/effort/context metadata and narrow themes.');
  } finally {
    releaseRestart?.();
    await page.unroute('**/api/agents**', agentRoute);
    await page.unroute('**/api/sessions**', sessionRoute);
    await page.unroute('**/api/agent-config/backups?*');
  }
}
