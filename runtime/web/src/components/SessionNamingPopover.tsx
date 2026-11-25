import React from "react";
import { useI18n } from "../i18n";
import { fetchAgents, type AgentStatus } from "../services/agents";
import {
  fetchSessionNamingPreference,
  updateSessionNamingPreference,
} from "../services/preferences";
import { AgentSelector } from "./AgentSelector";
import {
  agentConfigActionRowStyle,
  agentConfigPrimaryButtonStyle,
  agentConfigSecondaryButtonStyle,
} from "./AgentConfigPopover";

export function SessionNamingPopover({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [agents, setAgents] = React.useState<AgentStatus[]>([]);
  const [agent, setAgent] = React.useState("");
  const [model, setModel] = React.useState("");
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError("");
    Promise.all([fetchAgents(true), fetchSessionNamingPreference()])
      .then(([items, preference]) => {
        if (cancelled) return;
        const installed = items.filter((item) => item.installed);
        setAgents(installed);
        const selected = installed.find((item) => item.name === preference.agent) || installed[0];
        const selectedModel = selected?.models?.find((item) => item.id === preference.model)?.id || "";
        setAgent(selected?.name || "");
        setModel(selectedModel);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("sessionNaming.loadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const save = React.useCallback(async () => {
    if (!agent || busy) return;
    setBusy(true);
    setError("");
    try {
      await updateSessionNamingPreference({ agent, model });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sessionNaming.saveFailed"));
    } finally {
      setBusy(false);
    }
  }, [agent, busy, model, onClose, t]);

  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: "8px",
        right: "3px",
        zIndex: 40,
        padding: "14px",
        borderRadius: "12px",
        border: "1px solid var(--border-color)",
        background: "var(--menu-bg)",
        boxShadow: "0 16px 36px rgba(15, 23, 42, 0.18)",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
        {t("sessionNaming.title")}
      </div>
      <div
        style={{
          marginTop: "12px",
          minHeight: "42px",
          padding: "6px 8px",
          border: "1px solid var(--border-color)",
          borderRadius: "10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "8px",
        }}
      >
        {agent ? (
          <AgentSelector
            agent={agent}
            model={model}
            agents={agents}
            onAgentChange={(nextAgent, nextModel) => {
              setAgent(nextAgent);
              setModel(nextModel || "");
            }}
            compact
            showChevron
            menuPlacement="bottom"
            defaultExpandOptions
            viewportMenu
            allowDefaultModel
          />
        ) : null}
        <span style={{ minWidth: 0, marginLeft: "auto", fontSize: "12px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {busy ? t("common.loading") : model || t("agent.defaultModel")}
        </span>
      </div>
      {error ? (
        <div style={{ marginTop: "8px", color: "#dc2626", fontSize: "11px", lineHeight: 1.4 }}>
          {error}
        </div>
      ) : null}
      <div style={{ ...agentConfigActionRowStyle, marginTop: "12px" }}>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          style={agentConfigSecondaryButtonStyle(busy)}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={busy || !agent}
          onClick={() => void save()}
          style={agentConfigPrimaryButtonStyle(busy || !agent)}
        >
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
