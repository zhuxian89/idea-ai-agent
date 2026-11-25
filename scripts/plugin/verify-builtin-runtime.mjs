#!/usr/bin/env node
// verify-builtin-runtime.mjs <plugin-zip>
//
// Extracts the final IDEA plugin ZIP into an isolated temporary HOME/project directory, boots the embedded
// `idea-agent-*` binary for the current OS/arch, exchanges the one-time `/?ide_token=...` bootstrap for its
// private HttpOnly cookie, verifies `/api/dirs` registers the project root, and requests EVERY packaged web
// file over HTTP, asserting HTTP 200, byte-for-byte equality with the ZIP contents, and zero `/mindfs-assets/`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { readZipBuffer } from './verify-plugin-assets.mjs';

function hostBinaryName() {
  const goos = { darwin: 'darwin', win32: 'windows', linux: 'linux' }[process.platform];
  const goarch = { arm64: 'arm64', x64: 'amd64' }[process.arch];
  assert.ok(goos && goarch, `unsupported host platform ${process.platform}/${process.arch}`);
  return `idea-agent-${goos}-${goarch}${goos === 'windows' ? '.exe' : ''}`;
}

async function main() {
  const zipArg = process.argv[2];
  if (!zipArg) {
    console.error('usage: verify-builtin-runtime.mjs <plugin-zip>');
    process.exit(2);
  }
  const zipPath = path.resolve(zipArg);
  const zip = readZipBuffer(zipPath);
  const binaryName = hostBinaryName();
  const binaryEntry = `idea-ai-agent/runtime/${binaryName}`;
  assert.ok(zip.has(binaryEntry), `${path.basename(zipPath)} does not contain ${binaryEntry}`);

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'plugin-builtin-live-'));
  let proc = null;
  try {
    const extractRoot = path.join(tmp, 'extracted');
    const webFiles = new Map();
    const webPrefix = 'idea-ai-agent/runtime/web/';
    for (const name of zip.names) {
      if (!name.startsWith('idea-ai-agent/runtime/') || name.endsWith('/')) continue;
      const dest = path.join(extractRoot, name);
      mkdirSync(path.dirname(dest), { recursive: true });
      const content = zip.read(name);
      writeFileSync(dest, content);
      if (name.startsWith(webPrefix)) {
        webFiles.set(name.slice(webPrefix.length), content);
      }
    }
    assert.ok(webFiles.size >= 300, `expected >= 300 packaged web files, found ${webFiles.size}`);

    const binPath = path.join(extractRoot, binaryEntry);
    if (process.platform !== 'win32') chmodSync(binPath, 0o755);

    const homeDir = path.join(tmp, 'home');
    const projDir = path.join(tmp, 'project');
    const dataDir = path.join(tmp, 'data');
    const hostDir = path.join(tmp, 'host');
    for (const d of [homeDir, projDir, dataDir, hostDir]) mkdirSync(d, { recursive: true });

    const token = randomBytes(32).toString('hex');
    const env = {
      PATH: process.env.PATH || '',
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
      IDE_AGENT_DATA_DIR: dataDir,
      IDE_AGENT_REMOTE_HOST_DIR: hostDir,
      MINDFS_STATIC_DIR: path.join(extractRoot, 'idea-ai-agent/runtime/web'),
      IDE_AGENT_TOKEN: token,
      TMPDIR: tmp,
      TEMP: tmp,
      TMP: tmp,
    };
    if (process.platform === 'win32') {
      for (const k of ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
        if (process.env[k]) env[k] = process.env[k];
      }
    }

    proc = spawn(binPath, ['--project', projDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    let stderrBuf = '';
    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
    });

    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for IDE_AGENT_READY; stderr=${stderrBuf}`)), 30000);
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        if (line.startsWith('IDE_AGENT_READY ')) {
          clearTimeout(timer);
          rl.close();
          resolve(JSON.parse(line.slice('IDE_AGENT_READY '.length)));
        }
      });
      proc.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`built-in runtime exited early (${code}); stderr=${stderrBuf}`));
      });
    });

    const baseUrl = ready.url;
    const bootRes = await fetch(`${baseUrl}/?ide_token=${token}`, { redirect: 'manual' });
    assert.equal(bootRes.status, 303, `expected 303 redirect on token bootstrap, got ${bootRes.status}`);
    const setCookies = typeof bootRes.headers.getSetCookie === 'function'
      ? bootRes.headers.getSetCookie()
      : [bootRes.headers.get('set-cookie')].filter(Boolean);
    assert.ok(setCookies.length > 0, 'missing HttpOnly session cookie on bootstrap');
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');

    const dirsRes = await fetch(`${baseUrl}/api/dirs`, { headers: { Cookie: cookieHeader } });
    assert.equal(dirsRes.status, 200, `/api/dirs returned HTTP ${dirsRes.status}`);
    const dirsJson = await dirsRes.json();
    const dirsList = Array.isArray(dirsJson) ? dirsJson : dirsJson.dirs || [];
    assert.ok(dirsList.some((d) => d.id === ready.rootId), `rootId ${ready.rootId} missing from /api/dirs`);

    const entries = [...webFiles.entries()];
    let index = 0;
    async function worker() {
      while (index < entries.length) {
        const [rel, expected] = entries[index++];
        const url = rel === 'index.html' ? `${baseUrl}/` : `${baseUrl}/${rel}`;
        const res = await fetch(url, { headers: { Cookie: cookieHeader } });
        assert.equal(res.status, 200, `HTTP ${res.status} for ${rel}`);
        const actual = Buffer.from(await res.arrayBuffer());
        assert.ok(actual.equals(expected), `served bytes for ${rel} differ from packaged file`);
        if (/\.(?:html|js|css|webmanifest)$/.test(rel)) {
          assert.ok(!actual.includes(Buffer.from('/mindfs-assets/')), `served ${rel} contains /mindfs-assets/`);
        }
      }
    }
    await Promise.all(Array.from({ length: 12 }, () => worker()));

    const exited = new Promise((resolve) => proc.once('exit', resolve));
    proc.stdin.write('shutdown\n');
    proc.stdin.end();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    console.log(`OK: ${binaryName} from ${path.basename(zipPath)} started cleanly and served all ${webFiles.size} web files byte-for-byte`);
  } finally {
    if (proc && proc.exitCode === null) {
      proc.kill();
    }
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Best-effort temp cleanup: probe subprocesses or Windows AV handles must never fail a passed verification.
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`FAILED: ${error.message}`);
    process.exit(1);
  });
}
