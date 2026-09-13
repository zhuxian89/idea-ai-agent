import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

function createService() {
  const exports = {};
  const source = fs.readFileSync("src/services/session.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const sandbox = { exports, console, setTimeout, clearTimeout, WebSocket: { OPEN: 1 }, require: (name) => {
    if (name === "./e2ee") return { e2eeService: { setClientId() {}, isRequired: () => false } };
    return {};
  } };
  vm.runInNewContext(compiled, sandbox);
  const service = exports.sessionService;
  const messages = [];
  service.ws = { readyState: 1, send: (raw) => messages.push(JSON.parse(raw)), close() {} };
  return { service, messages };
}

test("answer waits for matching server acceptance", async () => {
  const { service, messages } = createService();
  let finished = false;
  const result = service.answerQuestion("root", "session", "codex", "question", { q_0: "A" }).then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(finished, false, "sending bytes must not mark the answer submitted");
  service.handleMessage({ type: "session.answer_question.accepted", id: "unrelated", payload: {} });
  await Promise.resolve();
  assert.equal(finished, false);
  service.handleMessage({ type: "session.answer_question.accepted", id: messages[0].id, payload: {} });
  await result;
  assert.equal(finished, true);
});

test("server refusal and disconnect reject answers; user can retry", async () => {
  const { service, messages } = createService();
  const first = service.answerQuestion("root", "session", "claude", "question", { q_0: "B" });
  const failed = assert.rejects(first, /expired/);
  await Promise.resolve();
  service.handleMessage({ type: "session.error", id: messages[0].id, error: { message: "question expired" }, payload: {} });
  await failed;
  const retry = service.answerQuestion("root", "session", "claude", "question", { q_0: "B" });
  const disconnected = assert.rejects(retry, /连接|connection/i);
  service.disconnect();
  await disconnected;
});

test("offline answers reject instead of reporting success", async () => {
  const { service } = createService();
  service.disconnect();
  await assert.rejects(service.answerQuestion("root", "session", "codex", "question", { q_0: "A" }));
});
