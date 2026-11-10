import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const fixture = `
  import { sessionService } from "./src/services/session";

  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = FakeSocket.CONNECTING;
    onopen: any; onmessage: any; onclose: any; onerror: any;
    constructor() {
      sockets.push(this);
      queueMicrotask(() => {
        if (this.readyState !== FakeSocket.CONNECTING) return;
        this.readyState = FakeSocket.OPEN;
        this.onopen?.();
      });
    }
    send(raw: string) {
      const message = JSON.parse(raw);
      if (message.type === "ping") {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "pong", id: message.id }) }));
      }
    }
    close() { this.readyState = FakeSocket.CLOSED; }
  }
  (window as any).WebSocket = FakeSocket;

  let finishOpening: () => void;
  if (window.location.pathname === "/pending") {
    (sessionService as any).buildWSUrl = () => new Promise<string>(resolve => {
      finishOpening = () => resolve("wss://app-components.test/ws");
    });
  }
  (window as any).connectionFixture = {
    count: () => sockets.length,
    finishOpening: () => finishOpening(),
    loseConnection: () => {
      const socket = sockets[sockets.length - 1];
      socket.close();
      socket.onclose?.({ code: 1006, reason: "", wasClean: false });
    },
  };

  function ConnectedApp() {
    useEffect(() => {
      sessionService.connect("root");
      return () => sessionService.disconnect();
    }, []);
    return <p>Connected app</p>;
  }
  function Fixture() {
    const [visible, setVisible] = useState(true);
    return <><button onClick={() => setVisible(value => !value)}>Toggle app</button>{visible && <ConnectedApp />}</>;
  }
`;

test("unmount stops automatic reconnect; remount and unexpected disconnection still connect", async (t) => {
  const page = await mount(t, fixture, () => ({}));
  const socketCount = () => page.evaluate(() => window.connectionFixture.count());
  await expect.poll(socketCount).toBe(1);

  await page.getByRole("button", { name: "Toggle app" }).click();
  await expect(page.getByText("Connected app")).toHaveCount(0);
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    for (const type of ["online", "focus", "pageshow"]) window.dispatchEvent(new Event(type));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await socketCount(), 1, "watchdog and page events must not reconnect an unmounted app");

  await page.getByRole("button", { name: "Toggle app" }).click();
  await expect.poll(socketCount).toBe(2);
  await page.evaluate(() => window.connectionFixture.loseConnection());
  await expect.poll(socketCount).toBe(3);
});

test("unmount while preparing the connection does not open a late socket", async (t) => {
  const page = await mount(t, fixture, () => ({}), 900, "/pending");
  await expect(page.getByText("Connected app")).toBeVisible();
  await page.getByRole("button", { name: "Toggle app" }).click();
  await page.evaluate(() => window.connectionFixture.finishOpening());
  await page.waitForTimeout(3500);
  assert.equal(await page.evaluate(() => window.connectionFixture.count()), 0);
});
