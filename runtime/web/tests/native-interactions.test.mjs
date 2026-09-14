import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
const webDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    // Only a missing installation can skip. Crashes or missing OS dependencies fail.
    if (!/Executable doesn't exist/i.test(String(error))) throw error;
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0"
    ? process.env.PLAYWRIGHT_BROWSERS_PATH
    : process.platform === "darwin" ? path.join(homedir(), "Library/Caches/ms-playwright")
      : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || homedir(), "ms-playwright")
        : path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache"), "ms-playwright");
  const candidates = [chromium.executablePath()];
  if (existsSync(cache)) {
    // Also support an existing older local Chromium (e.g. macOS chromium-1208).
    for (const entry of readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()) {
      for (const suffix of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux64/chrome", "chrome-linux/chrome", "chrome-win64/chrome.exe", "chrome-win/chrome.exe",
      ]) candidates.push(path.join(cache, entry, suffix));
    }
  }
  const executablePath = candidates.find((file) => existsSync(file));
  return executablePath ? chromium.launch({ headless: true, executablePath }) : null;
}

let bundle;
async function fixtureBundle() {
  if (bundle) return bundle;
  const result = await build({
    stdin: {resolveDir: webDir, sourcefile: "native-fixture.tsx", loader: "tsx", contents: `
      import React from "react";
      import {createRoot} from "react-dom/client";
      import {I18nProvider} from "./src/i18n";
      import {AskUserQuestionCard} from "./src/components/SessionViewer";
      const root = createRoot(document.getElementById("root"));
      window.answers = [];
      window.mount = (interaction, status = "running") => root.render(<I18nProvider><AskUserQuestionCard key={interaction.title} active={true} rootId="root" sessionKey="session" agent="codex"
        toolCall={{callId: interaction.title, title: interaction.title, status, kind:"ask_user", meta:{toolUseId:interaction.title,nativeInteraction:interaction,questions:[{question:interaction.title,options:interaction.actions.map(label=>({label}))}]}}}
        onAnswer={answer => { window.answers.push(answer); return new Promise((resolve,reject)=>{window.accept=resolve;window.reject=reject}); }} /></I18nProvider>);
    `},
    loader: {".css":"empty"},
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: {"process.env.NODE_ENV": '"test"', "import.meta.env": '{}'},
    plugins: [{name:"export-question-fixture",setup(build){build.onLoad({filter:/SessionViewer\.tsx$/}, args=>({contents:readFileSync(args.path,"utf8").replace("function AskUserQuestionCard(","export function AskUserQuestionCard("),loader:"tsx"}));}}],
  });
  bundle = result.outputFiles[0].text;
  return bundle;
}

