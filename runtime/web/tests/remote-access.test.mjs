import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
        </> : open ? <div className="idea-workbench"><RemoteAccessDialog onClose={()=>setOpen(false)} /></div> : <p>Panel closed</p>}</I18nProvider>;
      }
      createRoot(document.getElementById("root")).render(<Fixture/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    loader: {".css":"empty"}, define: {"process.env.NODE_ENV":'"test"', "import.meta.env":"{}"},
  });
  async function pageFor(width, editor = false) {
    const page = await browser.newPage({ locale: "en-US", viewport: { width, height: 850 } });
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
    await expect(page.getByRole("link",{name:"Continue connecting"})).toHaveAttribute("href","https://relay.test/bind?code=pending");
    status = {...status,relay_bound:true,host_bound:true,enabled:true,migration_pending:false,connected:true,pending_code:"",node_url:"https://relay.test/n/node/",projects:[{project_id:"A",name:"Project A",label:"",enabled:true,availability:"online"},{project_id:"B",name:"Project B",label:"",enabled:true,availability:"online"}]};
    await expect(page.getByText("Enabled",{exact:true})).toBeVisible();
    const expectedLink = `${status.project_url}?root=project&session=existing-session#mindfs_pairing=${status.pairing_secret}`;
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
    await expect(page.getByRole("link",{name:"打开浏览器"})).toBeVisible();
    await page.screenshot({path:"/tmp/remote-v2-dark-zh.png"});
    await page.evaluate(() => {localStorage.setItem("mindfs-locale","en-US");window.dispatchEvent(new CustomEvent("mindfs:locale-changed",{detail:"en-US"}));});
    await page.getByRole("button",{name:"Manage",exact:true}).click();
    await page.getByRole("switch",{name:"Project B",exact:true}).click();
    await expect(page.getByRole("switch",{name:"Project B",exact:true})).not.toBeChecked();
    assert.equal(status.projects[1].enabled,false);
    assert.equal(status.projects[0].enabled,true);
    assert.equal(status.host_enabled,true);
    await page.getByRole("switch",{name:"Project A",exact:true}).click();
    await expect(page.getByRole("switch",{name:"Project A",exact:true})).not.toBeChecked();
    await page.getByRole("button",{name:"Back",exact:true}).click();
    await expect(page.getByRole("button",{name:"Resume sharing this project"})).toBeVisible();
    await expect(page.getByRole("img",{name:"Remote access QR code"})).toHaveCount(0);
    await page.getByRole("button",{name:"Resume sharing this project"}).click();
    await expect(page.getByRole("link",{name:"Open browser"})).toBeVisible();
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.getByRole("button",{name:"Disable remote access for this computer",exact:true}).click();
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
    await expect(page.getByRole("link",{name:"Continue connecting"})).toBeVisible();
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
    await expect(page.getByRole("link",{name:"Open browser"})).toHaveAttribute("href",status.project_url+"#mindfs_pairing=computer-key");
    assert.deepEqual(calls,["/n/node/api/idea/remote/bind"]);
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
