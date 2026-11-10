import { e2eeService } from "../../src/services/e2ee";
import { sessionService } from "../../src/services/session";

// Records every frame sent to each socket. The test decides when the E2EE handshake ends.
const w = window as any;
w.sockets = [];
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 1;
  sent: string[] = [];
  onopen: any; onmessage: any; onclose: any; onerror: any;
  constructor() { w.sockets.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
}
w.WebSocket = FakeSocket;

let finishHandshake: () => void = () => {};
// mount() resets isRequired after this module loads, so the E2EE stand-ins are installed per test.
const requireE2EE = () => {
  (e2eeService as any).isRequired = () => true;
  (e2eeService as any).hasSecret = () => true;
  (e2eeService as any).ensureSession = () => new Promise<null>((resolve) => { finishHandshake = () => resolve(null); });
  (e2eeService as any).encodeWSMessage = async (value: unknown) => JSON.stringify(value);
};

const service = sessionService as any;
w.sendFixture = {
  attach: () => { requireE2EE(); service.ws = new FakeSocket(); },
  send: (id: string) => sessionService.sendMessage("root", "s1", "hello", "chat", "codex",
    undefined, undefined, undefined, undefined, undefined, undefined, id),
  // The connection is replaced while the handshake is still running.
  replaceSocket: () => { service.ws?.close(); service.ws = new FakeSocket(); },
  // The handshake ends, then the new connection opens and resends whatever is queued.
  finishHandshakeAndOpen: () => { finishHandshake(); service.ws.onopen?.(); },
  finishHandshake: () => finishHandshake(),
  pendingIds: () => Array.from(service.pendingMessages.keys()),
  sentFrames: () => w.sockets.map((socket: FakeSocket) => socket.sent.map((raw) => JSON.parse(raw).id)),
};
const Fixture = () => null;
export { Fixture };
