import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep tests launched from the IDE out of the running plugin's data directory.
const runtime = fileURLToPath(new URL('../runtime/', import.meta.url));
const caches = JSON.parse(execFileSync('go', ['env', '-json', 'GOCACHE', 'GOMODCACHE', 'GOPATH'], { cwd: runtime, encoding: 'utf8' }));
const home = mkdtempSync(path.join(tmpdir(), 'idea-agent-tests-'));
let exitCode = 1;
try {
  const env = { ...process.env, ...caches, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), AppData: path.join(home, 'appdata') };
  for (const key of ['IDE_AGENT_DATA_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']) delete env[key];
  const args = process.argv.slice(2);
  const result = spawnSync('go', ['test', '-p', '2', ...(args.length ? args : ['./server/...', '-count=1'])], { cwd: runtime, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
process.exitCode = exitCode;
