import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import QRCode from "qrcode";

const webDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const styles = ["src/index.css", "src/ide.css", "src/components/remote/remoteAccess.css", "src/components/FileEditor.css"]
  .map(file => readFileSync(webDir + file, "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, "")).join("\n");

test("remote panel and browser editing", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) {
    if (!/Executable doesn't exist/i.test(String(error))) throw error;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }
  t.after(() => browser.close());
  const bundle = await build({
    stdin: { resolveDir: webDir, loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { I18nProvider } from "./src/i18n";
      import { RemoteAccessDialog } from "./src/components/remote/RemoteAccessDialog";
      import { RemoteFileViewer } from "./src/components/remote/RemoteFileViewer";
      import { FileEditStore } from "./src/services/fileEditing";
      const files = ["first.ts", "second.ts"].map(path => ({root:"project", path, name:path, content:"const count = 1;", revision:"original", size:16, encoding:"utf-8", ext:".ts"}));
      const store = new FileEditStore({load:async (root,path)=>files.find(f=>f.path===path), save: async (root,path,content,revision)=>{
        if (window.conflict) throw new Error("file_edit_conflict");
        window.saved = {content,revision}; return {...files.find(f=>f.path===path),content,revision:"saved"};
      }});
      function Fixture() {
        const [open,setOpen] = useState(true);
        const [file,setFile] = useState(files[0]);
        return <I18nProvider>{window.editorFixture ? <>
          <button onClick={()=>setFile(files[0])}>First file</button><button onClick={()=>setFile(files[1])}>Second file</button>
          <RemoteFileViewer file={file} store={store} onUpdated={setFile} onSaved={setFile} />
        </> : open ? <div className="idea-workbench"><RemoteAccessDialog onClose={()=>setOpen(false)} /></div> : <><p>Panel closed</p><button onClick={()=>setOpen(true)}>Reopen panel</button></>}</I18nProvider>;
      }
      createRoot(document.getElementById("root")).render(<Fixture/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    loader: {".css":"empty"}, define: {"process.env.NODE_ENV":'"test"', "import.meta.env":"{}"},
  });
  async function pageFor(width, editor = false) {
    const page = await browser.newPage({ locale: "en-US", viewport: { width, height: 850 } });
    page.setDefaultTimeout(8000);
    t.after(() => page.close());
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root" style="height:750px;display:flex;flex-direction:column"></div></body></html>' }));
    await page.goto("https://remote.fixture.test/n/node/");
    await page.addStyleTag({content:styles});
    await page.evaluate(editor => { window.editorFixture = editor; }, editor);
    return page;
  }
  await t.test("one-click connection, automatic links, current conversation and project management", async () => {
    const page = await pageFor(375);
    const calls = [];
    await page.evaluate(() => {
      history.replaceState({}, "", "?root=project&session=existing-session&ide_chrome=1&file=private.ts");
      window.open = url => { window.opened = url; return null; };
      Object.defineProperty(navigator, "clipboard", {value:{writeText: async value => {window.copied = value;}}});
    });
    let status = {relay_bound:false,host_bound:false,enabled:false,connected:false,relay_base_url:"https://relay.test",node_url:"",pending_code:"",pairing_secret:"private-pairing-secret",host_enabled:true,project_id:"A",project_name:"Project A",project_url:"https://relay.test/n/node/p/A/",projects:[]};
    await page.route("**/api/idea/remote**", route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "POST") {
        calls.push(path);
        if (path.endsWith("/bind")) status = {...status,migration_pending:true,pending_code:"pending"};
        else if (path.endsWith("/host-enable")) status = {...status,host_enabled:route.request().postDataJSON().enabled,connected:false};
        else if (path.endsWith("/project-sharing")) {
          const input = route.request().postDataJSON();
          status = {...status,projects:status.projects.map(project=>project.project_id===input.project_id ? {...project,enabled:input.enabled} : project)};
        }
      }
      return route.fulfill({contentType:"application/json",body:JSON.stringify(status)});
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.getByRole("button",{name:"Enable remote access",exact:true})).toBeVisible();
    assert.deepEqual(calls, []);
    await page.getByRole("button",{name:"Enable remote access",exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>window.opened)).toBe("https://relay.test/bind?code=pending");
    await expect(page.getByRole("link",{name:"Continue signing in"})).toHaveAttribute("href","https://relay.test/bind?code=pending");
    status = {...status,relay_bound:true,host_bound:true,enabled:true,migration_pending:false,connected:true,pending_code:"",node_url:"https://relay.test/n/node/",projects:[{project_id:"A",name:"Project A",label:"",enabled:true,availability:"online"},{project_id:"B",name:"Project B",label:"",enabled:true,availability:"online"}]};
    await expect(page.getByText("Connected",{exact:true})).toBeVisible();
    const expectedLink = `${status.project_url}?root=project&session=existing-session`;
    await expect(page.getByRole("link",{name:"Open browser"})).toHaveAttribute("href",expectedLink);
    await page.getByRole("button",{name:"Copy link",exact:true}).click();
    assert.equal(await page.evaluate(()=>window.copied),expectedLink);
    await expect(page.locator("input:not([role=switch])")).toHaveCount(0);
    const expectedQR = QRCode.create(expectedLink);
    const actualModules = await page.getByRole("img",{name:"Remote access QR code"}).evaluate(async (img, size) => {
      await img.decode(); const canvas = document.createElement("canvas");
      canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
      const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0);
      const scale=canvas.width/(size+4);
      return Array.from({length:size*size},(_,index)=>ctx.getImageData(Math.floor((index%size+2.5)*scale),Math.floor((Math.floor(index/size)+2.5)*scale),1,1).data[0]<128?1:0);
    },expectedQR.modules.size);
    assert.deepEqual(actualModules,Array.from(expectedQR.modules.data));
    await page.screenshot({path:"/tmp/remote-v2-narrow.png"});
    const rect=await page.getByRole("dialog").boundingBox();
    assert.ok(rect.x>=0 && rect.x+rect.width<=375);
    await page.setViewportSize({width:900,height:850});
    await page.screenshot({path:"/tmp/remote-v2-desktop.png"});
    await page.evaluate(() => {document.documentElement.dataset.theme="dark";localStorage.setItem("mindfs-locale","zh-CN");window.dispatchEvent(new CustomEvent("mindfs:locale-changed",{detail:"zh-CN"}));});
    await expect(page.getByRole("link",{name:"打开网页"})).toBeVisible();
    await page.screenshot({path:"/tmp/remote-v2-dark-zh.png"});
    await page.evaluate(() => {localStorage.setItem("mindfs-locale","en-US");window.dispatchEvent(new CustomEvent("mindfs:locale-changed",{detail:"en-US"}));});
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.getByRole("button",{name:/Shared projects/}).click();
    await page.getByRole("switch",{name:"Project B",exact:true}).click();
    await expect(page.getByRole("switch",{name:"Project B",exact:true})).not.toBeChecked();
    assert.equal(status.projects[1].enabled,false);
    assert.equal(status.projects[0].enabled,true);
    assert.equal(status.host_enabled,true);
    await page.getByRole("switch",{name:"Project A",exact:true}).click();
    await expect(page.getByRole("switch",{name:"Project A",exact:true})).not.toBeChecked();
    await page.getByRole("button",{name:"Back",exact:true}).click();
    await page.getByRole("button",{name:"Back",exact:true}).click();
    await expect(page.getByRole("button",{name:"Resume sharing this project"})).toBeVisible();
    await expect(page.getByRole("img",{name:"Remote access QR code"})).toHaveCount(0);
    await page.getByRole("button",{name:"Resume sharing this project"}).click();
    await expect(page.getByRole("link",{name:"Open browser"})).toBeVisible();
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.getByRole("button",{name:"Pause remote access",exact:true}).click();
    assert.equal(status.host_enabled,false);
    assert.deepEqual(calls,["/n/node/api/idea/remote/bind",...Array(3).fill("/n/node/api/idea/remote/project-sharing"),"/n/node/api/idea/remote/host-enable"]);
  });
  await t.test("closing a pending connection preserves it for later completion", async () => {
    const page=await pageFor(900);const calls=[];
    await page.route("**/api/idea/remote**",route=>{
      if(route.request().method()==="POST")calls.push(route.request().url());
      return route.fulfill({contentType:"application/json",body:JSON.stringify({relay_bound:false,enabled:false,migration_pending:true,legacy_mode:true,relay_base_url:"https://relay.test",pending_code:"pending"})});
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.getByRole("link",{name:"Continue signing in"})).toBeVisible();
    await page.getByRole("button",{name:"Close",exact:true}).click();
    await expect(page.getByText("Panel closed")).toBeVisible();
    assert.deepEqual(calls,[]);
  });
  await t.test("slow management status does not queue overlapping polls", async () => {
    const page=await pageFor(900);let calls=0;let release;
    const waiting=new Promise(resolve=>{release=resolve;});
    await page.route("**/api/idea/remote**",async route=>{
      calls++;await waiting;
      await route.fulfill({contentType:"application/json",body:JSON.stringify({relay_bound:false,enabled:false,host_enabled:false,relay_base_url:"https://relay.test",pending_code:""})});
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect.poll(()=>calls).toBe(1);await page.waitForTimeout(2300);assert.equal(calls,1);release();
    await expect(page.getByRole("button",{name:"Enable remote access",exact:true})).toBeVisible();
  });
  await t.test("joining a bound computer does not ask for another service login", async () => {
    const page=await pageFor(900);const calls=[];
    let status={relay_bound:true,host_bound:true,host_enabled:true,enabled:false,connected:true,project_id:"B",project_name:"Project B",project_url:"https://relay.test/n/node/p/B/",pairing_secret:"computer-key"};
    await page.route("**/api/idea/remote**",route=>{
      if(route.request().method()==="POST"){calls.push(new URL(route.request().url()).pathname);status={...status,enabled:true};}
      return route.fulfill({contentType:"application/json",body:JSON.stringify(status)});
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole("button",{name:"Share this project",exact:true}).click();
    await expect(page.getByRole("link",{name:"Open browser"})).toHaveAttribute("href",status.project_url);
    assert.deepEqual(calls,["/n/node/api/idea/remote/bind"]);
  });
  await t.test("service setup detects, installs, retries and waits for restart before showing remote access", async () => {
    const page = await browser.newPage({ locale: "en-US", viewport: { width: 900, height: 850 } });
    page.setDefaultTimeout(8000);
    t.after(() => page.close());
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root" style="height:750px;display:flex;flex-direction:column"></div></body></html>' }));
    await page.goto("https://127.0.0.1.fixture.test/");
    await page.addStyleTag({ content: styles });
    await page.evaluate(() => {
      window.mode = { current: "embedded", selected: "embedded", confirmed: false, installed: false, running: false, installing: false, installError: "" };
      window.modeMessages = [];
      window.sendMode = () => window.dispatchEvent(new CustomEvent("idea:backend-mode", { detail: window.mode }));
      window.ideaAgent = { postMessage: message => {
        window.modeMessages.push(message);
        if (message.action === "setBackendMode" && window.saveError) {
          window.dispatchEvent(new CustomEvent("idea:backend-mode", { detail: { error: window.saveError } })); return;
        }
        if (message.action === "setBackendMode") window.mode = { ...window.mode, selected: message.mode, confirmed: true };
        if (message.action === "installBackend") window.mode = { ...window.mode, installing: true, installError: "" };
        if (["backendMode", "setBackendMode", "installBackend"].includes(message.action)) window.sendMode();
      } };
    });
    let remoteRequests = 0;
    await page.route("**/api/idea/remote**", route => {
      remoteRequests++;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ relay_bound: true, host_bound: true, host_enabled: true, enabled: true, connected: true, project_id: "A", project_url: "https://relay.test/n/N/p/A/" }) });
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.getByRole("radio", { name: /Run with IDEA/ })).toBeChecked();
    await page.getByRole("radio", { name: /Keep running after IDEA closes/ }).check();
    await expect(page.getByRole("status")).toContainText("not installed");
    await page.screenshot({ path: "/tmp/one-click-install-desktop.png" });
    await page.getByRole("button", { name: "Install and continue", exact: true }).click();
    await expect(page.getByRole("button", { name: "Installing…", exact: true })).toBeDisabled();
    await expect(page.getByRole("radio", { name: /Run with IDEA/ })).toBeDisabled();
    assert.equal(remoteRequests, 0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Reopen panel" }).click();
    await expect(page.getByRole("radio", { name: /Run with IDEA/ })).toBeDisabled();
    await page.evaluate(() => { window.mode = { ...window.mode, installing: false, installError: "Download failed" }; window.sendMode(); });
    await expect(page.getByRole("alert")).toHaveText("Download failed");
    await page.getByRole("radio", { name: /Keep running after IDEA closes/ }).check();
    await page.getByRole("button", { name: "Install and continue", exact: true }).click();
    assert.equal(await page.evaluate(() => window.modeMessages.filter(m => m.action === "installBackend").length), 2);
    await page.evaluate(() => { window.mode = { ...window.mode, selected: "standalone", confirmed: true, installed: true, installing: false, installError: "" }; window.sendMode(); });
    await expect(page.getByRole("button", { name: "Restart IDEA and continue", exact: true })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Open browser" })).toHaveCount(0);
    assert.equal(remoteRequests, 0);
    assert.equal(await page.evaluate(() => window.modeMessages.some(m => m.action === "remoteAccess")), false);
    await page.screenshot({ path: "/tmp/restart-continue-desktop.png" });
    await page.evaluate(() => {
      localStorage.setItem("mindfs-locale", "zh-CN"); window.dispatchEvent(new Event("mindfs:locale-changed"));
      document.documentElement.dataset.theme = "dark";
    });
    await page.setViewportSize({ width: 375, height: 850 });
    await expect(page.getByRole("button", { name: "重启 IDEA 并继续", exact: true })).toBeEnabled();
    await page.screenshot({ path: "/tmp/restart-continue-dark-zh-narrow.png" });
    await page.getByRole("button", { name: "重启 IDEA 并继续", exact: true }).click();
    assert.equal(await page.evaluate(() => window.modeMessages.filter(m => m.action === "restartIdea").length), 1);
    await page.getByRole("button", { name: "稍后重启", exact: true }).click();
    await page.evaluate(() => {
      localStorage.setItem("mindfs-locale", "en-US"); window.dispatchEvent(new Event("mindfs:locale-changed"));
      document.documentElement.dataset.theme = "light";
    });
    await page.setViewportSize({ width: 900, height: 850 });
    await page.getByRole("button", { name: "Reopen panel" }).click();
    await expect(page.getByRole("radio", { name: /Keep running after IDEA closes/ })).toBeChecked();
    await expect(page.getByRole("button", { name: "Install and continue", exact: true })).toHaveCount(0);
    await page.getByRole("radio", { name: /Run with IDEA/ }).check();
    await page.evaluate(() => { window.saveError = "Cannot save preference"; });
    await page.getByRole("button", { name: "Use built-in service", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Cannot save preference");
    assert.equal(remoteRequests, 0);
    await page.evaluate(() => { window.saveError = ""; });
    await page.getByRole("button", { name: "Use built-in service", exact: true }).click();

    await expect(page.getByRole("link", { name: "Open browser" })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await expect(page.getByRole("link", { name: "Open browser" })).toHaveCount(0);
    await page.getByRole("radio", { name: /Keep running after IDEA closes/ }).check();
    await expect(page.getByRole("status")).toContainText("Standalone service detected");
    await page.evaluate(() => {
      localStorage.setItem("mindfs-locale", "zh-CN"); window.dispatchEvent(new Event("mindfs:locale-changed"));
      document.documentElement.dataset.theme = "dark";
    });
    await page.setViewportSize({ width: 375, height: 850 });
    await expect(page.getByRole("button", { name: "使用独立服务", exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.querySelector('dialog').scrollWidth > document.querySelector('dialog').clientWidth), false);
    await page.screenshot({ path: "/tmp/one-click-installed-dark-zh-narrow.png" });
  });
  await t.test("standalone IDEA panel shows service controls and never the install offer", async () => {
    const page = await browser.newPage({ locale: "en-US", viewport: { width: 900, height: 850 } });
    page.setDefaultTimeout(8000);
    t.after(() => page.close());
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="local-ai-agent-mode" content="standalone"></head><body><div id="root" style="height:750px;display:flex;flex-direction:column"></div></body></html>' }));
    await page.goto("https://127.0.0.1.fixture.test/?ide=1");
    await page.addStyleTag({ content: styles });
    await page.evaluate(() => {
      window.editorFixture = false;
      window.mode = { current: "standalone", selected: "standalone", confirmed: true, installed: true, running: true, installing: false, installError: "" };
      window.serviceMessages = [];
      window.ideaAgent = { postMessage: message => {
        window.serviceMessages.push(message);
        if (message.action === "setBackendMode") window.mode = { ...window.mode, selected: message.mode };
        if (["backendMode", "setBackendMode"].includes(message.action))
          window.dispatchEvent(new CustomEvent("idea:backend-mode", { detail: window.mode }));
      } };
    });
    let running = true, bound = true;
    const mutations = [];
    await page.route("**/api/idea/remote**", route => {
      if (route.request().method() === "POST") { mutations.push(new URL(route.request().url()).pathname); bound = true; }
      return route.fulfill({ contentType: "application/json",
        body: JSON.stringify({ relay_bound: bound, host_bound: bound, host_enabled: true, enabled: bound, connected: running && bound, project_id: "A", project_name: "Project A", project_url: "https://relay.test/n/N/p/A/", service: { running, version: "0.1.26-standalone.3", address: "127.0.0.1:7331", pid: 1 } }) });
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    for (const name of ["Restart service", "Stop service"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop service", exact: true })).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("Standalone service detected and running");
    await expect(page.getByRole("button", { name: "Install and continue", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    // Remote controls follow gateway state while this local panel stays mounted.
    await expect(page.getByRole("button", { name: "Start service", exact: true })).toHaveCount(0);
    assert.equal(await page.locator(".remote-support").evaluate(node => node.open), false);
    await expect(page.getByRole("region", { name: "Standalone updates" }).getByRole("button", { name: "Restart service", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop service", exact: true })).toBeVisible();
    await expect(page.getByText("Want one place for all your projects?")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy install command" })).toHaveCount(0);
    await page.evaluate(() => { window.savedRemoteDialog = document.querySelector("dialog"); window.dispatchEvent(new CustomEvent("idea:backend-state", {detail:{busy:true}})); });
    await expect(page.getByRole("button", {name:"Stop service", exact:true})).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("idea:backend-state", {detail:{busy:false}})));
    await page.getByRole("button", {name:"Back", exact:true}).click();
    running = false;
    bound = false;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("idea:backend-state", {detail:{busy:false}})));
    await expect(page.getByRole("button", {name:"Start service", exact:true})).toBeVisible();
    await expect(page.getByRole("button", {name:"Stop service", exact:true})).toHaveCount(0);
    await expect(page.getByRole("button", {name:"Restart service", exact:true})).toHaveCount(0);
    await expect(page.getByRole("button", {name:"Enable remote access", exact:true})).toHaveCount(0);
    await expect(page.getByRole("link", {name:"Continue signing in", exact:true})).toHaveCount(0);
    await expect(page.getByRole("img", {name:"Remote access QR code", exact:true})).toHaveCount(0);
    await page.screenshot({path:"/tmp/remote-start-stopped-desktop.png"});
    await page.evaluate(() => {
      localStorage.setItem("mindfs-locale","zh-CN"); window.dispatchEvent(new Event("mindfs:locale-changed"));
      document.documentElement.dataset.theme="dark";
    });
    await page.setViewportSize({width:375,height:850});
    await expect(page.getByRole("heading",{name:"远程服务未启动"})).toBeVisible();
    await page.screenshot({path:"/tmp/remote-start-stopped-narrow.png"});
    assert.equal(await page.evaluate(() => document.querySelector('dialog').scrollWidth > document.querySelector('dialog').clientWidth), false);
    await page.evaluate(() => {
      localStorage.setItem("mindfs-locale","en-US"); window.dispatchEvent(new Event("mindfs:locale-changed"));
      document.documentElement.dataset.theme="light";
    });
    await page.setViewportSize({width:900,height:850});
    await page.getByRole("button", {name:"Start service", exact:true}).click();
    assert.equal(await page.evaluate(() => window.serviceMessages.at(-1).action), "backendStart");
    assert.deepEqual(mutations, []);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("idea:backend-state", {detail:{busy:true}})));
    await expect(page.getByRole("button", {name:"Starting…", exact:true})).toBeDisabled();
    assert.equal(await page.evaluate(() => window.savedRemoteDialog === document.querySelector("dialog")), true);
    const startError = "Local AI Agent did not start; see C:\\Users\\42169\\AppData\\Roaming\\LocalAIAgent\\remote\\logs\\standalone.log";
    await page.evaluate(error => window.dispatchEvent(new CustomEvent("idea:backend-state", {detail:{busy:false,error}})), startError);
    await expect(page.getByRole("heading", {name:"Remote service failed to start"})).toBeVisible();
    await page.waitForTimeout(2200);
    await page.getByText("Startup details", {exact:true}).click();
    await expect(page.getByText(startError, {exact:true})).toBeVisible();
    await page.setViewportSize({width:375,height:850});
    assert.equal(await page.evaluate(() => document.querySelector('dialog').scrollWidth > document.querySelector('dialog').clientWidth), false);
    await page.screenshot({path:"/tmp/remote-start-error-narrow.png"});
    await page.setViewportSize({width:900,height:850});
    await expect(page.getByRole("button", {name:"Retry", exact:true})).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.savedRemoteDialog.open), true);
    running = true;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("idea:backend-state", {detail:{busy:false}})));
    await expect(page.getByRole("button", {name:"Enable remote access", exact:true})).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", {name:"Enable remote access", exact:true}).click();
    assert.deepEqual(mutations, ["/api/idea/remote/bind"]);
    await expect(page.getByRole("link", {name:"Open browser",exact:true})).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await page.getByRole("radio", { name: /Run with IDEA/ }).check();
    await page.getByRole("button", { name: "Use built-in service", exact: true }).click();
    await expect(page.getByRole("button", { name: "Restart IDEA and continue", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Start service", exact: true })).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.savedRemoteDialog === document.querySelector("dialog")), true);
  });
  await t.test("standalone checks on open, links its update notice to settings and updates only on click", async () => {
    const page = await browser.newPage({locale:"en-US",viewport:{width:375,height:850}});
    page.setDefaultTimeout(8000); t.after(()=>page.close());
    await page.route("**/*", route=>route.fulfill({contentType:"text/html",body:'<html><head><meta name="local-ai-agent-mode" content="standalone"></head><body><div id="root"></div></body></html>'}));
    await page.goto("https://127.0.0.1.fixture.test/?ide=1");
    await page.addStyleTag({content:styles});
    await page.evaluate(()=>{
      window.updateMessages=[];
      window.updateState={version:"0.1.26-standalone.12",latest:"",checking:false,updating:false,available:false,error:""};
      window.sendUpdate=()=>window.dispatchEvent(new CustomEvent("idea:standalone-update",{detail:window.updateState}));
      window.ideaAgent={postMessage(message){
        window.updateMessages.push(message);
        if(message.action==="backendMode") window.dispatchEvent(new CustomEvent("idea:backend-mode",{detail:{current:"standalone",selected:"standalone",confirmed:true,installed:true,running:true,installing:false,installError:""}}));
        if(message.action==="checkBackendUpdate") { window.updateState={...window.updateState,checking:true,error:""}; window.sendUpdate(); }
        if(message.action==="updateBackend") { window.updateState={...window.updateState,updating:true,error:""}; window.sendUpdate(); }
      }};
    });
    let enabled=true;
    const mutations=[];
    await page.route("**/api/idea/remote**",route=>{
      if(route.request().method()==="POST") { mutations.push(new URL(route.request().url()).pathname); enabled=route.request().postDataJSON().enabled; }
      return route.fulfill({contentType:"application/json",body:JSON.stringify({relay_bound:true,host_bound:true,host_enabled:enabled,enabled,connected:enabled,node_url:"https://relay.test/n/N/",service:{running:true,version:"0.1.26-standalone.12"}})});
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.getByRole("link",{name:"Open browser"})).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>window.updateMessages.filter(m=>m.action==="checkBackendUpdate").length)).toBe(1);
    await expect(page.getByRole("button",{name:"Update available",exact:true})).toHaveCount(0);
    await page.evaluate(()=>{window.updateState={...window.updateState,checking:false,latest:"0.1.26-standalone.43",available:true};window.sendUpdate();});
    await expect(page.getByRole("button",{name:"Update available",exact:true})).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Update available");
    await expect(page.getByRole("link",{name:"Open browser"})).toBeVisible();
    assert.equal(await page.evaluate(()=>window.updateMessages.some(m=>m.action==="updateBackend")),false);
    const screenshotDir = webDir + "../../output/playwright/remote-update-notice";
    await mkdir(screenshotDir, {recursive:true});
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => {
        document.documentElement.dataset.theme=theme;
        localStorage.setItem("mindfs-locale","zh-CN");window.dispatchEvent(new Event("mindfs:locale-changed"));
      }, theme);
      for (const width of [375, 900]) {
        await page.setViewportSize({width,height:850});
        await expect(page.getByRole("button",{name:"有新版本",exact:true})).toBeVisible();
        assert.equal(await page.evaluate(()=>document.querySelector("dialog").scrollWidth>document.querySelector("dialog").clientWidth),false);
        await page.screenshot({path:`${screenshotDir}/${theme}-${width}.png`});
        await page.getByRole("button",{name:"有新版本",exact:true}).click();
        await expect(page.getByRole("region",{name:"独立后台更新"}).getByRole("button",{name:"重启服务",exact:true})).toBeVisible();
        await expect(page.getByRole("button",{name:"停止服务",exact:true})).toBeVisible();
        assert.equal(await page.locator(".remote-support").evaluate(node => node.open),false);
        assert.equal(await page.evaluate(()=>document.querySelector("dialog").scrollWidth>document.querySelector("dialog").clientWidth),false);
        await page.screenshot({path:`${screenshotDir}/settings-${theme}-${width}.png`});
        await page.getByRole("button",{name:"返回",exact:true}).click();
      }
    }
    await page.evaluate(()=>{localStorage.setItem("mindfs-locale","en-US");window.dispatchEvent(new Event("mindfs:locale-changed"));});
    await page.setViewportSize({width:375,height:850});
    await page.getByRole("button",{name:"Update available",exact:true}).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("New version: 0.1.26-standalone.43")).toBeVisible();
    assert.equal(await page.evaluate(()=>window.updateMessages.filter(m=>m.action==="checkBackendUpdate").length),1);
    await page.getByRole("button",{name:"Check for updates",exact:true}).click();
    await expect(page.getByRole("button",{name:"Checking…",exact:true})).toBeDisabled();
    await page.evaluate(()=>{window.updateState={...window.updateState,checking:false,latest:"",available:false,error:"GitHub Releases returned HTTP 403"};window.sendUpdate();});
    await expect(page.getByRole("alert")).toHaveText("Could not finish. Try again.");
    await page.getByRole("button",{name:"Back",exact:true}).click();
    await expect(page.getByRole("button",{name:"Update available",exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await expect(page.getByRole("alert")).toHaveText("Could not finish. Try again.");
    await page.getByRole("button",{name:"Back",exact:true}).click();
    await expect(page.getByRole("link",{name:"Open browser"})).toBeVisible();
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.evaluate(()=>{window.updateState={...window.updateState,checking:false,error:"",latest:window.updateState.version};window.sendUpdate();});
    await expect(page.getByRole("status")).toHaveText("Up to date");
    await page.getByRole("button",{name:"Back",exact:true}).click();
    await expect(page.getByRole("button",{name:"Update available",exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.getByRole("button",{name:"Check for updates",exact:true}).click();
    await page.evaluate(()=>{window.updateState={...window.updateState,checking:false,latest:"0.1.26-standalone.43",available:true};window.sendUpdate();});
    await expect(page.getByRole("button",{name:"Check for updates",exact:true})).toBeEnabled();
    await expect(page.getByText("New version: 0.1.26-standalone.43")).toBeVisible();
    assert.equal(await page.evaluate(()=>window.updateMessages.some(m=>m.action==="updateBackend")),false);
    assert.equal(await page.evaluate(()=>document.querySelector("dialog").scrollWidth>document.querySelector("dialog").clientWidth),false);
    await page.screenshot({path:"/tmp/remote-v3-updates-narrow-en.png"});
    await page.getByRole("button",{name:"Update and restart",exact:true}).click();
    await expect(page.getByRole("button",{name:"Close",exact:true})).toBeDisabled();
    await expect(page.getByRole("button",{name:"Back",exact:true})).toBeDisabled();
    await page.evaluate(()=>{window.updateState={...window.updateState,updating:false,error:"SHA-256 verification failed"};window.sendUpdate();});
    await expect(page.getByRole("button",{name:"Update and restart",exact:true})).toBeEnabled();
    await page.getByRole("button",{name:"Back",exact:true}).click();
    await expect(page.getByRole("link",{name:"Open browser"})).toBeVisible();
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.getByRole("button",{name:"Pause remote access",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Remote access is paused"})).toBeVisible();
    await page.getByRole("button",{name:"Enable remote access",exact:true}).click();
    await expect(page.getByRole("link",{name:"Open browser"})).toBeVisible();
    assert.deepEqual(mutations,["/api/idea/remote/enable","/api/idea/remote/enable"]);
  });
  await t.test("standalone browser checks versions without requiring the IDEA bridge", async () => {
    const page = await pageFor(375);
    await page.evaluate(()=>{
      const meta=document.createElement("meta");meta.name="local-ai-agent-mode";meta.content="standalone";document.head.append(meta);
      document.documentElement.dataset.theme="dark";
      localStorage.setItem("mindfs-locale","zh-CN");
    });
    await page.route("**/api/idea/remote**",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({relay_bound:true,host_bound:true,host_enabled:true,enabled:true,connected:true,node_url:"https://relay.test/n/N/",service:{running:true,version:"0.1.26-standalone.12",platform:"windows-amd64"}})}));
    let latest="0.1.26-standalone.44", checks=0, fail=false;
    await page.route("https://api.github.com/repos/zhuxian89/idea-ai-agent/releases?per_page=100",route=>{
      checks++;
      const name=`local-ai-agent-${latest}-windows-amd64.zip`;
      return route.fulfill({status:fail?403:200,contentType:"application/json",body:JSON.stringify([{tag_name:`standalone-v${latest}`,draft:false,prerelease:true,assets:[{name},{name:`${name}.sha256`}]}])});
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.getByRole("button",{name:"有新版本",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"有新版本",exact:true}).click();
    await expect(page.getByRole("status")).toHaveText("有新版本 0.1.26-standalone.44");
    await expect(page.getByRole("link",{name:"查看新版"})).toHaveAttribute("href",/standalone-v0.1.26-standalone.44$/);
    await expect(page.getByRole("button",{name:"更新并重启"})).toHaveCount(0);
    assert.equal(checks,1);
    latest="0.1.26-standalone.45";
    await page.getByRole("button",{name:"检查更新",exact:true}).click();
    await expect(page.getByRole("status")).toHaveText("有新版本 0.1.26-standalone.45");
    assert.equal(checks,2);
    assert.equal(await page.evaluate(()=>document.querySelector("dialog").scrollWidth>document.querySelector("dialog").clientWidth),false);
    await page.screenshot({path:"/tmp/remote-v3-browser-updates-narrow-zh.png"});
    fail=true;
    await page.getByRole("button",{name:"检查更新",exact:true}).click();
    await expect(page.getByRole("alert")).toHaveText("无法检查更新，请重试。");
    await page.getByRole("button",{name:"返回",exact:true}).click();
    await expect(page.getByRole("link",{name:"打开网页"})).toBeVisible();
  });
  await t.test("disconnection hides stale links and offers reconnect",async()=>{
    const page=await pageFor(900);let connected=false;
    await page.route("**/api/idea/remote**",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({relay_bound:true,host_bound:true,host_enabled:true,enabled:true,connected,project_id:"A",project_url:"https://relay.test/n/N/p/A/",pairing_secret:"key"})}));
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.getByRole("button",{name:"Check connection",exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:"Open browser"})).toHaveCount(0);
    connected=true;await page.getByRole("button",{name:"Check connection",exact:true}).click();
    await expect(page.getByRole("link",{name:"Open browser"})).toBeVisible();
  });
  await t.test("editing retains drafts across navigation and conflict; save uses original revision", async () => {
    const page = await pageFor(900,true);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole("button",{name:"Edit",exact:true}).click();
    const editor = page.getByRole("textbox",{name:"File content",exact:true});
    await expect(editor).toHaveText("const count = 1;");
    await editor.fill("const count = 2;");
    await page.getByRole("button",{name:"Second file",exact:true}).click();
    await page.getByRole("button",{name:"First file",exact:true}).click();
    await expect(editor).toHaveText("const count = 2;");
    await page.evaluate(()=>{window.conflict = true;});
    await page.getByRole("button",{name:"Save",exact:true}).click();
    await expect(page.getByRole("alert")).toContainText("changed");
    await expect(editor).toHaveText("const count = 2;");
    await page.evaluate(()=>{window.conflict = false;});
    await page.getByRole("button",{name:"Save",exact:true}).click();
    await expect(page.getByRole("button",{name:"Save",exact:true})).toBeDisabled();
    assert.deepEqual(await page.evaluate(()=>window.saved),{content:"const count = 2;",revision:"original"});
  });
});
