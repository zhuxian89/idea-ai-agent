import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const webDir = fileURLToPath(new URL("../../", import.meta.url));

/**
 * A page with the real SessionService, a scripted WebSocket and a fake clock.
 * `implementation` may replace src/services/session.ts with another file's text, so a test can be
 * run against the previous code to show that it would have caught the bug.
 */
export async function sessionHarness(t, { implementation } = {}) {
  const bundle = await build({
    stdin: { resolveDir: webDir, loader: "tsx", contents: `
      import { sessionService } from "./src/services/session";
      import { e2eeService } from "./src/services/e2ee";
      e2eeService.isRequired = () => false;
      window.session = sessionService;
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
    plugins: implementation ? [{ name: "previous-session", setup(b) {
      b.onResolve({ filter: /\/services\/session$/ }, () => ({ path: "previous-session", namespace: "previous" }));
      b.onLoad({ filter: /.*/, namespace: "previous" }, () => ({ contents: implementation, loader: "ts", resolveDir: `${webDir}src/services` }));
    } }] : [],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "en-US" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    // Every attempt is recorded. Behaviour is chosen per test through window.net.
    window.net = { mode: "hang", closeAfterMs: 0, created: [], sent: [] };
    class FakeWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3;
      constructor(url) {
        this.url = url; this.readyState = 0;
        window.net.created.push({ at: Date.now(), socket: this });
        if (window.net.mode === "open" || window.net.mode === "flap") {
          Promise.resolve().then(() => { this.readyState = 1; this.onopen?.({}); });
          if (window.net.mode === "flap") setTimeout(() => this.serverClose(1006), window.net.closeAfterMs);
        }
      }
      send(raw) { window.net.sent.push({ at: Date.now(), message: JSON.parse(raw) }); }
      close() { this.readyState = 3; }
      serverClose(code = 1006) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code, reason: "", wasClean: false }); }
      reply(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    }
    window.WebSocket = FakeWebSocket;
  });
  await page.clock.install({ time: 0 });
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" })
    : route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.goto("https://reconnect.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const api = {
    page,
    errors,
    /** Move the fake clock forward in small steps so timers and promises interleave as they would live. */
    async advance(ms, step = 250) {
      for (let left = ms; left > 0; left -= step) await page.clock.runFor(Math.min(step, left));
    },
    attempts: () => page.evaluate(() => window.net.created.map(c => c.at)),
    sent: () => page.evaluate(() => window.net.sent.map(m => ({ at: m.at, type: m.message.type }))),
    mode: (mode, extra = {}) => page.evaluate(([m, e]) => Object.assign(window.net, { mode: m }, e), [mode, extra]),
    connect: () => page.evaluate(() => window.session.connect("root")),
    latest: (fn, arg) => page.evaluate(([name, a]) => { const s = window.net.created.at(-1).socket; return s[name](a); }, [fn, arg]),
    dispatch: name => page.evaluate(n => window.dispatchEvent(new Event(n)), name),
  };
  t.after(() => { if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`); });
  return api;
}

export function previousSession() {
  return readFileSync(new URL("../../src/services/session.ts", import.meta.url), "utf8");
}
