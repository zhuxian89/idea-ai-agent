import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve("vite"))("esbuild");
const activity = { exports: {} };
const bundle = buildSync({
  stdin: { contents: 'export { SessionActivity } from "./src/components/SessionActivity"; export { I18nProvider } from "./src/i18n";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
  external: ["react", "react/jsx-runtime"], define: { "process.env.NODE_ENV": '"production"' },
});
vm.runInNewContext(bundle.outputFiles[0].text, { module: activity, exports: activity.exports, require });

const question = (id, status) => ({ type: "tool", id, toolCall: { callId: id, kind: "ask_user", status, title: "Execution approval" } });
const bash = { type: "tool", id: "bash", toolCall: { callId: "bash", kind: "execute", status: "running", title: "Bash" } };
function renderActivity(...tools) {
  return renderToStaticMarkup(React.createElement(activity.exports.I18nProvider, null, React.createElement(activity.exports.SessionActivity, {
    timeline: [{ type: "user_text", id: "user", content: "Check the version", timestamp: new Date().toISOString() }, ...tools],
    lastEventAt: Date.now(), connected: true, recoveryText: "",
  })));
}

test("resolved approval stops waiting for an answer while the real command keeps running", () => {
  assert.match(renderActivity(question("approval-bash", "running"), bash), /等待你的回答/);
  const resolved = renderActivity(question("approval-bash", "complete"), bash);
  assert.doesNotMatch(resolved, /等待你的回答/);
  assert.match(resolved, /正在执行工具：运行命令/);
});

test("failed or canceled approvals do not leave the activity stuck waiting", () => {
  for (const status of ["failed", "canceled", "cancelled"]) {
    assert.doesNotMatch(renderActivity(question("approval-bash", status), bash), /等待你的回答/);
  }
});

test("resolving one approval does not hide a different unanswered question", () => {
  assert.match(renderActivity(question("approval-one", "complete"), question("approval-two", "running"), bash), /等待你的回答/);
  assert.doesNotMatch(renderActivity(question("approval-one", "complete"), question("approval-two", "complete"), bash), /等待你的回答/);
});
