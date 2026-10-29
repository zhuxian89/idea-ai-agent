import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

// Run from runtime/web: node --test tests/idea-bridge-commands.test.mjs
// Pure unit coverage of the IDE bridge queues: native title-bar commands and
// editor-capture requests must never be dropped while either side boots.
const compiled = ts.transpileModule(fs.readFileSync("src/services/ideaBridge.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const compiledPreferences = ts.transpileModule(fs.readFileSync("src/services/ideaPreferences.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function loadBridge({ ready = false, search = "", pathname = "/" } = {}) {
  const listeners = {};
  const posts = [];
  const inject = () => { window.ideaAgent = { postMessage: (payload) => posts.push(payload) }; };
  const window = {
    location: { search, pathname },
    addEventListener: (name, handler) => { (listeners[name] ||= []).push(handler); },
    dispatchEvent: (event) => { for (const handler of listeners[event.type] || []) handler(event); },
  };
  if (ready) inject();
  const preferences = { exports: {}, window };
  vm.runInNewContext(compiledPreferences, preferences);
  const sandbox = {
    window,
    URLSearchParams,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    exports: {},
    require: (name) => {
      if (name === "./ideaPreferences") return preferences.exports;
      assert.equal(name, "./appearance", "ideaBridge must not pull app runtime services");
      return { setIdeaTheme: () => {}, restoreIdeaAppearance: () => {} };
    },
  };
  vm.runInNewContext(compiled, sandbox);
  return {
    window,
    posts,
    injectBridge: inject,
    fireReady: () => window.dispatchEvent({ type: "ideaAgentReady" }),
    exports: sandbox.exports,
  };
}

test("native commands clicked before the view subscribes replay in order", () => {
  const bridge = loadBridge();
  bridge.window.ideaAgentNativeCommand("new");
  bridge.window.ideaAgentNativeCommand("history");
  const seen = [];
  const unsubscribe = bridge.exports.subscribeIdeaNativeCommand((command) => seen.push(command));
  assert.deepEqual(seen, ["new", "history"], "queued clicks must replay on subscribe");
  bridge.window.ideaAgentNativeCommand("settings");
  assert.deepEqual(seen, ["new", "history", "settings"], "live commands go straight through");
  unsubscribe();
  bridge.window.ideaAgentNativeCommand("new");
  assert.deepEqual(seen, ["new", "history", "settings"], "delivery stops after unsubscribe");
  const seenAgain = [];
  bridge.exports.subscribeIdeaNativeCommand((command) => seenAgain.push(command));
  assert.deepEqual(seenAgain, ["new"], "unsubscribed commands stay queued");
});

test("remote browser opens files through its web viewer and keeps native commands local", () => {
  const bridge = loadBridge({ pathname: "/n/project-node/" });
  assert.equal(bridge.exports.isIdeaRuntime, false);
  const files = [];
  bridge.window.addEventListener("ideaRemoteOpenFile", event => files.push(event.detail));
  bridge.exports.openIdeaFile("project", "src/main.ts");
  assert.deepEqual(JSON.parse(JSON.stringify(files)), [{ root: "project", path: "src/main.ts" }]);
  assert.equal(bridge.posts.length, 0);
  const local = loadBridge();
  const commands = [];
  local.window.ideaAgentNativeCommand("remote");
  local.exports.subscribeIdeaNativeCommand(command => commands.push(command));
  assert.deepEqual(commands, ["remote"]);
});

test("unknown native commands never reach the view", () => {
  const bridge = loadBridge();
  for (const command of [null, 7, "", "openFile", "refresh", "addContext"]) {
    bridge.window.ideaAgentNativeCommand(command);
  }
  const seen = [];
  bridge.exports.subscribeIdeaNativeCommand((command) => seen.push(command));
  assert.deepEqual(seen, []);
});

test("the bridge queue stays bounded so native clicks cannot grow without limit", () => {
  const bridge = loadBridge();
  for (let index = 0; index < 25; index += 1) bridge.window.ideaAgentNativeCommand("new");
  bridge.window.ideaAgentNativeCommand("settings");
  const seen = [];
  bridge.exports.subscribeIdeaNativeCommand((command) => seen.push(command));
  assert.deepEqual(seen, [...Array(19).fill("new"), "settings"], "oldest queued clicks drop first");
});

test("editor capture requests reach an already-injected bridge directly", () => {
  const bridge = loadBridge({ ready: true });
  bridge.exports.requestIdeaEditorContext();
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.posts)), [{ action: "addContext" }]);
});

