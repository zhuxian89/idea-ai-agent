#!/usr/bin/env node
// verify-release-assets.mjs <assets dir> <version> [--targets a,b|all] [--repo <repository root>] [--skip-build-info]
//
// The static gates of AGENTS.md "发布前验证" for the assets of a standalone release, run against the final
// archives (not the sources). Exit status 1 when any gate fails; every failure is printed.
// `--targets` limits the check to a test build of some platforms (default: all six, 24 assets); a partial build
// has the archive, its `.sh` (macOS / Linux) and the online entry of its family, each with a `.sha256`.
//
//  * exactly the 24 expected files, each `.sha256` well formed and matching its file;
//  * each program is built for the platform in its name (ELF / Mach-O / PE header), built from a clean tree
//    (`vcs.modified=false`) and carries the version;
//  * install.sh / install.ps1 inside the packages are byte for byte the sources, PowerShell scripts have a BOM;
//  * the web directory of every package is exactly runtime/web/dist and has no `/mindfs-assets/` reference;
//  * the embedded archive of every self-extracting `.sh` equals the matching `.tar.gz`;
//  * the online entries equal scripts/install.sh and scripts/standalone/download.ps1.
//
// Needs `tar` and `unzip`; uses `go version -m` for the build information when Go is installed.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS = {
  'linux-amd64': { archive: 'tar.gz', os: 'linux', arch: 'amd64', exe: 'local-ai-agent' },
  'linux-arm64': { archive: 'tar.gz', os: 'linux', arch: 'arm64', exe: 'local-ai-agent' },
  'macos-amd64': { archive: 'tar.gz', os: 'darwin', arch: 'amd64', exe: 'local-ai-agent' },
  'macos-arm64': { archive: 'tar.gz', os: 'darwin', arch: 'arm64', exe: 'local-ai-agent' },
  'windows-amd64': { archive: 'zip', os: 'windows', arch: 'amd64', exe: 'local-ai-agent.exe' },
  'windows-arm64': { archive: 'zip', os: 'windows', arch: 'arm64', exe: 'local-ai-agent.exe' },
};

export function parseTargets(value) {
  if (!value || value === 'all') return Object.keys(TARGETS);
  const list = [...new Set(value.split(',').map((x) => x.trim()).filter(Boolean))];
  const unknown = list.filter((x) => !TARGETS[x]);
  if (unknown.length || !list.length) throw new Error(`unknown target(s): ${unknown.join(', ') || value}; use ${Object.keys(TARGETS).join(', ')} or all`);
  return list;
}

