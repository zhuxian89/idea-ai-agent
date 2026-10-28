import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { agentDisplayName } from "../services/agentSetup";
import "./AgentModelRefresh.css";

export function AgentModelRefresh({ agent, onRefresh }: {
  agent: string;
  onRefresh: (agent: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const busy = useRef(false);
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const refresh = async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase("loading");
    setError("");
    try {
      await onRefresh(agent);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      busy.current = false;
    }
  };
  return <div className="agent-model-refresh">
    <button type="button" disabled={phase === "loading"} aria-busy={phase === "loading"}
      title={t("agent.refreshModelsHint", { name: agentDisplayName(agent) })}
      aria-label={t("agent.refreshModelsLabel", { name: agentDisplayName(agent) })}
      onClick={() => void refresh()}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 19.5 9M4.5 15a8 8 0 0 0 13.4 2.9" />
      </svg>
      <span>{t(phase === "loading" ? "agent.refreshingModels" : "agent.refreshModels")}</span>
    </button>
    {phase === "done" ? <p role="status">{t("agent.modelsRefreshed")}</p> : null}
    {phase === "error" ? <p role="alert">{t("agent.modelsRefreshFailed")}<span>{error}</span></p> : null}
  </div>;
}
