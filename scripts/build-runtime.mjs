import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, 'runtime');
const output = path.join(root, 'build', 'local-runtime');
const os = process.env.GOOS || ({ win32: 'windows', darwin: 'darwin', linux: 'linux' })[process.platform];
const arch = process.env.GOARCH || ({ x64: 'amd64', arm64: 'arm64' })[process.arch];
if (!os || !arch) throw new Error('Unsupported runtime platform. Set GOOS and GOARCH explicitly.');

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

const skipWebBuild = process.env.IDEA_AGENT_SKIP_WEB_BUILD === '1';
if (!skipWebBuild) {
  if (!existsSync(path.join(runtime, 'web/node_modules/vite/bin/vite.js'))) {
    throw new Error('Install frontend dependencies first: cd runtime/web && pnpm install --reporter=append-only');
  }
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], path.join(runtime, 'web'));
} else if (!existsSync(path.join(runtime, 'web/dist/index.html'))) {
  throw new Error('IDEA_AGENT_SKIP_WEB_BUILD=1 requires a prebuilt runtime/web/dist directory');
}
// This directory is generated and owned by this task; stale assets or binaries
// must not survive a rebuild for another platform.
if (path.relative(root, path.resolve(output)) !== path.join('build', 'local-runtime')) throw new Error('Invalid runtime output path');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', path.join(output, `idea-agent-${os}-${arch}${os === 'windows' ? '.exe' : ''}`), './server/cmd/idea-agent'], runtime,
  { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: '0' });
cpSync(path.join(runtime, 'web/dist'), path.join(output, 'web'), { recursive: true });
for (const file of ['agents.json', 'task_template.json', 'LICENSE']) cpSync(path.join(runtime, file), path.join(output, file));
mkdirSync(path.join(output, 'licenses'), {recursive: true});
cpSync(path.join(runtime, 'third_party/codex-go-sdk/LICENSE'), path.join(output, 'licenses/codex-go-sdk-LICENSE'));
cpSync(path.join(runtime, 'third_party/claude-agent-sdk-go/LICENSE'), path.join(output, 'licenses/claude-agent-sdk-go-LICENSE'));
cpSync(path.join(runtime, 'third_party/jsonschema-v6-LICENSE'), path.join(output, 'licenses/jsonschema-v6-LICENSE'));
console.log(`Local runtime ready: ${output}`);
