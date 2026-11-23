import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const written = [];
after(() => { for (const file of written) rmSync(file, { force: true }); });
async function load(entry) {
  const bundle = await build({ entryPoints: [new URL(entry, import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "node" });
  const dir = new URL("../node_modules/.cache/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL(`reconnect-policy-${Math.random().toString(36).slice(2)}.mjs`, dir);
  writeFileSync(file, bundle.outputFiles[0].text);
  written.push(file);
  return import(file.href);
}
const { RECONNECT_POLICY, retryDelayMs, connectTimeoutMs } = await load("../src/services/reconnectPolicy.ts");

test("retries back off and stop at the ceiling", () => {
  const middle = () => 0.5; // no jitter
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map(n => retryDelayMs(n, middle)), [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000]);
});

test("the first retry is exact; later ones are spread within the jitter and never collapse to zero", () => {
  assert.equal(retryDelayMs(1, () => 0), 1000);
  assert.equal(retryDelayMs(1, () => 1), 1000);
  for (const failures of [2, 3, 4, 5, 6, 9]) {
    const base = retryDelayMs(failures, () => 0.5);
    const low = retryDelayMs(failures, () => 0), high = retryDelayMs(failures, () => 1);
    assert.ok(low >= base * (1 - RECONNECT_POLICY.jitter) - 1 && high <= base * (1 + RECONNECT_POLICY.jitter) + 1, `${failures}: ${low}..${high} around ${base}`);
    assert.ok(low > 0);
  }
});

test("a slow handshake is given more time after each failure instead of being cut off at the same point", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(connectTimeoutMs), [5000, 8000, 12000, 20000, 20000, 20000]);
});

test("a probe is not allowed to be shorter than a slow round trip over the Relay", () => {
  // The storm began with a 2s probe every 3s. Round trips through the Relay tunnel can exceed that
  // without anything being wrong.
  assert.ok(RECONNECT_POLICY.probeTimeoutMs >= 8000);
  assert.ok(RECONNECT_POLICY.wakeProbeTimeoutMs >= 4000);
  assert.ok(RECONNECT_POLICY.probeIdleMs >= 10_000, "a connection that just spoke does not need a probe");
});

test("the number of attempts in ten minutes is bounded", () => {
  let elapsed = 0, attempts = 0;
  for (let failures = 1; elapsed < 600_000; failures++) {
    elapsed += retryDelayMs(failures, () => 0.5) + connectTimeoutMs(failures - 1);
    attempts++;
  }
  // The old behaviour tried every 3 seconds: about 200 times.
  assert.ok(attempts <= 30, `${attempts} attempts in ten minutes`);
});