test("file references and selected code use separate host requests, including before startup", () => {
  for (const ready of [true, false]) {
    const bridge = loadBridge({ ready });
    bridge.exports.requestIdeaFileContext();
    bridge.exports.requestIdeaEditorContext();
    if (!ready) {
      bridge.injectBridge();
      bridge.fireReady();
    }
    assert.deepEqual(JSON.parse(JSON.stringify(bridge.posts)), [
      { action: "addFileContext" }, { action: "addContext" },
    ]);
  }
});

test("file navigation waits for the IDEA bridge instead of dropping the click", () => {
  const bridge = loadBridge();
  bridge.exports.openIdeaFile("project-root", "CheckPlanAutoJobStatusEnum");
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.posts)), []);
  bridge.injectBridge();
  bridge.fireReady();
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.posts)), [{
    action: "openFile",
    rootId: "project-root",
    path: "CheckPlanAutoJobStatusEnum",
  }]);
});

test("editor capture clicks before the IDE injects window.ideaAgent flush once on ready", () => {
  const bridge = loadBridge();
  bridge.exports.requestIdeaEditorContext();
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.posts)), [], "the click must be queued, not dropped");
  bridge.injectBridge();
  bridge.fireReady();
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.posts)), [{ action: "addContext" }]);
});

test("duplicate queued capture requests collapse into a single host message", () => {
  const bridge = loadBridge();
  bridge.exports.requestIdeaEditorContext();
  bridge.exports.requestIdeaEditorContext();
  bridge.injectBridge();
  bridge.fireReady();
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.posts)), [{ action: "addContext" }]);
});

test("only the explicit ide_chrome parameter declares the native chrome host", () => {
  assert.equal(loadBridge({ search: "?ide_token=t&ide_theme=dark&ide_chrome=1" }).exports.isIdeaChromeHost(), true);
  assert.equal(loadBridge({ search: "?ide_token=t&ide_theme=dark" }).exports.isIdeaChromeHost(), false);
  assert.equal(loadBridge({ search: "?ide_chrome=0" }).exports.isIdeaChromeHost(), false);
  assert.equal(loadBridge({ search: "?ide_chrome=on" }).exports.isIdeaChromeHost(), false);
  assert.equal(loadBridge({ search: "" }).exports.isIdeaChromeHost(), false);
});

test("IDE code contexts still queue until the composer subscribes", () => {
  const bridge = loadBridge({ ready: true });
  bridge.window.ideaAgentReceiveContext("int captured = 1;");
  bridge.window.ideaAgentReceiveContext("   ");
  const seen = [];
  const unsubscribe = bridge.exports.subscribeIdeaContext((text) => seen.push(text));
  assert.deepEqual(seen, ["int captured = 1;"], "blank contexts stay ignored, real ones replay");
  bridge.window.ideaAgentReceiveContext("second");
  assert.deepEqual(seen, ["int captured = 1;", "second"]);
  unsubscribe();
});

test("console analysis preserves current/new targets across startup and ignores invalid targets", () => {
  const bridge = loadBridge();
  bridge.window.ideaAgentReceiveContext("original editor context");
  bridge.window.ideaAgentReceiveContext("new-session error", "new");
  bridge.window.ideaAgentReceiveContext("invalid", "send");
  const seen = [];
  const stop = bridge.exports.subscribeIdeaContext((text, target) => seen.push({ text, target }));
  assert.deepEqual(seen, [
    { text: "original editor context", target: "current" },
    { text: "new-session error", target: "new" },
  ]);
  stop();
  bridge.window.ideaAgentReceiveContext("wait during send", "new");
  bridge.exports.subscribeIdeaContext((text, target) => seen.push({ text, target }));
  assert.deepEqual(seen.at(-1), { text: "wait during send", target: "new" });
  assert.deepEqual(bridge.posts, [], "capturing context must not send anything to the runtime");
});

test("language changes are sent to native preferences and update the current host value", () => {
  const bridge = loadBridge({ ready: true });
  bridge.exports.persistIdeaLocale("zh-CN");
  assert.equal(bridge.window.ideaAgent.locale, "zh-CN");
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.posts)), [{ action: "setLocale", locale: "zh-CN" }]);
});

test("the latest language choice wins when the bridge loads after repeated changes", () => {
  const bridge = loadBridge();
  for (const locale of ["zh-CN", "en-US", "zh-CN"]) bridge.exports.persistIdeaLocale(locale);
  bridge.injectBridge();
  bridge.window.ideaAgent.locale = "en-US";
  bridge.fireReady();
  assert.equal(bridge.window.ideaAgent.locale, "zh-CN");
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.posts)), [{ action: "setLocale", locale: "zh-CN" }]);
});
