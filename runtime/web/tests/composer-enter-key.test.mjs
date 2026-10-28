import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

const source = fs.readFileSync("src/components/ActionBar.tsx", "utf8");
const start = source.indexOf("  const handleEditorEnter = useCallback(");
const end = source.indexOf("  const handleEditorPaste = useCallback(", start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(`${source.slice(start, end)}\nexports.handleEditorEnter = handleEditorEnter;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function composer({ composing = false, candidates = [], activeCandidateIndex = 0, mode = "chat" } = {}) {
  const state = { sent: 0, applied: [] };
  const sandbox = {
    exports: {}, candidates, activeCandidateIndex, mode,
    useCallback: (fn) => fn,
    isCompositionActive: () => composing,
    applyCandidate: (candidate) => state.applied.push(candidate),
    handleSend: () => { state.sent += 1; },
  };
  vm.runInNewContext(compiled, sandbox);
  return {
    state,
    pressEnter: ({ shiftKey = false } = {}) => {
      const event = {
        shiftKey,
        prevented: false,
        stopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
      };
      const handled = sandbox.exports.handleEditorEnter(event);
      return { event, handled };
    },
  };
}

test("plain Enter always sends in chat and command modes", () => {
  for (const mode of ["chat", "command"]) {
    const { state, pressEnter } = composer({ mode });
    const { event, handled } = pressEnter();
    assert.equal(handled, true);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(state.sent, 1);
  }
});

test("Shift+Enter remains available for a newline", () => {
  const { state, pressEnter } = composer();
  const { event, handled } = pressEnter({ shiftKey: true });
  assert.equal(handled, false);
  assert.equal(event.prevented, false);
  assert.equal(state.sent, 0);
});

test("an active IME composition consumes only its own Enter", () => {
  const composing = composer({ composing: true });
  assert.equal(composing.pressEnter().handled, true);
  assert.equal(composing.state.sent, 0);

  const committed = composer({ composing: false });
  assert.equal(committed.pressEnter().handled, true);
  assert.equal(committed.state.sent, 1);
});

test("Enter still accepts a visible completion candidate before sending", () => {
  const candidate = { id: "one" };
  const { state, pressEnter } = composer({ candidates: [candidate] });
  assert.equal(pressEnter().handled, true);
  assert.deepEqual(state.applied, [candidate]);
  assert.equal(state.sent, 0);
});

test("composer has no time-based or mobile Enter gate", () => {
  const handler = source.slice(start, end);
  assert.doesNotMatch(handler, /compositionGuardUntilRef|mobileEnterKeySends|isMobile/);
});