test("native forms preserve types, retry rejection, and require acknowledged submission", async t => {
  const browser = await launchBrowser();
  assert.ok(browser, "a local Chromium is required for native form QA");
  t.after(()=>browser.close());
  const page = await browser.newPage({locale:"en-US",viewport:{width:375,height:850}});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",route=>route.fulfill({contentType:"text/html",body:'<!doctype html><html><body style="margin:12px;font:14px system-ui;--text-primary:#222;--text-secondary:#666;--border-color:#ccc;--content-bg:#fff"><div id="root"></div></body></html>'}));
  await page.goto("https://native.fixture.test");
  await page.addScriptTag({content:await fixtureBundle()});
  const mount = n=>page.evaluate(n=>window.mount(n),n);
  await mount({kind:"form",title:"MCP settings",message:"Enter connection settings",actions:["accept","decline","cancel"],schema:{type:"object",required:["count","enabled"],properties:{count:{type:"integer",title:"Count"},enabled:{type:"boolean",title:"Enabled"},color:{type:"string",enum:["red","blue"]}}}});
  const submit=page.getByRole("button",{name:"Submit answer",exact:true});
  await expect(submit).toBeDisabled();
  await page.getByRole("radio",{name:"Accept",exact:true}).check();
  await page.getByRole("spinbutton",{name:"Count *",exact:true}).fill("3");
  await page.getByRole("combobox",{name:"Enabled *",exact:true}).selectOption("false");
  await page.getByRole("combobox",{name:"color",exact:true}).selectOption("1");
  const reports=path.resolve(webDir,"../../build/reports/native-interactions");mkdirSync(reports,{recursive:true});
  await page.screenshot({path:path.join(reports,"form-mobile.png")});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
  await submit.click();
  await expect(page.getByRole("button",{name:"Submitting...",exact:true})).toBeDisabled();
  const answers=await page.evaluate(()=>window.answers);
  assert.deepEqual(JSON.parse(answers[0].answers.q_1),{count:3,enabled:false,color:"blue"});
  await page.evaluate(()=>window.reject(new Error("form validation: count must be at least 4")));
  await expect(page.getByText("form validation: count must be at least 4",{exact:true})).toBeVisible();
  await page.getByRole("spinbutton",{name:"Count *",exact:true}).fill("4");
  await submit.click();await page.evaluate(()=>window.accept());
  await expect(submit).not.toBeVisible();

  await mount({kind:"form",title:"Decline empty form",message:"Required form",actions:["accept","decline","cancel"],schema:{type:"object",required:["name"],properties:{name:{type:"string"}}}});
  await page.getByRole("radio",{name:"Decline",exact:true}).check();
  await submit.click();
  assert.deepEqual(await page.evaluate(()=>window.answers.at(-1).answers),{q_0:"decline"});
  await page.evaluate(()=>window.accept());

  await mount({kind:"url",title:"URL confirmation",message:"Sign in",url:"https://example.com/login",actions:["accept","decline","cancel"]});
  await expect(page.getByRole("link",{name:"https://example.com/login"})).toHaveAttribute("rel","noopener noreferrer");
  await expect(submit).toBeDisabled();
  await mount({kind:"url",title:"Invalid URL",url:"javascript:alert(1)",actions:["accept","decline","cancel"]});
  await expect(page.getByRole("link")).toHaveCount(0);

  await mount({kind:"permissions",title:"Extra permissions",message:"Read outside project",details:{permissions:{fileSystem:{read:["/tmp/example"]}}},actions:["allow_turn","allow_session","decline"]});
  await expect(submit).toBeDisabled();
  await page.getByRole("radio",{name:"Allow for this turn",exact:true}).check();
  await submit.click();
  assert.deepEqual(await page.evaluate(()=>window.answers.at(-1).answers),{q_0:"allow_turn"});
  await page.evaluate(()=>window.accept());

  await mount({kind:"form",title:"Nested form",actions:["accept","decline","cancel"],schema:{type:"object",properties:{config:{type:"object"}}}});
  await page.getByRole("radio",{name:"Accept",exact:true}).check();
  await page.getByRole("textbox",{name:"Form content (JSON)",exact:true}).fill('{"config":{"nested":[1,true]}}');
  await submit.click();
  assert.deepEqual(JSON.parse(await page.evaluate(()=>window.answers.at(-1).answers.q_1)),{config:{nested:[1,true]}});
  await page.evaluate(()=>window.accept());

  await mount({kind:"refusal_fallback_prompt",title:"Model fallback",message:"Try another model",details:{originalModel:"one",fallbackModel:"two"},actions:["retry_fallback","edit_prompt","cancelled"]});
  await page.getByRole("radio",{name:"Retry with fallback model",exact:true}).check();
  await page.screenshot({path:path.join(reports,"fallback-mobile.png")});
  await submit.click();assert.equal(await page.evaluate(()=>window.answers.at(-1).answers.q_0),"retry_fallback");
  await page.evaluate(()=>window.accept());

  await page.evaluate(()=>window.mount({kind:"url",title:"Expired confirmation",url:"https://example.com",actions:["accept","decline","cancel"]},"canceled"));
  await page.getByRole("button",{name:"Expired confirmation"}).click();
  await expect(page.getByRole("radio",{name:"Accept",exact:true})).toBeDisabled();
  await expect(submit).toBeDisabled();

  await page.setViewportSize({width:900,height:650});
  await page.evaluate(()=>{
    localStorage.setItem("mindfs-locale","zh-CN");
    window.dispatchEvent(new Event("mindfs:locale-changed"));
    document.body.style.cssText="margin:24px;font:14px system-ui;background:#1e1e1e;color:#ddd;--text-primary:#ddd;--text-secondary:#aaa;--border-color:#555;--content-bg:#252525";
  });
  await mount({kind:"form",title:"中文 MCP 表单",message:"输入配置后确认",actions:["accept","decline","cancel"],schema:{type:"object",properties:{name:{type:"string",title:"名称"}}}});
  await page.getByRole("radio",{name:"接受",exact:true}).check();
  await page.getByRole("textbox",{name:"名称",exact:true}).fill("本地配置");
  await page.screenshot({path:path.join(reports,"form-desktop-zh-dark.png")});
  assert.deepEqual(errors,[]);
});
