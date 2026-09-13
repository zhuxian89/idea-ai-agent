import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

const source = fs.readFileSync("src/components/ActionBar.tsx", "utf8");
const start = source.indexOf("  const handleKeyDown = useCallback(");
const end = source.indexOf("  const handleEditorEnter = useCallback(", start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(`${source.slice(start, end)}\nexports.handleKeyDown = handleKeyDown;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function keyboard({ compactWorkbench = true, candidates = [], composing = false, draft = "current draft" } = {}) {
  const state = { draft, historyCalls: 0, candidateIndex: 0 };
  const sandbox = {
    exports: {}, compactWorkbench, candidates, activeCandidateIndex: 0, activeToken: null,
    useCallback: (fn) => fn,
    isCompositionActive: () => composing,
    navigateInputHistory: () => { state.historyCalls += 1; state.draft = "previous message"; return true; },
    setActiveCandidateIndex: (update) => { state.candidateIndex = update(state.candidateIndex); },
    setCandidates: () => {}, applyCandidate: () => {},
  };
  vm.runInNewContext(compiled, sandbox);
  return {
    state,
    press: (key) => {
      const event = {
        key, nativeEvent: {}, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
        prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
      };
      sandbox.exports.handleKeyDown(event);
      return event;
    },
  };
}

test("IDE composer arrows never replace an empty, single-line, or multiline draft with history", () => {
  for (const draft of ["", "current draft", "first line\nsecond line"]) {
    const { state, press } = keyboard({ draft });
    for (const key of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown"]) {
      const event = press(key);
      assert.equal(event.prevented, false, "native caret movement must remain available");
      assert.equal(event.stopped, false);
      assert.equal(state.draft, draft);
      assert.equal(state.historyCalls, 0);
    }
  }
});

test("IDE completion candidates still support arrow navigation without replacing the draft", () => {
  const { state, press } = keyboard({ candidates: [{ id: "one" }, { id: "two" }] });
  assert.equal(press("ArrowDown").prevented, true);
  assert.equal(state.candidateIndex, 1);
  assert.equal(press("ArrowUp").prevented, true);
  assert.equal(state.candidateIndex, 0);
  assert.equal(state.historyCalls, 0);
  assert.equal(state.draft, "current draft");
});

test("IME composition keeps control of arrows", () => {
  const { state, press } = keyboard({ candidates: [{ id: "one" }], composing: true });
  assert.equal(press("ArrowUp").prevented, false);
  assert.equal(press("ArrowDown").prevented, false);
  assert.equal(state.historyCalls, 0);
});

test("non-IDE clients retain their existing input history behavior", () => {
  const { state, press } = keyboard({ compactWorkbench: false });
  assert.equal(press("ArrowUp").prevented, true);
  assert.equal(state.historyCalls, 1);
});
