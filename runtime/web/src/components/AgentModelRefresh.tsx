import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { agentDisplayName } from "../services/agentSetup";
import "./AgentModelRefresh.css";

type Phase = "idle" | "loading" | "done" | "error";

export function AgentModelRefresh({ agent, onRefresh, onRestart }: {
  agent: string;
  onRefresh?: (agent: string) => Promise<void>;
  onRestart?: (agent: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const busy = useRef(false);
  const [refresh, setRefresh] = useState<Phase>("idle");
  const [restart, setRestart] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const run = async (action: (agent: string) => Promise<void>, setPhase: (phase: Phase) => void, finished: Phase) => {
    if (busy.current) return;
    busy.current = true;
    setRefresh("idle");
    setRestart("idle");
    setPhase("loading");
    setError("");
    try {
      await action(agent);
      setPhase(finished);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      busy.current = false;
    }
  };
  const loading = refresh === "loading" || restart === "loading";
  const name = agentDisplayName(agent);
  return <div className="agent-model-refresh">
    <div className="agent-model-actions">
      {onRefresh ? <button type="button" disabled={loading} aria-busy={refresh === "loading"}
        title={t("agent.refreshModelsHint", { name })}
        aria-label={t("agent.refreshModelsLabel", { name })}
        onClick={() => void run(onRefresh, setRefresh, "done")}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 19.5 9M4.5 15a8 8 0 0 0 13.4 2.9" />
        </svg>
        <span>{t(refresh === "loading" ? "agent.refreshingModels" : "agent.refreshModels")}</span>
      </button> : null}
      {onRestart ? <button type="button" disabled={loading} aria-busy={restart === "loading"}
        title={t("agent.restartHint", { name })}
        aria-label={t("agent.restartLabel", { name })}
        onClick={() => void run(onRestart, setRestart, "idle")}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0" />
        </svg>
        <span>{t(restart === "loading" ? "agentConfig.restarting" : "agentConfig.restart")}</span>
      </button> : null}
    </div>
    {refresh === "done" ? <p role="status">{t("agent.modelsRefreshed")}</p> : null}
    {refresh === "error" ? <p role="alert">{t("agent.modelsRefreshFailed")}<span>{error}</span></p> : null}
    {restart === "error" ? <p role="alert">{t("agentConfig.restartFailed")}<span>{error}</span></p> : null}
  </div>;
}
