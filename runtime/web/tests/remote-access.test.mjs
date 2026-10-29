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
const styles = ["src/index.css", "src/components/remote/remoteAccess.css", "src/components/FileEditor.css"]
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
        </> : open ? <RemoteAccessDialog onClose={()=>setOpen(false)} /> : <p>Panel closed</p>}</I18nProvider>;
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
  await t.test("binding is explicit, phone QR pairs automatically, regular link stays public, unlink disables first", async () => {
    const page = await pageFor(375);
    const calls = [];
    let status = { relay_bound:false, enabled:false, connected:false, relay_base_url:"https://relay.test", node_url:"", pending_code:"", pairing_secret:"private-pairing-secret" };
    await page.route("**/api/idea/remote**", route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "POST") {
        calls.push(path);
        if (path.endsWith("/bind")) status = {...status,enabled:true,pending_code:"pending"};
        else status = {...status,enabled:route.request().postDataJSON().enabled,connected:false};
      }
      return route.fulfill({contentType:"application/json",body:JSON.stringify(status)});
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.getByText("Link Relay before using remote access.")).toBeVisible();
    assert.deepEqual(calls, []);
    await page.getByRole("button",{name:"Link Relay",exact:true}).click();
    await expect(page.getByRole("link",{name:"Open Relay linking page"})).toHaveAttribute("href","https://relay.test/bind?code=pending");
    status = {...status,relay_bound:true,connected:true,pending_code:"",node_url:"https://relay.test/n/node/"};
    await expect(page.getByText("Remote access is online",{exact:true})).toBeVisible();
    await expect(page.getByRole("img",{name:"Remote access QR code"})).toHaveAttribute("src",/^data:image\/png/);
    const expectedQR = QRCode.create(`${status.node_url}#mindfs_pairing=${status.pairing_secret}`);
    const actualModules = await page.getByRole("img",{name:"Remote access QR code"}).evaluate(async (img, size) => {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const scale = canvas.width / (size + 4);
      return Array.from({length:size * size}, (_, index) => {
        const x = Math.floor((index % size + 2.5) * scale);
        const y = Math.floor((Math.floor(index / size) + 2.5) * scale);
        return ctx.getImageData(x, y, 1, 1).data[0] < 128 ? 1 : 0;
      });
    }, expectedQR.modules.size);
    assert.deepEqual(actualModules, Array.from(expectedQR.modules.data));
    await expect(page.getByText("Scan with your phone to connect without entering a pairing key. This QR code grants access; do not share it.")).toBeVisible();
    await expect(page.getByRole("link",{name:"Open browser"})).toHaveAttribute("href",status.node_url);
    await expect(page.getByRole("textbox",{name:"Pairing key",exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"Show pairing key"}).click();
    await expect(page.getByRole("textbox",{name:"Pairing key",exact:true})).toHaveValue(status.pairing_secret);
    const rect = await page.getByRole("dialog").boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 375);
    await page.getByRole("button",{name:"Unlink",exact:true}).click();
    await expect(page.getByText("Remote access is off. Delete this node in Relay to unlink it.")).toBeVisible();
    assert.equal(status.enabled,false);
    assert.deepEqual(calls,["/n/node/api/idea/remote/bind","/n/node/api/idea/remote/enable"]);
  });
  await t.test("cancel pending binding disables access", async () => {
    const page = await pageFor(900);
    let enabled = true;
    await page.route("**/api/idea/remote**", route => {
      if (route.request().method() === "POST") enabled = route.request().postDataJSON().enabled;
      return route.fulfill({contentType:"application/json",body:JSON.stringify({relay_bound:false,enabled,relay_base_url:"https://relay.test",pending_code:"pending"})});
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.getByRole("link",{name:"Open Relay linking page"})).toBeVisible();
    await page.getByRole("button",{name:"Close",exact:true}).click();
    await expect(page.getByText("Panel closed")).toBeVisible();
    assert.equal(enabled,false);
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
