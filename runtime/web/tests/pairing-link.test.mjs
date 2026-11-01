import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const compile = file => ts.transpileModule(readFileSync(`src/services/${file}.ts`, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const linkSource = compile("pairingLink");
const bootstrapSource = compile("bootstrap");

function browser(href, { secrets = new Map(), node = "project-a", expectedSecret = "scan-key", offline = false, handshakeError = "", refreshError = "" } = {}) {
  let url = new URL(href);
  let required = false, configured = false, nodeId = "", unlocked = false, opens = 0;
  const requests = [];
  const listeners = new Set();
  const snapshot = () => ({ required, configured, nodeId, unlocked, secretPresent: secrets.has(nodeId) });
  const emit = () => listeners.forEach(listener => listener(snapshot()));
  const e2eeService = {
    snapshot, subscribe: listener => { listeners.add(listener); listener(snapshot()); },
    configure: (value, id) => { required = value; nodeId = id; configured = true; emit(); },
    isRequired: () => required, hasSecret: () => secrets.has(nodeId),
    setSecret: secret => { secrets.set(nodeId, secret); unlocked = false; emit(); },
    clearSecret: () => { secrets.delete(nodeId); unlocked = false; emit(); },
    clearSession: () => { unlocked = false; emit(); },
    ensureSession: async () => {
      if (unlocked) return;
      opens++;
      if (handshakeError) throw new Error(handshakeError);
      if (secrets.get(nodeId) !== expectedSecret) throw new Error("e2ee_proof_invalid");
      unlocked = true; emit();
    },
    parseProtectedJSONResponse: response => response.json(),
    protectedFetch: async target => {
      await e2eeService.ensureSession();
      assert.equal(unlocked, true, "business request must follow successful pairing");
      if (refreshError) throw new Error(refreshError);
      return fetch(target);
    },
  };
  async function fetch(target) {
    requests.push(target);
    if (offline) throw new Error("offline");
    return { ok: true, json: async () => ({ e2ee_required: true, e2ee_node_id: node }) };
  }
  const window = {
    get location() { return url; },
    history: { state: { preserved: true }, replaceState: (state, _, next) => {
      assert.equal(state.preserved, true); url = new URL(next);
    } },
  };
  const links = {};
  vm.runInNewContext(linkSource, { exports: links, URL, URLSearchParams, window });
  const bootstrap = {};
  vm.runInNewContext(bootstrapSource, {
    exports: bootstrap, fetch, Error,
    require: name => {
      if (name === "./pairingLink") return links;
      if (name === "./base") return { appPath: path => `/n/node${path}` };
      if (name === "./e2ee") return { e2eeService };
      throw new Error(name);
    },
  });
  return { links, service: bootstrap.bootstrapService, secrets, requests, rotate: value => { expectedSecret = value; unlocked = false; }, get url() { return url; }, get opens() { return opens; }, online: () => { offline = false; handshakeError = ""; refreshError = ""; } };
}

test("handshake and protected status failures preserve pairing and recover on manual retry", async () => {
  for (const failure of [{handshakeError:"Failed to fetch"}, {refreshError:"relay_status_failed_502"}]) {
    const b = browser("https://relay.test/n/node/#mindfs_pairing=scan-key", failure);
    const state = await b.service.start();
    assert.equal(state.phase, "error");
    assert.equal(state.error, Object.values(failure)[0]);
    assert.equal(b.secrets.get("project-a"), "scan-key");
    b.online();
    assert.equal((await b.service.start()).phase, "ready");
  }
});

test("manual pairing network failure also retains the submitted key", async () => {
  const b = browser("https://relay.test/n/node/", {handshakeError:"Failed to fetch"});
  assert.equal((await b.service.start()).phase, "needs_pairing");
  await assert.rejects(b.service.submitPairingSecret("scan-key"), /Failed to fetch/);
  assert.equal(b.service.snapshot().phase, "error");
  assert.equal(b.secrets.get("project-a"), "scan-key");
  b.online();
  assert.equal((await b.service.start()).phase, "ready");
});

test("QR grants automatic pairing, removes fragment and preserves unrelated URL state", async () => {
  const b = browser("https://relay.test/n/node/?root=project#mindfs_pairing=scan-key&section=chat");
  // Module construction must not consume a host QR before the entry router decides its scope.
  assert.ok(b.url.hash.includes("mindfs_pairing"));
  assert.equal((await b.service.start()).phase, "ready");
  assert.equal(b.url.href, "https://relay.test/n/node/?root=project#section=chat");
  assert.equal(b.opens, 1);
  assert.equal(b.secrets.get("project-a"), "scan-key");
  assert.ok(b.requests.every(url => !url.includes("scan-key") && !url.includes("mindfs_pairing")));
  const reopened = browser(b.url.href, { secrets: b.secrets });
  assert.equal((await reopened.service.start()).phase, "ready");
});

test("plain links and other projects still require pairing; invalid QR never bypasses authentication", async () => {
  const plain = browser("https://relay.test/n/node/");
  assert.equal((await plain.service.start()).phase, "needs_pairing");
  assert.equal(plain.opens, 0);
  const another = browser("https://relay.test/n/other/", { node: "project-b", secrets: new Map([["project-a", "scan-key"]]) });
  assert.equal((await another.service.start()).phase, "needs_pairing");
  const invalid = browser("https://relay.test/n/node/#mindfs_pairing=wrong");
  assert.equal((await invalid.service.start()).phase, "needs_pairing");
  assert.equal(invalid.secrets.size, 0);
});

test("network failure retains scanned authorization for the next bootstrap attempt", async () => {
  const b = browser("https://relay.test/n/node/#mindfs_pairing=scan-key", { offline: true });
  assert.equal((await b.service.start()).phase, "error");
  assert.equal(b.url.hash, "");
  b.online();
  assert.equal((await b.service.start()).phase, "ready");
});

test("QR data keeps credentials in a fragment and roundtrips encoded characters", async () => {
  const b = browser("https://relay.test/n/node/");
  const secret = "value+with/&=#characters";
  const url = new URL(b.links.buildPairingLink("https://relay.test/n/node/?root=project", secret));
  assert.equal(url.search, "?root=project");
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("mindfs_pairing"), secret);
  const scanned = browser(url.href, { expectedSecret: secret });
  assert.equal((await scanned.service.start()).phase, "ready");
  assert.equal(scanned.url.hash, "");
});

test("local IDEA pages do not consume QR authorization", async () => {
  const b = browser("http://127.0.0.1:1234/#mindfs_pairing=scan-key");
  assert.equal((await b.service.start()).phase, "needs_pairing");
  assert.equal(b.secrets.size, 0);
});


test("a replacement access link recovers an existing page even with an expired cached credential", async () => {
  const b = browser("https://relay.test/n/node/#mindfs_pairing=scan-key");
  assert.equal((await b.service.start()).phase, "ready");
  b.rotate("replacement-key");
  b.service.acceptPairingLinkSecret("replacement-key");
  assert.equal((await b.service.start()).phase, "ready");
  assert.equal(b.secrets.get("project-a"), "replacement-key");
  assert.equal(b.opens, 2);
});
