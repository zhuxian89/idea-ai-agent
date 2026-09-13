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
  let backgroundSession;
  const send = (type, payload) => socket.send(JSON.stringify({type, payload: {root_id: rootId, session_key: session.key, ...payload}}));
  await page.route('**/api/agents**', route => route.fulfill({json: {agents: [{name: 'codex', installed: true, available: true, models: []}], shells: []}}));
  await page.route('**/api/sessions**', route => {
    const url = new URL(route.request().url());
    rootId = url.searchParams.get('root') || rootId;
    if (url.pathname === '/api/sessions') {
      const items = [session, backgroundSession].filter(Boolean).map(item => ({...item, root_id: rootId}));
      return route.fulfill({json: {items, total_count: items.length}});
    }
    if (url.pathname === '/api/sessions/delivery-test') return route.fulfill({json: {...session, root_id: rootId}});
    if (backgroundSession && url.pathname === `/api/sessions/${backgroundSession.key}`) return route.fulfill({json: {...backgroundSession, root_id: rootId}});
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
  backgroundSession = {
    ...session, key: 'delivery-switching', session_key: 'delivery-switching', name: 'Switching regression',
    exchanges: [{seq: 1, role: 'user', content: 'Another running request', timestamp}],
  };
  send('session.user_message', {session_key: backgroundSession.key, session: backgroundSession, exchange: backgroundSession.exchanges[0]});
  const openHistory = async name => {
    await page.getByRole('button', {name: 'Chat history', exact: true}).click();
    await page.getByText(name, {exact: true}).click();
  };
  await openHistory(backgroundSession.name);
  await chat.getByText('Another running request', {exact: true}).waitFor();
  assert.doesNotMatch(await status.innerText(), /Last update/, 'another session must not inherit the first session\'s activity time');
  await openHistory(session.name);
  await status.getByText('Running tool: Run tests', {exact: true}).waitFor();
  assert.match(await status.innerText(), /Last update 1m \d+s ago/, 'returning to the running session must retain its last-update age');
  await status.getByText(/No new activity for/).waitFor();
  await page.setViewportSize({width: 375, height: 850});
  await page.screenshot({path: path.join(reports, 'ide-message-activity.png'), animations: 'disabled'});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await openHistory(backgroundSession.name);
  await chat.getByText('Another running request', {exact: true}).waitFor();
  send('session.stream', {event: {type: 'tool_call_update', data: {callId: 'tool-test', kind: 'execute', status: 'running', title: 'Run tests in background'}}});
  // A visible acknowledgement on the same socket confirms that the preceding
  // background event was processed before advancing the browser clock.
  send('session.stream', {session_key: backgroundSession.key, event: {type: 'recovery', data: {message: 'Waiting while background task progresses'}}});
  await status.getByText('Waiting while background task progresses', {exact: true}).waitFor();
  await page.clock.fastForward(20000);
  await openHistory(session.name);
  await status.getByText('Running tool: Run tests in background', {exact: true}).waitFor();
  assert.match(await status.innerText(), /Last update 2\d+s ago/, 'background progress must retain its receipt time when the viewer opens');
  send('session.queue.updated', {queue: [{id: 'queue-next', content: 'Queued follow up', timestamp}]});
  await page.getByRole('button', {name: 'Delete queued message', exact: true}).waitFor();
  send('session.queue.updated', {queue: []});
  session.pending = false;
  send('session.done', {});
  await page.getByRole('button', {name: 'Delete queued message', exact: true}).waitFor({state: 'detached'});
  await status.waitFor({state: 'detached'});
  console.log('PASS: authoritative user message and replay deduplication; live thought/tool status, session switching and background activity times, honest silence timer, queue drain and completion.');

  // Finish another session while its viewer is unmounted, then open its history.
  // Old buffered stream events must not restart the completed activity indicator.
  backgroundSession = {
    ...session, key: 'delivery-background', session_key: 'delivery-background', name: 'Completed in background',
    pending: false, exchanges: [
      {seq: 1, role: 'user', content: 'Background request', timestamp},
      {seq: 2, role: 'assistant', content: 'Background answer preserved.', timestamp},
    ],
  };
  send('session.user_message', {session_key: backgroundSession.key, session: backgroundSession, exchange: backgroundSession.exchanges[0]});
  send('session.stream', {session_key: backgroundSession.key, event: {type: 'message_chunk', data: {content: 'Background answer preserved.'}}});
  send('session.stream', {session_key: backgroundSession.key, event: {type: 'message_done', data: {}}});
  send('session.done', {session_key: backgroundSession.key, replay: true});
  await page.getByRole('button', {name: 'Chat history', exact: true}).click();
  await page.getByText('Completed in background', {exact: true}).click();
  await chat.getByText('Background answer preserved.', {exact: true}).waitFor();
  await status.waitFor({state: 'detached', timeout: 2000});
  console.log('PASS: reopening a session completed in the background preserves the answer without restarting the generating indicator.');
}
