import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const { expect } = createRequire(new URL('../runtime/web/package.json', import.meta.url))('@playwright/test');
const patch = name => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-edited before this turn\n+original readme\n`;

// Use the shipped App, HTTP history and WebSocket completion delivery. Loading
// a SessionViewer fixture directly misses the live App's persistence handoff.
export async function smokeTurnDiff(browser, bootstrapURL, rootId, reports) {
  const page = await browser.newPage({locale: 'zh-CN', viewport: {width: 430, height: 850}});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const timestamp = new Date().toISOString();
  const sessions = [{agent: 'codex', native: false}, {agent: 'codex', native: true}, {agent: 'claude', native: false}].map(({agent, native}) => ({
    key: `diff-${agent}-${native ? 'native' : 'workspace'}`, name: `${agent} ${native ? 'native' : 'workspace'} diff regression`, agent, native, root_id: rootId, type: 'chat', pending: true,
    created_at: timestamp, updated_at: timestamp, activity_history_version: 1, reply_metadata_version: 1,
    exchanges: [{seq: 1, role: 'user', agent, content: `Restore README with ${agent}`, timestamp}], exchange_aux: {},
  }));
  let socket;
  let historyReads = 0;
  let holdNextRead = false;
  let releaseRead;
  const emit = (type, session, payload = {}) => socket.send(JSON.stringify({type,
    payload: {root_id: rootId, session_key: session.key, ...payload},
  }));
  const stream = (session, type, data) => emit('session.stream', session, {event: {type, data}});
  await page.route('**/api/agents**', route => route.fulfill({json: {agents: ['codex', 'claude'].map(name => ({name, installed: true, available: true, models: []})), shells: []}}));
  await page.route('**/api/sessions**', async route => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/\/sync$/, '');
    if (url.pathname === '/api/sessions') {
      const items = sessions.map(({exchanges, exchange_aux, ...meta}) => meta);
      return route.fulfill({json: {items, total_count: items.length}});
    }
    const session = sessions.find(s => url.pathname === `/api/sessions/${s.key}`);
    if (session) {
      historyReads++;
      const after = Number(url.searchParams.get('seq') || 0);
      const response = structuredClone({...session, exchanges: session.exchanges.filter(ex => ex.seq > after),
        exchange_aux: Object.fromEntries(Object.entries(session.exchange_aux).filter(([seq]) => Number(seq) > after))});
      if (holdNextRead) {
        holdNextRead = false;
        await new Promise(resolve => { releaseRead = resolve; });
      }
      return route.fulfill({json: response});
    }
    if (url.pathname.endsWith('/related-files')) return route.fulfill({json: []});
    return route.continue();
  });
  await page.routeWebSocket(/\/ws(?:\?|$)/, route => {
    socket = route;
    route.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'ping') route.send(JSON.stringify({type: 'pong'}));
      if (message.type === 'session.ready') {
        const session = sessions.find(s => s.key === message.payload?.session_key);
        if (session && !session.pending) emit('session.done', session, {replay: true});
      }
    });
  });
  const chat = page.locator('.idea-chat:visible');
  const select = async session => {
    await page.evaluate(() => window.ideaAgentNativeCommand('history'));
    await page.locator('.idea-history:visible').getByText(session.name, {exact: true}).click();
    await chat.getByText(session.exchanges[0].content, {exact: true}).waitFor();
  };
  const persist = (session, seq, content, name, native = false) => {
    session.pending = false;
    session.exchanges.push({seq, role: 'agent', agent: session.agent, content, timestamp: new Date().toISOString()});
    session.exchange_aux[seq] = [{seq, line: 0, turn_diff: {diff: patch(name), ...(native ? {turnId: `native-${seq}`} : {workspace: true})}}];
  };
  try {
    await page.goto(`${bootstrapURL}&ide_chrome=1&ide_theme=dark`);
    await page.locator('[contenteditable="true"]').first().waitFor({timeout: 30000});
    await page.evaluate(() => { window.bridgeCalls = []; window.ideaAgent = {postMessage: p => window.bridgeCalls.push(p)}; });
    for (const session of sessions) {
      await select(session);
      stream(session, 'thought_chunk', {content: 'Checking existing changes.'});
      stream(session, 'tool_call', {callId: `restore-${session.agent}`, kind: 'execute', status: 'running', title: 'Restore README'});
      stream(session, 'tool_call_update', {callId: `restore-${session.agent}`, kind: 'execute', status: 'complete', title: 'Restore README'});
      const answer = 'README restored. [README.md](Z:/java_project/zhszh-wz-lab-system/README.md)';
      stream(session, 'message_chunk', {content: answer});
      // Cover command-only Codex, native Codex, and the shared Claude fallback.
      // Neither is injected into the component's props by the test.
      if (session.native) stream(session, 'turn_diff', {turnId: 'native-2', diff: patch('README.md')});
      stream(session, 'message_done', {});
      persist(session, 2, answer, 'README.md', session.native);
      const readsBeforeDone = historyReads;
      emit('session.done', session);
      await expect(chat.locator('[data-turn-diff-file="README.md"]')).toHaveCount(1);
      await expect(chat.getByText('README restored.', {exact: false})).toHaveCount(1);
      await expect(chat.locator('[data-session-activity]')).toHaveCount(0);
      assert.ok(historyReads > readsBeforeDone, 'completion must retrieve persisted auxiliary data');
      // The first live conversation may have no session query; reopening from
      // history includes it. A stripped empty href used to navigate/reload both.
      const sessionURL = page.url();
      for (const withSession of [false, true]) {
        await page.evaluate(({sessionURL, withSession}) => {
          const url = new URL(sessionURL);
          if (!withSession) url.searchParams.delete('session');
          history.replaceState({}, '', url);
          window.bridgeCalls = [];
        }, {sessionURL, withSession});
        const before = page.url();
        // replaceState itself emits a same-document navigation; count only
        // navigation caused by the clicks after the fixture URL is prepared.
        let navigations = 0;
        const onNavigation = frame => { if (frame === page.mainFrame()) navigations++; };
        page.on('framenavigated', onNavigation);
        for (let click = 0; click < 2; click++) {
          await chat.getByRole('link', {name: 'README.md', exact: true}).click();
        }
        assert.deepEqual(await page.evaluate(() => window.bridgeCalls.filter(p => p.action === 'openFile')), [
          {action: 'openFile', rootId, path: 'Z:/java_project/zhszh-wz-lab-system/README.md'},
          {action: 'openFile', rootId, path: 'Z:/java_project/zhszh-wz-lab-system/README.md'},
        ]);
        assert.equal(page.url(), before);
        await expect(chat.locator('[data-turn-diff-file="README.md"]')).toHaveCount(1);
        assert.equal(navigations, 0, 'a Windows filename link must not navigate the chat');
        page.off('framenavigated', onNavigation);
      }
      await chat.locator('[data-turn-diff-file="README.md"]').click();
      await expect(chat.locator('[data-turn-diff-detail]')).toContainText('-edited before this turn');
      await expect(chat.locator('[data-turn-diff-detail]')).toContainText('+original readme');
      await chat.locator('[data-turn-diff-detail]').getByRole('button', {name: '在 IDEA 中打开', exact: true}).click();
      assert.ok(await page.evaluate(() => window.bridgeCalls.some(p => p.action === 'openFile' && p.path === 'README.md')));
      await page.screenshot({path: path.join(reports, `turn-diff-live-${session.agent}-${session.native ? 'native' : 'workspace'}.png`), animations: 'disabled'});
    }
    await page.screenshot({path: path.join(reports, 'turn-diff-live-dark.png'), animations: 'disabled'});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    // A slow completion fetch must never overwrite the following live turn.
    const session = sessions.at(-1);
    const startTurn = (content, seq) => {
      session.pending = true;
      const exchange = {seq, role: 'user', content, agent: session.agent, timestamp: new Date().toISOString()};
      session.exchanges.push(exchange);
      emit('session.user_message', session, {session: {key: session.key, agent: session.agent}, exchange});
    };
    startTurn('Second turn', 3);
    stream(session, 'message_chunk', {content: 'Second answer.'});
    stream(session, 'message_done', {});
    persist(session, 4, 'Second answer.', 'second.txt');
    holdNextRead = true;
    emit('session.done', session);
    await expect.poll(() => typeof releaseRead).toBe('function');
    startTurn('Third turn', 5);
    stream(session, 'message_chunk', {content: 'Third answer in progress.'});
    await expect(chat.getByText('Third answer in progress.', {exact: true})).toHaveCount(1);
    releaseRead();
    // Flush network work before asserting that new output/pending state survives.
    await page.waitForLoadState('networkidle');
    await expect(chat.getByText('Third answer in progress.', {exact: true})).toHaveCount(1);
    await expect(chat.locator('[data-session-activity]')).toHaveCount(1);
    persist(session, 6, 'Third answer in progress.', 'third.txt');
    stream(session, 'message_done', {});
    emit('session.done', session);
    await expect(chat.locator('[data-turn-diff-file="third.txt"]')).toHaveCount(1);
    await expect(chat.locator('[data-turn-diff-file="second.txt"]')).toHaveCount(1);
    await expect(chat.locator('[data-turn-diff-file="README.md"]')).toHaveCount(1);
    await expect(chat.getByText('Third answer in progress.', {exact: true})).toHaveCount(1);
    await expect(chat.locator('[data-session-activity]')).toHaveCount(0);
    const readsAfterFinish = historyReads;
    emit('session.done', session, {replay: true});
    await page.waitForLoadState('networkidle');
    assert.equal(historyReads, readsAfterFinish, 'replayed done must not cause a history-fetch loop');
    await page.reload();
    await expect(chat.locator('[data-turn-diff-file="third.txt"]')).toHaveCount(1);
    await expect(chat.locator('[data-turn-diff-file="README.md"]')).toHaveCount(1);
    assert.deepEqual(errors, []);
    console.log('PASS: complete App retrieves native/workspace diffs, preserves the next live turn, opens Windows filename links without chat navigation, opens diff files, reloads history, and avoids replay loops.');
  } finally {
    releaseRead?.();
    await page.context().close();
  }
}
