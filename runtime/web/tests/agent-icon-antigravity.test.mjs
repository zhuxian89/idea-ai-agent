import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve("vite"))("esbuild");
const iconModule = { exports: {} };
const bundle = buildSync({
  stdin: { contents: 'export { AgentIcon } from "./src/components/AgentIcon";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
  external: ["react", "react/jsx-runtime"], define: { "process.env.NODE_ENV": '"production"' },
});
vm.runInNewContext(bundle.outputFiles[0].text, { module: iconModule, exports: iconModule.exports, require });

function renderIcon(agentName) {
  return renderToStaticMarkup(React.createElement(iconModule.exports.AgentIcon, { agentName, style: { width: 18, height: 18 } }));
}

// The initials fallback renders aria-label=<agent name>; a mapped icon never does.
test("antigravity renders its bundled icon instead of the initials fallback", () => {
  const markup = renderIcon("antigravity");
  assert.match(markup, /<img[^>]*src="[^"]*\/assets\/agents\/antigravity\.png"/);
  assert.match(markup, /alt="Antigravity"/);
  assert.doesNotMatch(markup, /aria-label="antigravity"/);
});

test("existing agent icons keep their mappings", () => {
  for (const name of ["gemini", "codex", "claude", "augment"]) {
    assert.doesNotMatch(renderIcon(name), new RegExp(`aria-label="${name}"`), `${name} must not fall back to initials`);
  }
});

// Real agy error text is JSON: {"code":-32000,"message":"Authentication required"}.
test("antigravity login error is classified as login, not a generic failure", async () => {
  const setup = await loadSetupModule();
  const agent = { name: "antigravity", installed: true, available: false, probe_pending: false, error: '{"code":-32000,"message":"Authentication required"}' };
  assert.equal(setup.agentSetupState(agent), "login");
  assert.equal(setup.agentSetupStatusKey(agent), "agent.loginRequired");
  const unrelated = { ...agent, error: "connection refused" };
  assert.equal(setup.agentSetupState(unrelated), "error");
});

test("antigravity uses the product display name", async () => {
  const setup = await loadSetupModule();
  assert.equal(setup.agentDisplayName("antigravity"), "Antigravity");
  assert.equal(setup.agentDisplayName("codex"), "Codex");
  assert.equal(setup.agentDisplayName("claude"), "Claude Code");
  assert.equal(setup.agentDisplayName("gemini"), "gemini");
});

async function loadSetupModule() {
  const setupBundle = buildSync({
    stdin: { contents: 'export * from "./src/services/agentSetup";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs",
  });
  const setupModule = { exports: {} };
  vm.runInNewContext(setupBundle.outputFiles[0].text, { module: setupModule, exports: setupModule.exports, require });
  return setupModule.exports;
}
