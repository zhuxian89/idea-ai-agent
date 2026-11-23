import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

// The real timing rules, so these tests keep exercising what ships.
const reconnectPolicy = (() => {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/services/reconnectPolicy.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    { exports, Math },
  );
  return exports;
})();

function createService() {
  const exports = {};
  const source = fs.readFileSync("src/services/session.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const sandbox = { exports, console, setTimeout, clearTimeout, WebSocket: { OPEN: 1 }, require: (name) => {
    if (name === "./e2ee") return { e2eeService: { setClientId() {}, isRequired: () => false } };
    if (name === "./reconnectPolicy") return reconnectPolicy;
    return {};
  } };
  vm.runInNewContext(compiled, sandbox);
  const service = exports.sessionService;
  const messages = [];
  service.ws = { readyState: 1, send: (raw) => messages.push(JSON.parse(raw)), close() {} };
  return { service, messages, sandbox };
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

test("manual continuation is scoped, preserves agent settings, and never duplicates an in-flight request", async () => {
  const { service, messages, sandbox } = createService();
  const session = { key: "failed", type: "chat", agent: "codex", model: "chosen-model", mode: "plan", effort: "high", fast_service: "on" };
  const fail = () => service.handleMessage({ type: "session.stream", payload: {
    root_id: "root", session_key: "failed", event: { type: "error", data: { message: "offline" } },
  } });
  assert.equal(await service.continueFailedSession("root", session, "Continue safely"), false);
  fail();
  service.handleMessage({ type: "session.done", payload: { root_id: "root", session_key: "failed" } });
  assert.ok(service.getSessionFailure("root", "failed"), "done after error must not erase recovery");
  assert.equal(await service.continueFailedSession("other-root", session, "Continue safely"), false);
  assert.equal(await service.continueFailedSession("root", { ...session, type: "command" }, "Continue safely"), false);
  assert.equal(await service.continueFailedSession("root", { ...session, pending: true }, "Continue safely"), false);
  sandbox.navigator = { onLine: false };
  assert.equal(await service.continueFailedSession("root", session, "Continue safely"), false);
  sandbox.navigator.onLine = true;
  const first = service.continueFailedSession("root", session, "Continue safely");
  assert.equal(await service.continueFailedSession("root", session, "Continue safely"), false);
  assert.equal(await first, true);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].payload, { root_id: "root", session_key: "failed", content: "Continue safely",
    type: "chat", agent: "codex", model: "chosen-model", agent_mode: "plan", effort: "high", fast_service: "on" });
  // The real server rejection contains only the request ID, not session/root.
  service.handleMessage({ type: "session.error", id: messages[0].id, payload: {}, error: { message: "unavailable" } });
  assert.equal(service.getSessionFailure("root", "failed").sending, false);
  assert.equal(await service.continueFailedSession("root", session, "Continue safely"), true);
  service.handleMessage({ type: "session.user_message", payload: { root_id: "root", session_key: "failed", exchange: { content: "Continue safely" } } });
  assert.equal(service.getSessionFailure("root", "failed"), undefined);
  assert.equal(await service.continueFailedSession("root", session, "Continue safely"), false);
});

test("failed continuation dispatch unlocks without retaining an automatically replayable message", async () => {
  const { service } = createService();
  service.handleMessage({ type: "session.stream", payload: { root_id: "root", session_key: "s", event: { type: "error", data: {} } } });
  service.ws.send = () => { throw new Error("Socket closed"); };
  assert.equal(await service.continueFailedSession("root", { key: "s", agent: "codex" }, "Continue safely"), false);
  assert.equal(service.getSessionFailure("root", "s").sending, false);
  assert.equal(service.pendingMessages.size, 0);
});

test("continuation completion replay releases its lock, while unrelated request errors do not stop a running turn", async () => {
  const { service, messages } = createService();
  service.handleMessage({ type: "session.stream", payload: { root_id: "root", session_key: "s", event: { type: "error", data: {} } } });
  await service.continueFailedSession("root", { key: "s", agent: "codex" }, "Continue safely");
  service.handleMessage({ type: "session.done", payload: { root_id: "root", session_key: "s", request_id: messages[0].id, replay: true } });
  assert.equal(service.getSessionFailure("root", "s"), undefined);
  service.handleMessage({ type: "session.stream", payload: { root_id: "root", session_key: "s", event: { type: "thought_chunk", data: { content: "Running" } } } });
  await service.sendMessage("root", "s", "Queued", "chat", "codex");
  service.handleMessage({ type: "session.error", id: messages[1].id, payload: {}, error: { message: "Queue rejected" } });
  assert.equal(service.isSessionStreaming("s"), true);
  assert.equal(service.getSessionFailure("root", "s"), undefined);
});

test("watchdog probes only a silent socket and drops it when nothing answers", async () => {
  const { service, messages, sandbox } = createService();
  const timers = [];
  sandbox.window = { setTimeout(callback, ms) { timers.push({ callback, ms }); return timers.length; } };
  let drops = 0;
  service.failAndRetry = () => { drops += 1; };
  service.rootId = "root";

  // A connection that has just spoken is alive: no probe.
  service.lastInboundAt = Date.now();
  service.ensureReconnectLoop();
  await Promise.resolve();
  assert.equal(messages.length, 0, "a socket that just received data must not be probed");

  // Silent for longer than the idle threshold: one probe, with the generous timeout.
  service.lastInboundAt = Date.now() - reconnectPolicy.RECONNECT_POLICY.probeIdleMs - 1;
  service.ensureReconnectLoop();
  await Promise.resolve();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "ping");
  const probe = timers.at(-1);
  assert.equal(probe.ms, reconnectPolicy.RECONNECT_POLICY.probeTimeoutMs);

  // Any reply cancels the pending drop.
  service.clearProbe();
  probe.callback();
  assert.equal(drops, 0, "a received reply must cancel the pending reconnect");

  // No probe is stacked while one is outstanding; an unanswered one drops the socket.
  service.ensureReconnectLoop();
  assert.equal(messages.length, 2);
  service.ensureReconnectLoop();
  assert.equal(messages.length, 2, "a second probe must not be sent while one is waiting");
  timers.at(-1).callback();
  assert.equal(drops, 1);
});
