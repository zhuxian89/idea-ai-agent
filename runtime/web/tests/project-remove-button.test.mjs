import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const listView = readFileSync(new URL('../src/components/DefaultListView.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/components/workbench/WorkspaceView.tsx', import.meta.url), 'utf8');
const managedRoots = readFileSync(new URL('../src/app/workbench/useManagedRootActions.ts', import.meta.url), 'utf8');

// Removing a project is only offered for standalone/relay projects; IDEA-managed roots keep registration in IDEA.
test('remove-project entry is rendered only when a handler is supplied', () => {
  assert.match(listView, /onRemoveRoot\?: \(\) => void;/);
  assert.match(listView, /\{onRemoveRoot \? \(\s*<button/);
  assert.match(listView, /t\("directory\.removeProject"\)/);
});

test('App hides remove-project for IDEA-managed projects', () => {
  assert.match(app, /onRemoveRoot=\{isIDEManagedProject \? undefined : handleRemoveCurrentRoot\}/);
});

test('remove-project calls DELETE /api/dirs with the current root path and confirms first', () => {
  const handler = managedRoots.slice(managedRoots.indexOf('const handleRemoveCurrentRoot'), managedRoots.indexOf('const applyManagedRootRename'));
  assert.match(handler, /window\.confirm\(t\("root\.confirmRemove"/);
  assert.match(handler, /appURL\("\/api\/dirs", new URLSearchParams\(\{ path: rootPath \}\)\)/);
  assert.match(handler, /method: "DELETE"/);
  assert.match(handler, /reportError\("root\.delete_failed"/);
});
