import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/services/agents.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const snapshot = model => ({ agents: [{ name: 'codex', installed: true, available: !!model,
  probe_pending: !model, models: model ? [{ id: model, name: model }] : [] }], shells: [] });
function setup() {
  const calls = [];
  const sandbox = { exports: {}, console: { error() {} }, require(name) {
    if (name === './base') return { appPath: path => path };
    if (name === './api') return { protectedAPIReady: () => true, protectedJSON: url => new Promise((resolve, reject) => calls.push({ url, resolve, reject })) };
    throw new Error(name);
  } };
  vm.runInNewContext(source, sandbox);
  return { api: sandbox.exports, calls };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('status invalidations during a pending read coalesce into a fresh snapshot', async () => {
  const { api, calls } = setup();
  const initial = api.fetchAgents(true);
  const update = api.fetchAgents(true);
  const connected = api.fetchAgents(true);
  assert.equal(calls.length, 1);
  calls[0].resolve(snapshot(''));
  await flush();
  assert.equal(calls.length, 2, 'must not reuse the old probe-pending snapshot');
  // An additional native status event can also overtake the follow-up request.
  const lastUpdate = api.fetchAgents(true);
  calls[1].resolve(snapshot('intermediate-model'));
  await flush();
  assert.equal(calls.length, 3);
  calls[2].resolve(snapshot('native-model'));
  for (const pending of [initial, update, connected, lastUpdate]) {
    assert.equal((await pending)[0].models[0].id, 'native-model');
  }
  assert.equal((await api.fetchAgents())[0].probe_pending, false);
  assert.equal(calls.length, 3, 'normal reads should use the latest cache');
});

test('normal concurrent reads share I/O and catalog invalidation stays separate', async () => {
  const { api, calls } = setup();
  const initial = api.fetchAgents();
  const joined = api.fetchAgents();
  const catalog = api.fetchAgentCatalog(true);
  const catalogUpdate = api.fetchAgentCatalog(true);
  calls[0].resolve(snapshot('installed'));
  calls[1].resolve(snapshot(''));
  await flush();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, '/api/agents?all=1');
  calls[2].resolve(snapshot('catalog'));
  assert.equal((await initial)[0].models[0].id, 'installed');
  assert.equal((await joined)[0].models[0].id, 'installed');
  assert.equal((await catalog)[0].models[0].id, 'catalog');
  assert.equal((await catalogUpdate)[0].models[0].id, 'catalog');
});

test('refresh errors release in-flight state and honor each caller error policy', async () => {
  const { api, calls } = setup();
  const initial = api.fetchAgents(true);
  const strict = api.fetchAgents(true, { throwOnError: true });
  const rejected = assert.rejects(strict, /offline/);
  calls[0].reject(new Error('offline'));
  await rejected;
  assert.equal((await initial).length, 0);
  const retry = api.fetchAgents(true);
  calls[1].resolve(snapshot('recovered'));
  assert.equal((await retry)[0].models[0].id, 'recovered');
});
