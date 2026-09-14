import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/services/activityFacts.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports });
const { readActivityFacts, mergeActivityFacts, mergeToolStatus } = exports;
const base = { schemaVersion: 1, agent: "codex", origin: "live", operation: "execute", source: "agent" };

test("wire validation handles unknown versions, malformed facts and native zero duration", () => {
  for (const invalid of [null, [], {}, { ...base, schemaVersion: 2 }, { ...base, agent: "unsupported" }, { ...base, agent: ["codex"] }, { ...base, agent: { toString: "codex" } }, { ...base, actions: [{ type: "read", path: 5 }] }, { ...base, tool: null }]) {
    assert.equal(readActivityFacts(invalid), undefined);
  }
  assert.equal(readActivityFacts({ ...base, durationMs: 0 }).durationMs, 0);
  for (const durationMs of [undefined, null, -1, NaN, Infinity, "100"]) {
    assert.equal(readActivityFacts({ ...base, outcome: "failed", durationMs }).durationMs, undefined);
    assert.equal(readActivityFacts({ ...base, outcome: "failed", durationMs }).outcome, "failed");
  }
});

test("partial updates preserve facts and terminal evidence, replacing actions only when supplied", () => {
  const initial = { ...base, actions: [{ type: "read", path: "README.md" }], tool: { name: "get", server: "files" } };
  const complete = mergeActivityFacts(initial, { outcome: "declined", durationMs: 0 });
  const replay = mergeActivityFacts(complete, { ...base, tool: { displayName: "Files" } });
  assert.equal(replay.outcome, "declined");
  assert.equal(replay.durationMs, 0);
  assert.equal(replay.tool.server, "files");
  assert.equal(replay.tool.displayName, "Files");
  assert.equal(replay.actions[0].path, "README.md");
  const replaced = mergeActivityFacts(replay, { actions: [], outcome: "cancelled" });
  assert.equal(replaced.actions.length, 0);
  assert.equal(replaced.outcome, "cancelled");
  for (const terminal of ["complete", "failed", "declined", "cancelled", "interrupted"]) {
    assert.equal(mergeToolStatus(terminal, "running"), terminal);
  }
  assert.equal(mergeToolStatus("failed", "complete"), "complete");
  replay.actions[0].path = "changed";
  assert.equal(initial.actions[0].path, "README.md");
});
