import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const fixture = `import { Fixture } from "./tests/fixtures/send-failure-resend";`;

test("a send that reported failure is not delivered again after reconnect", async (t) => {
  const page = await mount(t, fixture, () => ({}));
  await page.waitForFunction(() => window.sendFixture);
  await page.evaluate(() => window.sendFixture.attach());

  const result = page.evaluate(() => window.sendFixture.send("msg-lost"));
  await expect.poll(() => page.evaluate(() => window.sendFixture.encodingIds())).toEqual(["msg-lost"]);
  await page.evaluate(() => window.sendFixture.replaceSocket());
  await page.evaluate(() => window.sendFixture.finishEncoding());
  assert.equal(await result, false, "the caller is told the message was not sent");
  await page.evaluate(() => window.sendFixture.finishAllEncodings());

  await expect.poll(() => page.evaluate(() => window.sendFixture.pendingIds())).toEqual([]);
  const frames = await page.evaluate(() => window.sendFixture.sentFrames());
  assert.deepEqual(frames.flat(), [], "no socket may receive the message the caller was told failed");

  const retry = page.evaluate(() => window.sendFixture.send("msg-retry"));
  await expect.poll(() => page.evaluate(() => window.sendFixture.encodingIds())).toEqual(["msg-retry"]);
  await page.evaluate(() => window.sendFixture.finishEncoding());
  assert.equal(await retry, true);
  assert.deepEqual((await page.evaluate(() => window.sendFixture.sentFrames())).flat(), ["msg-retry"]);
});

test("a send that succeeded stays queued until the server accepts it", async (t) => {
  const page = await mount(t, fixture, () => ({}));
  await page.waitForFunction(() => window.sendFixture);
  await page.evaluate(() => window.sendFixture.attach());

  const result = page.evaluate(() => window.sendFixture.send("msg-ok"));
  await expect.poll(() => page.evaluate(() => window.sendFixture.encodingIds())).toEqual(["msg-ok"]);
  await page.evaluate(() => window.sendFixture.finishEncoding());
  assert.equal(await result, true);

  assert.deepEqual(await page.evaluate(() => window.sendFixture.pendingIds()), ["msg-ok"]);
  assert.deepEqual((await page.evaluate(() => window.sendFixture.sentFrames())).flat(), ["msg-ok"]);

  await page.evaluate(() => window.sendFixture.replaceSocket());
  await expect.poll(() => page.evaluate(() => window.sendFixture.encodingIds())).toEqual(["msg-ok"]);
  await page.evaluate(() => window.sendFixture.finishEncoding());
  await expect.poll(() => page.evaluate(() => window.sendFixture.sentFrames())).toEqual([["msg-ok"], ["msg-ok"]]);

  await page.evaluate(() => window.sendFixture.accept("msg-ok"));
  await expect.poll(() => page.evaluate(() => window.sendFixture.pendingIds())).toEqual([]);
  await page.evaluate(() => window.sendFixture.replaceSocket());
  assert.deepEqual(await page.evaluate(() => window.sendFixture.encodingIds()), []);
  assert.deepEqual(await page.evaluate(() => window.sendFixture.sentFrames()), [["msg-ok"], ["msg-ok"], []]);
});
