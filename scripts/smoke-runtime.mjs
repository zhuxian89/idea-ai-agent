import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const toolsDir = path.join(root, '.tools');
mkdirSync(toolsDir, { recursive: true });
const work = mkdtempSync(path.join(toolsDir, 'runtime-smoke-'));
const project = path.join(work, '项目 with spaces');
const data = path.join(work, 'data');
mkdirSync(project);
mkdirSync(data);
// A stale standalone registration must never enable another project in the IDE.
writeFileSync(path.join(data, 'registry.json'), JSON.stringify({dirs: [{id: 'other', name: 'other', root_path: work}], order: ['other']}));
writeFileSync(path.join(project, 'Example.kt'), 'class Example { fun greeting() = "hello" }\n');
const os = ({win32: 'windows', darwin: 'darwin', linux: 'linux'})[process.platform];
const arch = ({x64: 'amd64', arm64: 'arm64'})[process.arch];
const binary = `idea-agent-${os}-${arch}${os === 'windows' ? '.exe' : ''}`;
const executable = path.join(work, binary);
cpSync(path.join(root, 'build/local-runtime', binary), executable);
cpSync(path.join(root, 'runtime/task_template.json'), path.join(work, 'task_template.json'));

let remoteRequests = 0;
const remote = http.createServer((_req, res) => { remoteRequests++; res.writeHead(503).end(); });
remote.listen(0, '127.0.0.1');
await once(remote, 'listening');
const remoteURL = `http://127.0.0.1:${remote.address().port}`;
// No CLI or model requests: the executable sees an empty installed Agent registry.
writeFileSync(path.join(work, 'agents.json'), JSON.stringify({agents: [], shells: [], relayBaseURL: remoteURL}));
const token = randomBytes(32).toString('hex');
const child = spawn(executable, ['--project', project], {
  cwd: work, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: {...process.env, IDE_AGENT_TOKEN: token, IDE_AGENT_DATA_DIR: data,
    MINDFS_AGENTS_CONFIG: path.join(work, 'agents.json'),
    MINDFS_STATIC_DIR: path.join(root, 'build/local-runtime/web'), MINDFS_RELAY_BASE_URL: remoteURL},
});
let browser;
let diagnostics = '';
child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk.toString()).slice(-6000); });
try {
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Runtime startup timed out: ${diagnostics}`)), 30000);
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Runtime exited ${code}: ${diagnostics}`)); });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const line = output.split('\n').find((value) => value.startsWith('IDE_AGENT_READY '));
      if (line) { clearTimeout(timeout); resolve(JSON.parse(line.slice('IDE_AGENT_READY '.length))); }
    });
  });
  assert.equal(new URL(ready.url).hostname, '127.0.0.1');
  assert.equal((await fetch(`${ready.url}/api/dirs`)).status, 401);
  const bootstrapURL = `${ready.url}/?ide_token=${token}`;
  const bootstrap = await fetch(bootstrapURL, {redirect: 'manual'});
  assert.equal(bootstrap.status, 303);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const headers = {Cookie: cookie};
  const dirs = await (await fetch(`${ready.url}/api/dirs`, {headers})).json();
  assert.equal(dirs.length, 1);
  assert.equal(dirs[0].root_path, project);
  for (const route of ['/api/tasks', '/api/tasks/unused/input']) {
    const response = await fetch(`${ready.url}${route}`, {method: 'POST', headers: {...headers, 'Content-Type': 'application/json'}, body: JSON.stringify({root_id: ready.rootId, create_worktree: true})});
    assert.equal(response.status, 403, 'task flow must not create a worktree');
  }
  for (const [route, method] of [['/api/dirs', 'POST'], ['/api/dirs', 'DELETE'], ['/api/local_dirs', 'GET'], ['/api/git/worktrees', 'POST']]) {
    assert.equal((await fetch(`${ready.url}${route}`, {method, headers})).status, 403);
  }
  const status = await (await fetch(`${ready.url}/api/relay/status`, {headers})).json();
  assert.equal(status.no_relayer, true);
  assert.equal((await fetch(`${ready.url}/api/relay/bind/start`, {method: 'POST', headers})).status, 404);
  assert.equal((await fetch(`${ready.url}/api/dirs`, {headers: {...headers, Origin: 'https://example.com'}})).status, 403);
  const html = await (await fetch(`${ready.url}/`, {headers})).text();
  assert.match(html, /type="module"/);
  const sessionResponse = await fetch(`${ready.url}/api/sessions?root=${encodeURIComponent(ready.rootId)}`, {headers});
  assert.equal(sessionResponse.status, 200);
  console.log('PASS: startup, authentication, project selection, sessions, local-only routes, static assets.');

  if (!process.argv.includes('--http-only')) {
    const { chromium } = createRequire(new URL('../runtime/web/package.json', import.meta.url))('@playwright/test');
    const chrome = process.env.IDE_AGENT_BROWSER || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
    browser = await chromium.launch({headless: true, ...(chrome ? {executablePath: chrome} : {channel: 'chrome'})});
    const page = await browser.newPage({viewport: {width: 1120, height: 850}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(bootstrapURL);
    await page.locator('[contenteditable="true"]').first().waitFor({timeout: 30000});
    await page.evaluate(() => window.ideaAgentReceiveContext('IDE_CONTEXT_SMOKE\n文件：Example.kt:1\nclass Example'));
    await page.waitForFunction(() => [...document.querySelectorAll('[contenteditable="true"]')].some(e => e.textContent.includes('IDE_CONTEXT_SMOKE')));
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByRole('button', {name: /worktree/i}).count(), 0, 'IDE composer must not offer worktree creation');
    const reports = path.join(root, 'build/reports');
    mkdirSync(reports, {recursive: true});
    await page.screenshot({path: path.join(reports, 'agent-wide.png'), animations: 'disabled'});
    await page.setViewportSize({width: 430, height: 850});
    await page.evaluate(() => window.ideaAgentSetTheme('dark'));
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && localStorage.getItem('mindfs-appearance-mode') === 'dark');
    await page.waitForFunction(() => {
      const editor = [...document.querySelectorAll('[contenteditable="true"]')].find(e => e.textContent.includes('IDE_CONTEXT_SMOKE'));
      if (!editor) return false;
      const rect = editor.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return rect.x >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && !!hit && editor.contains(hit);
    });
    await page.screenshot({path: path.join(reports, 'agent-sidebar.png'), animations: 'disabled'});
    assert.deepEqual(errors, []);
    console.log('PASS: browser render, editor context draft, theme synchronization, narrow sidebar; no uncaught page errors.');
  }
  assert.equal(remoteRequests, 0, 'IDE runtime contacted the remote configuration/relay service');
  child.stdin.end('shutdown\n');
  const exit = await Promise.race([once(child, 'exit'), new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timed out')), 10000).unref())]);
  assert.equal(exit[0], 0);
  console.log('PASS: no remote service requests; host shutdown exits cleanly.');
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null && child.signalCode === null) { child.stdin.end('shutdown\n'); child.kill(); await once(child, 'exit'); }
  await new Promise(resolve => remote.close(resolve));
  if (path.resolve(work).startsWith(path.resolve(toolsDir) + path.sep)) rmSync(work, {recursive: true, force: true});
}
