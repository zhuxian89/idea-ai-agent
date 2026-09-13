import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

const sandbox = {exports: {}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/services/agentDefaults.ts", "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText, sandbox);

test("native new conversations inherit CLI defaults, including custom Agent aliases", () => {
  for (const protocol of ["codex-sdk", "claude-sdk"]) {
    const defaults = sandbox.exports.getAgentDefaults({name: "custom", protocol, current_model_id: "old-model", default_model_id: "cached-model", default_effort: "high", default_fast_service: "on"});
    assert.equal(defaults.model, "");
    assert.equal(defaults.effort, "");
    assert.equal(defaults.fastService, "");
  }
  assert.equal(sandbox.exports.getAgentDefaults({name: "acp", default_model_id: "saved"}).model, "saved");
});
