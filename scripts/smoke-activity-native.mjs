// Opt-in: calls the locally installed agents using existing authentication.
// Run only for native integration acceptance; creates an isolated benign project.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const reports = path.join(root, 'build/reports/activity-ide-readiness');
const agents = process.argv.includes('--codex-only') ? ['codex'] : ['codex', 'claude'];
const resultFile = path.join(reports, agents.length === 1 ? 'native-codex.json' : 'native-cli.json');
mkdirSync(reports, {recursive: true});
mkdirSync(path.join(root, '.tools'), {recursive: true});
const previous = process.argv.includes('--recheck') ? JSON.parse(readFileSync(resultFile)) : null;
const work = previous ? path.dirname(previous.project) : mkdtempSync(path.join(root, '.tools/activity-native-'));
const project = path.join(work, '验证 project');
mkdirSync(project, {recursive: true}); mkdirSync(path.join(work, 'data'), {recursive: true});
if (!previous) {
writeFileSync(path.join(project, 'README.md'), '# Activity acceptance fixture\nThe verification marker is ACTIVITY_READY_2026.\n');
execFileSync('git', ['init', '-q', project]);
execFileSync('git', ['-C', project, 'add', 'README.md']);
execFileSync('git', ['-C', project, '-c', 'user.name=Acceptance', '-c', 'user.email=acceptance@example.invalid', 'commit', '-qm', 'fixture']);
}
const registry = JSON.parse(readFileSync(path.join(root, 'runtime/agents.json')));
registry.agents = registry.agents.filter(a => ['codex', 'claude'].includes(a.name));
writeFileSync(path.join(work, 'agents.json'), JSON.stringify(registry));
const platform = {darwin: 'darwin', linux: 'linux', win32: 'windows'}[process.platform];
const architecture = {arm64: 'arm64', x64: 'amd64'}[process.arch];
const binary = `idea-agent-${platform}-${architecture}${process.platform === 'win32' ? '.exe' : ''}`;
cpSync(path.join(root, 'build/local-runtime', binary), path.join(work, binary));
cpSync(path.join(root, 'runtime/task_template.json'), path.join(work, 'task_template.json'));
const token = randomBytes(32).toString('hex');
const child = spawn(path.join(work, binary), ['--project', project], {cwd: work, stdio: ['pipe', 'pipe', 'pipe'],
  env: {...process.env, IDE_AGENT_TOKEN: token, IDE_AGENT_DATA_DIR: path.join(work, 'data'), MINDFS_AGENTS_CONFIG: path.join(work, 'agents.json'), MINDFS_STATIC_DIR: path.join(root, 'build/local-runtime/web')}});
