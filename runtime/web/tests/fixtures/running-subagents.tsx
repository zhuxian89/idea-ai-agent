import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionViewer } from "../../src/components/SessionViewer";
import { I18nProvider } from "../../src/i18n";
import { sessionService } from "../../src/services/session";

const w = window as any;
w.opened = [];
w.stopped = [];
w.stopResults = [];
// What the server sends back for the last stop request.
w.reply = (type: string, error?: { code: string; message: string }) => {
  const request = w.stopped[w.stopped.length - 1];
  (sessionService as any).handleMessage({ id: request.id, type, payload: {}, error });
};

// What the backend emits for a Task call: kind "task", rawType "claude_task".
w.subagent = (callId: string, status: string, patch: Record<string, unknown> = {}) => ({
  role: "tool", agent: "claude",
  toolCall: {
    callId, status, kind: "task", rawType: "claude_task", title: patch.title ?? "Search " + callId,
    meta: { taskId: "task-" + callId, parentToolUseId: callId, subagentType: "Explore", progress: "reading files", ...patch.meta as object },
  },
});

// The real service, with the socket send recorded instead of opened.
(sessionService as any).ws = { readyState: 1, send: (raw: string) => w.stopped.push(JSON.parse(raw)), close() {} };
w.sessionClosed = () => (sessionService as any).closeSocket();
const realWebSocket = window.WebSocket;
(window as any).WebSocket = Object.assign(function () {}, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 });
void realWebSocket;

function App() {
  const [session, setSession] = useState<any>({
    key: "parent", name: "parent", agent: "claude", pending: true,
    exchanges: [
      { role: "user", seq: 1, agent: "claude", timestamp: new Date().toISOString(), content: "investigate" },
      w.subagent("toolu-a", "running"),
      w.subagent("toolu-b", "running", { title: "Review tests" }),
      w.subagent("toolu-c", "complete", { title: "Already done" }),
    ],
  });
  w.setSession = (patch: object) => setSession((previous: object) => ({ ...previous, ...patch }));
  w.finishSubagent = (callId: string) => setSession((previous: any) => ({
    ...previous,
    exchanges: previous.exchanges.map((ex: any) => ex.toolCall?.callId === callId ? { ...ex, toolCall: { ...ex.toolCall, status: "complete" } } : ex),
  }));
  return <I18nProvider><main className="idea-workbench" id="fixture">
    <SessionViewer session={session} rootId="root" rootPath="/project" connected loading={false}
      onAskUserAnswer={async () => {}}
      onOpenSubagent={(subagent) => w.opened.push(subagent)}
      onStopSubagent={(subagent) => {
        // Same shape as App's handler: the failure reason is what the user would be shown.
        sessionService.stopTask("root", "parent", subagent.stopRef).then(
          () => w.stopResults.push({ ok: true }),
          (error) => w.stopResults.push({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
      }} />
  </main></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<App />);
