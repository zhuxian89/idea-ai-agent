import React from "react";
import { createRoot } from "react-dom/client";
import { SessionViewer } from "../../src/components/SessionViewer";
import { UserMessageSummaryButton } from "../../src/components/UserMessageSummaryButton";
import { I18nProvider } from "../../src/i18n";
import { buildBaseTimeline } from "../../src/hooks/useSessionStream";

// Long conversation: every turn is user + assistant, so user messages get seq 1, 3, 5, ...
const exchanges = Array.from({ length: 120 }, (_, turn) => [
  { role: "user", seq: turn * 2 + 1, agent: "codex", timestamp: new Date().toISOString(), content: `问题 ${turn + 1}` },
  { role: "assistant", seq: turn * 2 + 2, agent: "codex", timestamp: new Date().toISOString(), content: `回答 ${turn + 1}\n\n`.repeat(6) },
]).flat();
const session = { key: "A", name: "长对话", agent: "codex", pending: false, exchanges };

// Same mapping as App.tsx's ideaUserMessageSummaries.
const summaries = buildBaseTimeline(exchanges as any, {}).flatMap((item, index) =>
  item.type === "user_text" ? [{ id: item.id || `idea-user-${index}`, seq: Number(item.seq || index + 1), summary: item.content }] : []);

createRoot(document.getElementById("root")!).render(
  <I18nProvider><main className="idea-workbench" id="fixture">
    <UserMessageSummaryButton summaries={summaries} />
    <SessionViewer session={session as any} rootId="root" rootPath="/project" connected loading={false}
      onAskUserAnswer={async () => {}} />
  </main></I18nProvider>,
);
