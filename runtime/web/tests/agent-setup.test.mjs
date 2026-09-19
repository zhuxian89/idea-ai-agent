import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const bundle = await build({ entryPoints: [new URL('../src/services/agentSetup.ts', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'node' });
const { agentSetupState, agentsForPicker, agentHelpLinks, agentErrorMessage, CC_SWITCH_URL } =
  await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('setup distinguishes installation, discovery, authentication and real failures', () => {
  assert.equal(agentSetupState({ installed: false, available: false }), 'missing');
  assert.equal(agentSetupState({ installed: false, available: false, probe_pending: true }), 'pending');
  assert.equal(agentSetupState({ installed: true, available: false, error: 'Authentication required' }), 'login');
  assert.equal(agentSetupState({ installed: true, available: false, error: '{"message":"Sign in required","data":{"reason":"login"}}' }), 'login');
  assert.equal(agentSetupState({ installed: true, available: false, error: 'Internal error' }), 'error');
  assert.equal(agentSetupState({ installed: true, available: true }), 'ready');
  assert.equal(agentErrorMessage('{"message":"Native error"}'), 'Native error');
});

test('first-use picker retains primary uninstalled agents and every installed agent', () => {
  const agents = [
    { name: 'codex', installed: false }, { name: 'claude', installed: false },
    { name: 'cursor', installed: true }, { name: 'custom', installed: true },
    { name: 'other', installed: false },
  ];
  assert.deepEqual(agentsForPicker(agents).map(item => item.name), ['codex', 'claude', 'cursor', 'custom']);
  assert.deepEqual(agentsForPicker([]), [], 'do not invent runtime definitions');
});

test('only supported agents get CC Switch and unknown agents never get invented help URLs', () => {
  assert.equal(agentHelpLinks('codex').ccSwitch, true);
  assert.equal(agentHelpLinks('claude').ccSwitch, true);
  assert.equal(agentHelpLinks('cursor').ccSwitch, undefined);
  assert.equal(agentHelpLinks('custom'), undefined);
  assert.equal(CC_SWITCH_URL, 'https://github.com/farion1231/cc-switch');
});

test('IDEA settings and selector reuse the same guide without installing or writing config', () => {
  const source = name => readFileSync(new URL('../src/components/' + name, import.meta.url), 'utf8');
  for (const name of ['AgentSelector.tsx', 'IdeaAgentSettings.tsx']) assert.match(source(name), /<AgentSetupGuide/);
  assert.doesNotMatch(source('IdeaAgentSettings.tsx'), /onRun\(agent, "install"\)/);
  assert.doesNotMatch(source('AgentSetupGuide.tsx'), /onRun|testAgentConnection|restartAgent|fetch\(/);
});
