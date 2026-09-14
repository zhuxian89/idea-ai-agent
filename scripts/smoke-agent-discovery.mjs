import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const { expect } = createRequire(new URL('../runtime/web/package.json', import.meta.url))('@playwright/test');

// Exercise the shipped App's initial connection and reconnect handlers. Native
// discovery can finish in either gap without a status event reaching the UI.
export async function smokeAgentDiscovery(browser, bootstrapURL, reports) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 375, height: 700 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  const sockets = [];
  let models = [];
  let reads = 0;
  let restarts = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket(/\/ws(?:\?|$)/, socket => {
    sockets.push(socket);
    socket.onMessage(raw => {
      if (JSON.parse(String(raw)).type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
    });
  });
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    let firstOpen = true;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        return new Proxy(this, {
          get(target, key) {
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
          set(target, key, value) {
            if (key === 'onopen' && typeof value === 'function') {
              const callback = value;
              value = event => {
                if (firstOpen) {
                  firstOpen = false;
                  window.releaseAgentConnection = () => callback.call(target, event);
                } else callback.call(target, event);
              };
            }
            return Reflect.set(target, key, value, target);
          },
        });
      }
    };
  });
  await page.route('**/api/agents**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/restart')) {
      restarts++;
      return route.fulfill({ status: 500, json: { error: 'Unexpected manual restart' } });
    }
    reads++;
    return route.fulfill({ json: { agents: [{ name: 'codex', installed: true,
      available: models.length > 0, probe_pending: models.length === 0, models }], shells: [] } });
  });
  try {
    await page.goto(`${bootstrapURL}&ide_chrome=1`);
    await page.locator('[contenteditable="true"]').first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => typeof window.releaseAgentConnection === 'function');
    const trigger = page.locator('[data-onboarding="agent-selector"] > button');
    await trigger.click();
    const menu = page.locator('[data-agent-menu]');
    await expect(menu.getByRole('status')).toHaveAccessibleName('Discovering models and options for codex…');
    await expect(menu).not.toContainText('probe pending');
    const initialReads = reads;
    models = [{ id: 'before-connection', name: 'Discovered before connection' }];
    await page.evaluate(() => window.releaseAgentConnection());
    await expect.poll(() => reads).toBeGreaterThan(initialReads);
    await menu.getByRole('button', { name: /Expand codex/ }).click();
    await expect(menu.getByRole('button', { name: 'Discovered before connection', exact: true })).toBeVisible();

    // No agent.status.changed event is sent while disconnected.
    const beforeReconnect = reads;
    models = [{ id: 'during-disconnect', name: 'Discovered while disconnected' }];
    await sockets[0].close({ code: 1012, reason: 'Discovery reconnect fixture' });
    await expect.poll(() => sockets.length).toBe(2);
    await expect.poll(() => reads).toBeGreaterThan(beforeReconnect);
    await expect(menu.getByRole('button', { name: 'Discovered while disconnected', exact: true })).toBeVisible();

    models = [{ id: 'live-update', name: 'Discovered from status event' }];
    sockets[1].send(JSON.stringify({ type: 'agent.status.changed', payload: { name: 'codex' } }));
    await expect(menu.getByRole('button', { name: 'Discovered from status event', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(reports, 'agent-discovery-app.png'), animations: 'disabled' });
    assert.equal(restarts, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: Agent models discovered before connection, during disconnect and from live status updates appear automatically without restart.');
  } catch (error) {
    console.error('Agent discovery fixture:', { reads, sockets: sockets.length, errors });
    throw error;
  } finally {
    await page.close();
  }
}
