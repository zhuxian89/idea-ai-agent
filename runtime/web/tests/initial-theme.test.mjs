import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

const html = fs.readFileSync("index.html", "utf8");
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function loadTheme({ stored = null, theme = "", systemDark = false, blockedStorage = false } = {}) {
  const attributes = new Map([["data-theme", "dark"]]);
  const document = {
    documentElement: {
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
    },
    querySelectorAll: () => [],
    getElementById: () => ({}),
  };
  const window = {
    location: { search: theme ? `?ide_theme=${encodeURIComponent(theme)}` : "" },
    localStorage: { getItem: () => { if (blockedStorage) throw new Error("Storage blocked"); return stored; } },
    matchMedia: () => ({ matches: systemDark }),
  };
  vm.runInNewContext(bootstrap, { document, window, URLSearchParams });
  return { document, window };
}

test("first visit has a dark background before external assets load", () => {
  assert.match(html, /<html[^>]+data-theme="dark"/);
  assert.match(html, /html \{ background: #1e1f22; color-scheme: dark; \}/);
  assert.match(html, /html\[data-theme="light"\] \{ background: #ffffff; color-scheme: light; \}/);
  assert.equal(loadTheme().document.documentElement.getAttribute("data-theme"), "dark");
});

test("IDE theme overrides stale storage and the operating system theme", () => {
  for (const theme of ["dark", "light"]) {
    const opposite = theme === "dark" ? "light" : "dark";
    const { document } = loadTheme({ theme, stored: opposite, systemDark: opposite === "dark" });
    assert.equal(document.documentElement.getAttribute("data-theme"), theme);
  }
});

test("blocked storage and invalid theme parameters keep the dark fallback", () => {
  for (const options of [{ blockedStorage: true }, { theme: "invalid" }, { theme: "dark", blockedStorage: true }]) {
    assert.equal(loadTheme(options).document.documentElement.getAttribute("data-theme"), "dark");
  }
  assert.equal(loadTheme({ theme: "light", blockedStorage: true }).document.documentElement.getAttribute("data-theme"), "light");
});

test("saved appearance still applies when no IDE theme is supplied", () => {
  assert.equal(loadTheme({ stored: "light" }).document.documentElement.getAttribute("data-theme"), "light");
  assert.equal(loadTheme({ stored: "system" }).document.documentElement.getAttribute("data-theme"), null);
});

test("React startup preserves the early IDE theme instead of restoring stale storage", () => {
  for (const theme of ["dark", "light"]) {
    const context = loadTheme({ theme, stored: theme === "dark" ? "light" : "dark" });
    const appearance = { ...context, exports: {} };
    const transpile = (path) => ts.transpileModule(fs.readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    }).outputText;
    vm.runInNewContext(transpile("src/services/appearance.ts"), appearance);
    vm.runInNewContext(transpile("src/ide-main.tsx"), {
      ...context,
      exports: {},
      require: (name) => {
        if (name === "./services/appearance") return appearance.exports;
        if (name === "react") return { default: { createElement: () => null } };
        if (name === "react-dom/client") return { createRoot: () => ({ render: () => {} }) };
        return {};
      },
    });
    assert.equal(context.document.documentElement.getAttribute("data-theme"), theme);
  }
});
