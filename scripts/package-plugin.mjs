#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const buildDir = path.join(root, 'build');
const localRuntimeDir = path.join(buildDir, 'local-runtime');
const distributionsDir = path.join(buildDir, 'distributions');
const localPackagesDir = path.join(buildDir, 'local-packages');
const gradleCommand = process.platform === 'win32' ? path.join(root, 'gradlew.bat') : path.join(root, 'gradlew');
const corepackCommand = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';

const targets = {
  'macos-arm64': { id: 'macos-arm64', goos: 'darwin', goarch: 'arm64', binary: 'idea-agent-darwin-arm64' },
  'macos-amd64': { id: 'macos-amd64', goos: 'darwin', goarch: 'amd64', binary: 'idea-agent-darwin-amd64' },
  'windows-amd64': { id: 'windows-amd64', goos: 'windows', goarch: 'amd64', binary: 'idea-agent-windows-amd64.exe' },
  'windows-arm64': { id: 'windows-arm64', goos: 'windows', goarch: 'arm64', binary: 'idea-agent-windows-arm64.exe' },
};
const releaseTargets = Object.values(targets);
const targetAliases = {
  mac: 'macos-arm64',
  'mac-arm': 'macos-arm64',
  'mac-intel': 'macos-amd64',
  win: 'windows-amd64',
  windows: 'windows-amd64',
  'win-arm': 'windows-arm64',
};

function usage() {
  console.log(`Local AI Agent packaging

Usage:
  node scripts/package-plugin.mjs local mac [--version VERSION] [--verify] [--dry-run]
  node scripts/package-plugin.mjs local win [--version VERSION] [--verify] [--dry-run]
  node scripts/package-plugin.mjs release [--version VERSION] [--skip-tests] [--dry-run]

Commands:
  local mac    Build one macOS Apple Silicon test package
  local win    Build one Windows x64 test package
  release      Build macOS arm64/amd64, Windows amd64/arm64, and Marketplace packages

Environment:
  IDEA_AGENT_JAVA_HOME   Optional JDK 21 home override
`);
}

