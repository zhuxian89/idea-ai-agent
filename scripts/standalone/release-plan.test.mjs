import assert from "node:assert/strict";
import test from "node:test";
import { plan } from "./release-plan.mjs";

const ok = { version: "0.1.64", targets: "all", changes: "- x", refName: "standalone-0.1.64", defaultVersion: "0.1.60", notesFileExists: false };

test("a valid request becomes a plan", () => {
  const r = plan(ok);
  assert.deepEqual(r.problems, []);
  assert.equal(r.targets.length, 6);
  assert.deepEqual(plan({ ...ok, targets: "macos-arm64" }).targets, ["macos-arm64"]);
  assert.deepEqual(plan({ ...ok, version: "0.1.64-standalone.1", refName: "standalone-0.1.64-standalone.1" }).problems, []);
  assert.deepEqual(plan({ ...ok, changes: "", notesFileExists: true }).problems, [], "notes may come from a committed file");
});

test("requests that must not release anything are refused", () => {
  assert.match(plan({ ...ok, version: "v0.1.64" }).problems[0], /not a version/);
  assert.match(plan({ ...ok, version: "0.1.60" }).problems[0], /never reused/);
  assert.match(plan({ ...ok, refName: "main" }).problems[0], /never from main/);
  assert.match(plan({ ...ok, refName: "standalone-0.1.63" }).problems[0], /does not match version/);
  assert.match(plan({ ...ok, targets: "macos-arm64,beos" }).problems[0], /unknown target\(s\): beos/);
  assert.match(plan({ ...ok, changes: "  ", notesFileExists: false }).problems[0], /no release notes/);
  assert.equal(plan({ version: "", targets: "all", changes: "", refName: "", defaultVersion: "0.1.60", notesFileExists: false }).problems.length, 3);
});
