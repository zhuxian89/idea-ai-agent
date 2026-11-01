import assert from 'node:assert/strict';
import path from 'node:path';

async function smokeWorkbenchControls(page, reports) {
  const failures = [];
  const toolbar = page.locator('.idea-toolbar');
  for (const name of ['New session', 'Chat history', 'Agent settings']) {
    const button = toolbar.getByRole('button', {name, exact: true});
    await button.hover();
    try {
      await page.getByRole('tooltip').filter({hasText: name}).waitFor({timeout: 1500});
      const tooltipBounds = await page.getByRole('tooltip').boundingBox();
      assert.ok(tooltipBounds.x >= 0 && tooltipBounds.x + tooltipBounds.width <= page.viewportSize().width);
      if (name === 'Agent settings') {
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
  for (const name of ['Chat history', 'Agent settings']) {
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
    await menu.locator('[data-agent-row="claude"] > button').first().click();
    await menu.locator('[data-agent-error-details="claude"] summary').click();
    await menu.getByText('Sign in required (test)', {exact: true}).waitFor();
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
// Installation and probing responses are fixtures; no CLI installer is executed.
export async function smokeAgentManagement(page, reports) {
  page.setDefaultTimeout(10000);
  const manage = page.getByRole('button', {name: 'Agent settings', exact: true});
  let releaseProbe;
  const probes = [];
  const installs = [];
  const agents = [
    {name: 'codex', installed: true, available: true, version: 'test', update_check_supported: true, models: [{id: 'test-model', name: 'Test Model'}, {id: 'test-long-model', name: 'A longer model name'}], update_commands: ['echo test-only']},
    {name: 'claude', installed: true, available: true, models: [], update_commands: ['echo test-only']},
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
    if (url.pathname === '/api/agents/probe') {
      probes.push(route.request().postDataJSON());
      if (probes.length === 1) {
        await new Promise(resolve => { releaseProbe = resolve; });
        return route.fulfill({status: 400, json: {error: 'Simulated probe failure'}});
      }
      agents[1].available = true;
      delete agents[1].error;
      return route.fulfill({json: {probing: true, agent: 'claude'}});
    }
    if (url.pathname === '/api/agents/install') {
      installs.push(route.request().postDataJSON());
      agents[2].installed = true;
      agents[2].available = true;
      return route.fulfill({json: [{type: 'chunk', text: 'fixture installation output'}, {type: 'done'}]});
    }
    if (url.pathname === '/api/agents/check-update') {
      assert.deepEqual(route.request().postDataJSON(), {agent: 'codex'});
      return route.fulfill({json: {has_update: false, current_version: 'test'}});
    }
    if (url.pathname === '/api/agents') {
      const all = url.searchParams.get('all') === '1';
      return route.fulfill({json: {agents: all ? agents : agents.filter(agent => agent.installed), shells: []}});
    }
    throw new Error(`Unexpected Agent API in smoke: ${url.pathname}`);
  };
  const sessionRoute = async route => {
    const url = new URL(route.request().url());
    const item = {...session, root_id: url.searchParams.get('root')};
    url.pathname = url.pathname.replace(/\/sync$/, '');
    if (!['GET', 'POST'].includes(route.request().method())) return route.continue();
    if (url.pathname === '/api/sessions') await route.fulfill({json: {items: [item], total_count: 1}});
    else if (url.pathname === '/api/sessions/ide-ui-history') await route.fulfill({json: item});
    else if (url.pathname === '/api/sessions/ide-ui-history/related-files') await route.fulfill({json: []});
    else await route.continue();
  };
  await page.route('**/api/agents**', agentRoute);
  await page.route('**/api/sessions**', sessionRoute);
  try {
    await page.reload();
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({state: 'visible'});
    await page.locator('.idea-workbench').waitFor({state: 'visible', timeout: 30000});
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
    await page.locator('[data-agent-menu] [data-agent-row="claude"] > button').first().click();
    await page.keyboard.press('Escape');
    await assertPermission('Full access');
    await selectPermission('Standard');
    await agentSelector.click();
    await page.locator('[data-agent-menu] [data-agent-row="codex"] > button').first().click();
    await page.keyboard.press('Escape');
    await assertPermission('Full access');
    console.log('PASS: document paste; visible Codex/Claude native permission choices; full-access default and explicit downgrade retained across model changes.');
    assert.equal(await page.locator('[data-onboarding="project-tabs"]').count(), 0);
    assert.equal(await page.getByRole('button', {name: /Open file sidebar|Expose local services/}).count(), 0);
    assert.equal(await page.getByText('Pending', {exact: true}).count(), 0);
    // Exercise the current setup guide separately from selecting a ready Agent.
    agents[1].available = false;
    agents[1].error = 'Sign in required (test)';
    await page.reload();
    await editor.waitFor({state: 'visible'});
    await smokeWorkbenchControls(page, reports);
    await page.evaluate(() => window.ideaAgentReceiveContext('DRAFT_PRESERVED'));
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent.includes('DRAFT_PRESERVED'));
    await manage.click();
    const codex = page.locator('[data-agent="codex"]');
    const claude = page.locator('[data-agent="claude"]');
    await codex.getByRole('button', {name: 'Check for updates', exact: true}).click();
    await codex.getByText('Up to date (vtest)', {exact: true}).waitFor();
    await claude.locator('[data-agent-error-details="claude"] summary').click();
    await claude.getByText('Sign in required (test)', {exact: true}).waitFor();
    assert.equal(await page.locator('[data-agent="gemini"]').isVisible(), false);
    await claude.getByRole('button', {name: 'Check again', exact: true}).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-agent="claude"] button')].some(button => button.disabled));
    assert.deepEqual(probes, [{agent: 'claude'}]);
    releaseProbe();
    await page.getByRole('alert').filter({hasText: 'Simulated probe failure'}).waitFor();
    await claude.getByRole('button', {name: 'Check again', exact: true}).click();
    await claude.locator('[data-agent-setup]').waitFor({state: 'detached'});
    await claude.getByRole('button', {name: 'Test connection', exact: true}).waitFor();
    assert.deepEqual(probes, [{agent: 'claude'}, {agent: 'claude'}]);
    await page.getByRole('button', {name: 'Back to chat', exact: true}).click();
    assert.ok((await editor.innerText()).includes('DRAFT_PRESERVED'));
    await page.getByRole('button', {name: 'Chat history', exact: true}).click();
    await page.getByText('Order idempotency', {exact: true}).click();
    await page.locator('.idea-chat:visible').waitFor();
    await page.getByText('Existing native reply preserved.', {exact: false}).waitFor();
    await page.getByText('Test Model · xhigh', {exact: true}).waitFor();
    await page.locator('[title="Context 38% used (98000/258000 tokens)"]').waitFor();
    await page.screenshot({path: path.join(reports, 'ide-workbench-chat.png'), animations: 'disabled'});
    await page.getByRole('button', {name: 'Chat history', exact: true}).click();
    await page.screenshot({path: path.join(reports, 'ide-workbench-history.png'), animations: 'disabled'});
    // Verify the current settings layout in both themes and a narrow sidebar.
    await page.reload();
    await page.locator('.idea-workbench').waitFor({state: 'visible', timeout: 30000});
    await manage.click();
    await codex.waitFor();
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => window.ideaAgentSetTheme(value), theme);
      await page.screenshot({path: path.join(reports, 'ide-workbench-settings-' + theme + '.png'), animations: 'disabled'});
    }
    await page.setViewportSize({width: 375, height: 850});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(await codex.getByRole('button', {name: 'Test connection', exact: true}).isVisible());
    await page.getByRole('button', {name: 'Back to chat', exact: true}).click();
    await editor.waitFor({state: 'visible'});
    const bounds = await editor.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 375 && bounds.y + bounds.height <= 850);
    await page.screenshot({path: path.join(reports, 'ide-workbench-375.png'), animations: 'disabled'});
    await manage.click();
    await page.locator('.idea-more-agents summary').click();
    await page.locator('[data-agent="gemini"]').getByRole('button', {name: 'Install now', exact: true}).click();
    const installed = page.locator('[data-agent="gemini"]');
    await installed.getByText('Detected', {exact: true}).waitFor();
    assert.deepEqual(installs, [{agent: 'gemini'}]);
    assert.equal(await installed.getByRole('button', {name: 'Install now', exact: true}).count(), 0);
    await installed.getByRole('button', {name: 'Test connection', exact: true}).waitFor();
    await page.screenshot({path: path.join(reports, 'ide-workbench-install.png'), animations: 'disabled'});
    console.log('PASS: settings navigation and draft retention, probe failure/recovery, update check, install dispatch and detection, history reply/model/effort/context metadata and narrow themes.');
  } finally {
    releaseProbe?.();
    await page.unroute('**/api/agents**', agentRoute);
    await page.unroute('**/api/sessions**', sessionRoute);
  }
}
