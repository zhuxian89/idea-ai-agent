import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => imports[name], URLSearchParams, AbortController, DOMException });
  return exports;
}
class APIError extends Error { constructor(status) { super('private server error'); this.status = status; } }
const ref = { rootId: 'root /', sessionKey: 'A /', callId: 'call /' };
const call = { callId: ref.callId, kind: 'execute', status: 'complete' };
test('HTTP distinguishes missing, unavailable and denied; existing wrapper stays compatible', async () => {
  let response, error, received;
  const { sessionService } = load('src/services/session.ts', {
    './base': { appURL: (path, params) => path + '?' + params, wsURL: path => path },
    './api': { ProtectedAPIError: APIError, protectedJSON: async (...args) => { received = args; if (error) throw error; return response; } },
    './e2ee': { e2eeService: { setClientId() {}, isRequired: () => false } }, './sessionHistory': {},
  });
  for (response of [call, { toolcall: call }, { toolCall: call }]) {
    assert.equal((await sessionService.getToolCallDetails(ref)).toolCall, call);
    assert.equal(await sessionService.getToolCall(ref.rootId, ref.sessionKey, ref.callId), call);
  }
  const controller = new AbortController();
  await sessionService.getToolCallDetails(ref, controller.signal);
  assert.equal(received[1].signal, controller.signal);
  assert.equal(received[0], '/api/sessions/A%20%2F/toolcalls/call%20%2F?root=root+%2F');
  for (response of [null, {}, { toolcall: null }]) assert.equal((await sessionService.getToolCallDetails(ref)).kind, 'missing');
  for (const status of [404, 400, 401, 403, 408, 429, 500, 503, undefined]) {
    error = status ? new APIError(status) : new Error('private network error');
    const result = await sessionService.getToolCallDetails(ref);
    if (status === 404) assert.equal(result.kind, 'missing');
    else {
      assert.equal(result.kind, 'unavailable');
      assert.equal(result.retryable, ![400, 401, 403].includes(status));
      assert.ok(!result.message.includes('private'));
    }
    assert.equal(await sessionService.getToolCall(ref.rootId, ref.sessionKey, ref.callId), null);
  }
  controller.abort();
  await assert.rejects(sessionService.getToolCallDetails(ref, controller.signal), { name: 'AbortError' });
});
function loader() {
  const requests = [];
  const service = { getToolCallDetails(ref, signal) {
    return new Promise((resolve, reject) => requests.push({ ref, signal, resolve, reject }));
  } };
  return { ...load('src/services/activityDetails.ts', { './session': { sessionService: service } }), requests };
}
test('in-flight reads coalesce, cancel independently and never cache completed output', async () => {
  const { loadActivityDetails, requests } = loader();
  const first = new AbortController(), second = new AbortController();
  const a = loadActivityDetails(ref, first.signal), b = loadActivityDetails(ref, second.signal);
  assert.equal(requests.length, 1);
  first.abort();
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal(requests[0].signal.aborted, false);
  const c = loadActivityDetails({ ...ref, sessionKey: 'B' });
  const d = loadActivityDetails({ ...ref, rootId: 'other-root' });
  assert.equal(requests.length, 3);
  requests.forEach(request => request.resolve({ kind: 'loaded', toolCall: call }));
  assert.equal((await b).toolCall, call);
  await Promise.all([c, d]);
  const again = loadActivityDetails(ref);
  assert.equal(requests.length, 4);
  requests[3].resolve({ kind: 'missing' });
  assert.equal((await again).kind, 'missing');
});
test('last cancellation releases request; late completion cannot remove a new request', async () => {
  const { loadActivityDetails, requests } = loader();
  const controller = new AbortController();
  const old = loadActivityDetails(ref, controller.signal);
  controller.abort();
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(requests[0].signal.aborted, true);
  const next = loadActivityDetails(ref);
  requests[0].resolve({ kind: 'loaded', toolCall: call });
  await Promise.resolve();
  const joined = loadActivityDetails(ref);
  assert.equal(requests.length, 2);
  requests[1].resolve({ kind: 'missing' });
  assert.equal((await next).kind, 'missing');
  assert.equal((await joined).kind, 'missing');
  await assert.rejects(loadActivityDetails(ref, controller.signal), { name: 'AbortError' });
  assert.equal(requests.length, 2);
});
test('full content replaces compact prefixes; stale snapshots cannot erase live output', () => {
  const { detailContent } = loader();
  const content = text => [{ type: 'text', text }];
  const full = content('line 1\nline 2\nline 3');
  assert.equal(detailContent(content('line 1\n...(truncated)'), full), full);
  const live = content('line 1\nline 2\nline 3\nline 4');
  assert.equal(detailContent(live, full), live);
  const changed = content('replacement output');
  assert.equal(detailContent(changed, full), changed);
  assert.equal(detailContent(undefined, full), full);
});