export function expectedAssets(version, targets = Object.keys(TARGETS)) {
  const files = [];
  if (targets.some((t) => TARGETS[t].os !== 'windows')) files.push('install.sh');
  if (targets.some((t) => TARGETS[t].os === 'windows')) files.push('install.ps1');
  for (const target of targets) {
    const t = TARGETS[target];
    files.push(`local-ai-agent-${version}-${target}.${t.archive}`);
    if (t.os !== 'windows') files.push(`local-ai-agent-${version}-${target}.sh`);
  }
  return files.flatMap((f) => [f, f + '.sha256']).sort();
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Which platform and CPU an executable was built for, read from its header. */
export function detectBinary(buf) {
  if (buf.length > 20 && buf.readUInt32BE(0) === 0x7f454c46) {
    if (buf[4] !== 2) return { os: 'linux', arch: 'unsupported-class' };
    const machine = buf.readUInt16LE(18);
    return { os: 'linux', arch: machine === 0x3e ? 'amd64' : machine === 0xb7 ? 'arm64' : `machine-${machine}` };
  }
  if (buf.length > 8 && buf.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = buf.readUInt32LE(4);
    return { os: 'darwin', arch: cpu === 0x01000007 ? 'amd64' : cpu === 0x0100000c ? 'arm64' : `cpu-${cpu}` };
  }
  if (buf.length > 0x40 && buf[0] === 0x4d && buf[1] === 0x5a) {
    const pe = buf.readUInt32LE(0x3c);
    if (buf.readUInt32LE(pe) !== 0x4550) return { os: 'windows', arch: 'bad-pe-signature' };
    const machine = buf.readUInt16LE(pe + 4);
    const plus = buf.readUInt16LE(pe + 24) === 0x20b;
    return { os: 'windows', arch: !plus ? 'not-pe32+' : machine === 0x8664 ? 'amd64' : machine === 0xaa64 ? 'arm64' : `machine-${machine}` };
  }
  return { os: 'unknown', arch: 'unknown' };
}

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

const MARKER = Buffer.from('\n__LOCAL_AI_AGENT_ARCHIVE__\n');

export function verifyAssets(dir, version, repoRoot, log = () => {}, options = {}) {
  const failures = [];
  const fail = (message) => failures.push(message);
  const read = (name) => readFileSync(path.join(dir, name));

  // 1. exactly the expected files, and every checksum file is right
  const targets = options.targets || Object.keys(TARGETS);
  const wanted = expectedAssets(version, targets);
  const present = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  for (const n of wanted) if (!present.includes(n)) fail(`missing asset: ${n}`);
  for (const n of present) if (!wanted.includes(n)) fail(`unexpected asset: ${n}`);
  for (const n of wanted.filter((f) => f.endsWith('.sha256'))) {
    if (!present.includes(n)) continue;
    const target = n.slice(0, -'.sha256'.length);
    const m = /^([0-9a-f]{64})  (\S+)\n$/.exec(read(n).toString('utf8'));
    if (!m) { fail(`${n}: not in "<sha256>  <name>" form`); continue; }
    if (m[2] !== target) fail(`${n}: names ${m[2]}, expected ${target}`);
    if (present.includes(target) && m[1] !== sha256(read(target))) fail(`${n}: does not match ${target}`);
  }
  log(`${present.length} files found, ${wanted.length} expected`);
  if (failures.length) return failures; // the later gates need the files

  // 2. online entries
  const source = (p) => readFileSync(path.join(repoRoot, p));
  if (wanted.includes('install.sh') && !read('install.sh').equals(source('scripts/install.sh'))) fail('install.sh differs from scripts/install.sh');
  if (wanted.includes('install.ps1')) {
    if (!read('install.ps1').equals(source('scripts/standalone/download.ps1'))) fail('install.ps1 differs from scripts/standalone/download.ps1');
    if (!read('install.ps1').subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail('install.ps1 (online entry) has no UTF-8 BOM');
  }

  // 3. each package
  const dist = path.join(repoRoot, 'runtime/web/dist');
  const distFiles = existsSync(dist) ? listFiles(dist).sort() : null;
  if (!distFiles) fail('runtime/web/dist is missing; build the web first');
  const work = mkdtempSync(path.join(os.tmpdir(), 'verify-assets-'));
  try {
    for (const [target, t] of Object.entries(TARGETS).filter(([k]) => targets.includes(k))) {
      const name = `local-ai-agent-${version}-${target}`;
      const archive = `${name}.${t.archive}`;
      const out = path.join(work, target);
      execFileSync('mkdir', ['-p', out]);
      if (t.archive === 'zip') execFileSync('unzip', ['-q', path.join(dir, archive), '-d', out]);
      else execFileSync('tar', ['-xzf', path.join(dir, archive), '-C', out]);
      const bundle = path.join(out, name);
      if (!existsSync(bundle)) { fail(`${archive}: top-level directory ${name} is missing`); continue; }
      for (const f of [t.exe, 'agents.json', 'task_template.json', 'LICENSE', 'NOTICE.md', 'README.md', 'web/index.html', t.os === 'windows' ? 'install.ps1' : 'install.sh']) {
        if (!existsSync(path.join(bundle, f))) fail(`${archive}: ${f} is missing`);
      }
      const exePath = path.join(bundle, t.exe);
      if (existsSync(exePath)) {
        const exe = readFileSync(exePath);
        const got = detectBinary(exe);
        if (got.os !== t.os || got.arch !== t.arch) fail(`${archive}: program is ${got.os}/${got.arch}, expected ${t.os}/${t.arch}`);
        if (!exe.includes(Buffer.from(version))) fail(`${archive}: program does not contain the version ${version}`);
        if (!options.skipBuildInfo) try {
          const info = execFileSync('go', ['version', '-m', exePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          if (!/vcs\.modified=false/.test(info)) fail(`${archive}: not built from a clean tree (vcs.modified is not false)`);
        } catch (error) {
          if (error.code === 'ENOENT') log('go is not installed: build information not checked');
          else fail(`${archive}: go version -m failed`);
        }
      }
      // install script and web resources
      const script = t.os === 'windows' ? 'install.ps1' : 'install.sh';
      if (existsSync(path.join(bundle, script))) {
        const inPackage = readFileSync(path.join(bundle, script));
        if (!inPackage.equals(source(`scripts/standalone/${script}`))) fail(`${archive}: ${script} differs from scripts/standalone/${script}`);
        if (t.os === 'windows' && !inPackage.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail(`${archive}: install.ps1 has no UTF-8 BOM`);
      }
      const webDir = path.join(bundle, 'web');
      if (existsSync(webDir) && distFiles) {
        const files = listFiles(webDir).sort();
        if (JSON.stringify(files) !== JSON.stringify(distFiles)) fail(`${archive}: web files differ from runtime/web/dist (${files.length} vs ${distFiles.length})`);
        else {
          for (const f of files) {
            const a = readFileSync(path.join(webDir, f));
            if (!a.equals(readFileSync(path.join(dist, f)))) { fail(`${archive}: web/${f} differs from runtime/web/dist`); break; }
            if (/\.(html|js|css|json|webmanifest|svg)$/.test(f) && a.includes('/mindfs-assets/')) fail(`${archive}: web/${f} references /mindfs-assets/`);
          }
        }
        log(`${target}: ${files.length} web files`);
      }
      // self-extracting installer
      if (t.os !== 'windows') {
        const sh = read(`${name}.sh`);
        const at = sh.indexOf(MARKER);
        const header = at < 0 ? '' : sh.subarray(0, at).toString('utf8');
        if (at < 0) fail(`${name}.sh: archive marker not found`);
        else {
          if (!header.startsWith('#!/bin/sh\n')) fail(`${name}.sh: does not start with #!/bin/sh`);
          if (!header.includes(`"$work_dir/${name}/install.sh"`)) fail(`${name}.sh: does not run ${name}/install.sh`);
          if (!sh.subarray(at + MARKER.length).equals(read(archive))) fail(`${name}.sh: embedded archive differs from ${archive}`);
        }
        if ((statSync(path.join(dir, `${name}.sh`)).mode & 0o111) === 0) fail(`${name}.sh: not executable`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return failures;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false; };
  const option = (name) => { const i = args.indexOf(name); if (i < 0) return null; const [, v] = args.splice(i, 2); return v; };
  const skipBuildInfo = flag('--skip-build-info');
  const repoOption = option('--repo');
  const targets = parseTargets(option('--targets'));
  const [dirArg, version] = args;
  if (!dirArg || !version) { console.error('usage: verify-release-assets.mjs <assets dir> <version> [--targets a,b|all] [--repo <root>] [--skip-build-info]'); process.exit(2); }
  const repoRoot = repoOption ? path.resolve(repoOption) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const failures = verifyAssets(path.resolve(dirArg), version, repoRoot, (m) => console.log('  ' + m), { skipBuildInfo, targets });
  if (failures.length) {
    console.error(`FAILED: ${failures.length} problem(s)`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(`OK: all ${expectedAssets(version, targets).length} assets of ${version} (${targets.join(', ')}) passed the static release gates`);
}
