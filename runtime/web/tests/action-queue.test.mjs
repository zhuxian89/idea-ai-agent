import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the queued-message bar is inset only when the composer row has side buttons', () => {
  const source = read('../src/components/ActionBar.tsx');
  // The composer row reserves 30px side columns only for this condition; the queue must use the same one,
  // otherwise it is 31px narrower than the status card above and the input below (phone chat, IDE workbench).
  const sideButtons = source.match(/gridTemplateColumns: (isMobile && !compactWorkbench && !remotePhone) \? "30px minmax\(0, 1fr\) 30px"/);
  assert.ok(sideButtons, 'composer row condition changed; update the queue inset with it');
  assert.ok(source.includes(`data-inset={${sideButtons[1]} ? "1" : undefined}`));
  assert.ok(!/padding: isMobile \? "0 31px 4px"/.test(source), 'the old unconditional inset must not return');
});

test('queue actions share one icon style and take their colours from the theme', () => {
  const css = read('../src/components/actionQueue.css');
  assert.match(css, /\.action-queue-btn svg \{[^}]*stroke: currentColor;[^}]*stroke-width: 1\.8;/);
  assert.match(css, /\.action-queue-item \{[^}]*border: 1px solid var\(--panel-border\);[^}]*background: var\(--panel-bg\);/);
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(css.replace(/var\(--danger-color, #dc2626\)/g, '')), 'no hard-coded colours outside the danger fallback');
  const source = read('../src/components/ActionBar.tsx');
  const queue = source.slice(source.indexOf('className="action-queue"'), source.indexOf('data-onboarding="message-input"'));
  assert.ok(!/renderToolIcon|color: "#dc2626"/.test(queue), 'queue buttons use the shared line icons, not the coloured tool icon or inline red');
  for (const key of ['action.queueEdit', 'action.queueDelete', 'action.queueSendNow', 'action.queueSave', 'action.queueCancelEdit']) {
    assert.ok(queue.includes(`t("${key}")`), `${key} stays on its button`);
  }
});
