import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToolCallCard } from "../../src/components/stream/ToolCallCard";
import { SessionViewer } from "../../src/components/SessionViewer";
import { I18nProvider } from "../../src/i18n";
import { sessionService } from "../../src/services/session";

const w = window as any;
w.requests = [];
w.controlled = false;
w.remoteResult = { kind: "loaded", toolCall: { callId: "call", kind: "execute", status: "complete", content: [{ type: "text", text: "first line\nfull output" }] } };
sessionService.getToolCallDetails = (ref, signal) => {
  const request = { ...ref, signal, time: Date.now() } as any;
  w.requests.push(request);
  return w.controlled ? new Promise(resolve => { request.resolve = resolve; }) : Promise.resolve(w.remoteResult);
};
w.reply = (index, result) => w.requests[index].resolve(result);
w.copied = [];
w.failCopy = false;
document.execCommand = () => {
  if (w.failCopy) return false;
  w.copied.push((document.activeElement as HTMLTextAreaElement).value);
  return true;
};
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("blocked"); } } });
w.locale = locale => { w.ideaAgent = { ...w.ideaAgent, locale }; window.dispatchEvent(new Event("ideaAgentReady")); };
w.sessionEvents = 0;
sessionService.subscribe("A", () => w.sessionEvents++);
const initialCall = { callId: "call", kind: "execute", title: "Run checks", status: "complete", meta: { command: "  printf '原始命令'\n  " }, content: [{ type: "text", text: "first line" }] };
function App() {
  const [state, setState] = useState({ rootId: "root", sessionKey: "A", call: initialCall, defaultExpanded: false, localKey: "local-1", visible: true, duplicate: false, viewer: false });
  const [exchanges, setExchanges] = useState([
    { role: "user", content: "检查项目", timestamp: new Date().toISOString(), seq: 1 },
    { role: "assistant", content: "我会检查项目并运行验证。\n\n".repeat(40), timestamp: new Date().toISOString(), seq: 2 },
    { role: "tool", toolCall: initialCall, seq: 3 },
  ]);
  w.set = patch => setState(prev => ({ ...prev, ...patch }));
  w.updateCall = patch => setState(prev => ({ ...prev, call: { ...prev.call, ...patch } }));
  w.append = content => setExchanges(prev => [...prev, { role: "assistant", content, timestamp: new Date().toISOString(), seq: prev.length + 1 }]);
  const card = <ToolCallCard {...state.call} rootId={state.rootId} sessionKey={state.sessionKey}
    localKey={state.localKey} defaultExpanded={state.defaultExpanded} />;
  return <I18nProvider><main className="idea-workbench" id="fixture">
    {state.viewer ? <SessionViewer rootId={state.rootId} rootPath="/project" session={{ key: state.sessionKey, agent: "codex", exchanges, pending: true } as any} />
      : <article><p>我会先查看项目说明，再运行检查。</p>{state.visible && <div data-card="primary">{card}</div>}
        {state.duplicate && <div data-card="duplicate">{card}</div>}<p>检查完成后，这里显示最终回答。</p></article>}
  </main></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<App />);