function fail(message) {
  console.error(`Packaging failed: ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    usage();
    process.exit(0);
  }
  const mode = argv[0] === 'all' ? 'release' : argv[0];
  if (mode !== 'local' && mode !== 'release') fail(`unknown command: ${argv[0]}`);
  let index = 1;
  let target = null;
  if (mode === 'local') {
    const rawTarget = argv[index++];
    const targetId = targetAliases[rawTarget] || rawTarget;
    target = targets[targetId];
    if (!target) fail(`unknown local target: ${rawTarget || '(missing)'}`);
  }
  const options = { version: '', dryRun: false, verify: mode === 'release' };
  while (index < argv.length) {
    const arg = argv[index++];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--verify') options.verify = true;
    else if (arg === '--skip-tests') options.verify = false;
    else if (arg === '--version') options.version = argv[index++] || '';
    else if (arg.startsWith('--version=')) options.version = arg.slice('--version='.length);
    else fail(`unknown option: ${arg}`);
  }
  if (options.version && !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(options.version)) {
    fail(`invalid version: ${options.version}`);
  }
  return { mode, target, ...options };
}

function defaultVersion() {
  const source = readFileSync(path.join(root, 'build.gradle.kts'), 'utf8');
  const match = source.match(/version\s*=\s*providers\.gradleProperty\("pluginVersion"\)\.getOrElse\("([^"]+)"\)/);
  if (!match) throw new Error('Cannot read the default plugin version from build.gradle.kts');
  return match[1];
}

function nextLocalVersion(baseVersion) {
  if (!existsSync(localPackagesDir)) return `${baseVersion}-local.1`;
  const escaped = baseVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^idea-ai-agent-${escaped}-local\\.(\\d+)-`);
  const highest = readdirSync(localPackagesDir).reduce((current, name) => {
    const match = name.match(pattern);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${baseVersion}-local.${highest + 1}`;
}

function run(command, args, options = {}) {
  console.log(`\n> ${path.basename(command)} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with ${result.status}`);
}

function capture(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
  });
}

function javaMajor(javaHome) {
  const executable = javaHome
    ? path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  const result = capture(executable, ['-version']);
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const match = output.match(/version "(?:1\.)?(\d+)/);
  return result.status === 0 && match ? Number(match[1]) : 0;
}

function addIntelliJHomes(candidates, parent) {
  if (!parent || !existsSync(parent)) return;
  for (const name of readdirSync(parent)) {
    if (!name.toLowerCase().includes('intellij idea')) continue;
    const appHome = process.platform === 'darwin'
      ? path.join(parent, name, 'Contents', 'jbr', 'Contents', 'Home')
      : path.join(parent, name, 'jbr');
    candidates.push(appHome);
  }
}

function findJavaHome() {
  const override = process.env.IDEA_AGENT_JAVA_HOME;
  if (override) {
    if (javaMajor(override) < 21) throw new Error(`IDEA_AGENT_JAVA_HOME is not a JDK 21 installation: ${override}`);
    return override;
  }
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);
  if (process.platform === 'darwin') {
    const result = capture('/usr/libexec/java_home', ['-v', '21']);
    if (result.status === 0 && result.stdout.trim()) candidates.push(result.stdout.trim());
    addIntelliJHomes(candidates, '/Applications');
    addIntelliJHomes(candidates, path.join(os.homedir(), 'Applications'));
  } else if (process.platform === 'win32') {
    addIntelliJHomes(candidates, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'JetBrains'));
    addIntelliJHomes(candidates, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'));
  }
  for (const candidate of candidates) {
    if (candidate && javaMajor(candidate) >= 21) return candidate;
  }
  if (javaMajor(null) >= 21) {
    const lookup = capture(process.platform === 'win32' ? 'where.exe' : 'which', ['java']);
    const executable = lookup.status === 0 ? lookup.stdout.split(/\r?\n/).find(Boolean) : '';
    if (executable) {
      const home = path.dirname(path.dirname(realpathSync(executable.trim())));
      if (javaMajor(home) >= 21) return home;
    }
  }
  throw new Error('JDK 21 was not found. Install IntelliJ IDEA or set IDEA_AGENT_JAVA_HOME to a JDK 21 directory.');
}

function packagingEnvironment(javaHome, extra = {}) {
  const env = { ...process.env, ...extra };
  if (javaHome) {
    env.JAVA_HOME = javaHome;
    env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`;
  }
  return env;
}

function buildFrontend(env) {
  run(corepackCommand, ['pnpm', 'run', 'typecheck'], { cwd: path.join(root, 'runtime', 'web'), env });
  run(corepackCommand, ['pnpm', 'run', 'build'], { cwd: path.join(root, 'runtime', 'web'), env });
}

function buildRuntime(target, env) {
  run(process.execPath, [path.join(root, 'scripts', 'build-runtime.mjs')], {
    env: packagingEnvironment(env.JAVA_HOME || '', {
      ...env,
      GOOS: target.goos,
      GOARCH: target.goarch,
      IDEA_AGENT_SKIP_WEB_BUILD: '1',
    }),
  });
}

function buildPlugin(version, env) {
  const distribution = path.join(distributionsDir, `idea-ai-agent-${version}.zip`);
  rmSync(distribution, { force: true });
  run(gradleCommand, [`-PpluginVersion=${version}`, 'buildPlugin', '-x', 'buildRuntime', '--offline'], { env });
  if (!existsSync(distribution)) throw new Error(`Gradle did not create ${distribution}`);
  return distribution;
}

function readZip(source, label = '') {
  const archive = typeof source === 'string' ? source : label;
  const data = typeof source === 'string' ? readFileSync(source) : source;
  const archiveName = path.basename(archive || 'archive.zip');
  const minimumEocd = 22;
  const searchStart = Math.max(0, data.length - 65557);
  let eocd = -1;
  for (let offset = data.length - minimumEocd; offset >= searchStart; offset--) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${archiveName} is not a valid ZIP file`);
  const entryCount = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index++) {
    if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error(`${archiveName} has an invalid ZIP directory`);
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (entries.has(name)) throw new Error(`${archiveName} contains a duplicate entry: ${name}`);
    entries.set(name, { method, compressedSize, size, localOffset, centralOffset: offset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    mode(name) {
      const entry = entries.get(name);
      return entry ? data.readUInt32LE(entry.centralOffset + 38) >>> 16 : 0;
    },
    markExecutable(names) {
      if (typeof source !== 'string') throw new Error(`Cannot update permissions inside ${archiveName}`);
      for (const name of names) {
        const entry = entries.get(name);
        if (!entry) throw new Error(`${archiveName} does not contain ${name}`);
        data[entry.centralOffset + 5] = 3;
        const existing = data.readUInt32LE(entry.centralOffset + 38) & 0xffff;
        data.writeUInt32LE(((0o100755 << 16) | existing) >>> 0, entry.centralOffset + 38);
      }
      writeFileSync(source, data);
    },
    read(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`${archiveName} does not contain ${name}`);
      const local = entry.localOffset;
      if (data.readUInt32LE(local) !== 0x04034b50) throw new Error(`${name} has an invalid ZIP header`);
      const nameLength = data.readUInt16LE(local + 26);
      const extraLength = data.readUInt16LE(local + 28);
      const start = local + 30 + nameLength + extraLength;
      const compressed = data.subarray(start, start + entry.compressedSize);
      const content = entry.method === 0 ? compressed : entry.method === 8 ? inflateRawSync(compressed) : null;
      if (!content) throw new Error(`${name} uses unsupported ZIP compression method ${entry.method}`);
      if (content.length !== entry.size) throw new Error(`${name} has an invalid uncompressed size`);
      return content;
    },
  };
}

function validateBinary(data, target) {
  if (target.goos === 'darwin') {
    if (data.length < 8 || data.readUInt32LE(0) !== 0xfeedfacf) throw new Error(`${target.binary} is not a 64-bit Mach-O file`);
    const expectedCpu = target.goarch === 'arm64' ? 0x0100000c : 0x01000007;
    if (data.readUInt32LE(4) !== expectedCpu) throw new Error(`${target.binary} has the wrong Mach-O architecture`);
    return;
  }
  if (data.length < 64 || data.toString('ascii', 0, 2) !== 'MZ') throw new Error(`${target.binary} is not a PE file`);
  const peOffset = data.readUInt32LE(0x3c);
  const expectedMachine = target.goarch === 'arm64' ? 0xaa64 : 0x8664;
  if (data.readUInt16LE(peOffset + 4) !== expectedMachine) throw new Error(`${target.binary} has the wrong PE architecture`);
}

function validatePackage(archive, version, expectedTargets) {
  const zip = readZip(archive);
  const runtimeEntries = zip.names.filter(entry => /\/runtime\/idea-agent-(?:darwin|windows)-/.test(entry));
  const expectedEntries = expectedTargets.map(target => `idea-ai-agent/runtime/${target.binary}`).sort();
  if (JSON.stringify(runtimeEntries.sort()) !== JSON.stringify(expectedEntries)) {
    throw new Error(`Unexpected runtime files in ${path.basename(archive)}: ${runtimeEntries.join(', ')}`);
  }
  const pluginJar = `idea-ai-agent/lib/idea-ai-agent-${version}.jar`;
  if (!zip.names.includes(pluginJar)) throw new Error(`${path.basename(archive)} does not contain ${pluginJar}`);
  const plugin = readZip(zip.read(pluginJar), pluginJar);
  const pluginXml = plugin.read('META-INF/plugin.xml').toString('utf8');
  const packagedVersion = pluginXml.match(/<version>([^<]+)<\/version>/)?.[1];
  if (packagedVersion !== version) throw new Error(`${path.basename(archive)} contains plugin version ${packagedVersion || '(missing)'}`);
  for (const target of expectedTargets) {
    const runtimeEntry = `idea-ai-agent/runtime/${target.binary}`;
    if ((zip.mode(runtimeEntry) & 0o111) === 0) throw new Error(`${target.binary} is not executable inside the ZIP`);
    validateBinary(zip.read(runtimeEntry), target);
  }
}

function normalizePackage(archive, expectedTargets) {
  const zip = readZip(archive);
  zip.markExecutable(expectedTargets.map(target => `idea-ai-agent/runtime/${target.binary}`));
}

function outputName(version, target) {
  return `idea-ai-agent-${version}-${target.id}.zip`;
}

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function printPlan(config, version) {
  const selected = config.mode === 'release' ? releaseTargets : [config.target];
  console.log(`Mode: ${config.mode}`);
  console.log(`Version: ${version}`);
  for (const target of selected) console.log(`- ${outputName(version, target)}`);
  if (config.mode === 'release') console.log(`- idea-ai-agent-${version}.zip (Marketplace)`);
  console.log(`Checks: typecheck + web build${config.verify ? ' + Gradle tests/configuration' : ''}`);
}

function main() {
  const config = parseArguments(process.argv.slice(2));
  const baseVersion = defaultVersion();
  const version = config.version || (config.mode === 'local' ? nextLocalVersion(baseVersion) : baseVersion);
  printPlan(config, version);
  if (config.dryRun) return;

  const javaHome = findJavaHome();
  const env = packagingEnvironment(javaHome);
  const selected = config.mode === 'release' ? releaseTargets : [config.target];
  const destination = config.mode === 'release'
    ? path.join(buildDir, 'releases', version)
    : localPackagesDir;
  mkdirSync(destination, { recursive: true });

  buildFrontend(env);
  if (config.verify) {
    run(gradleCommand, [`-PpluginVersion=${version}`, 'test', 'verifyPluginProjectConfiguration', '--offline'], { env });
  }

  const runtimeCache = mkdtempSync(path.join(os.tmpdir(), 'idea-agent-runtimes-'));
  const outputs = [];
  try {
    for (const target of selected) {
      console.log(`\n=== Packaging ${target.id} ===`);
      buildRuntime(target, env);
      const runtime = path.join(localRuntimeDir, target.binary);
      copyFileSync(runtime, path.join(runtimeCache, target.binary));
      chmodSync(path.join(runtimeCache, target.binary), 0o755);
      const distribution = buildPlugin(version, env);
      const output = path.join(destination, outputName(version, target));
      copyFileSync(distribution, output);
      normalizePackage(output, [target]);
      validatePackage(output, version, [target]);
      outputs.push(output);
    }

    if (config.mode === 'release') {
      console.log('\n=== Packaging Marketplace ===');
      for (const target of releaseTargets) {
        const runtime = path.join(localRuntimeDir, target.binary);
        copyFileSync(path.join(runtimeCache, target.binary), runtime);
        chmodSync(runtime, 0o755);
      }
      const distribution = buildPlugin(version, env);
      const output = path.join(destination, `idea-ai-agent-${version}.zip`);
      copyFileSync(distribution, output);
      normalizePackage(output, releaseTargets);
      validatePackage(output, version, releaseTargets);
      outputs.push(output);
      const sums = outputs.map(file => `${hashFile(file)}  ${path.basename(file)}`).join('\n') + '\n';
      writeFileSync(path.join(destination, 'SHA256SUMS.txt'), sums);
    }
  } finally {
    rmSync(runtimeCache, { recursive: true, force: true });
  }

  console.log('\nPackages ready:');
  for (const output of outputs) console.log(`- ${path.relative(root, output)} (${hashFile(output)})`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
