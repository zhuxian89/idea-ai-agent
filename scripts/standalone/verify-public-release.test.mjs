import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyPublicAssets } from './verify-public-release.mjs';

test('verifyPublicAssets checks anonymous downloads byte-for-byte and detects tampering', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pub-verify-'));
  const served = new Map([
    ['a.bin', Buffer.from('hello-world-binary')],
    ['a.bin.sha256', Buffer.from('sha-file')],
  ]);
  for (const [name, buf] of served) writeFileSync(path.join(dir, name), buf);

  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined, 'must download anonymously');
    const name = decodeURIComponent((req.url || '').split('/').pop() || '');
    const body = served.get(name);
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/releases/download`;

  try {
    const assets = [...served.entries()].map(([name, buf]) => ({
      name,
      digest: `sha256:${createHash('sha256').update(buf).digest('hex')}`,
    }));
    const results = await verifyPublicAssets({
      tag: 'standalone-v0.1.99',
      assetsDir: dir,
      baseUrl,
      releaseMeta: { isDraft: false, assets },
    });
    assert.equal(results.length, 2);

    served.set('a.bin', Buffer.from('tampered-bytes'));
    await assert.rejects(
      () => verifyPublicAssets({ tag: 'standalone-v0.1.99', assetsDir: dir, baseUrl, releaseMeta: { isDraft: false, assets } }),
      /differs byte-for-byte/,
    );

    await assert.rejects(
      () => verifyPublicAssets({ tag: 'standalone-v0.1.99', assetsDir: dir, baseUrl, releaseMeta: { isDraft: true, assets } }),
      /still a draft/,
    );
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
