import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const webDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("file and class links open in IDEA without reloading an initial or existing conversation", async t => {
  const cases = [
    ["CheckPlanAutoJobStatusEnum", "#CheckPlanAutoJobStatusEnum", "CheckPlanAutoJobStatusEnum"],
    ["Worker", "src/main/java/Worker.java:42", "src/main/java/Worker.java:42"],
    ["README.md", "Z:/java_project/zhszh-wz-lab-system/README.md", "Z:/java_project/zhszh-wz-lab-system/README.md"],
    ["Windows URI", "file:///Z:/java_project/Chinese%20dir/README.md#L3", "Z:/java_project/Chinese dir/README.md#L3"],
    ["POSIX URI", "file:///Users/test/project/README.md", "/Users/test/project/README.md"],
    ["README line", "README.md:8", "README.md:8"],
    ["Windows line", "Z:/java_project/README.md:12:3", "Z:/java_project/README.md:12:3"],
    ["Windows backslashes", "Z:\\java_project\\README.md", "Z:/java_project/README.md"],
    ["Literal percent", "docs/100%done.md", "docs/100%done.md"],
  ];
  const markdown = cases.map(([label, href]) => `[${label}](${href})`).join(" ") + ' [unsafe](javascript:alert) [empty]() <script>window.scriptRan = true</script> <a href="javascript:window.scriptRan=true" onclick="window.scriptRan=true">unsafe HTML</a>';
  const bundle = await build({
    stdin: {
      resolveDir: webDir,
      sourcefile: "markdown-idea-navigation.tsx",
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { I18nProvider } from "./src/i18n";
        import { MarkdownViewer } from "./src/components/MarkdownViewer";
        window.opened = [];
        window.bridgeCalls = [];
        window.ideaAgent = { postMessage: payload => window.bridgeCalls.push(payload) };
        createRoot(document.getElementById("root")).render(
          <I18nProvider><MarkdownViewer
            content={${JSON.stringify(markdown)}}
            root="root"
            onFileClick={(path) => window.opened.push(path)}
          /><MarkdownViewer root="root" currentPath="docs/guide.md"
            content={'[Plan file](file:///Z:/java_project/README.md) <a href="file:///Users/test/project/README.md">Raw file</a>'}
          /></I18nProvider>,
        );
      `,
    },
    bundle: true,
    write: false,
    outdir: "/tmp/markdown-idea-navigation",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    external: ["mermaid"],
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_NATIVE_PLATFORM": '""' },
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(script);
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage();
  for (const suffix of ["", "?session=existing-session"]) {
    const url = `http://127.0.0.1:${server.address().port}/${suffix}`;
    await page.goto(url);
    let navigations = 0;
    const onNavigation = frame => { if (frame === page.mainFrame()) navigations++; };
    page.on("framenavigated", onNavigation);
    for (const [index, [label]] of cases.entries()) {
      await page.getByText(label, {exact: true}).click();
      assert.deepEqual(await page.evaluate(() => window.opened), cases.slice(0, index + 1).map(item => item[2]), label);
    }
    for (const label of ["unsafe", "empty", "unsafe HTML"]) await page.getByText(label, {exact: true}).click();
    assert.deepEqual(await page.evaluate(() => window.opened), cases.map(item => item[2]));
    assert.equal(await page.evaluate(() => window.scriptRan), undefined);
    await page.getByText("Plan file", {exact: true}).click();
    await page.getByText("Raw file", {exact: true}).click();
    assert.deepEqual(await page.evaluate(() => window.bridgeCalls), [
      {action: "openFile", rootId: "root", path: "Z:/java_project/README.md"},
      {action: "openFile", rootId: "root", path: "/Users/test/project/README.md"},
    ]);
    assert.equal(page.url(), url);
    assert.equal(navigations, 0, "file, empty and rejected links must never reload the chat");
    page.off("framenavigated", onNavigation);
  }
});
