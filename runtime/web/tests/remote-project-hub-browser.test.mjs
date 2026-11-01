import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("one computer pairing opens A/B with isolated drafts and revoked access hides business content", async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { RemoteHostShell } from "./src/components/remote/RemoteHostShell";
      import { I18nProvider } from "./src/i18n";
      import { E2EEService, e2eeService } from "./src/services/e2ee";
      import { appURL } from "./src/services/base";
      import { remoteProjectId } from "./src/services/remoteScope";
      import { useIdeaComposerContext } from "./src/hooks/useIdeaComposerContext";
      import "./src/index.css";
      E2EEService.prototype.ensureSession = async function() {
        if (!this.hasSecret()) throw new Error("e2ee_secret_missing");
        return {};
      };
      E2EEService.prototype.protectedJSON = async function(url, init) {
        await this.ensureSession();
        const response = await fetch(url, init);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload;
      };
      e2eeService.setClientId("project-browser");
      window.projectCrypto = e2eeService;
      function Workbench() {
        const [draft, setDraft] = useState({text:"",attachments:[]});
        useIdeaComposerContext({rootId:"same-root",sessionKey:"same-session",busy:false,draft,write:setDraft});
        return <section aria-label="Project business">
          <h2>Project {remoteProjectId()}</h2>
          <textarea aria-label="Message draft" value={draft.text} onChange={event => setDraft({text:event.target.value,attachments:[]})} />
          <output>{appURL("/api/sessions")}</output>
        </section>;
      }
      createRoot(document.getElementById("root")).render(<I18nProvider><RemoteHostShell><Workbench /></RemoteHostShell></I18nProvider>);
    ` }, bundle: true, write: false, outdir: "/tmp/idea-remote-hub-browser", format: "iife", jsx: "automatic",
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "en-US", viewport: { width: 390, height: 844 } });
  const errors = []; const accesses = [];
  page.on("pageerror", error => errors.push(error.message));
  let disabled = false; let failStatus = false; let statusRequests = 0;
  let catalogRequests = 0; let holdNextCatalog = false; let releaseCatalog;
  await page.route("https://hub.test/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/fixture.js") return route.fulfill({contentType:"text/javascript",body:script});
    if (path === "/fixture.css") return route.fulfill({contentType:"text/css",body:css});
    let payload;
    if (path === "/n/N/api/relay/status") {
      statusRequests++;
      if (failStatus) return route.fulfill({status:503,body:"offline"});
    }
    if (path === "/n/N/api/relay/status") payload = {remote_host:true,e2ee_required:true,e2ee_node_id:"host-N",node_name:"My PC"};
    else if (path === "/n/N/api/remote/projects") {
      catalogRequests++;
      if (holdNextCatalog) {
        holdNextCatalog = false;
        await new Promise(resolve => { releaseCatalog = resolve; });
        payload = {projects:[]}; // Stale response from before the explicit reconnect.
      } else payload = {projects:[
        {project_id:"A",name:"Project A",label:"first",availability:"online"},
        {project_id:"B",name:"Project B",label:"second",availability:"online"},
        {project_id:"C",name:"Project C",label:"third",availability:"closed"},
      ]};
    }
    else if (/\/api\/remote\/projects\/[AB]\/access$/.test(path)) {
      const id = path.split("/").at(-2); accesses.push(id);
      payload = {project_id:id,e2ee_node_id:`project-${id}`,pairing_secret:`project-key-${id}`};
    }
    if (payload) {
      if (disabled && path !== "/n/N/api/relay/status") return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"remote_access_disabled"})});
      return route.fulfill({contentType:"application/json",body:JSON.stringify(payload)});
    }
    if (path.includes("/api/")) throw new Error(`Unexpected API ${path}`);
    return route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'});
  });
  await page.goto("https://hub.test/n/N/p/A/#mindfs_pairing=computer-key");
  await expect(page.getByRole("heading",{name:"Project A",exact:true})).toBeVisible();
  assert.equal(new URL(page.url()).hash, "");
  await expect(page.getByRole("textbox",{name:"Pairing key"})).toHaveCount(0);
  await expect(page.locator("output")).toHaveText("https://hub.test/n/N/p/A/api/sessions");
  await page.getByRole("textbox",{name:"Message draft"}).fill("unsent A");
  await page.getByRole("button",{name:"Project A ▾"}).click();
  await expect(page.getByRole("button",{name:/Project C/})).toBeDisabled();
  await page.getByRole("button",{name:/Project B/}).click();
  await expect(page.getByRole("heading",{name:"Project B",exact:true})).toBeVisible();
  await expect(page.getByRole("textbox",{name:"Message draft"})).toHaveValue("");
  await page.getByRole("textbox",{name:"Message draft"}).fill("unsent B");
  await page.getByRole("button",{name:"Project B ▾"}).click();
  await page.getByRole("button",{name:/Project A/}).click();
  await expect(page.getByRole("textbox",{name:"Message draft"})).toHaveValue("unsent A");
  const secrets = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("mindfs.e2ee.secret.")));
  assert.deepEqual(secrets, ["mindfs.e2ee.secret.host-N"]);
  assert.deepEqual(accesses, ["A","B","A"]);
  await page.screenshot({path:"/tmp/idea-remote-hub-project-mobile.png"});
  disabled = true;
  await expect(page.getByRole("region",{name:"Project business"})).toHaveCount(0,{timeout:8000});
  await expect(page.getByRole("alert")).toHaveText("Remote access is disabled on this computer.");
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => localStorage.getItem("mindfs.e2ee.secret.host-N")), "computer-key");
  disabled = false;
  await page.evaluate(() => localStorage.removeItem("mindfs.e2ee.secret.host-N"));
  await page.goto("https://hub.test/n/N/");
  await expect(page.getByRole("heading", {name:"Use the access link from IDEA"})).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  await expect(page.getByRole("button", {name:/Project A/})).toHaveCount(0);
  assert.deepEqual(accesses, ["A","B","A"]);
  await page.goto("https://hub.test/n/N/#mindfs_pairing=computer-key");
  await expect(page.getByRole("button", {name:/Project A/})).toBeVisible();
  await expect(page.getByRole("button", {name:/Project C/})).toBeDisabled();
  assert.deepEqual(errors, []);
  failStatus = true;
  await page.goto("https://hub.test/n/N/p/A/");
  await expect(page.getByRole("alert")).toHaveText("Your computer is offline. Keep it online with IDEA running.");
  await expect(page.getByLabel("Pairing key", {exact:true})).toHaveCount(0);
  const failedRequests = statusRequests;
  await page.waitForTimeout(300);
  assert.equal(statusRequests, failedRequests);
  failStatus = false;
  await page.getByRole("button",{name:"Retry",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Project A",exact:true})).toBeVisible();
  await expect(page.getByRole("textbox",{name:"Message draft"})).toHaveValue("unsent A");
  assert.deepEqual(errors, []);
  await page.clock.install();
  holdNextCatalog = true;
  await page.getByRole("button",{name:"Project A ▾"}).click();
  await expect.poll(() => typeof releaseCatalog).toBe("function");
  const pendingReads = catalogRequests;
  await page.clock.fastForward(16000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  assert.equal(catalogRequests, pendingReads, "a slow directory request must not overlap polling or menu refreshes");
  await page.evaluate(() => window.projectCrypto.clearSecret());
  await expect(page.getByRole("region",{name:"Project business"})).toHaveCount(0);
  await page.getByRole("button",{name:"Retry",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Project A",exact:true})).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.url().endsWith("/api/remote/projects"));
  releaseCatalog();
  await oldResponse;
  await page.waitForTimeout(100);
  await expect(page.getByRole("heading",{name:"Project A",exact:true})).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  assert.deepEqual(errors, []);
});

test("actual App bootstrap preserves the project's in-memory key after the host shell handshake", async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { App } from "./src/App";
      import { RemoteHostShell } from "./src/components/remote/RemoteHostShell";
      import { I18nProvider } from "./src/i18n";
      import { E2EEService, e2eeService } from "./src/services/e2ee";
      import { remoteHostE2EE } from "./src/services/remoteHost";
      import { bootstrapService } from "./src/services/bootstrap";
      const unlocked = new Set();
      const snapshot = E2EEService.prototype.snapshot;
      E2EEService.prototype.snapshot = function() { return {...snapshot.call(this),unlocked:unlocked.has(this)&&this.hasSecret()}; };
      E2EEService.prototype.ensureSession = async function() {
        if (!this.hasSecret()) throw new Error("e2ee_secret_missing");
        unlocked.add(this); return {};
      };
      E2EEService.prototype.protectedFetch = async function(url,init) { await this.ensureSession(); return fetch(url,init); };
      E2EEService.prototype.parseProtectedJSONResponse = response => response.json();
      window.bootstrap = bootstrapService; window.projectCrypto = e2eeService; window.hostCrypto = remoteHostE2EE;
      createRoot(document.getElementById("root")).render(<I18nProvider><RemoteHostShell><App /></RemoteHostShell></I18nProvider>);
    ` }, bundle: true, write: false, outdir: "/tmp/idea-remote-hub-app", format: "iife", jsx: "automatic",
    loader: { ".css": "empty", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  });
  const browser = await chromium.launch({headless:true,channel:"chrome"});
  t.after(() => browser.close());
  const page = await browser.newPage({locale:"en-US"});
  const errors=[]; const requests=[];
  page.on("pageerror", error=>errors.push(error.message));
  await page.route("https://app-hub.test/**",route=> {
    const path=new URL(route.request().url()).pathname;
    if(!path.includes("/api/")) return route.fulfill({contentType:"text/html",body:'<!doctype html><html><body><div id="root"></div></body></html>'});
    requests.push(path);
    const payload=path==="/n/N/api/relay/status" ? {remote_host:true,e2ee_required:true,e2ee_node_id:"host-N"}
      : path==="/n/N/api/remote/projects" ? {projects:[{project_id:"A",name:"A",label:"",availability:"online"}]}
      : path.endsWith("/projects/A/access") ? {project_id:"A",e2ee_node_id:"project-A",pairing_secret:"project-key"}
      : path==="/n/N/p/A/api/relay/status" ? {e2ee_required:true,e2ee_node_id:"project-A",no_relayer:true}
      : {dirs:[],agents:[],shells:[],tasks:[],templates:[],items:[]};
    return route.fulfill({contentType:"application/json",body:JSON.stringify(payload)});
  });
  await page.goto("https://app-hub.test/n/N/p/A/#mindfs_pairing=host-key");
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith(".js")).text});
  await expect.poll(()=>page.evaluate(()=>window.bootstrap.snapshot().phase)).toBe("ready");
  assert.deepEqual(await page.evaluate(()=>({
    host:window.hostCrypto.getSecret(), project:window.projectCrypto.getSecret(),
    node:window.projectCrypto.snapshot().nodeId,
    persistentProject:localStorage.getItem("mindfs.e2ee.secret.project-A"),
    separateClients:window.projectCrypto.currentClientId()!==window.hostCrypto.currentClientId(),
  })),{host:"host-key",project:"project-key",node:"project-A",persistentProject:null,separateClients:true});
  assert.ok(requests.includes("/n/N/p/A/api/relay/status"));
  assert.ok(requests.includes("/n/N/p/A/api/dirs"));
  assert.equal(requests.includes("/n/N/api/dirs"),false);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.deepEqual(errors,[]);
});
