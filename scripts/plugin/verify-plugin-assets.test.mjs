import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PLUGIN_TARGETS, verifyPluginAssets } from './verify-plugin-assets.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data, mode = 0o100644 } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const sum = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localParts.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function fakeBinary(target) {
  if (target.goos === 'darwin') {
    const b = Buffer.alloc(16);
    b.writeUInt32LE(0xfeedfacf, 0);
    b.writeUInt32LE(target.goarch === 'arm64' ? 0x0100000c : 0x01000007, 4);
    return b;
  }
  const b = Buffer.alloc(128);
  b.write('MZ', 0, 'ascii');
  b.writeUInt32LE(64, 0x3c);
  b.write('PE\0\0', 64, 'ascii');
  b.writeUInt16LE(target.goarch === 'arm64' ? 0xaa64 : 0x8664, 68);
  return b;
}

function makeFixture({ version = '0.1.28', indexHtml = '<!doctype html><script src="./assets/app.js"></script>', tamperPs1 = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'plugin-gate-test-'));
  const distDir = path.join(root, 'dist');
  const assetsDir = path.join(root, 'assets');
  mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(path.join(distDir, 'index.html'), indexHtml);
  writeFileSync(path.join(distDir, 'assets/app.js'), 'console.log("ok");');

  const installSh = readFileSync(path.join(repoRoot, 'scripts/install.sh'));
  const downloadPs1 = tamperPs1 ? Buffer.from('no-bom') : readFileSync(path.join(repoRoot, 'scripts/standalone/download.ps1'));
  const jarBuf = buildStoredZip([
    { name: 'META-INF/plugin.xml', data: `<idea-plugin><version>${version}</version></idea-plugin>` },
    { name: 'installers/install.sh', data: installSh },
    { name: 'installers/install.ps1', data: downloadPs1 },
  ]);

  const specs = [
    ...Object.entries(PLUGIN_TARGETS).map(([id, t]) => ({ name: `idea-ai-agent-${version}-${id}.zip`, targets: [t] })),
    { name: `idea-ai-agent-${version}.zip`, targets: Object.values(PLUGIN_TARGETS) },
  ];
  const sums = [];
  for (const spec of specs) {
    const entries = [
      { name: `idea-ai-agent/lib/idea-ai-agent-${version}.jar`, data: jarBuf },
      { name: 'idea-ai-agent/LICENSE', data: 'MIT' },
      { name: 'idea-ai-agent/NOTICE.md', data: 'Notice' },
      { name: 'idea-ai-agent/runtime/agents.json', data: '{}' },
      { name: 'idea-ai-agent/runtime/task_template.json', data: '{}' },
      { name: 'idea-ai-agent/runtime/LICENSE', data: 'MIT' },
      { name: 'idea-ai-agent/runtime/licenses/gopsutil-LICENSES.txt', data: 'BSD' },
      { name: 'idea-ai-agent/runtime/web/index.html', data: indexHtml },
      { name: 'idea-ai-agent/runtime/web/assets/app.js', data: 'console.log("ok");' },
      ...spec.targets.map((t) => ({ name: `idea-ai-agent/runtime/${t.binary}`, data: fakeBinary(t), mode: 0o100755 })),
    ];
    const zipBuf = buildStoredZip(entries);
    writeFileSync(path.join(assetsDir, spec.name), zipBuf);
    sums.push(`${createHash('sha256').update(zipBuf).digest('hex')}  ${spec.name}`);
  }
  writeFileSync(path.join(assetsDir, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  return { root, distDir, assetsDir, version };
}

test('verifyPluginAssets accepts valid packages and rejects relay assets, BOM loss and checksum tampering', () => {
  const ok = makeFixture();
  try {
    verifyPluginAssets({
      assetsDir: ok.assetsDir,
      version: ok.version,
      repoRoot,
      distDir: ok.distDir,
      skipGoBuildInfo: true,
      minWebFiles: 2,
    });

    writeFileSync(path.join(ok.assetsDir, 'SHA256SUMS.txt'), '0'.repeat(64) + `  idea-ai-agent-${ok.version}.zip\n`);
    assert.throws(
      () =>
        verifyPluginAssets({
          assetsDir: ok.assetsDir,
          version: ok.version,
          repoRoot,
          distDir: ok.distDir,
          skipGoBuildInfo: true,
          minWebFiles: 2,
        }),
      /entry count mismatch|SHA-256 mismatch/,
    );
  } finally {
    rmSync(ok.root, { recursive: true, force: true });
  }

  const relayBad = makeFixture({ indexHtml: '<script src="/mindfs-assets/index.js"></script>' });
  try {
    assert.throws(
      () =>
        verifyPluginAssets({
          assetsDir: relayBad.assetsDir,
          version: relayBad.version,
          repoRoot,
          distDir: relayBad.distDir,
          skipGoBuildInfo: true,
          minWebFiles: 2,
        }),
      /forbidden \/mindfs-assets\//,
    );
  } finally {
    rmSync(relayBad.root, { recursive: true, force: true });
  }

  const bomBad = makeFixture({ tamperPs1: true });
  try {
    assert.throws(
      () =>
        verifyPluginAssets({
          assetsDir: bomBad.assetsDir,
          version: bomBad.version,
          repoRoot,
          distDir: bomBad.distDir,
          skipGoBuildInfo: true,
          minWebFiles: 2,
        }),
      /missing UTF-8 BOM/,
    );
  } finally {
    rmSync(bomBad.root, { recursive: true, force: true });
  }
});
