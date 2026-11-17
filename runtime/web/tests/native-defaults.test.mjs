import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

const sandbox = {exports: {}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/services/agentDefaults.ts", "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText, sandbox);

test("new conversations keep native model defaults and use first mode, high effort and fast off", () => {
  for (const protocol of ["codex-sdk", "claude-sdk"]) {
    const defaults = sandbox.exports.getAgentDefaults({name: "custom", protocol, current_model_id: "old-model", default_model_id: "cached-model", default_effort: "medium", default_fast_service: "on", supports_fast_service: true,
      efforts: ["low", "medium", "high"], modes: [{id: "first"}, {id: "second"}], current_mode_id: "second"});
    assert.equal(defaults.model, "");
    assert.equal(defaults.mode, "first");
    assert.equal(defaults.effort, "high");
    assert.equal(defaults.fastService, "off");
  }
  assert.equal(sandbox.exports.getAgentDefaults({name: "acp", default_model_id: "saved"}).model, "saved");
});

test("effort defaults respect the selected model's supported values", () => {
  const agent = {name: "acp", default_model_id: "normal", default_effort: "medium", efforts: ["low", "medium", "high"], models: [
    {id: "normal", supportEffort: true},
    {id: "limited", supportEffort: true, efforts: ["low", "medium"]},
    {id: "only-low", supportEffort: true, efforts: ["low"]},
  ]};
  assert.equal(sandbox.exports.getAgentDefaults(agent).effort, "high");
  assert.equal(sandbox.exports.getAgentDefaults(agent, "limited").effort, "medium");
  assert.equal(sandbox.exports.getAgentDefaults(agent, "only-low").effort, "low");
  assert.equal(sandbox.exports.getAgentDefaults({name: "no-options"}).effort, "");
});