// Runtime diagnostics may contain local authentication details: do not print them.
child.stderr.resume();
let browser;
const outcomes = [];
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Runtime startup timeout')), 30000);
    child.once('error', reject); child.once('exit', code => {clearTimeout(timer); reject(new Error('Runtime exit ' + code));});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const line = output.split('\n').find(s => s.startsWith('IDE_AGENT_READY ')); if (line) {clearTimeout(timer); resolve(JSON.parse(line.slice(16)));} });
  });
  const {chromium} = createRequire(new URL('../runtime/web/package.json', import.meta.url))('@playwright/test');
  browser = await chromium.launch({headless: true, channel: 'chrome'});
  const page = await browser.newPage({viewport: {width: 480, height: 900}});
  await page.goto(`${ready.url}/?ide_token=${token}&ide_chrome=1`);
  await page.evaluate(() => {window.nativeEvents = []; window.nativeSocket = new WebSocket(location.origin.replace('http:', 'ws:') + '/ws?client_id=activity-native-acceptance'); window.nativeSocket.onmessage = event => {try {window.nativeEvents.push(JSON.parse(event.data));} catch {}};});
  await page.waitForFunction(() => window.nativeSocket.readyState === WebSocket.OPEN);
  for (const agent of agents) {
    const result = {agent, version: execFileSync(agent, ['--version'], {encoding: 'utf8'}).trim(), status: 'pending'};
    console.log(`Testing native ${result.version} in isolated fixture`);
    const prior = previous?.outcomes.find(item => item.agent === agent);
    if (prior?.reason?.includes('180 seconds')) {outcomes.push(prior); continue;}
    const started = Date.now();
    if (!previous) await page.evaluate(({agent, rootId}) => {window.nativeEvents = []; window.nativeSocket.send(JSON.stringify({id: 'readiness-' + agent, type: 'session.message', payload: {
      root_id: rootId, type: 'chat', agent,
      content: 'This is a bounded local integration test. Do not delegate or use network tools. Work only in the current fixture directory. Perform these three separate tool calls in order: (1) read README.md; (2) run the shell command printf ACTIVITY_OK; (3) run the shell command sh -c "exit 7". The third command is expected to fail: do not retry or fix it. Then answer briefly with the README marker and each command exit status. Do not edit files.'
    }}));}, {agent, rootId: ready.rootId});
    try {
      if (!previous) await page.waitForFunction(() => window.nativeEvents.some(e => ['session.done', 'session.error', 'error'].includes(e.type)), null, {timeout: 180000});
      const events = await page.evaluate(() => window.nativeEvents);
      result.eventTypes = prior?.eventTypes || [...new Set(events.map(e => e.type))];
      const key = prior?.sessionKey || events.map(e => e.payload?.session_key || e.payload?.session?.key).find(Boolean);
      assert.ok(key, 'native session key');
      result.sessionKey = key;
      const fetchHistory = () => page.evaluate(async ({key, rootId}) => {
        const response = await fetch(`/api/sessions/${encodeURIComponent(key)}?root=${encodeURIComponent(rootId)}`);
        if (!response.ok) throw new Error('History HTTP ' + response.status);
        return response.json();
      }, {key, rootId: ready.rootId});
      const history = await fetchHistory();
      const tools = Object.values(history.exchange_aux || {}).flat().filter(e => e.toolcall).map(e => e.toolcall);
      result.tools = tools.map(call => ({callId: call.callId, kind: call.kind, status: call.status, activity: call.activity}));
      result.finalAnswer = (history.exchanges || []).filter(e => ['assistant', 'agent'].includes(e.role)).map(e => e.content).join('\n');
      result.pending = history.pending;
      await page.reload();
      const returned = await fetchHistory();
      assert.deepEqual(Object.values(returned.exchange_aux || {}).flat().filter(e => e.toolcall).map(e => e.toolcall), tools);
      result.historyReturned = true;
      assert.ok(tools.some(call => call.status === 'complete'), 'successful native tool');
      assert.ok(tools.some(call => call.status === 'failed'), 'failed native tool');
      assert.equal(tools.length, 3, 'three separate native tools, without duplicate wrappers');
      assert.match(result.finalAnswer, /ACTIVITY_READY_2026/);
      assert.equal(Boolean(history.pending), false);
      await page.waitForFunction(() => typeof window.ideaAgentNativeCommand === 'function');
      await page.evaluate(() => window.ideaAgentNativeCommand('history'));
      await page.locator('.idea-history:visible').getByText(history.name, {exact: true}).click();
      await page.locator('[data-tool-activity]').first().waitFor();
      // Opening history can trigger F4's full native import after the initial
      // GET. Check persisted tools after that request and another full sync.
      const synced = await page.evaluate(async ({key, rootId}) => (await fetch(`/api/sessions/${encodeURIComponent(key)}/sync?root=${encodeURIComponent(rootId)}`, {method: 'POST'})).json(), {key, rootId: ready.rootId});
      const syncedTools = Object.values(synced.exchange_aux || {}).flat().filter(e => e.toolcall).map(e => e.toolcall);
      assert.deepEqual(syncedTools.map(call => [call.callId, call.status]), tools.map(call => [call.callId, call.status]), 'full native sync must preserve unique IDs and failure');
      assert.equal(await page.locator('[data-tool-activity]').count(), tools.length);
      assert.equal(await page.locator('[data-activity-group]').count(), 0, 'two successes and a failure cannot become an extra completed group');
      assert.equal(await page.locator('[data-activity-details]').count(), 0);
      assert.equal(await page.locator('[data-session-activity]').count(), 0);
      await page.screenshot({path: path.join(reports, `${agent}-native-history-browser.png`)});
      const first = page.locator('[data-tool-activity]').first();
      await first.locator('button[aria-expanded]').first().click();
      await first.locator('[data-activity-details]').getByText(/ACTIVITY_READY_2026/).waitFor();
      result.browserHistory = {tools: tools.length, collapsedByDefault: true, firstDetailLoaded: true, completedTimerRemoved: true};
      result.status = 'passed';
    } catch (error) {
      result.status = 'incomplete';
      result.reason = error.name === 'TimeoutError' ? 'No terminal event within 180 seconds' : error.message.split('\n')[0];
      // Stop this test session before starting another, using its own socket only.
      await page.evaluate(rootId => {const key = window.nativeEvents?.map(e => e.payload?.session_key || e.payload?.session?.key).find(Boolean); if (key && window.nativeSocket?.readyState === WebSocket.OPEN) window.nativeSocket.send(JSON.stringify({type:'session.stop', payload:{root_id:rootId, session_key:key}}));}, ready.rootId);
    }
    result.elapsedMs = prior?.elapsedMs || Date.now() - started;
    if (previous) result.historyRechecked = true;
    outcomes.push(result);
    writeFileSync(resultFile, JSON.stringify({project, outcomes}, null, 2));
    console.log(`${agent}: ${result.status}${result.reason ? ' — ' + result.reason : ''} (${result.elapsedMs} ms)`);
    // Reload recreates the application connection; give the next test its own observer socket.
    await page.evaluate(() => {window.nativeSocket?.close(); window.nativeEvents = []; window.nativeSocket = new WebSocket(location.origin.replace('http:', 'ws:') + '/ws?client_id=activity-native-acceptance'); window.nativeSocket.onmessage = event => {try {window.nativeEvents.push(JSON.parse(event.data));} catch {}};});
    await page.waitForFunction(() => window.nativeSocket.readyState === WebSocket.OPEN);
  }
} finally {
  await browser?.close();
  child.stdin.end('shutdown\n');
  const force = setTimeout(() => child.kill('SIGTERM'), 10000);
  if (child.exitCode === null) await once(child, 'exit');
  clearTimeout(force);
}
writeFileSync(resultFile, JSON.stringify({project, outcomes}, null, 2));
if (outcomes.length !== agents.length || outcomes.some(result => result.status !== 'passed')) process.exitCode = 1;
