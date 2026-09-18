import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const gitDiffModel = path.join(import.meta.dirname, "../src/components/gitDiffModel.ts");
const compiled = ts.transpileModule(fs.readFileSync(gitDiffModel, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = { exports: {}, require };
vm.runInNewContext(compiled, sandbox);
const model = sandbox.exports;

const insertedFieldDiff = [
  "@@ -1,5 +1,6 @@",
  " err := uc.SendMessage(msgCtx, usecase.SendMessageInput{",
  "-  Content:   job.User.Content,",
  "-  ClientCtx: job.ClientCtx,",
  "+  Content:       job.User.Content,",
  "+  UserTimestamp: job.User.Timestamp,",
  "+  ClientCtx:     job.ClientCtx,",
  " })",
].join("\n");

const rows = model.buildSideBySideRows(model.buildDiffLines(insertedFieldDiff));
const changedRows = rows.filter((row) => row.kind === "change");
const sideBySideContextRows = rows.filter((row) => row.kind === "ctx");

assert.equal(changedRows.length, 1);
assert.equal(changedRows[0].left, undefined);
assert.equal(changedRows[0].right?.text.trimStart().startsWith("UserTimestamp:"), true);
assert.equal(
  sideBySideContextRows.some((row) => row.right?.text.trimStart().startsWith("Content:")),
  true,
);
assert.equal(
  sideBySideContextRows.some((row) => row.right?.text.trimStart().startsWith("ClientCtx:")),
  true,
);

const unifiedRows = model.buildUnifiedRows(model.buildDiffLines(insertedFieldDiff));
const contentRows = unifiedRows.filter((row) => row.kind !== "hunk" && row.line.kind !== "ctx");

assert.deepEqual(
  contentRows.map((row) => row.line.text.trimStart().split(/\s+/)[0]),
  ["UserTimestamp:"],
);
assert.deepEqual(
  contentRows.map((row) => row.counterpart?.text.trimStart().split(/\s+/)[0] || ""),
  [""],
);

const agentReplyDiff = [
  "--- a/session.go",
  "+++ b/session.go",
  "-  Content:   job.User.Content,",
  "-  ClientCtx: job.ClientCtx,",
  "+  Content:       job.User.Content,",
  "+  UserTimestamp: job.User.Timestamp,",
  "+  ClientCtx:     job.ClientCtx,",
].join("\n");

const agentReplyRows = model.buildDiffCodeRows(agentReplyDiff);
const agentReplyChangedRows = agentReplyRows.filter((row) => row.kind === "add" || row.kind === "del");

assert.deepEqual(
  agentReplyChangedRows.map((row) => row.text.trimStart().split(/\s+/)[0]),
  ["UserTimestamp:"],
);

const insertedArgument = model.getInlineDiffSegments(
  "streamHub.BroadcastSessionUserMessage(rootID, key, job.User.Content, job.ExcludeClientID)",
  "streamHub.BroadcastSessionUserMessageAt(rootID, key, job.User.Content, job.User.Timestamp, job.ExcludeClientID)",
);

assert.equal(
  insertedArgument.some((segment) => segment.kind === "add" && segment.text.includes("job.User.Timestamp")),
  true,
);

const prefixedContentDiff = [
  "--- a/Counter.java",
  "+++ b/Counter.java",
  "@@ -0,0 +1,2 @@",
  "+",
  "++++j;",
].join("\n");
const prefixedRows = model.buildDiffLines(prefixedContentDiff);

assert.deepEqual(
  prefixedRows.map((line) => ({ kind: line.kind, text: line.text, newLine: line.newLine })),
  [
    { kind: "hunk", text: prefixedContentDiff.split("\n")[2], newLine: undefined },
    { kind: "add", text: "", newLine: 1 },
    { kind: "add", text: "+++j;", newLine: 2 },
  ],
);
assert.equal(
  insertedArgument.some((segment) => segment.kind === "ctx" && segment.text.includes("job.User.Content")),
  true,
);
