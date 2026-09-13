import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const activity = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/SessionActivity.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, {
  exports: activity.exports,
  require: (name) => name === "../i18n"
    ? { useI18n: () => ({ t: (key, values) => `${key}${values?.name ? `:${values.name}` : ""}` }) }
    : require(name),
});

const question = (id, status) => ({ type: "tool", id, toolCall: { callId: id, kind: "ask_user", status, title: "Execution approval" } });
const bash = { type: "tool", id: "bash", toolCall: { callId: "bash", kind: "execute", status: "running", title: "Bash" } };
function renderActivity(...tools) {
  return renderToStaticMarkup(React.createElement(activity.exports.SessionActivity, {
    timeline: [{ type: "user_text", id: "user", content: "Check the version", timestamp: new Date().toISOString() }, ...tools],
    lastEventAt: Date.now(), connected: true, recoveryText: "",
  }));
}

test("resolved approval stops waiting for an answer while the real command keeps running", () => {
  assert.match(renderActivity(question("approval-bash", "running"), bash), /session\.activityAnswer/);
  const resolved = renderActivity(question("approval-bash", "complete"), bash);
  assert.doesNotMatch(resolved, /session\.activityAnswer/);
  assert.match(resolved, /session\.activityTool:Bash/);
});

test("failed or canceled approvals do not leave the activity stuck waiting", () => {
  for (const status of ["failed", "canceled", "cancelled"]) {
    assert.doesNotMatch(renderActivity(question("approval-bash", status), bash), /session\.activityAnswer/);
  }
});

test("resolving one approval does not hide a different unanswered question", () => {
  assert.match(renderActivity(question("approval-one", "complete"), question("approval-two", "running"), bash), /session\.activityAnswer/);
  assert.doesNotMatch(renderActivity(question("approval-one", "complete"), question("approval-two", "complete"), bash), /session\.activityAnswer/);
});
