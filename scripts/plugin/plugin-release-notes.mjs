#!/usr/bin/env node
// plugin-release-notes.mjs --version V --changes-file F [--standalone-version SV] [--commit SHA] [--replace-existing] [--formal]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function pluginReleaseNotes({
  version,
  changes,
  standaloneVersion = '',
  commitSha = '',
  replaceExisting = false,
  formal = false,
  repo = 'zhuxian89/idea-ai-agent',
}) {
  const out = [];
  if (!formal) {
    out.push('**本版为测试草稿。** 尚未替换公开的正式插件发布。', '');
  }
  out.push(
    '## 本次更新',
    '',
    changes.trim(),
    '',
    '## 安装',
    '',
    `下载对应平台 ZIP，在 IDEA 的「插件 → 从磁盘安装插件」选择 ZIP，随后重启 IDEA。若已安装 **${version}**，同样需要从磁盘重装并重启 IDEA 才能更新。通用 ZIP 含四个平台的内嵌后台，校验见 \`SHA256SUMS.txt\`。`,
  );
  if (standaloneVersion) {
    out.push(
      '',
      `独立后台单独更新至 [${standaloneVersion}](https://github.com/${repo}/releases/tag/standalone-v${standaloneVersion})。`,
    );
  }
  if (replaceExisting && commitSha) {
    out.push(
      '',
      `本次替换的附件构建自 [\`${commitSha.slice(0, 12)}\`](https://github.com/${repo}/commit/${commitSha})。GitHub 的 Source code 归档仍对应原 ${version} 标签。`,
    );
  }
  out.push('');
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : '';
  };
  const version = option('--version');
  const changesFile = option('--changes-file');
  if (!version || !changesFile) {
    console.error(
      'usage: plugin-release-notes.mjs --version V --changes-file F [--standalone-version SV] [--commit SHA] [--replace-existing] [--formal]',
    );
    process.exit(2);
  }
  const changes = readFileSync(changesFile, 'utf8');
  if (!changes.trim()) {
    console.error('the changes file is empty: write what this version changes');
    process.exit(1);
  }
  process.stdout.write(
    pluginReleaseNotes({
      version,
      changes,
      standaloneVersion: option('--standalone-version'),
      commitSha: option('--commit'),
      replaceExisting: args.includes('--replace-existing'),
      formal: args.includes('--formal'),
      repo: process.env.GITHUB_REPOSITORY || 'zhuxian89/idea-ai-agent',
    }),
  );
}
