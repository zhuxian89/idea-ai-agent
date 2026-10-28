import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ActionBar } from "../../src/components/ActionBar";
import { I18nProvider } from "../../src/i18n";
import { bootstrapService } from "../../src/services/bootstrap";
import { promoteComposerDraft } from "../../src/services/composerDrafts";
import "../../src/index.css";
import "../../src/ide.css";

bootstrapService.canUseProtectedAPI = () => true;
window.ideaAgent = { locale: "zh-CN", postMessage: () => {} } as any;
window.fetch = async () => Response.json({
  agents: [{ name: "codex", installed: true, available: true, models: [] }], shells: [],
});

function Fixture() {
  const [session, setSession] = useState("original");
  const [root, setRoot] = useState("project-one");
  const [pending, setPending] = useState(true);
  const [sent, setSent] = useState(0);
  const [cancelled, setCancelled] = useState(0);
  const [finish, setFinish] = useState<(() => void) | null>(null);
  const promote = () => {
    promoteComposerDraft(root, session, "accepted-session");
    setSession("accepted-session");
  };
  return <I18nProvider><main className="idea-workbench" style={{ padding: 16 }}>
    <div role="status">project={root}; session={session || "new"}; sent={sent}; cancelled={cancelled}</div>
    <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
      <button onClick={() => window.ideaAgentReceiveContext?.("Current console error", "current")}>当前会话分析</button>
      <button onClick={() => window.ideaAgentReceiveContext?.("New console error", "new")}>新会话分析</button>
      <button onClick={() => setSession("original")}>原会话</button>
      <button onClick={() => setSession("")}>空白会话</button>
      <button onClick={() => setSession("second")}>第二会话</button>
      <button onClick={() => setRoot(root === "project-one" ? "project-two" : "project-one")}>切换项目</button>
      <button onClick={promote}>正式会话 ID</button>
      <button onClick={() => setPending(value => !value)}>切换运行态</button>
      <button onClick={() => finish?.()}>完成发送</button>
    </nav>
    <ActionBar compactWorkbench status="connected" currentRootId={root}
      currentSession={session ? { key: session, name: session, type: "chat", agent: "codex", pending } : null}
      onNewSession={() => setSession("")}
      onCancelCurrentTurn={() => setCancelled(value => value + 1)}
      onSendMessage={async () => {
        setSent(value => value + 1);
        if (!session) { promoteComposerDraft(root, "", "pending-test"); setSession("pending-test"); }
        await new Promise<void>(resolve => setFinish(() => resolve));
        setFinish(null);
      }} />
  </main></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
