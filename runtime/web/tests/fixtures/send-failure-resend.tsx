import { e2eeService } from "../../src/services/e2ee";
import { sessionService } from "../../src/services/session";

// Use the service's real connection handlers and control asynchronous encoding.
const w = window as any;
w.sockets = [];
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: any; onmessage: any; onclose: any; onerror: any;
  constructor() { w.sockets.push(this); }
  open() { this.readyState = FakeSocket.OPEN; this.onopen(); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
}
w.WebSocket = FakeSocket;

const encodings: { id: string; finish: () => void }[] = [];
// mount() resets isRequired after this module loads, so the E2EE stand-ins are installed per test.
const requireE2EE = () => {
  (e2eeService as any).isRequired = () => true;
  (e2eeService as any).hasSecret = () => true;
  (e2eeService as any).ensureSession = async () => null;
  (e2eeService as any).encodeWSMessage = (value: { id: string }) => new Promise<string>(resolve => {
    encodings.push({ id: value.id, finish: () => resolve(JSON.stringify(value)) });
  });
  (e2eeService as any).decodeWSMessage = async (raw: string) => JSON.parse(raw);
};

const service = sessionService as any;
w.sendFixture = {
  attach: async () => {
    requireE2EE();
    service.buildWSUrl = async () => "wss://app-components.test/ws";
    sessionService.connect("root");
    await Promise.resolve();
    service.ws.open();
  },
  send: (id: string) => sessionService.sendMessage("root", "s1", "hello", "chat", "codex",
    undefined, undefined, undefined, undefined, undefined, undefined, id),
  replaceSocket: async () => {
    service.ws.close();
    service.ws.onclose({ code: 1006, reason: "", wasClean: false });
    sessionService.connect("root");
    await Promise.resolve();
    service.ws.open();
  },
  encodingIds: () => encodings.map(item => item.id),
  finishEncoding: () => encodings.shift()!.finish(),
  finishAllEncodings: () => { for (const item of encodings.splice(0)) item.finish(); },
  accept: (id: string) => service.ws.onmessage({ data: JSON.stringify({
    type: "session.accepted", payload: { request_id: id, root_id: "root", session_key: "s1" },
  }) }),
  pendingIds: () => Array.from(service.pendingMessages.keys()),
  sentFrames: () => w.sockets.map((socket: FakeSocket) => socket.sent.map((raw) => JSON.parse(raw).id)),
};
const Fixture = () => null;
export { Fixture };
