import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

test("task load errors have their own classification and preserve diagnostic details", () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync("src/services/error.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: () => ({ translateNow: key => key }) });
  const error = exports.errorService.fromCode("task.load_failed");
  assert.equal(error.code, "task.load_failed");
  assert.equal(error.messageKey, "task.loadFailed");
  assert.equal(error.severity, "error");
  assert.equal(error.recoverable, true);
  const message = "SQL logic error: no such column: template_snapshot_json (1)";
  assert.equal(exports.errorService.fromCode("task.load_failed", message).message, message);
});

test("startup task loading never reports a file write failure", () => {
  const source = readFileSync("src/App.tsx", "utf8");
  const start = source.indexOf("const loadKanbanTasks =");
  assert.ok(start >= 0);
  // Capture through the task-specific error fallback, independent of inner const declarations.
  const fallback = source.indexOf('t("task.loadFailed")', start);
  assert.ok(fallback > start);
  const handler = source.slice(start, fallback);
  assert.match(handler, /reportError\("task\.load_failed"/);
  assert.doesNotMatch(handler, /reportError\("file\.write_failed"/);
});
