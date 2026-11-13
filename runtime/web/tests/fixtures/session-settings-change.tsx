import React from "react";
import { createRoot } from "react-dom/client";
import { SessionViewer } from "../../src/components/SessionViewer";
import { I18nProvider } from "../../src/i18n";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 11, 8, 0, seconds)).toISOString();
const user = (seq: number, content: string, patch: Record<string, unknown>) =>
  ({ role: "user", seq, agent: "codex", timestamp: at(seq), content, ...patch });
const reply = (seq: number) => ({ role: "agent", seq, agent: "codex", timestamp: at(seq), content: `reply ${seq}` });

const session = {
  key: "A", name: "settings", agent: "codex", pending: false,
  exchanges: [
    user(1, "first", { model: "m1", model_display_name: "Model 1", effort: "high", fast_service: "off" }),
    reply(2),
    user(3, "same settings", { model: "m1", model_display_name: "Model 1", effort: "high", fast_service: "off" }),
    reply(4),
    user(5, "all three change", { model: "m2", model_display_name: "Model 2", effort: "low", fast_service: "on" }),
    reply(6),
    // A different agent has its own settings; nothing is comparable with codex.
    user(7, "other agent", { agent: "claude", model: "c1", effort: "", fast_service: "" }),
    reply(8),
    user(9, "other agent again", { agent: "claude", model: "c1", effort: "", fast_service: "" }),
  ],
};

createRoot(document.getElementById("root")!).render(
  <I18nProvider><main className="idea-workbench" id="fixture">
    <SessionViewer session={session as any} rootId="root" rootPath="/project" connected loading={false}
      onAskUserAnswer={async () => {}} />
  </main></I18nProvider>,
);
