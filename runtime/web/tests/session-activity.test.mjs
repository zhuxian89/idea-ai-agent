import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { test } from 'node:test';

const exports = {};
const facts = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/activityFacts.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, {exports: facts});
const source = fs.readFileSync('src/hooks/useSessionStream.ts', 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
vm.runInNewContext(compiled, {exports, require(name) {
  if (name === 'react') return {useEffect() {}, useMemo: fn => fn(), useState: value => [typeof value === 'function' ? value() : value, () => {}]};
  if (name === '../i18n') return {translateNow: key => key};
  if (name === '../services/session') return {sessionService: {getSessionActivity: () => undefined}};
  if (name === '../services/activityFacts') return facts;
  return {};
}});

test('live tools retain running state; ending a turn without a result leaves the tool unknown', () => {
  const exchanges = [
    {role: 'user', content: 'Run the tests'},
    {role: 'tool', toolCall: {callId: 'test-run', kind: 'execute', status: 'running', title: 'Run tests'}},
  ];
  const active = exports.useSessionStream('session', exchanges, {}, undefined, true);
  assert.equal(active.timeline.find(item => item.type === 'tool').toolCall.status, 'running');
  const completed = exports.useSessionStream('session', exchanges, {}, undefined, false);
  assert.equal(completed.timeline.find(item => item.type === 'tool').toolCall.status, 'unknown');
  assert.equal(exchanges[1].toolCall.status, 'running', 'rendering history must not mutate stored native events');
});

test('native failure evidence overrides a stale running status without mutating stored events', () => {
  const call = {callId: 'failed', kind: 'execute', status: 'running', activity: {
    schemaVersion: 1, agent: 'codex', origin: 'live', operation: 'execute', source: 'agent', outcome: 'failed',
  }};
  const state = exports.useSessionStream('session', [{role: 'tool', toolCall: call}], {}, undefined, false);
  assert.equal(state.timeline[0].toolCall.status, 'failed');
  assert.equal(call.status, 'running');
});
