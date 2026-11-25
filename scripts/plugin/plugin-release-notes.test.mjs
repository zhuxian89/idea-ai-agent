import assert from 'node:assert/strict';
import test from 'node:test';
import { pluginReleaseNotes } from './plugin-release-notes.mjs';

test('plugin release notes include reinstall reminder, standalone version and replacement commit when applicable', () => {
  const sameVer = pluginReleaseNotes({
    version: '0.1.27',
    changes: '- 新增单 Agent 重启按钮',
    standaloneVersion: '0.1.64',
    commitSha: '0a67550123456789abcdef',
    replaceExisting: true,
    formal: true,
  });
  assert.ok(!sameVer.includes('测试草稿'));
  assert.match(sameVer, /若已安装 \*\*0\.1\.27\*\*，同样需要从磁盘重装并重启 IDEA/);
  assert.match(sameVer, /standalone-v0\.1\.64/);
  assert.match(sameVer, /`0a6755012345`/);

  const draft = pluginReleaseNotes({
    version: '0.1.28',
    changes: '- 新版本变更',
    standaloneVersion: '0.1.64',
    formal: false,
  });
  assert.match(draft, /本版为测试草稿/);
  assert.ok(!draft.includes('本次替换的附件构建自'));
});
