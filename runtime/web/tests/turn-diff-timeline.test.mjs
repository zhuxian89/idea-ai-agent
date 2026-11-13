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

const savedExchanges = [
  { seq: 3, role: "user", content: "change it" },
  { seq: 4, role: "agent", content: "Changed the file." },
];
const savedAux = {
  4: [{ seq: 4, line: 1, turn_diff: { turnId: "previous-turn", diff: "previous change" } }],
};

test("a streaming reply after sparse history never borrows the previous turn's aux", () => {
  // The display position of the new reply is 4, but persisted seq 4 belongs
  // to the previous reply. Both omitted seq and server transient seq=0 occur.
  for (const seq of [undefined, 0]) {
    const timeline = buildBaseTimeline([
      ...savedExchanges,
      { seq, role: "user", content: "explain it" },
      { seq, role: "agent", content: "Here is why." },
    ], savedAux);
    assert.deepEqual(Array.from(timeline, item => item.type), [
      "user_text", "assistant_text", "turn_diff", "user_text", "assistant_text",
    ]);
    assert.equal(timeline[2].turnDiff.turnId, "previous-turn");
  }
});

test("multiple streaming text blocks cannot look up saved aux by their display position", () => {
  const timeline = buildBaseTimeline([
    { seq: 5, role: "user", content: "change it" },
    { seq: 6, role: "agent", content: "Changed the file." },
    { role: "user", content: "explain it" },
    { role: "agent", content: "First explanation." },
    { role: "thought", content: "Checking." },
    { role: "agent", content: "Second explanation." },
    { role: "tool", toolCall: { callId: "read-1", kind: "read", status: "complete" } },
    { role: "agent", content: "Final explanation." },
  ], { 6: [{ ...savedAux[4][0], seq: 6 }] });
  assert.equal(timeline.filter(item => item.type === "turn_diff").length, 1);
  assert.equal(timeline.at(-1).content, "Final explanation.");
});

test("completed and reloaded replies keep only the diff saved under their own seq", () => {
  const exchanges = [
    ...savedExchanges,
    { seq: 5, role: "user", content: "explain it" },
    { seq: 6, role: "agent", content: "Here is why." },
    { seq: 7, role: "user", content: "change another file" },
    { seq: 8, role: "agent", content: "Changed another file." },
  ];
  const aux = { ...savedAux,
    8: [{ seq: 8, line: 1, turn_diff: { turnId: "new-turn", diff: "new change" } }],
  };
  const build = () => buildBaseTimeline(JSON.parse(JSON.stringify(exchanges)), JSON.parse(JSON.stringify(aux)));
  const timeline = build();
  assert.deepEqual(Array.from(timeline, item => item.type), [
    "user_text", "assistant_text", "turn_diff",
    "user_text", "assistant_text",
    "user_text", "assistant_text", "turn_diff",
  ]);
  assert.deepEqual(Array.from(timeline.filter(item => item.type === "turn_diff"), item => item.turnDiff.turnId), ["previous-turn", "new-turn"]);
  assert.deepEqual(build(), timeline);
});
