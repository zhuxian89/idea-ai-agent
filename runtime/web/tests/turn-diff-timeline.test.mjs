import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

const compiled = ts.transpileModule(fs.readFileSync("src/hooks/useSessionStream.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = {
  exports: {},
  require: (name) => {
    if (name === "react") return {};
    if (name === "../services/session") return { sessionService: {} };
    if (name === "../i18n") return { translateNow: () => "" };
    if (name === "../services/activityFacts") return { readActivityFacts: () => null };
    throw new Error(`unexpected import: ${name}`);
  },
};
vm.runInNewContext(compiled, sandbox);
const { buildBaseTimeline } = sandbox.exports;

test("the latest turn diff is placed after the final assistant text", () => {
  const timeline = buildBaseTimeline([
    { seq: 1, role: "user", content: "change it" },
    { seq: 2, role: "agent", content: "Done." },
  ], {
    2: [
      { seq: 2, line: 0, turn_diff: { turnId: "turn-1", diff: "old snapshot" } },
      { seq: 2, line: 0, turn_diff: { turnId: "turn-1", diff: "latest snapshot" } },
    ],
  });

  assert.deepEqual(Array.from(timeline, (item) => item.type), ["user_text", "assistant_text", "turn_diff"]);
  assert.equal(timeline[2].turnDiff.diff, "latest snapshot");
});

test("tool activity remains inline while the turn diff stays at the end", () => {
  const timeline = buildBaseTimeline([
    { seq: 1, role: "user", content: "change it" },
    { seq: 2, role: "agent", content: "Done." },
  ], {
    2: [
      { seq: 2, line: 0, toolcall: { callId: "edit-1", kind: "edit", status: "complete" } },
      { seq: 2, line: 0, turn_diff: { turnId: "turn-1", diff: "final diff" } },
    ],
  });

  assert.deepEqual(Array.from(timeline, (item) => item.type), ["user_text", "tool", "assistant_text", "turn_diff"]);
});
