import assert from "node:assert/strict";
import test from "node:test";
import { plan } from "./release-plan.mjs";

const ok = {
  version: "0.1.65",
  targets: "all",
  mode: "draft",
  changes: "- x",
  refName: "standalone-0.1.65",
  defaultVersion: "0.1.64",
  notesFileExists: false,
};

test("a valid request becomes a plan across draft, prerelease and formal modes", () => {
  const r = plan(ok);
  assert.deepEqual(r.problems, []);
  assert.equal(r.targets.length, 6);
  assert.equal(r.mode, "draft");
  assert.deepEqual(plan({ ...ok, refName: "main", mode: "formal" }).problems, []);
  assert.deepEqual(plan({ ...ok, targets: "macos-arm64", mode: "prerelease" }).targets, ["macos-arm64"]);
  assert.deepEqual(plan({ ...ok, version: "0.1.65-standalone.1", refName: "standalone-0.1.65-standalone.1" }).problems, []);
  assert.deepEqual(plan({ ...ok, changes: "", notesFileExists: true }).problems, [], "notes may come from a committed file");
});

test("requests that must not release anything are refused", () => {
  assert.match(plan({ ...ok, version: "v0.1.65" }).problems[0], /not a version/);
  assert.match(plan({ ...ok, version: "0.1.64" }).problems[0], /never reused/);
  assert.match(plan({ ...ok, refName: "standalone-0.1.63" }).problems[0], /does not match version/);
  assert.match(plan({ ...ok, refName: "feature/test" }).problems[0], /does not match version/);
  assert.match(plan({ ...ok, mode: "invalid" }).problems[0], /unknown mode/);
  assert.match(plan({ ...ok, mode: "formal", targets: "macos-arm64" }).problems[0], /formal mode updates/);
  assert.match(plan({ ...ok, targets: "macos-arm64,beos" }).problems[0], /unknown target\(s\): beos/);
  assert.match(plan({ ...ok, changes: "  ", notesFileExists: false }).problems[0], /no release notes/);
  assert.equal(
    plan({ version: "", targets: "all", changes: "", refName: "", defaultVersion: "0.1.64", notesFileExists: false }).problems.length,
    3,
  );
});
