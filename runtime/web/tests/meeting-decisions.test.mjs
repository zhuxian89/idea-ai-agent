import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// 详情接口分两次读取运行和会议轮次，并发时二者可能差一轮。裁决草稿必须跟着「弹窗实际展示并会提交的那一轮」走，
// 否则上一轮的草稿（custom、defer、仍匹配的 adopt）会被套到新一轮的条目上并通过后台校验。
test('decision drafts belong to the round the modal shows and submits, not to run.round', () => {
  const shell = read('../src/components/collab/CollabShell.tsx');
  assert.match(shell, /const meetingDraftRound = meetingDetail\?\.meeting\?\.rounds\.at\(-1\)\?\.number \?\? meetingDetail\?\.run\.round;/);
  assert.match(shell, /const meetingDraftKey = meetingDetail \? JSON\.stringify\(\[meetingDetail\.run\.root_id, meetingDetail\.run\.id, meetingDraftRound\]\) : "";/);
  assert.ok(!/meetingDetail\.run\.id, meetingDetail\.run\.round\]/.test(shell), 'the draft key must not use run.round');
  const pane = read('../src/components/collab/MeetingPane.tsx');
  assert.match(pane, /round: current\.number, decisions/, 'the submitted round is the displayed (last) round');
});

test('the decision modal is only "done" for choices that are still valid, shows submit errors itself and freezes while submitting', () => {
  const modal = read('../src/components/collab/MeetingDecisions.tsx');
  assert.match(modal, /adoptableOptions\(item\)\.has\(adoptValue\(/, 'an adopt choice counts only while its option is still adoptable');
  assert.match(modal, /if \(!busy\) onChoiceRaw\(choice\)/, 'choices are frozen while a request is in flight');
  assert.match(modal, /className="decision-error" role="alert"/, 'the failure reason is shown inside the modal');
  assert.match(read('../src/components/collab/MeetingPane.tsx'), /busy=\{busy\} error=\{error\}/, 'the pane passes the failure reason to the modal');
  assert.match(read('../src/components/collab/QuickDecisions.tsx'), /readOnly=\{busy\}/, 'quick mode freezes its custom instruction too');
});
