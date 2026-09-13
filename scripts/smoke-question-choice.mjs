import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';

const {expect} = createRequire(new URL('../runtime/web/package.json', import.meta.url))('@playwright/test');

export async function smokeQuestionChoice(browser, bootstrapURL, rootId, reports) {
  const page = await browser.newPage({locale: 'en-US', viewport: {width: 375, height: 850}});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const timestamp = new Date().toISOString();
  const sessions = ['choice-session', 'other-session'].map(key => ({key, session_key: key, name: key,
    root_id: rootId, type: 'chat', agent: 'codex', pending: true, created_at: timestamp, updated_at: timestamp,
    exchanges: [{seq: 1, role: 'user', content: `Request for ${key}`, timestamp}],
  }));
  let socket;
  const answers = [];
  const messages = [];
  await page.route('**/api/agents**', route => route.fulfill({json: {agents: [{name: 'codex', available: true, installed: true, models: []}], shells: []}}));
  await page.route('**/api/sessions**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/sessions') return route.fulfill({json: {items: sessions, total_count: sessions.length}});
    const session = sessions.find(item => url.pathname === `/api/sessions/${item.key}`);
    if (session) return route.fulfill({json: {...session, exchanges: session.exchanges.filter(ex => ex.seq > Number(url.searchParams.get('seq') || 0))}});
    if (url.pathname.endsWith('/related-files')) return route.fulfill({json: []});
    return route.continue();
  });
  await page.routeWebSocket(/\/ws(?:\?|$)/, route => {
    socket = route;
    route.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'ping') route.send(JSON.stringify({type: 'pong'}));
      if (message.type === 'session.answer_question') answers.push(message);
      if (message.type === 'session.message') messages.push(message);
    });
  });
  const emit = (type, payload) => socket.send(JSON.stringify({type, payload: {root_id: rootId, session_key: sessions[0].key, ...payload}}));
  const select = async session => {
    await page.evaluate(() => window.ideaAgentNativeCommand('history'));
    await page.locator('.idea-history:visible').getByText(session.name, {exact: true}).click();
    await page.locator('.idea-chat:visible').getByText(`Request for ${session.key}`, {exact: true}).waitFor();
  };
  try {
    await page.goto(`${bootstrapURL}&ide_chrome=1`);
    await page.locator('[contenteditable="true"]').first().waitFor({timeout: 30000});
    await select(sessions[0]);
    const call = {callId: 'choice-1', kind: 'ask_user', status: 'running', title: 'Choose a layout',
      meta: {toolUseId: 'choice-1', questions: [{question: 'Choose a layout', options: [{label: 'List'}, {label: 'Tabs'}]}]},
    };
    emit('session.stream', {event: {type: 'tool_call', data: call}});
    const submit = page.getByRole('button', {name: 'Submit answer', exact: true});
    await submit.waitFor();
    await expect(submit).toBeDisabled();
    await expect(page.getByRole('radio', {name: 'List', exact: true})).not.toBeChecked();
    await expect(page.getByRole('radio', {name: 'Tabs', exact: true})).not.toBeChecked();
    await select(sessions[1]);
    await select(sessions[0]);
    await submit.waitFor();
    await expect(submit).toBeDisabled();
    assert.equal(answers.length, 0, 'displaying/reopening a question must not submit an answer');
    await page.getByRole('radio', {name: 'Tabs', exact: true}).check();
    await expect(submit).toBeEnabled();
    assert.equal(answers.length, 0, 'selecting an option alone is not submission');
    await page.screenshot({path: path.join(reports, 'ide-question-choice.png'), animations: 'disabled'});
    await submit.click();
    await expect.poll(() => answers.length).toBe(1);
    assert.equal(answers[0].payload.session_key, sessions[0].key);
    assert.equal(answers[0].payload.tool_use_id, call.callId);
    assert.deepEqual(answers[0].payload.answers, {q_0: 'Tabs'});
    await expect(page.getByRole('button', {name: 'Submitting...', exact: true})).toBeDisabled();
    socket.send(JSON.stringify({type: 'session.answer_question.accepted', id: answers[0].id, payload: {root_id: rootId, session_key: sessions[0].key, tool_use_id: call.callId}}));
    emit('session.stream', {event: {type: 'tool_call_update', data: {...call, status: 'complete', meta: {...call.meta, answers: {q_0: 'Tabs'}}}}});
    emit('session.stream', {event: {type: 'thought_chunk', data: {content: 'Continue with Tabs'}}});
    await page.locator('.idea-chat:visible').getByText('Thinking', {exact: true}).waitFor();
    assert.equal(messages.length, 0, 'the answer must use the question endpoint, not a separate composer send');
    assert.deepEqual(errors, []);
    console.log('PASS: choice card opens, waits for explicit submission, survives session switching and resumes only after accepted answer.');
  } finally {
    await page.context().close();
  }
}
