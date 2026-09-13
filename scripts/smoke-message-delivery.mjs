import assert from 'node:assert/strict';
import path from 'node:path';

// Controlled transport events exercise the shipped UI without a CLI/model call.
export async function smokeMessageDelivery(page, reports) {
  let socket;
  let rootId = '';
  const sent = [];
  const session = {
    key: 'delivery-test', session_key: 'delivery-test', name: 'Delivery regression',
    type: 'chat', agent: 'codex', pending: true,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    exchanges: [{seq: 1, role: 'user', content: 'First request', timestamp: new Date().toISOString()}],
  };
  const send = (type, payload) => socket.send(JSON.stringify({type, payload: {root_id: rootId, session_key: session.key, ...payload}}));
  await page.route('**/api/agents**', route => route.fulfill({json: {agents: [{name: 'codex', installed: true, available: true, models: []}], shells: []}}));
  await page.route('**/api/sessions**', route => {
    const url = new URL(route.request().url());
    rootId = url.searchParams.get('root') || rootId;
    if (url.pathname === '/api/sessions') return route.fulfill({json: {items: [{...session, root_id: rootId}], total_count: 1}});
    if (url.pathname === '/api/sessions/delivery-test') return route.fulfill({json: {...session, root_id: rootId}});
    if (url.pathname.endsWith('/related-files')) return route.fulfill({json: []});
    return route.continue();
  });
  await page.routeWebSocket(/\/ws(?:\?|$)/, route => {
    socket = route;
    route.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'ping') route.send(JSON.stringify({type: 'pong'}));
      if (message.type === 'session.message') sent.push(message);
    });
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.idea-view-heading p')?.textContent.includes('with spaces'), null, {timeout: 30000});
  await page.getByRole('button', {name: 'Chat history', exact: true}).click();
  await page.getByText('Delivery regression', {exact: true}).click();
  const chat = page.locator('.idea-chat:visible');
  await chat.getByText('First request', {exact: true}).waitFor();
  // The server starts a message even though the UI still considers the session busy.
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill('Follow up after previous turn');
  await page.locator('[data-onboarding="send-action"]').click();
  await page.waitForFunction(() => !document.querySelector('[contenteditable="true"]')?.textContent.trim());
  assert.equal(sent.length, 1);
  const timestamp = new Date().toISOString();
  send('session.accepted', {request_id: sent[0].id, timestamp});
  const exchange = {role: 'user', content: sent[0].payload.content, timestamp};
  send('session.user_message', {session: {key: session.key, agent: 'codex'}, exchange});
  await chat.getByText(exchange.content, {exact: true}).waitFor();
  send('session.user_message', {session: {key: session.key, agent: 'codex'}, exchange});
  assert.equal(await chat.getByText(exchange.content, {exact: true}).count(), 1, 'replay must not duplicate a user bubble');
  const status = chat.locator('[data-session-activity]');
  await status.waitFor({timeout: 2000});
  assert.match(await status.innerText(), /Waiting for Agent|waiting for response/i);
  send('session.stream', {event: {type: 'thought_chunk', data: {content: 'Inspecting the request.'}}});
  await status.getByText('Thinking', {exact: true}).waitFor();
  send('session.stream', {event: {type: 'tool_call', data: {callId: 'tool-test', kind: 'execute', status: 'running', title: 'Run tests'}}});
  await status.getByText('Running tool: Run tests', {exact: true}).waitFor();
  await page.clock.install();
  await page.clock.fastForward(65000);
  await status.getByText(/No new activity for/).waitFor();
  assert.doesNotMatch(await status.innerText(), /crashed|deadlocked/i);
  await page.setViewportSize({width: 375, height: 850});
  await page.screenshot({path: path.join(reports, 'ide-message-activity.png'), animations: 'disabled'});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  send('session.queue.updated', {queue: [{id: 'queue-next', content: 'Queued follow up', timestamp}]});
  await page.getByRole('button', {name: 'Delete queued message', exact: true}).waitFor();
  send('session.queue.updated', {queue: []});
  session.pending = false;
  send('session.done', {});
  await page.getByRole('button', {name: 'Delete queued message', exact: true}).waitFor({state: 'detached'});
  await status.waitFor({state: 'detached'});
  console.log('PASS: authoritative user message and replay deduplication; live thought/tool status, honest silence timer, queue drain and completion.');
}
