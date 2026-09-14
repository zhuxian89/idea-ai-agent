import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('vite'))('esbuild');
const bundle = buildSync({ stdin: { contents: 'export * from "./src/services/activityGrouping";', resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'grouping', define: { 'process.env.NODE_ENV': '"production"' } });
const sandbox = { console }; vm.runInNewContext(bundle.outputFiles[0].text, sandbox);
const { groupCompletedActivities, projectActivityTimeline } = sandbox.grouping;
const entry = (id, patch = {}) => ({ type: 'activity', view: { key: JSON.stringify(['root', 'A', id]), ref: { rootId: 'root', sessionKey: 'A', callId: id }, agent: 'codex', sourceTurnKey: 'turn', operation: 'execute', source: 'agent', state: 'completed', summary: id, requiresInteraction: false, ...patch } });
const group = (entries, closed = true) => groupCompletedActivities(entries, { closedTurnKeys: new Set(closed ? ['turn'] : []), minGroupSize: 3 });
const ids = rows => Array.from(rows, row => row.type === 'activity_group' ? Array.from(row.items, i => i.ref.callId) : row.type === 'activity' ? row.view.ref?.callId : row.key);
const calls = (prefix = '') => [1, 2, 3].map(i => entry(prefix + i));

test('0/1/2 remain single; three completed calls group only after their segment closes', () => {
  for (let n = 0; n < 3; n++) assert.equal(group(calls().slice(0, n)).filter(r => r.type === 'activity_group').length, 0);
  assert.deepEqual(ids(group(calls())), [['1', '2', '3']]);
  assert.deepEqual(ids(group(calls(), false)), ['1', '2', '3']);
  assert.deepEqual(ids(group([...calls(), { type: 'boundary', key: 'progress' }], false)), [['1', '2', '3'], 'progress']);
});

test('an open running tail never prematurely folds completed prefixes; closed runs retain the running member', () => {
  const entries = [...calls(), entry('running', { state: 'running' }), ...calls('next')];
  assert.equal(group(entries, false).length, 7);
  assert.deepEqual(ids(group([...entries, { type: 'boundary', key: 'text' }], false)), [['1', '2', '3'], 'running', ['next1', 'next2', 'next3'], 'text']);
});

test('all non-success and special kinds split groups without disappearing', () => {
  for (const patch of [
    ...['failed', 'declined', 'cancelled', 'interrupted', 'unknown'].map(state => ({ state })),
    ...['file_change', 'task', 'other'].map(operation => ({ operation })),
    { source: 'user_shell' }, { requiresInteraction: true }, { ref: undefined }, { agent: undefined }, { sourceTurnKey: undefined },
  ]) {
    assert.deepEqual(ids(group([...calls(), entry('special', patch), ...calls('next')])), [['1', '2', '3'], patch.ref === undefined && Object.hasOwn(patch, 'ref') ? undefined : 'special', ['next1', 'next2', 'next3']]);
  }
});

test('root/session/agent/turn changes are boundaries; unknown identity never groups', () => {
  for (const patch of [ { agent: 'claude' }, { sourceTurnKey: 'other-turn' }, { ref: { rootId: 'other', sessionKey: 'A', callId: 'new' } }, { ref: { rootId: 'root', sessionKey: 'B', callId: 'new' } } ]) {
    const rows = group([...calls(), entry('new', patch)], false);
    assert.equal(rows[0].type, 'activity_group'); assert.equal(rows[1].type, 'activity');
  }
  for (const patch of [{ ref: undefined }, { agent: undefined }, { sourceTurnKey: undefined }]) assert.equal(group(calls().map(e => ({ ...e, view: { ...e.view, ...patch } }))).length, 3);
});

test('twenty updates count once with the newest outcome; group identity ignores text, locale and appended members', () => {
  const a = group(calls())[0];
  const repeats = [...calls(), ...Array.from({ length: 20 }, () => entry('2'))];
  assert.deepEqual(ids(group(repeats)), [['1', '2', '3']]);
  assert.deepEqual(ids(group([...repeats, entry('2', { state: 'failed' })])), ['1', '2', '3']);
  assert.equal(group([...calls().map(e => ({ ...e, view: { ...e.view, summary: '新的文字' } })), entry('4')])[0].key, a.key);
  assert.notEqual(group(calls().map(e => ({ ...e, view: { ...e.view, agent: 'claude' } })))[0].key, a.key);
});

const context = { rootId: 'root', sessionKey: 'A', rootPath: '/project', locale: 'zh-CN', tailClosed: true };
const item = (id, patch = {}) => ({ id, type: 'tool', agent: 'codex', sourceTurnKey: 'turn', toolCall: { callId: id, kind: 'execute', status: 'complete', meta: { command: 'cat README.md' }, ...patch } });
test('timeline adapter keeps every text/special boundary and original indices, with no phase inference', () => {
  for (const type of ['user_text', 'assistant_text', 'thought', 'todo', 'plan', 'compact']) {
    const boundary = { id: 'boundary', type, content: 'original content' };
    const timeline = [item('1'), item('2'), item('3'), boundary, item('4'), item('5'), item('6')];
    const projected = projectActivityTimeline(timeline, context);
    assert.equal(projected.rows[0].type, 'activity_group');
    assert.equal(projected.rows[1].type, 'boundary');
    assert.equal(projected.originals.get(projected.rows[1].key).item, boundary);
    assert.equal(projected.originals.get(projected.rows[2].items[0].key).index, 4);
  }
});

test('special raw kinds and source override conflicting facts, and missing identity is conservative', () => {
  const facts = { schemaVersion: 1, agent: 'codex', operation: 'execute', source: 'agent', origin: 'live', outcome: 'completed' };
  for (const patch of [ ...['task', 'edit', 'ask_user', 'todo', 'switch_mode'].map(kind => ({ kind })), { meta: { source: 'userShell' } }, { meta: { rawType: 'collabToolCall' } }, { content: [{ type: 'diff', oldText: 'a', newText: 'b' }] } ]) {
    const result = projectActivityTimeline([item('1'), item('special', { ...patch, activity: facts }), item('3')], context);
    assert.equal(result.rows.length, 3);
  }
  const missing = [1, 2, 3].map(i => ({ ...item('local-' + i), agent: undefined, toolCall: { callId: '', kind: 'read', status: 'complete' } }));
  const result = projectActivityTimeline(missing, context);
  assert.equal(result.rows.length, 3); assert.equal(result.originals.size, 3);
});

test('1000 compact activities do not inspect large log text; duplicate views retain first position and latest data', () => {
  const log = { type: 'text', get text() { throw new Error('grouping must not inspect logs'); } };
  const timeline = Array.from({ length: 1000 }, (_, i) => item(String(i), { content: [log] }));
  const result = projectActivityTimeline(timeline, context);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].items.length, 1000);
  const latest = item('0', { title: 'updated', status: 'failed' });
  const updated = projectActivityTimeline([...timeline, latest], context);
  assert.equal(updated.originals.size, 1000);
  const first = updated.originals.get(updated.rows[0].view.key);
  assert.equal(first.index, 0); assert.equal(first.item.toolCall.title, 'updated');
});
