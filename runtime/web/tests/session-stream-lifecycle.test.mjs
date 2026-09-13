import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

function createService() {
  const exports = {};
  const source = fs.readFileSync("src/services/session.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, console, setTimeout, clearTimeout,
    require: (name) => name === "./e2ee"
      ? { e2eeService: { setClientId() {}, isRequired: () => false } }
      : {},
  });
  const service = exports.sessionService;
  const send = (type, payload = {}, error) => service.handleMessage({
    type, payload: { root_id: "root", session_key: "session", ...payload }, error,
  });
  const stream = (type, content = "") => send("session.stream", { event: { type, data: { content } } });
  return { service, send, stream };
}

function observe(service) {
  const state = { streaming: service.isSessionStreaming("session"), events: [] };
  state.unsubscribe = service.subscribe("session", {
    onStream: (event) => {
      state.events.push(event.type);
      if (event.type !== "message_done") state.streaming = event.type !== "error";
    },
    onDone: () => { state.events.push("done"); state.streaming = false; },
    onError: () => { state.events.push("error"); state.streaming = false; },
  });
  return state;
}

for (const replay of [false, true]) {
  test(`a completed turn cannot resume generating when the viewer mounts (replay=${replay})`, () => {
    const { service, send, stream } = createService();
    const globalEvents = [];
    service.subscribeEvents((event) => globalEvents.push(event.type));
    stream("thought_chunk", "Working");
    stream("message_chunk", "Final answer");
    stream("message_done");
    send("session.done", { replay });

    const viewer = observe(service);
    assert.equal(service.isSessionStreaming("session"), false);
    assert.equal(viewer.streaming, false, "buffered text must not reactivate a completed turn");
    assert.deepEqual(viewer.events, []);
    assert.deepEqual(globalEvents, ["session.stream", "session.stream", "session.stream", "session.done"],
      "the application must still receive all content and the completion event");
    viewer.unsubscribe();
    assert.equal(observe(service).streaming, false, "remounting must also remain idle");
  });
}

test("completion observers see an idle stream before subscribing a viewer", () => {
  const { service, send, stream } = createService();
  stream("message_chunk", "Final answer");
  let viewer;
  service.subscribeEvents((event) => {
    if (event.type !== "session.done") return;
    assert.equal(service.isSessionStreaming("session"), false);
    viewer = observe(service);
  });
  send("session.done");
  assert.equal(viewer.streaming, false);
  assert.ok(!viewer.events.includes("message_chunk"));
});

test("failed turns do not replay stale output when reopened", () => {
  const { service, send, stream } = createService();
  stream("message_chunk", "Partial answer");
  send("session.error", {}, { message: "Agent exited" });
  const viewer = observe(service);
  assert.equal(viewer.streaming, false);
  assert.deepEqual(viewer.events, []);
});

test("active turns still replay buffered events, finish live, and accept another turn", () => {
  const { service, send, stream } = createService();
  stream("thought_chunk", "Working");
  stream("message_chunk", "Answer");
  const viewer = observe(service);
  assert.equal(viewer.streaming, true);
  assert.deepEqual(viewer.events, ["thought_chunk", "message_chunk"]);
  stream("message_done");
  assert.equal(viewer.streaming, true, "wait for session.done while the backend settles the turn");
  send("session.done");
  assert.equal(viewer.streaming, false);
  assert.equal(service.isSessionStreaming("session"), false);
  viewer.unsubscribe();

  send("session.user_message", { exchange: { role: "user", content: "Next question" } });
  stream("message_chunk", "Next answer");
  const nextViewer = observe(service);
  assert.equal(nextViewer.streaming, true);
  assert.deepEqual(nextViewer.events, ["message_chunk"]);
  send("session.done");
  assert.equal(nextViewer.streaming, false);
});
