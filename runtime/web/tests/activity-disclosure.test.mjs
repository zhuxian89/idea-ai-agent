import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/services/activityDisclosure.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports });
const { ActivityDisclosureStore } = exports;
const ref = (sessionKey, itemKey = "call", rootId = "root") => ({ rootId, sessionKey, itemKey });

test("explicit choices isolate roots, sessions and local identities; restart restores defaults", () => {
  const store = new ActivityDisclosureStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  store.set(ref("A"), "open");
  store.set(ref("B"), "closed");
  store.set(ref("A", "local-1"), "closed");
  assert.equal(store.get(ref("A")), "open");
  assert.equal(store.get(ref("B")), "closed");
  assert.equal(store.get(ref("A", "call", "other-root")), undefined);
  assert.equal(store.get(ref("A", "local-2")), undefined);
  assert.equal(new ActivityDisclosureStore().get(ref("A")), undefined);
  unsubscribe();
  store.set(ref("A"), "closed");
  assert.equal(notifications, 3);
});

test("500 choices use LRU and protect focus until it leaves", () => {
  const store = new ActivityDisclosureStore();
  for (let i = 0; i < 500; i++) store.set(ref("A", String(i)), "open");
  const blur = store.focus(ref("A", "0"));
  store.touch(ref("A", "1"));
  store.set(ref("A", "500"), "closed");
  assert.equal(store.get(ref("A", "2")), undefined);
  for (let i = 501; i < 1001; i++) store.set(ref("A", String(i)), "open");
  assert.equal(store.get(ref("A", "0")), "open");
  blur();
  store.set(ref("A", "1001"), "open");
  assert.equal(store.get(ref("A", "0")), undefined);
  assert.equal(Array.from({ length: 1002 }, (_, i) => store.get(ref("A", String(i)))).filter(Boolean).length, 500);
});

test("50 sessions use LRU and an old blur cannot unprotect the newly focused item", () => {
  const store = new ActivityDisclosureStore();
  for (let i = 0; i < 50; i++) store.set(ref(String(i)), "open");
  const oldBlur = store.focus(ref("1"));
  const blur = store.focus(ref("0"));
  oldBlur();
  for (let i = 50; i < 101; i++) store.set(ref(String(i)), "open");
  assert.equal(store.get(ref("0")), "open");
  assert.equal(store.get(ref("1")), undefined);
  blur();
  store.set(ref("101"), "closed");
  assert.equal(store.get(ref("0")), undefined);
  assert.equal(Array.from({ length: 102 }, (_, i) => store.get(ref(String(i)))).filter(Boolean).length, 50);
});

test("group and child choices share the 500-entry budget and independent key namespaces", () => {
  const { activityDisclosureKey } = exports;
  const store = new ActivityDisclosureStore();
  const child = ref("A", activityDisclosureKey({ callId: "same" }));
  const group = ref("A", activityDisclosureKey({ groupKey: "same" }));
  store.set(child, "open"); store.set(group, "closed");
  assert.equal(store.get(child), "open"); assert.equal(store.get(group), "closed");
  const blur = store.focus(child);
  assert.equal(store.isFocused(child), true); assert.equal(store.isFocused(group), false);
  for (let i = 0; i < 499; i++) store.set(ref("A", activityDisclosureKey({ groupKey: String(i) })), "closed");
  assert.equal(store.get(group), undefined);
  assert.equal(store.get(child), "open");
  const revision = store.getRevision(); blur();
  assert.equal(store.isFocused(child), false); assert.ok(store.getRevision() > revision);
});
