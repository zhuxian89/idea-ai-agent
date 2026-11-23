import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sessionHarness } from "./helpers/session-clock-harness.mjs";

// RECONNECT_UNDER_TEST=previous runs the same scenarios against the code from before the fix
// (kept in /tmp by whoever is checking that these tests would have failed on it).
const implementation = process.env.SESSION_IMPL_FILE ? readFileSync(process.env.SESSION_IMPL_FILE, "utf8") : undefined;
const harness = t => sessionHarness(t, { implementation });
const gaps = times => times.slice(1).map((at, i) => at - times[i]);

test("a path where the handshake never completes is retried with growing gaps, not every few seconds", async t => {
  const h = await harness(t);
  await h.mode("hang");
  await h.connect();
  await h.advance(10 * 60_000);
  const attempts = await h.attempts();
  assert.ok(attempts.length <= 25, `${attempts.length} connection attempts in ten minutes`);
  const g = gaps(attempts);
  assert.ok(Math.max(...g) >= 15_000, `the wait never grew: gaps ${g.join(",")}`);
  assert.ok(g.slice(-3).every(gap => gap >= 12_000), `late gaps still short: ${g.slice(-3).join(",")}`);
});

test("a connection that opens and is dropped again keeps backing off instead of restarting at one second", async t => {
  const h = await harness(t);
  await h.mode("flap", { closeAfterMs: 5000 });
  await h.connect();
  await h.advance(5 * 60_000);
  const attempts = await h.attempts();
  assert.ok(attempts.length <= 20, `${attempts.length} attempts in five minutes of flapping`);
  const g = gaps(attempts);
  assert.ok(g[3] > g[0] + 3000, `gaps did not grow while flapping: ${g.join(",")}`);
});

test("a slow reply to a probe does not kill a connection that is working", async t => {
  const h = await harness(t);
  await h.mode("open");
  await h.connect();
  await h.advance(1000);
  assert.equal((await h.attempts()).length, 1);
  // Silent for longer than the probe idle threshold, then a reply that takes 6 seconds (> the old 2s).
  let answered = false;
  for (let i = 0; i < 80 && !answered; i++) {
    await h.advance(1000);
    const probes = (await h.sent()).filter(m => m.type === "ping");
    if (probes.length) {
      await h.advance(6000);
      await h.latest("reply", { type: "pong" });
      answered = true;
    }
  }
  assert.ok(answered, "the idle connection was never probed");
  // The late reply counts as proof of life: nothing is replaced, and no new probe is due yet.
  await h.advance(12_000);
  assert.equal((await h.attempts()).length, 1, "a working connection was replaced because a reply was slow");
  assert.equal((await h.sent()).filter(m => m.type === "ping").length, 1, "probed again right after a reply");
});

test("a connection that really died is replaced once the probe goes unanswered", async t => {
  const h = await harness(t);
  await h.mode("open");
  await h.connect();
  await h.advance(60_000);
  assert.ok((await h.attempts()).length >= 2, "an unanswered probe must lead to a new connection");
});

test("an open connection that keeps receiving data is never probed", async t => {
  const h = await harness(t);
  await h.mode("open");
  await h.connect();
  for (let i = 0; i < 120; i++) { await h.advance(1000); await h.latest("reply", { type: "pong" }); }
  assert.equal((await h.sent()).filter(m => m.type === "ping").length, 0);
  assert.equal((await h.attempts()).length, 1);
});

test("coming back to the foreground retries at once, but only once for a burst of events", async t => {
  const h = await harness(t);
  await h.mode("flap", { closeAfterMs: 1000 });
  await h.connect();
  await h.advance(80_000); // deep into the backoff
  const before = (await h.attempts()).length;
  await h.mode("hang");
  await h.advance(20_000); // make sure the next retry is not already due: pause is long by now
  const quiet = (await h.attempts()).length;
  for (const name of ["online", "pageshow", "focus", "online"]) await h.dispatch(name);
  await h.advance(500);
  const after = (await h.attempts()).length;
  assert.ok(after - quiet <= 1, `${after - quiet} attempts for one wake-up`);
  assert.ok(before <= quiet);
});

test("a person sending a message while disconnected does not wait out the backoff", async t => {
  const h = await harness(t);
  await h.mode("hang");
  await h.connect();
  await h.advance(120_000); // several failures: the next scheduled retry is far away
  const before = (await h.attempts()).length;
  await h.mode("open");
  await h.page.evaluate(() => window.session.sendWSMessage({ type: "session.message", payload: {} }));
  await h.advance(1000);
  const after = (await h.attempts()).length;
  assert.equal(after - before, 1, "sending did not trigger an immediate connection attempt");
});

test("after a connection has stayed up the backoff starts over", async t => {
  const h = await harness(t);
  await h.mode("hang");
  await h.connect();
  await h.advance(120_000); // failures have grown
  await h.mode("open");
  await h.dispatch("online");
  await h.advance(15_000); // open for longer than the healthy threshold
  await h.latest("reply", { type: "pong" });
  const count = (await h.attempts()).length;
  await h.latest("serverClose", 1006);
  await h.advance(1500);
  assert.equal((await h.attempts()).length, count + 1, "the first retry after a healthy connection should take about one second");
});
