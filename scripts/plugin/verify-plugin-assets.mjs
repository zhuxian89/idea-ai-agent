#!/usr/bin/env node
// verify-plugin-assets.mjs <assets-dir> <version> [--dist-dir <dir>] [--commit <sha>] [--skip-go-buildinfo]
//
// Static release gates on the 6 final IDEA plugin release files:
//   - exact 5 platform/Marketplace ZIPs + SHA256SUMS.txt, checksums match
//   - plugin JAR META-INF/plugin.xml version matches <version>
//   - embedded installers/install.sh and installers/install.ps1 match repo sources byte-for-byte; install.ps1 has UTF-8 BOM
//   - embedded runtime binaries match target OS/arch headers, carry Unix 0755 bit, and report Go vcs.modified=false
//   - embedded runtime/web/ equals runtime/web/dist byte-for-byte and contains no /mindfs-assets/ reference
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(here, '../..');

export const PLUGIN_TARGETS = {
  'macos-arm64': { goos: 'darwin', goarch: 'arm64', binary: 'idea-agent-darwin-arm64' },
  'macos-amd64': { goos: 'darwin', goarch: 'amd64', binary: 'idea-agent-darwin-amd64' },
  'windows-amd64': { goos: 'windows', goarch: 'amd64', binary: 'idea-agent-windows-amd64.exe' },
  'windows-arm64': { goos: 'windows', goarch: 'arm64', binary: 'idea-agent-windows-arm64.exe' },
};

export function readZipBuffer(source, label = 'archive.zip') {
  const data = typeof source === 'string' ? readFileSync(source) : source;
  const archiveName = typeof source === 'string' ? path.basename(source) : label;
  const minEocd = 22;
  const searchStart = Math.max(0, data.length - 65557);
  let eocd = -1;
  for (let offset = data.length - minEocd; offset >= searchStart; offset--) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  assert.ok(eocd >= 0, `${archiveName} is not a valid ZIP file`);
  const entryCount = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < entryCount; i++) {
    assert.equal(data.readUInt32LE(offset), 0x02014b50, `${archiveName} has an invalid ZIP central directory`);
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const size = data.readUInt32LE(offset + 24);
    const nameLen = data.readUInt16LE(offset + 28);
    const extraLen = data.readUInt16LE(offset + 30);
    const commentLen = data.readUInt16LE(offset + 32);
    const externalAttr = data.readUInt32LE(offset + 38);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.toString('utf8', offset + 46, offset + 46 + nameLen);
    assert.ok(!entries.has(name), `${archiveName} contains duplicate entry: ${name}`);
    entries.set(name, { method, compressedSize, size, externalAttr, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    mode: (name) => {
      const e = entries.get(name);
      return e ? e.externalAttr >>> 16 : 0;
    },
    read: (name) => {
      const e = entries.get(name);
      assert.ok(e, `${archiveName} is missing entry: ${name}`);
      const local = e.localOffset;
      assert.equal(data.readUInt32LE(local), 0x04034b50, `${name} has an invalid local ZIP header`);
      const nameLen = data.readUInt16LE(local + 26);
      const extraLen = data.readUInt16LE(local + 28);
      const start = local + 30 + nameLen + extraLen;
      const compressed = data.subarray(start, start + e.compressedSize);
      const content = e.method === 0 ? Buffer.from(compressed) : e.method === 8 ? inflateRawSync(compressed) : null;
      assert.ok(content, `${name} uses unsupported ZIP compression method ${e.method}`);
      assert.equal(content.length, e.size, `${name} uncompressed size mismatch`);
      return content;
    },
  };
}

export function verifyBinaryHeader(data, target) {
  if (target.goos === 'darwin') {
    assert.ok(data.length >= 8 && data.readUInt32LE(0) === 0xfeedfacf, `${target.binary} is not a 64-bit Mach-O executable`);
    const expectedCpu = target.goarch === 'arm64' ? 0x0100000c : 0x01000007;
    assert.equal(data.readUInt32LE(4), expectedCpu, `${target.binary} has wrong Mach-O CPU architecture`);
    return;
  }
  assert.ok(data.length >= 64 && data.toString('ascii', 0, 2) === 'MZ', `${target.binary} is not a Windows PE executable`);
  const peOffset = data.readUInt32LE(0x3c);
  const expectedMachine = target.goarch === 'arm64' ? 0xaa64 : 0x8664;
  assert.equal(data.readUInt16LE(peOffset + 4), expectedMachine, `${target.binary} has wrong PE machine architecture`);
}

function collectFiles(rootDir) {
  const map = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) map.set(path.relative(rootDir, full).split(path.sep).join('/'), readFileSync(full));
    }
  };
  walk(rootDir);
  return map;
}

