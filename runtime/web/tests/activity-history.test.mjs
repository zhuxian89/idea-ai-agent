import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Real browser IndexedDB + production cache/stream/card code. Native fixture
// inputs are projected by the actual Go importers without starting either CLI.
const webDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const reportDir = path.resolve(webDir, "../../build/reports/activity-history-parity");

test("historical activity survives backfill, IndexedDB reload and mixed-agent session switching", async t => {
  mkdirSync(reportDir, { recursive: true });
  execFileSync("go", ["test", "./server/internal/agent/codex", "./server/internal/agent/claude", "-run", "^TestImportedActivityFixtures$", "-count=1"], {
    cwd: path.resolve(webDir, ".."), env: { ...process.env, ACTIVITY_HISTORY_FIXTURE_DIR: reportDir }, stdio: "pipe",
  });
  const codex = JSON.parse(readFileSync(path.join(reportDir, "codex.json"), "utf8"));
  const claude = JSON.parse(readFileSync(path.join(reportDir, "claude.json"), "utf8"));
  const compact = call => ({ ...call, content: undefined, meta: { ...call.meta, output: undefined } });
  const exchanges = [
    { seq: 1, role: "user", content: "检查项目文档", agent: "codex", timestamp: "2026-09-14T01:00:00Z" },
    { seq: 2, role: "agent", content: "我先查看项目说明。", agent: "codex" },
    { seq: 3, role: "agent", content: "继续搜索相关实现。", agent: "claude" },
    { seq: 4, role: "user", content: "再查一下关联问题", agent: "claude", timestamp: "2026-09-14T01:00:05Z" },
    { seq: 5, role: "agent", content: "检查完成，相关信息如下。", agent: "claude" },
  ];
  const full = {
    key: "mixed", type: "chat", name: "History fixture", agent: "codex", activity_history_version: 1, reply_metadata_version: 1,
    exchanges, exchange_aux: {
      "2": [{ seq: 2, line: 1, toolcall: compact(codex.native) }],
      "3": [{ seq: 3, line: 1, toolcall: compact(claude.b) }],
      "5": [{ seq: 5, line: 0, toolcall: compact(claude.f) }],
    },
  };
  const old = {
    ...full, activity_history_version: undefined,
    exchange_aux: { "2": [{ seq: 2, line: 1, toolcall: { ...compact(codex.native), activity: undefined } }] },
  };
  const bundle = await build({
    stdin: { resolveDir: webDir, sourcefile: "activity-history-fixture.tsx", loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { I18nProvider } from "./src/i18n";
      import { getCachedSession, syncSession, sessionService } from "./src/services/session";
      import { mergeHistoryAux } from "./src/services/sessionHistory";
      import { useSessionStream } from "./src/hooks/useSessionStream";
      import { buildToolActivityView } from "./src/services/toolActivity";
      import { ToolCallCard } from "./src/components/stream/ToolCallCard";
      import { MarkdownViewer } from "./src/components/MarkdownViewer";
      window.mergeHistoryAux = mergeHistoryAux;
      window.detailRequests = [];
      window.networkRequests = [];
      window.projectActivity = buildToolActivityView;
      sessionService.getToolCallDetails = async ({ rootId, sessionKey, callId }) => {
        window.detailRequests.push({ rootId, sessionKey, callId });
        return window.details[callId] ? { kind: "loaded", toolCall: window.details[callId] } : { kind: "missing" };
      };
      const get = async (kind, key, seq) => {
        window.networkRequests.push({ kind, key, seq });
        try { const response = await fetch('/fixture/' + kind + '?key=' + key + '&seq=' + seq); return response.ok ? await response.json() : null; }
        catch { return null; }
      };
      sessionService.syncExternalSession = (root, key, seq) => get('full', key, seq);
      sessionService.getSession = (root, key, seq) => get('delta', key, seq);
      function App() {
        const [session, setSession] = useState(null);
        const state = useSessionStream(session?.key || '', session?.exchanges || [], session?.exchange_aux || {}, undefined, false);
        window.timeline = state.timeline;
        window.snapshot = session;
        window.showCached = async key => { const value = await getCachedSession('root', key); setSession(value); return value; };
        window.syncFixture = async (key = 'mixed', full = false) => { const value = await syncSession('root', key, { full }); setSession(value.session); return value; };
        window.showSession = setSession;
        return <I18nProvider><main className="idea-workbench" id="history-fixture">
          {state.timeline.map(item => item.type === 'tool' ? <div key={item.id} data-call={item.toolCall.callId} data-agent={item.agent || ''} data-turn={item.sourceTurnKey || ''}>
            <ToolCallCard {...item.toolCall} rootId="root" sessionKey={session.key} rootPath="/project" agent={item.agent} sourceTurnKey={item.sourceTurnKey}/>
          </div> : item.type === 'user_text' || item.type === 'assistant_text' ? <div key={item.id} data-message={item.type}><MarkdownViewer content={item.content}/></div> : null)}
        </main></I18nProvider>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, outdir: "/tmp/activity-history-fixture", platform: "browser", format: "iife", jsx: "automatic",
    external: ["mermaid"], loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
  });
  const styles = ["src/index.css", "src/ide.css"].map(file => readFileSync(path.join(webDir, file), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, "")).join("\n");
  const css = bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n");
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  let failFull = false;
  let nextFull = full;
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/fixture/")) {
      const isFull = url.pathname.endsWith("/full");
      if (isFull && failFull) { response.writeHead(503); response.end(); return; }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(isFull ? nextFull : { ...full, activity_history_version: undefined, exchanges: [], exchange_aux: {} }));
      return;
    }
    if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>' + styles + css + '\n#history-fixture { padding: 20px 16px; } #history-fixture > div { margin-bottom: 12px; }</style></head><body><div id="root"></div><script>window.details=' + JSON.stringify({ ...codex, ...claude }) + '</script><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 375, height: 760 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => !!window.showCached);
  await page.evaluate(async oldSession => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("mindfs-session-cache", 4);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("sessions", { keyPath: "cacheKey" });
        request.result.createObjectStore("session-lists", { keyPath: "cacheKey" });
        request.result.createObjectStore("drafts");
      };
      request.onsuccess = () => resolve(request.result); request.onerror = reject;
    });
    await new Promise(resolve => {
      const tx = db.transaction(["sessions", "drafts"], "readwrite");
      tx.objectStore("sessions").put({ cacheKey: "root::mixed", rootId: "root", sessionKey: "mixed", touchedAt: 0, session: oldSession });
      tx.objectStore("sessions").put({ cacheKey: "root::other", rootId: "root", sessionKey: "other", touchedAt: 0, session: { ...oldSession, key: "other", exchange_aux: {} } });
      tx.objectStore("drafts").put("keep my draft", "draft");
      tx.oncomplete = resolve;
    });
    db.close();
    await window.showCached("mixed");
  }, old);
  await expect(page.locator("[data-call]")).toHaveCount(1);
  await page.evaluate(() => window.syncFixture());
  await expect(page.locator("[data-call]")).toHaveCount(3);
  assert.deepEqual(await page.evaluate(() => window.networkRequests), [{ kind: "full", key: "mixed", seq: 0 }]);
  assert.deepEqual(await page.locator("[data-call]").evaluateAll(nodes => nodes.map(node => node.dataset.agent)), ["codex", "claude", "claude"]);
  await expect(page.locator('[data-call="native"]')).toContainText("读取 README.md");
  await expect(page.locator('[data-call="b"]')).toContainText("activity");
  const summaries = await page.locator("[data-call]").allTextContents();
  const identity = await page.locator("[data-call]").evaluateAll(nodes => nodes.map(node => ({ call: node.dataset.call, agent: node.dataset.agent, turn: node.dataset.turn })));
  assert.equal(identity[0].turn, '["native","codex","turn-1"]');
  assert.equal(identity[1].turn, "user:1");
  assert.equal(identity[2].turn, "user:4");
  assert.deepEqual(await page.evaluate(() => window.detailRequests), []);
  await page.screenshot({ path: path.join(reportDir, "light-375-history.png"), fullPage: true });
  await page.evaluate(() => window.showCached("other"));
  await expect(page.locator("[data-call]")).toHaveCount(0);
  await page.evaluate(() => window.showCached("mixed"));
  await expect(page.locator("[data-call]")).toHaveCount(3);
  await page.reload();
  await page.waitForFunction(() => !!window.showCached);
  await page.evaluate(() => window.showCached("mixed"));
  await expect(page.locator("[data-call]")).toHaveCount(3);
  assert.deepEqual(await page.locator("[data-call]").allTextContents(), summaries);
  await page.evaluate(() => window.syncFixture());
  assert.deepEqual(await page.evaluate(() => window.networkRequests), [{ kind: "delta", key: "mixed", seq: 5 }]);
  await page.evaluate(() => window.syncFixture("mixed", true));
  await expect(page.locator("[data-call]")).toHaveCount(3);
  assert.deepEqual(await page.locator("[data-call]").allTextContents(), summaries);
  await page.setViewportSize({ width: 720, height: 760 });
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  await page.screenshot({ path: path.join(reportDir, "dark-720-history.png"), fullPage: true });
  assert.deepEqual(await page.evaluate(() => window.detailRequests), []);
  await page.locator('[data-call="native"] button[aria-expanded]').click();
  await expect(page.locator('[data-call="native"]')).toContainText("documentation");
  assert.equal(await page.evaluate(() => window.detailRequests.length), 1);

  // No native log/network: retain the saved data and retry reconciliation later.
  failFull = true;
  await page.evaluate(() => window.syncFixture("other", true));
  assert.equal(await page.evaluate(() => window.snapshot.activity_history_version), undefined);
  failFull = false;
  nextFull = { ...full, key: "other" };
  await page.evaluate(() => window.syncFixture("other"));
  assert.equal(await page.evaluate(() => window.snapshot.activity_history_version), 1);
  await context.setOffline(true);
  await page.evaluate(() => window.syncFixture("mixed"));
  await expect(page.locator("[data-call]")).toHaveCount(3);
  await context.setOffline(false);
  const persisted = await page.evaluate(async () => {
    const request = indexedDB.open("mindfs-session-cache", 4);
    const db = await new Promise(resolve => request.onsuccess = () => resolve(request.result));
    const draft = await new Promise(resolve => { const request = db.transaction("drafts").objectStore("drafts").get("draft"); request.onsuccess = () => resolve(request.result); });
    const result = { version: db.version, draft, stores: [...db.objectStoreNames] }; db.close(); return result;
  });
  assert.equal(persisted.version, 4);
  assert.equal(persisted.draft, "keep my draft");
  assert.deepEqual(persisted.stores, ["drafts", "session-lists", "sessions"]);

  // Legacy tools use their exchange owner, while supported native facts win.
  // Missing user seq/agent/call ID stays missing, independent of the selector.
  await page.evaluate(() => window.showSession({
    key: "ownership", agent: "codex", exchanges: [
      { seq: 1, role: "user", content: "same user", agent: "codex" },
      { seq: 2, role: "agent", agent: "claude", content: "legacy owner" },
      { role: "user", content: "unsaved user" },
      { role: "tool", toolCall: { callId: "", kind: "read", status: "complete", title: "unknown" } },
    ], exchange_aux: { "2": [
      { seq: 2, toolcall: { callId: "legacy", kind: "read", status: "complete", title: "README.md" } },
      { seq: 2, toolcall: { callId: "native-owner", kind: "read", status: "complete", title: "README.md", activity: { schemaVersion: 1, agent: "codex", origin: "imported", operation: "read", source: "agent", nativeTurnId: "explicit" } } },
      { seq: 2, toolcall: { callId: "future", kind: "read", status: "complete", title: "README.md", activity: { schemaVersion: 99, agent: "codex" } } },
    ] },
  }));
  await expect(page.locator("[data-call]")).toHaveCount(4);
  assert.deepEqual(await page.locator("[data-call]").evaluateAll(nodes => nodes.map(node => [node.dataset.agent, node.dataset.turn])), [
    ["claude", "user:1"], ["codex", '["native","codex","explicit"]'], ["claude", "user:1"], ["", ""],
  ]);
  const refs = await page.evaluate(() => {
    const tool = window.timeline.find(item => item.type === "tool" && !item.toolCall.callId);
    return window.projectActivity(tool.toolCall, { rootId: "root", sessionKey: "ownership", locale: "zh-CN", requiresInteraction: false }).ref;
  });
  assert.equal(refs, undefined);
  const merged = await page.evaluate(() => {
    const call = { callId: "terminal", kind: "read", status: "failed", activity: { schemaVersion: 1, agent: "claude", origin: "imported", operation: "read", source: "agent", outcome: "failed", actions: [{ type: "read", path: "README.md" }] } };
    const base = [{ seq: 2, toolcall: call }, { seq: 2, toolcall: call }];
    const next = [{ seq: 2, toolcall: { callId: "terminal", kind: "read", status: "running", activity: { actions: [] } } }];
    return window.mergeHistoryAux(base, next);
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].toolcall.status, "failed");
  assert.equal(merged[0].toolcall.activity.outcome, "failed");
  assert.deepEqual(merged[0].toolcall.activity.actions, []);
  assert.deepEqual(await page.evaluate(() => {
    const entry = id => ({ seq: 2, toolcall: { callId: id, kind: "read", status: "complete" } });
    return window.mergeHistoryAux([entry("a"), entry("b"), entry("b")], [entry("c"), entry("a"), entry("d"), entry("b")]).map(item => item.toolcall.callId);
  }), ["c", "a", "d", "b"]);
  assert.deepEqual(errors, []);
  await context.close();
});
