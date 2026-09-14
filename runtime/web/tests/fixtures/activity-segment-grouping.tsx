import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionViewer } from "../../src/components/SessionViewer";
import { I18nProvider } from "../../src/i18n";
import { sessionService } from "../../src/services/session";
const w = window as any;
w.requests = []; w.answers = []; w.detailText = {};
w.call = (id, patch = {}) => ({ callId: id, kind: "execute", status: "complete", meta: { command: "node scripts/check.mjs --file " + id }, ...patch });
w.exchanges = (calls, agent = "codex") => [
  { role: "user", seq: 1, agent, timestamp: new Date().toISOString(), content: "检查项目，并说明结果。" },
  { role: "assistant", seq: 2, agent, timestamp: new Date().toISOString(), content: "我会先查看项目说明，再检查代码与测试。" },
  ...calls.map(toolCall => ({ role: "tool", agent, toolCall })),
];
sessionService.getToolCallDetails = async ref => {
  w.requests.push(ref);
  const call = w.current.exchanges.find(ex => ex.toolCall?.callId === ref.callId)?.toolCall || w.call(ref.callId);
  return { kind: "loaded", toolCall: { ...call, content: [{ type: "text", text: w.detailText[ref.callId] || "原始完整日志 " + ref.callId }] } };
};
w.locale = locale => { w.ideaAgent = { ...w.ideaAgent, locale }; window.dispatchEvent(new Event("ideaAgentReady")); };
function App() {
  const [session, setSession] = useState({ key: "A", name: "项目检查", agent: "codex", pending: true, exchanges: w.exchanges([1, 2, 3].map(i => w.call("call-" + i))) });
  const [scope, setScope] = useState({ rootId: "root", connected: true, loading: false, visible: true });
  w.current = session;
  w.setSession = patch => setSession(previous => ({ ...previous, ...patch }));
  w.setScope = patch => setScope(previous => ({ ...previous, ...patch }));
  w.append = exchange => setSession(previous => ({ ...previous, exchanges: [...previous.exchanges, { agent: previous.agent, ...exchange }] }));
  w.updateCall = (id, patch) => setSession(previous => ({ ...previous, exchanges: previous.exchanges.map(ex => ex.toolCall?.callId === id ? { ...ex, toolCall: { ...ex.toolCall, ...patch } } : ex) }));
  w.event = () => sessionService.handleMessage({ type: "session.stream", payload: { root_id: scope.rootId, session_key: session.key, event: { type: "tool_call_update", data: w.call("call-3") } } });
  w.finish = () => { sessionService.handleMessage({ type: "session.done", payload: { root_id: scope.rootId, session_key: session.key } }); w.setSession({ pending: false }); };
  return <I18nProvider><main className="idea-workbench" id="fixture">{scope.visible &&
    <SessionViewer session={session as any} rootId={scope.rootId} rootPath="/project" connected={scope.connected} loading={scope.loading}
      onAskUserAnswer={async input => { w.answers.push(input); }} />
  }</main></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<App />);
