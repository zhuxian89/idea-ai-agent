import assert from 'node:assert/strict';
import test from 'node:test';
import { planPlugin } from './plugin-plan.mjs';

const ok = {
  version: '0.1.28',
  mode: 'formal',
  replaceExisting: false,
  changes: '- new feature',
  refName: 'main',
  notesFileExists: false,
  releaseExists: false,
  tagExists: false,
};

test('valid plugin release plans cover new versions, same-version updates and safe drafts', () => {
  const fresh = planPlugin(ok);
  assert.deepEqual(fresh.problems, []);
  assert.equal(fresh.draftTag, 'v0.1.28');

  const branchRun = planPlugin({ ...ok, refName: 'plugin-0.1.28' });
  assert.deepEqual(branchRun.problems, []);

  const sameVerFormal = planPlugin({
    ...ok,
    version: '0.1.27',
    replaceExisting: true,
    releaseExists: true,
    tagExists: true,
  });
  assert.deepEqual(sameVerFormal.problems, []);

  const safeDraftWhenLive = planPlugin({
    ...ok,
    version: '0.1.27',
    mode: 'draft',
    replaceExisting: false,
    releaseExists: true,
    tagExists: true,
  });
  assert.deepEqual(safeDraftWhenLive.problems, []);
  assert.equal(safeDraftWhenLive.draftTag, 'plugin-draft-v0.1.27');
});

test('invalid plugin release requests are refused', () => {
  assert.match(planPlugin({ ...ok, version: 'v0.1.28' }).problems[0], /not a valid plugin version/);
  assert.match(planPlugin({ ...ok, mode: 'prerelease' }).problems[0], /unknown mode/);
  assert.match(planPlugin({ ...ok, refName: 'plugin-0.1.27' }).problems[0], /does not match version/);
  assert.match(planPlugin({ ...ok, changes: '   ' }).problems[0], /no release notes/);
  assert.match(
    planPlugin({ ...ok, version: '0.1.27', releaseExists: true, replaceExisting: false }).problems[0],
    /replace_existing=true/,
  );
});
