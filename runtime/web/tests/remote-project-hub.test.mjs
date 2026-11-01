import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key), clear: () => values.clear() };
}
function load(file, context = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(`src/services/${file}.ts`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, ...context });
  return exports;
}

test("project HTTP/WS routes keep both node and project while host calls use only node", () => {
  const window = { location: { pathname: "/n/N/p/P/", protocol: "https:", origin: "https://relay.test" } };
  const scope = load("remoteScope", { window });
  const base = load("base", { window, require: name => name === "./remoteScope" ? scope : {
    getApiBaseURL: () => "", getWsBaseURL: () => "", isBrowserRuntime: () => true,
  } });
  assert.equal(base.appURL("/api/sessions"), "/n/N/p/P/api/sessions");
  assert.equal(base.wsURL("/ws"), "wss://relay.test/n/N/p/P/ws");
  assert.equal(base.hostPath("/api/remote/projects"), "/n/N/api/remote/projects");
  assert.equal(scope.remoteProjectPrefix("/n/N/p/P2/"), "/n/N/p/P2");
  assert.equal(scope.remoteProjectPrefix("/n/N/"), "");
});

test("project storage view isolates overlapping names, enumeration and deletion", () => {
  const raw = storage();
  const scope = load("remoteScope");
  const a = scope.scopedStorage(raw, "/n/N/p/P");
  const b = scope.scopedStorage(raw, "/n/N/p/P2");
  raw.setItem("mindfs.e2ee.secret.host", "host-key");
  a.setItem("last-root", "same"); b.setItem("last-root", "other");
  assert.equal(a.getItem("last-root"), "same");
  assert.equal(b.getItem("last-root"), "other");
  assert.equal(a.length, 1); assert.equal(a.key(0), "last-root");
  a.clear();
  assert.equal(b.getItem("last-root"), "other");
  assert.equal(raw.getItem("mindfs.e2ee.secret.host"), "host-key");
});

test("node E2EE secret persists, project secret remains in memory with separate identities", () => {
  const raw = storage();
  const api = load("e2ee", { window: { localStorage: raw }, require: () => ({ appURL: p => p }) });
  const host = new api.E2EEService(); const project = new api.E2EEService();
  host.configure(true, "host"); host.setSecret("host-key");
  project.useMemorySecret(); project.configure(true, "project"); project.setSecret("project-key");
  assert.equal(host.getSecret(), "host-key"); assert.equal(project.getSecret(), "project-key");
  assert.equal(raw.getItem("mindfs.e2ee.secret.project"), null);
  project.clearSecret(); assert.equal(host.getSecret(), "host-key");
  assert.equal(raw.length, 1);
});

test("remote drafts survive full navigation in their project and never restore another project's draft", () => {
  const sessionStorage = storage();
  function drafts(project) {
    return load("remoteDrafts", { window: { sessionStorage }, require: () => ({ remoteProjectPrefix: () => `/n/N/p/${project}` }) });
  }
  drafts("A").saveRemoteDrafts(new Map([["same-root-session", { text: "A draft" }]]));
  assert.equal(drafts("B").readRemoteDrafts().size, 0);
  drafts("B").saveRemoteDrafts(new Map([["same-root-session", { text: "B draft" }]]));
  assert.equal(drafts("A").readRemoteDrafts().get("same-root-session").text, "A draft");
  assert.equal(drafts("B").readRemoteDrafts().get("same-root-session").text, "B draft");
});

test("generated service worker never intercepts nested project HTTP or WS requests", () => {
  const source = readFileSync("vite.config.ts", "utf8");
  const start = source.indexOf("function buildServiceWorker(");
  const end = source.indexOf("function appShellHTMLPlugin()", start);
  const compiled = ts.transpileModule(source.slice(start, end) + '\n(globalThis).workerSource = buildServiceWorker([], "test");', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const buildContext = {};
  vm.runInNewContext(compiled, buildContext);
  const events = {};
  vm.runInNewContext(buildContext.workerSource, { URL, self: {
    registration: { scope: "https://relay.test/n/N/p/P/" },
    location: { origin: "https://relay.test", href: "https://relay.test/n/N/p/P/service-worker.js" },
    addEventListener: (type, handler) => { events[type] = handler; },
  } });
  for (const path of ["/n/N/p/P/api/sessions", "/n/N/p/P/ws", "/n/N/api/remote/projects", "/n/N/p/P/health"]) {
    let intercepted = false;
    events.fetch({ request: { method: "GET", url: "https://relay.test" + path }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});
