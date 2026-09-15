import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const webDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("class anchors and source paths are handed to IDEA navigation", async t => {
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
        createRoot(document.getElementById("root")).render(
          <I18nProvider><MarkdownViewer
            content={"[CheckPlanAutoJobStatusEnum](#CheckPlanAutoJobStatusEnum) [Worker](src/main/java/Worker.java:42)"}
            root="root"
            onFileClick={(path) => window.opened.push(path)}
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
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText("CheckPlanAutoJobStatusEnum").click();
  await page.getByText("Worker").click();
  assert.deepEqual(await page.evaluate(() => window.opened), [
    "CheckPlanAutoJobStatusEnum",
    "src/main/java/Worker.java:42",
  ]);
});
