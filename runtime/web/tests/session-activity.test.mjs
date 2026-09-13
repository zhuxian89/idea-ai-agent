import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { test } from 'node:test';

const exports = {};
const source = fs.readFileSync('src/hooks/useSessionStream.ts', 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
vm.runInNewContext(compiled, {exports, require(name) {
  if (name === 'react') return {useEffect() {}, useMemo: fn => fn(), useState: value => [typeof value === 'function' ? value() : value, () => {}]};
  if (name === '../i18n') return {translateNow: key => key};
  return {};
}});

test('live tools retain native running state; completed history settles stale running tools', () => {
  const exchanges = [
    {role: 'user', content: 'Run the tests'},
    {role: 'tool', toolCall: {callId: 'test-run', kind: 'execute', status: 'running', title: 'Run tests'}},
  ];
  const active = exports.useSessionStream('session', exchanges, {}, undefined, true);
  assert.equal(active.timeline.find(item => item.type === 'tool').toolCall.status, 'running');
  const completed = exports.useSessionStream('session', exchanges, {}, undefined, false);
  assert.equal(completed.timeline.find(item => item.type === 'tool').toolCall.status, 'complete');
  assert.equal(exchanges[1].toolCall.status, 'running', 'rendering history must not mutate stored native events');
});
