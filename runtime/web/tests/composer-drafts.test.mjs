import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync("src/services/composerDrafts.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
function service() {
  const context = { exports: {} };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

test("draft identities isolate projects, sessions, and unsent drafts without delimiter collisions", () => {
  const { composerDraftKey: key } = service();
  assert.notEqual(key("one", "session"), key("two", "session"));
  assert.notEqual(key("one", ""), key("one", "session"));
  assert.notEqual(key("one:two", "three"), key("one", "two:three"));
  assert.equal(key("one"), key("one", ""));
});

test("unsent and pending drafts follow actual session promotions, not unrelated pending activity", () => {
  const api = service();
  const seen = [];
  const stop = api.subscribeComposerDraftPromotion((from, to) => seen.push([from, to]));
  api.promoteComposerDraft("root", "", "pending-1");
  api.promoteComposerDraft("root", "pending-1", "real-1");
  api.promoteComposerDraft("root", "real-1", "real-1");
  stop();
  api.promoteComposerDraft("root", "real-1", "ignored");
  assert.deepEqual(seen, [
    [api.composerDraftKey("root", ""), api.composerDraftKey("root", "pending-1")],
    [api.composerDraftKey("root", "pending-1"), api.composerDraftKey("root", "real-1")],
  ]);
});

test("App promotes composer drafts at creation and at the existing pending-session promotion boundary", () => {
  const source = readFileSync("src/App.tsx", "utf8");
  assert.match(source, /const tempKey = `pending-\$\{Date\.now\(\)\}`;\s+promoteComposerDraft\(activeRoot, "", tempKey\)/);
  assert.match(source, /const pendingCacheKey = rootSessionKey\(rootID, pendingKey\);\s+promoteComposerDraft\(rootID, pendingKey, sessionKey\)/);
});
