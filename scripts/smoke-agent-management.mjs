import assert from 'node:assert/strict';
import path from 'node:path';

// Exercise the real workbench with controlled API responses. No CLI, installer,
// configuration write or model request is executed by these UI checks.
export async function smokeAgentManagement(page, reports) {
  const manage = page.getByRole('button', {name: 'Agent management', exact: true});
  await manage.waitFor({state: 'visible', timeout: 5000});
  let catalogReads = 0;
  let failCatalog = false;
  let releaseRestart;
  const restarts = [];
  const agents = [
    {name: 'codex', installed: true, available: true, version: 'test', models: [], update_commands: ['echo test-only']},
    {name: 'claude', installed: true, available: true, models: [], update_commands: ['echo test-only']},
    {name: 'gemini', installed: false, available: false, models: [], install_commands: ['echo test-only']},
  ];
  await page.route('**/api/agents**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/agents/restart') {
      restarts.push(route.request().postDataJSON());
      if (restarts.length === 1) {
        await new Promise(resolve => { releaseRestart = resolve; });
        await route.fulfill({status: 400, json: {error: 'Simulated restart failure'}});
      } else {
        await route.fulfill({json: {restarting: true, agent: 'codex'}});
      }
    } else if (url.pathname === '/api/agents') {
      const all = url.searchParams.get('all') === '1';
      if (all) catalogReads++;
      if (all && failCatalog) await route.fulfill({status: 500, json: {error: 'Simulated catalog failure'}});
      else await route.fulfill({json: {agents: all ? agents : agents.filter(agent => agent.installed), shells: []}});
    } else await route.continue();
  });
  try {
    await page.reload();
    await page.locator('[contenteditable="true"]').first().waitFor();
    await page.waitForLoadState('networkidle');
    await manage.waitFor({state: 'visible'});
    await manage.click();
    for (const name of ['Add Agent config', 'Agent config switch & restart', 'Install and update Agent']) {
      assert.ok(await page.getByRole('button', {name, exact: true}).isVisible(), `${name} must be reachable`);
    }
    assert.equal(await page.getByRole('button', {name: /Expose local services|公网访问本地服务/}).count(), 0);
    await page.screenshot({path: path.join(reports, 'agent-management-menu.png'), animations: 'disabled'});
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', {name: 'Add Agent config', exact: true}).count(), 0);
    await page.mouse.click(370, 200);
    await manage.click();
    await page.getByRole('button', {name: 'Add Agent config', exact: true}).click();
    await page.getByText('Choose an agent to back up config', {exact: true}).waitFor();
    await page.getByText('codex', {exact: true}).first().waitFor();

    // Closing/reopening the mobile sidebar must not replay an old menu request.
    await page.mouse.click(370, 200);
    await manage.click();
    await page.getByRole('button', {name: 'Agent config switch & restart', exact: true}).click();
    const restart = page.getByRole('button', {name: 'Restart', exact: true});
    await restart.first().waitFor();
    await restart.first().click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.disabled && button.textContent === 'Restart'));
    assert.equal(restarts.length, 1);
    releaseRestart();
    await page.getByText('Simulated restart failure', {exact: false}).waitFor();
    const restarted = page.waitForResponse(response => response.url().endsWith('/api/agents/restart') && response.status() === 200);
    await restart.first().click();
    await restarted;
    assert.deepEqual(restarts, [{agent: 'codex'}, {agent: 'codex'}]);
    await page.mouse.click(370, 200);

    await manage.click();
    await page.getByRole('button', {name: 'Install and update Agent', exact: true}).click();
    await page.getByText('gemini', {exact: true}).waitFor();
    await page.getByText('Not detected', {exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Update', exact: true}).count(), 2);
    assert.equal(await page.getByRole('button', {name: 'Install', exact: true}).count(), 1);
    const readsBeforeRefresh = catalogReads;
    failCatalog = true;
    await page.getByRole('button', {name: 'Refresh Agent list', exact: true}).click();
    await page.getByText('Simulated catalog failure', {exact: false}).waitFor();
    assert.ok(catalogReads > readsBeforeRefresh, 'Refresh must make a new backend request');
    failCatalog = false;
    await page.getByRole('button', {name: 'Refresh Agent list', exact: true}).click();
    await page.getByText('Simulated catalog failure', {exact: false}).waitFor({state: 'hidden'});
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => window.ideaAgentSetTheme(value), theme);
      await page.screenshot({path: path.join(reports, `agent-management-${theme}.png`), animations: 'disabled'});
    }
    await page.setViewportSize({width: 375, height: 850});
    const refreshBounds = await page.getByRole('button', {name: 'Refresh Agent list', exact: true}).boundingBox();
    assert.ok(refreshBounds && refreshBounds.x >= 0 && refreshBounds.x + refreshBounds.width <= 375, 'Refresh stays inside the narrow tool window');
    await page.screenshot({path: path.join(reports, 'agent-management-375.png'), animations: 'disabled'});
    console.log('PASS: Agent management entry, native config flows, restart request/failure/retry, detection list and refresh.');
  } finally {
    releaseRestart?.();
    await page.unroute('**/api/agents**');
  }
}
