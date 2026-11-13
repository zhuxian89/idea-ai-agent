import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

function load(file, requires = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const sandbox = { exports: {}, require: (name) => {
    if (name in requires) return requires[name];
    throw new Error(`unexpected import: ${name}`);
  } };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports;
}

const { settingsChanges } = load("src/services/sessionSettingsChange.ts");
const { buildBaseTimeline } = load("src/hooks/useSessionStream.ts", {
  react: {},
  "../services/session": { sessionService: {} },
  "../i18n": { translateNow: () => "" },
  "../services/activityFacts": { readActivityFacts: () => null },
});

const settings = (patch = {}) => ({ model: "m1", modelName: "Model 1", effort: "high", fastService: "off", ...patch });
const plain = (value) => JSON.parse(JSON.stringify(value));

test("reports the model switch with display names", () => {
  assert.deepEqual(plain(settingsChanges(settings(), settings({ model: "m2", modelName: "Model 2" }))),
    [{ field: "model", from: "Model 1", to: "Model 2" }]);
});

test("falls back to the model id when there is no display name", () => {
  assert.deepEqual(plain(settingsChanges(settings({ modelName: "" }), settings({ model: "m2", modelName: "" }))),
    [{ field: "model", from: "m1", to: "m2" }]);
});

test("reports effort and fast mode changes together with the model", () => {
  assert.deepEqual(plain(settingsChanges(settings(), settings({ model: "m2", modelName: "Model 2", effort: "low", fastService: "on" }))), [
    { field: "model", from: "Model 1", to: "Model 2" },
    { field: "effort", from: "high", to: "low" },
    { field: "fastService", from: "off", to: "on" },
  ]);
});

test("an effort or fast mode reset to default is a change", () => {
  assert.deepEqual(plain(settingsChanges(settings(), settings({ effort: "", fastService: "" }))), [
    { field: "effort", from: "high", to: "" },
    { field: "fastService", from: "off", to: "" },
  ]);
});

test("identical settings report nothing", () => {
  assert.deepEqual(plain(settingsChanges(settings(), settings())), []);
});

test("an unrecorded model is not a model switch", () => {
  assert.deepEqual(plain(settingsChanges(settings({ model: "", modelName: "" }), settings())), []);
  assert.deepEqual(plain(settingsChanges(settings(), settings({ model: "", modelName: "" }))), []);
});

test("user messages keep the settings they were sent with", () => {
  const timeline = buildBaseTimeline([
    { seq: 1, role: "user", content: "hi", agent: "codex", model: "m1", model_display_name: "Model 1", effort: "high", fast_service: "off" },
  ], {});
  const user = timeline.find((item) => item.type === "user_text");
  assert.equal(user.model, "m1");
  assert.equal(user.modelDisplayName, "Model 1");
  assert.equal(user.effort, "high");
  assert.equal(user.fastService, "off");
});
