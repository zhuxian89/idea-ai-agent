import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentSelector } from "../../src/components/AgentSelector";
import { I18nProvider } from "../../src/i18n";
import type { AgentStatus } from "../../src/services/agents";

function Fixture() {
  const [agent, setAgent] = useState("codex");
  const [agents, setAgents] = useState<AgentStatus[]>([
    { name: "codex", installed: true, available: false, probe_pending: true },
    { name: "claude", installed: true, available: false, error: "Sign in required" },
  ]);
  (window as any).setAgents = setAgents;
  (window as any).setAgent = setAgent;
  return <I18nProvider><main className="idea-workbench" style={{ padding: 16, paddingTop: 300 }}>
    <AgentSelector agent={agent} agents={agents} warnUnavailable={agents.find(item => item.name === agent)?.available === false} showLabel stableLayout viewportMenu closeOnSelect={false} onAgentChange={setAgent}
      onAgentRestart={async name => {
        const w = window as any;
        w.restarts = [...(w.restarts || []), name];
        await new Promise(resolve => { w.finishRestart = resolve; });
      }} />
  </main></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
