import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

function setup() {
  const calls = [], timers = new Map();
  const api = { protectedAPIReady: () => true, protectedJSON: (url, options = {}) => new Promise((resolve, reject) => {
    calls.push({ url, options, resolve, reject });
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) };
  const common = { console, AbortController, DOMException,
    setTimeout: (fn, ms) => { timers.set(fn, ms); return fn; }, clearTimeout: fn => timers.delete(fn),
  };
  const load = (file, require) => {
    const sandbox = { ...common, exports: {}, require };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/services/${file}.ts`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, sandbox);
    return sandbox.exports;
  };
  const require = name => name === './api' ? api : name === './base' ? { appPath: path => path } : agents;
  const agents = load('agents', require);
  return { ...load('agentModelRefresh', require), calls,
    tick: ms => { for (const [fn, duration] of [...timers]) if (duration === ms) { timers.delete(fn); fn(); } },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const status = (pending = false, extra = {}) => ({ agents: [{ name: 'codex', installed: true, available: !pending, probe_pending: pending, models: [{ id: 'new' }], ...extra }] });

test('manual refresh reuses probe endpoint and waits for completion, not just acceptance', async () => {
  const { refreshAgentModels, calls, tick } = setup();
  const refresh = refreshAgentModels('codex');
  assert.equal(refresh, refreshAgentModels('codex'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/agents/probe');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { agent: 'codex' });
  let done = false;
  refresh.then(() => { done = true; });
  calls[0].resolve({ probing: true });
  await flush();
  assert.equal(done, false);
  assert.equal(calls[1].url, '/api/agents');
  assert.equal(calls[1].options.cache, 'no-store');
  calls[1].resolve(status(true));
  await flush();
  assert.equal(done, false);
  tick(1000);
  await flush();
  calls[2].resolve(status());
  await refresh;
  assert.equal(done, true);
  assert.ok(calls.every(call => !/restart|test-connection|refresh-models/.test(call.url)));
});

test('discovery errors and network failure allow retry, and waiting is bounded', async () => {
  for (const failure of ['models', 'network', 'timeout']) {
    const { refreshAgentModels, calls, tick } = setup();
    const refresh = refreshAgentModels('codex');
    const rejected = assert.rejects(refresh, failure === 'timeout' ? /Aborted/ : /failed/);
    if (failure === 'network') calls[0].reject(new Error('network failed'));
    else {
      calls[0].resolve({ probing: true });
      await flush();
      if (failure === 'timeout') tick(120000);
      else calls[1].resolve(status(false, { models_error: 'models failed' }));
    }
    await rejected;
    const index = calls.length;
    const retry = refreshAgentModels('codex');
    calls[index].resolve({ probing: true });
    await flush();
    calls[index + 1].resolve(status());
    await retry;
  }
});
