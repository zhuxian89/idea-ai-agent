import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { agentDisplayName } from "../services/agentSetup";
import "./AgentModelRefresh.css";

export function AgentRestartAction({ agent, onRestart }: {
  agent: string;
  onRestart: (agent: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const busy = useRef(false);
  const [phase, setPhase] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const restart = async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase("loading");
    setError("");
    try {
      await onRestart(agent);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      busy.current = false;
    }
  };
  return <div className="agent-model-refresh">
    <button type="button" disabled={phase === "loading"} aria-busy={phase === "loading"}
      title={t("agent.restartHint", { name: agentDisplayName(agent) })}
      aria-label={t("agent.restartLabel", { name: agentDisplayName(agent) })}
      onClick={() => void restart()}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0" />
      </svg>
      <span>{t(phase === "loading" ? "agentConfig.restarting" : "agentConfig.restart")}</span>
    </button>
    {phase === "error" ? <p role="alert">{t("agentConfig.restartFailed")}<span>{error}</span></p> : null}
  </div>;
}
