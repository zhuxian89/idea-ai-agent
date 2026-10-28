import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/services/answeredQuestion.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports });
const { applyAnsweredQuestion } = exports;
const question = { callId: "old", kind: "ask_user", status: "running", meta: { questions: ["Choose"] } };
const answer = { ...question, status: "complete", meta: { answers: { q_0: "A" } } };

test("correction matches live and saved questions without changing turn state or inserting history", () => {
  const original = { pending: false, updated_at: "unchanged", exchanges: [
    { role: "tool", toolCall: question }, { role: "user", content: "New turn" },
    { role: "tool", toolCall: { ...question, callId: "new" } },
  ], exchange_aux: { "2": [{ seq: 2, line: 0, toolcall: question }] } };
  const result = applyAnsweredQuestion(original, answer);
  assert.equal(result.pending, false);
  assert.equal(result.updated_at, "unchanged");
  assert.equal(result.exchanges.length, 3);
  assert.equal(result.exchanges[0].toolCall.status, "complete");
  assert.equal(result.exchanges[2].toolCall.status, "running");
  assert.equal(result.exchange_aux["2"][0].toolcall.meta.answers.q_0, "A");
  assert.equal(original.exchanges[0].toolCall.status, "running");
  assert.equal(applyAnsweredQuestion(original, { ...answer, callId: "missing" }), original);
  assert.equal(applyAnsweredQuestion(original, { ...answer, status: "running" }), original);
});

test("App handles corrections before draft attachment, pending flags and normal stream effects", () => {
  const source = fs.readFileSync("src/App.tsx", "utf8");
  const handlerStart = source.indexOf("const handleSessionStream =");
  const start = source.indexOf('if (payload.event?.type === "question_answered")', handlerStart);
  const end = source.indexOf("let pending = pendingBySessionRef.current[ck];", start);
  assert.ok(start > handlerStart && end > start);
  const context = {
    payload: { event: { type: "question_answered", data: answer } }, ck: "root:s", activeRoot: "root", streamKey: "s",
    sessionCacheRef: { current: { "root:s": { pending: false, exchanges: [{ role: "tool", toolCall: question }] } } },
    drawerSessionByRootRef: { current: { root: { key: "s", pending: false, exchanges: [{ role: "tool", toolCall: question }] } } },
    applyAnsweredQuestion, bumpCacheVersion() {},
    setDrawerSessionForRoot(root, session) { context.drawer = session; },
  };
  vm.runInNewContext(`(function () { ${source.slice(start, end)} throw new Error("fell through into stream startup"); })()`, context);
  assert.equal(context.sessionCacheRef.current["root:s"].pending, false);
  assert.equal(context.drawer.pending, false);
  assert.equal(context.drawer.exchanges[0].toolCall.status, "complete");
});
