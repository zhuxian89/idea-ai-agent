#!/usr/bin/env node
// verify-public-release.mjs --tag <tag> --assets-dir <dir> [--repo <owner/repo>] [--base-url <url>]
//
// Anonymously downloads every public asset of a GitHub Release (without GH_TOKEN or Authorization headers)
// and verifies that the public bytes and SHA-256 digests match the verified build directory byte for byte.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function verifyPublicAssets({ tag, assetsDir, baseUrl, releaseMeta }) {
  const localFiles = readdirSync(assetsDir)
    .filter((name) => statSync(path.join(assetsDir, name)).isFile())
    .sort();
  assert.ok(localFiles.length > 0, `no files found in ${assetsDir}`);

  if (releaseMeta) {
    assert.equal(releaseMeta.isDraft, false, `release ${tag} is still a draft`);
    const remoteNames = releaseMeta.assets.map((a) => a.name).sort();
    assert.deepEqual(remoteNames, localFiles, `release ${tag} asset list differs from verified assets`);
  }

  const digestByAsset = new Map(
    (releaseMeta?.assets || []).map((a) => [a.name, a.digest || '']),
  );

  const concurrency = 6;
  let cursor = 0;
  const results = [];

  async function worker() {
    while (cursor < localFiles.length) {
      const name = localFiles[cursor++];
      const expected = readFileSync(path.join(assetsDir, name));
      const url = `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'idea-ai-agent-public-release-verifier/1.0' },
        redirect: 'follow',
      });
      assert.equal(response.status, 200, `anonymous download failed for ${name} (${url}): HTTP ${response.status}`);
      const actual = Buffer.from(await response.arrayBuffer());
      assert.ok(actual.equals(expected), `public asset ${name} differs byte-for-byte from verified build artifact`);
      const sum = sha256(actual);
      const apiDigest = digestByAsset.get(name) || '';
      if (apiDigest.startsWith('sha256:')) {
        assert.equal(apiDigest, `sha256:${sum}`, `GitHub API digest mismatch for ${name}`);
      }
      results.push({ name, size: actual.length, sha256: sum });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, localFiles.length) }, () => worker()));
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : '';
  };
  const tag = option('--tag');
  const assetsDir = option('--assets-dir');
  const repo = option('--repo') || process.env.GITHUB_REPOSITORY || 'zhuxian89/idea-ai-agent';
  const baseUrl = option('--base-url') || `https://github.com/${repo}/releases/download`;
  if (!tag || !assetsDir) {
    console.error('usage: verify-public-release.mjs --tag <tag> --assets-dir <dir> [--repo <owner/repo>] [--base-url <url>]');
    process.exit(2);
  }
  const rawMeta = execFileSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'tagName,isDraft,isPrerelease,assets'], {
    encoding: 'utf8',
  });
  const releaseMeta = JSON.parse(rawMeta);
  verifyPublicAssets({ tag, assetsDir: path.resolve(assetsDir), baseUrl, releaseMeta })
    .then((results) => {
      console.log(`OK: verified ${results.length} public assets on ${tag} byte-for-byte anonymously`);
    })
    .catch((error) => {
      console.error(`FAILED: ${error.message}`);
      process.exit(1);
    });
}
