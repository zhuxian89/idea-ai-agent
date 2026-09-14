import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const { expect } = createRequire(new URL('../runtime/web/package.json', import.meta.url))('@playwright/test');

// Use the complete App and controlled transport; never dispatch a real Agent call.
export async function smokeSessionModel(browser, bootstrapURL, rootId, reports) {
  const page = await browser.newPage({locale: 'en-US', viewport: {width: 375, height: 850}});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const timestamp = new Date().toISOString();
  const sessions = [
    {key: 'model-claude', name: 'Claude model regression', agent: 'claude', model: 'fable', pending: false},
    {key: 'model-codex', name: 'Codex model regression', agent: 'codex', model: 'codex-model', pending: true},
  ].map(item => ({...item, session_key: item.key, root_id: rootId, type: 'chat',
    mode: item.agent === 'claude' ? 'bypassPermissions' : 'full-access',
    created_at: timestamp, updated_at: timestamp,
    exchanges: [{seq: 1, role: 'user', content: `Original ${item.agent} request`, timestamp}],
  }));
  const agents = sessions.map(item => ({name: item.agent, installed: true, available: true,
    models: [{id: item.model, name: item.model}, {id: `${item.model}-alternate`, name: `${item.model}-alternate`}],
  }));
  let socket;
  const sent = [];
  const emit = (type, session, payload = {}) => socket.send(JSON.stringify({type,
    payload: {root_id: rootId, session_key: session.key, ...payload},
  }));
  await page.route('**/api/agents**', route => route.fulfill({json: {agents, shells: []}}));
  await page.route('**/api/sessions**', route => {
    const url = new URL(route.request().url());
    // F4 history migration uses POST /sync before incremental reads.
    url.pathname = url.pathname.replace(/\/sync$/, '');
    if (url.pathname === '/api/sessions') return route.fulfill({json: {items: sessions, total_count: sessions.length}});
    const session = sessions.find(item => url.pathname === `/api/sessions/${item.key}`);
    if (session) {
      const afterSeq = Number(url.searchParams.get('seq') || 0);
      return route.fulfill({json: {activity_history_version: 1, ...session, exchanges: session.exchanges.filter(exchange => exchange.seq > afterSeq)}});
    }
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
  const label = page.locator('.idea-agent-selector-label');
  const assertSelection = (session, model = session.model) => expect(label).toHaveText(`${session.agent === 'claude' ? 'Claude Code' : 'Codex'} · ${model}`);
  const select = async session => {
    await page.evaluate(() => window.ideaAgentNativeCommand('history'));
    await page.locator('.idea-history:visible').getByText(session.name, {exact: true}).click();
    await page.locator('.idea-chat:visible').getByText(`Original ${session.agent} request`, {exact: true}).waitFor();
    await assertSelection(session);
  };
  const send = async (session, content) => {
    const count = sent.length;
    await page.locator('[contenteditable="true"]').first().fill(content);
    await page.locator('[data-onboarding="send-action"]').click();
    await expect.poll(() => sent.length).toBe(count + 1);
    const request = sent[count];
    assert.equal(request.payload.session_key, session.key, 'send must target the visible session');
    assert.equal(request.payload.agent, session.agent, 'send must use the visible Agent');
    assert.equal(request.payload.model, session.model, 'send must use the selected model');
    assert.equal(request.payload.agent_mode, session.mode, 'send must preserve the selected permission');
    await assertSelection(session);
    emit('session.accepted', session, {request_id: request.id, timestamp: new Date().toISOString()});
    await expect(page.locator('[contenteditable="true"]').first()).toHaveText('');
    await assertSelection(session);
    session.pending = true;
    return request;
  };
  try {
    await page.goto(`${bootstrapURL}&ide_chrome=1`);
    await page.locator('[contenteditable="true"]').first().waitFor({timeout: 30000});
    await select(sessions[0]);
    await send(sessions[0], 'Bind Claude session');
    await assertSelection(sessions[0]);

    // Both are running. A queue send rebinds the composer to the selected session.
    for (const session of [sessions[1], sessions[0], sessions[1]]) {
      await select(session);
      const request = await send(session, `Queue follow-up ${sent.length}`);
      await assertSelection(session);
      emit('session.queue.updated', session, {queue: [{id: request.id, content: request.payload.content, timestamp}]});
      await page.getByRole('button', {name: 'Delete queued message', exact: true}).waitFor();
      await assertSelection(session);
    }

    // The previously bound session must not override an explicit model/permission
    // choice made after opening a different running conversation from history.
    const target = sessions[0];
    await select(target);
    const alternateModel = `${target.model}-alternate`;
    await page.locator('[data-onboarding="agent-selector"] > button').click();
    await page.locator('[data-agent-menu]').getByRole('button', {name: alternateModel, exact: true}).click();
    await page.keyboard.press('Escape');
    await assertSelection(target, alternateModel);
    await page.locator('.idea-permission-select').click();
    await page.getByRole('option', {name: /Standard/}).click();
    const request = await send({...target, model: alternateModel, mode: 'default'}, 'Use my chosen model and permission');
    target.model = alternateModel;
    target.mode = 'default';

    const recordUser = (session, content) => {
      const exchange = {seq: session.exchanges.length + 1, role: 'user', content,
        agent: session.agent, model: session.model, mode: session.mode, timestamp: new Date().toISOString()};
      session.exchanges.push(exchange);
      emit('session.user_message', session, {session, exchange});
    };
    // Deliver updates for the other running session while this one is visible.
    await page.evaluate(() => {
      window.modelLabels = [];
      window.modelObserver = new MutationObserver(() => window.modelLabels.push(document.querySelector('.idea-agent-selector-label').textContent));
      window.modelObserver.observe(document.querySelector('.idea-agent-selector-label'), {childList: true, subtree: true, characterData: true});
    });
    recordUser(sessions[1], 'Background Codex follow-up');
    emit('session.stream', sessions[1], {event: {type: 'thought_chunk', data: {content: 'Background Codex thinking'}}});
    // A visible event on the same socket is a barrier for the background events.
    emit('session.stream', target, {event: {type: 'recovery', data: {message: 'Foreground model remains selected'}}});
    await page.locator('.idea-chat:visible').getByText('Foreground model remains selected', {exact: true}).waitFor();
    await assertSelection(target);
    recordUser(target, request.payload.content);
    await page.locator('.idea-chat:visible').getByText(request.payload.content, {exact: true}).waitFor();
    await assertSelection(target);
    const observed = await page.evaluate(() => { window.modelObserver.disconnect(); return window.modelLabels; });
    assert.ok(observed.every(value => value === `Claude Code · ${alternateModel}`), 'background and authoritative events must not flash another model');
    emit('session.queue.updated', target, {queue: []});
    await select(sessions[1]);
    await select(target);
    await expect(page.locator('.idea-permission-select')).toHaveAccessibleName('Execution permissions: Standard');

    // Exercise an idle conversation too: explicit choices must survive the
    // optimistic user bubble, acceptance, authoritative metadata and streaming.
    const idle = sessions[1];
    idle.pending = false;
    emit('session.done', idle, {replay: true});
    await select(idle);
    const idleRequest = await send(idle, 'Start another Codex turn');
    recordUser(idle, idleRequest.payload.content);
    emit('session.stream', idle, {event: {type: 'thought_chunk', data: {content: 'Working with the selected Codex model'}}});
    await page.locator('.idea-chat:visible').getByText('Thinking', {exact: true}).waitFor();
    await assertSelection(idle);
    await page.screenshot({path: path.join(reports, 'ide-session-model.png'), animations: 'disabled'});
    assert.deepEqual(errors, []);
    console.log('PASS: running/idle Claude/Codex sends, queued acceptance, explicit model/permission choices, background events, authoritative metadata and switching retain the correct composer and outgoing request.');
  } finally {
    await page.context().close();
  }
}
