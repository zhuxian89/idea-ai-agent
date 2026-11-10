import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, console, require: name => {
    assert.ok(name in modules, `unexpected dependency: ${name}`);
    return modules[name];
  } });
  return exports;
}

const ref = current => ({ current });
const key = (root, session) => `${root}::${session}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
const noop = () => {};
const models = load("src/app/sessionModel.ts");
const answered = load("src/services/answeredQuestion.ts");

test("completion preserves queued continuation, while cancellation clears pending acknowledgements", () => {
  const { createSessionStreamHandlers } = load("src/app/events/sessionStream.ts", {
    "../../services/answeredQuestion": answered,
    "../../services/error": { reportError: noop },
  });
  const cacheKey = key("root", "session");
  let selected = { key: "session", root_id: "root", pending: true, exchanges: [{ role: "user", pending_ack: true }] };
  let sessions = [selected];
  const pending = [];
  const state = {
    rootSessionKey: key,
    cancelRequestedBySessionRef: ref({}), pendingBySessionRef: ref({ [cacheKey]: {} }),
    queuedMessagesBySessionRef: ref({ [cacheKey]: [{ id: "queued" }] }),
    queueFrozenBySessionRef: ref({}), optimisticDequeuedIdsRef: ref({}),
    sessionCacheRef: ref({ [cacheKey]: selected }), drawerSessionByRootRef: ref({ root: selected }),
    currentRootIdRef: ref("root"), markSessionPending: (...args) => pending.push(args),
    setSelectedPendingByKey: noop, setSelectedSession: update => { selected = update(selected); },
    setSessions: update => { sessions = update(sessions); },
    setDrawerSessionForRoot: (root, session) => { state.drawerSessionByRootRef.current[root] = session; },
    setMultiProjectSessionPending: noop, bumpCacheVersion: noop,
  };
  const { handleSessionStreamDone } = createSessionStreamHandlers(state);
  handleSessionStreamDone("root", "session");
  assert.deepEqual(pending, [["root", "session"]]);
  assert.equal(state.sessionCacheRef.current[cacheKey].pending, true);

  state.cancelRequestedBySessionRef.current[cacheKey] = true;
  handleSessionStreamDone("root", "session");
  for (const session of [selected, sessions[0], state.sessionCacheRef.current[cacheKey], state.drawerSessionByRootRef.current.root]) {
    assert.equal(session.pending, false);
    assert.equal(session.exchanges[0].pending_ack, false);
  }
  assert.equal(pending.length, 1, "a queued message must not restart a cancelled turn");
});

for (const interruption of ["unmount", "next-turn"]) {
  test(`late completion replay cannot overwrite a session after ${interruption}`, async () => {
    const { createSessionReplay } = load("src/app/events/sessionReplay.ts", {
      "../../services/session": {}, "../sessionModel": models,
    });
    let cancelled = false;
    let finish;
    let applied = 0;
    const state = {
      rootSessionKey: key, isCancelled: () => cancelled,
      sessionCacheRef: ref({ [key("root", "session")]: { key: "session", pending: false } }),
      loadingSessionRef: ref({}), loadedSessionRef: ref({}),
      restoreActiveSession: () => new Promise(resolve => { finish = resolve; }),
      clearSessionStale: () => applied++, selectedSessionRef: ref({ key: "session" }),
      setSelectedSession: () => applied++, boundSessionByRootRef: ref({ root: "session" }),
      setDrawerSessionForRoot: () => applied++,
    };
    const replay = createSessionReplay(state);
    const version = replay.advanceTurnVersion("root", "session");
    const pending = replay.reloadSessionForReplay("root", "session", version);
    await tick();
    if (interruption === "unmount") cancelled = true;
    else state.sessionCacheRef.current[key("root", "session")].pending = true;
    finish({ key: "session", exchanges: [{ role: "assistant", content: "old turn" }] });
    await pending;
    assert.equal(applied, 0);
    assert.deepEqual(state.loadedSessionRef.current, {});
  });
}

test("file notifications invalidate the affected root without refreshing another project's visible file", async () => {
  const invalidated = [], refreshed = [], trees = [];
  const { createFileChangeHandlers } = load("src/app/events/fileChanges.ts", {
    "../../services/file": { invalidateFileCache: (...args) => invalidated.push(args) },
    "../../services/git": {},
  });
  const state = {
    currentRootIdRef: ref("active"), selectedDirRef: ref("active"), fileRef: ref({ root: "active", path: "README.md" }),
    refreshCurrentFileContent: (...args) => refreshed.push(args), invalidatePluginsForRoot: noop,
    refreshGitStatus: async () => ({ available: true, items: [] }), setGitDiff: noop, gitDiff: null,
    invalidTreeCacheKeysRef: ref(new Set()), treeCacheKey: key,
    refreshTreeDir: (...args) => trees.push(args),
  };
  const handlers = createFileChangeHandlers(state);
  handlers.handleFileChanged({ root_id: "background", path: "README.md" });
  await tick();
  assert.deepEqual(invalidated, [["background", "README.md"]]);
  assert.deepEqual(refreshed, []);
  assert.deepEqual(trees, []);
  assert.equal(state.invalidTreeCacheKeysRef.current.has(key("background", ".")), true);
  handlers.handleFileChanged({ root_id: "active", path: "README.md" });
  await tick();
  assert.deepEqual(refreshed, [["active", "README.md"]]);
  assert.deepEqual(trees, [["active", ".", true]]);
});

test("slash-command output and completion ignore a previous request after the command is restarted", () => {
  const { createSlashCommandHandlers } = load("src/app/events/slashCommands.ts", {
    "../../services/error": { reportError: noop },
  });
  let results = { [key("root", "session")]: { requestId: "new", content: "", status: "running" } };
  const handlers = createSlashCommandHandlers({
    rootSessionKey: key, resolveRootForSessionKey: () => "root", currentRootIdRef: ref("root"), t: value => value,
    setSlashCommandResults: update => { results = update(results); },
  });
  handlers.handleSlashCommandStream({ session_key: "session", request_id: "old", event: { type: "message_chunk", data: { content: "stale" } } });
  handlers.handleSlashCommandDone({ session_key: "session", request_id: "old" });
  assert.equal(results[key("root", "session")].content, "");
  assert.equal(results[key("root", "session")].status, "running");
  handlers.handleSlashCommandStream({ session_key: "session", request_id: "new", event: { type: "message_chunk", data: { content: "current" } } });
  handlers.handleSlashCommandDone({ session_key: "session", request_id: "new" });
  assert.equal(results[key("root", "session")].content, "current");
  assert.equal(results[key("root", "session")].status, "complete");
});