export function verifyPluginAssets({
  assetsDir,
  version,
  repoRoot = defaultRepoRoot,
  distDir = path.join(repoRoot, 'runtime/web/dist'),
  expectedCommit = '',
  skipGoBuildInfo = false,
  minWebFiles = 300,
}) {
  const expectedZips = [
    ...Object.keys(PLUGIN_TARGETS).map((id) => ({
      name: `idea-ai-agent-${version}-${id}.zip`,
      targets: [PLUGIN_TARGETS[id]],
    })),
    {
      name: `idea-ai-agent-${version}.zip`,
      targets: Object.values(PLUGIN_TARGETS),
    },
  ];
  const expectedFiles = [...expectedZips.map((z) => z.name), 'SHA256SUMS.txt'].sort();
  const actualFiles = readdirSync(assetsDir)
    .filter((f) => statSync(path.join(assetsDir, f)).isFile())
    .sort();
  assert.deepEqual(actualFiles, expectedFiles, `unexpected file set in ${assetsDir}`);

  const sumsLines = readFileSync(path.join(assetsDir, 'SHA256SUMS.txt'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(sumsLines.length, expectedZips.length, 'SHA256SUMS.txt entry count mismatch');
  const recordedSums = new Map();
  for (const line of sumsLines) {
    const match = line.match(/^([0-9a-f]{64})\s+\*?(\S+)$/);
    assert.ok(match, `malformed SHA256SUMS.txt line: ${line}`);
    recordedSums.set(match[2], match[1]);
  }

  const distFiles = collectFiles(distDir);
  assert.ok(distFiles.size >= minWebFiles, `dist directory has only ${distFiles.size} files (expected >= ${minWebFiles})`);

  const expectedInstallSh = readFileSync(path.join(repoRoot, 'scripts/install.sh'));
  const expectedDownloadPs1 = readFileSync(path.join(repoRoot, 'scripts/standalone/download.ps1'));
  assert.ok(
    expectedDownloadPs1.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
    'source scripts/standalone/download.ps1 is missing UTF-8 BOM',
  );

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'plugin-go-verify-'));
  try {
    for (const spec of expectedZips) {
      const zipPath = path.join(assetsDir, spec.name);
      const actualSum = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
      assert.equal(recordedSums.get(spec.name), actualSum, `SHA-256 mismatch in SHA256SUMS.txt for ${spec.name}`);

      const zip = readZipBuffer(zipPath);
      const jarEntry = `idea-ai-agent/lib/idea-ai-agent-${version}.jar`;
      assert.ok(zip.has(jarEntry), `${spec.name} is missing ${jarEntry}`);
      const jar = readZipBuffer(zip.read(jarEntry), jarEntry);
      const pluginXml = jar.read('META-INF/plugin.xml').toString('utf8');
      const xmlVersion = pluginXml.match(/<version>([^<]+)<\/version>/)?.[1];
      assert.equal(xmlVersion, version, `${spec.name} plugin.xml version is "${xmlVersion}", expected "${version}"`);

      const packagedSh = jar.read('installers/install.sh');
      assert.ok(packagedSh.equals(expectedInstallSh), `${spec.name} embedded installers/install.sh differs from scripts/install.sh`);
      const packagedPs1 = jar.read('installers/install.ps1');
      assert.ok(
        packagedPs1.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
        `${spec.name} embedded installers/install.ps1 is missing UTF-8 BOM`,
      );
      assert.ok(
        packagedPs1.equals(expectedDownloadPs1),
        `${spec.name} embedded installers/install.ps1 differs from scripts/standalone/download.ps1`,
      );

      for (const reqFile of [
        'idea-ai-agent/LICENSE',
        'idea-ai-agent/NOTICE.md',
        'idea-ai-agent/runtime/agents.json',
        'idea-ai-agent/runtime/task_template.json',
        'idea-ai-agent/runtime/LICENSE',
        'idea-ai-agent/runtime/licenses/gopsutil-LICENSES.txt',
      ]) {
        assert.ok(zip.has(reqFile), `${spec.name} is missing ${reqFile}`);
      }

      const runtimeBinaries = zip.names.filter((n) => /^idea-ai-agent\/runtime\/idea-agent-(?:darwin|windows)-/.test(n)).sort();
      const expectedBinaries = spec.targets.map((t) => `idea-ai-agent/runtime/${t.binary}`).sort();
      assert.deepEqual(runtimeBinaries, expectedBinaries, `unexpected runtime binaries in ${spec.name}`);

      for (const target of spec.targets) {
        const entryName = `idea-ai-agent/runtime/${target.binary}`;
        assert.ok((zip.mode(entryName) & 0o111) !== 0, `${target.binary} in ${spec.name} lacks Unix executable permission`);
        const binBytes = zip.read(entryName);
        verifyBinaryHeader(binBytes, target);
        if (!skipGoBuildInfo) {
          const outBin = path.join(tmpDir, `${spec.name}-${target.binary}`);
          writeFileSync(outBin, binBytes);
          const buildInfo = execFileSync('go', ['version', '-m', outBin], { encoding: 'utf8' });
          assert.ok(buildInfo.includes('vcs.modified=false'), `${target.binary} in ${spec.name} was not built from a clean tree:\n${buildInfo}`);
          if (expectedCommit) {
            assert.ok(
              buildInfo.includes(`vcs.revision=${expectedCommit}`),
              `${target.binary} in ${spec.name} vcs.revision mismatch (expected ${expectedCommit}):\n${buildInfo}`,
            );
          }
        }
      }

      const webPrefix = 'idea-ai-agent/runtime/web/';
      const webEntries = zip.names.filter((n) => n.startsWith(webPrefix) && !n.endsWith('/'));
      assert.deepEqual(
        webEntries.map((n) => n.slice(webPrefix.length)).sort(),
        [...distFiles.keys()].sort(),
        `${spec.name} runtime/web file list differs from dist`,
      );
      for (const fullName of webEntries) {
        const rel = fullName.slice(webPrefix.length);
        const bytes = zip.read(fullName);
        assert.ok(bytes.equals(distFiles.get(rel)), `${spec.name} runtime/web/${rel} differs from dist`);
        if (/\.(?:html|js|css|webmanifest)$/.test(rel)) {
          assert.ok(!bytes.includes(Buffer.from('/mindfs-assets/')), `${spec.name} runtime/web/${rel} references forbidden /mindfs-assets/`);
        }
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !['--dist-dir', '--commit'].includes(args[i - 1])));
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : '';
  };
  const [assetsDir, version] = positional;
  if (!assetsDir || !version) {
    console.error('usage: verify-plugin-assets.mjs <assets-dir> <version> [--dist-dir <dir>] [--commit <sha>] [--skip-go-buildinfo]');
    process.exit(2);
  }
  try {
    verifyPluginAssets({
      assetsDir: path.resolve(assetsDir),
      version,
      distDir: option('--dist-dir') ? path.resolve(option('--dist-dir')) : undefined,
      expectedCommit: option('--commit'),
      skipGoBuildInfo: args.includes('--skip-go-buildinfo'),
    });
    console.log(`OK: all 6 plugin ${version} release assets passed static gates`);
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    process.exit(1);
  }
}
