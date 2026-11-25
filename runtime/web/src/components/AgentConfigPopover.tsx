import React from "react";
import { useI18n } from "../i18n";
import type { AgentStatus } from "../services/agents";
import type { AgentAPIProvider, AgentConfigBackup } from "../services/agentConfig";
import { AgentMenuList } from "./AgentMenuList";
import { RestartSpinner, TrashIcon } from "./FileTreeIcons";

export type AgentConfigStep = "agent" | "details" | "confirm";
export type AgentConfigSwitchTab = "backup" | "api_provider";
export type AgentConfigSwitchSelection = { type: "backup" | "api_provider"; id: string };

export const agentConfigHintStyle: React.CSSProperties = {
  borderRadius: "8px",
  padding: "8px 10px",
  fontSize: "12px",
  color: "var(--text-secondary)",
  background: "rgba(148, 163, 184, 0.10)",
  lineHeight: 1.45,
  wordBreak: "break-word",
};

export const agentConfigActionRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "8px",
};

export const agentConfigPrimaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  border: "none",
  background: "var(--accent-color)",
  color: "#fff",
  borderRadius: "8px",
  padding: "8px 10px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1,
});

export const agentConfigSecondaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  border: "1px solid var(--border-color)",
  background: "transparent",
  color: "var(--text-secondary)",
  borderRadius: "8px",
  padding: "8px 10px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1,
});

export const agentConfigIconButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: "28px",
  height: "28px",
  border: "none",
  borderRadius: "8px",
  background: "transparent",
  color: "#dc2626",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 0.9,
  flexShrink: 0,
});

export function AgentConfigPopover({
  inDialog,
  step,
  agents,
  selectedAgent,
  switchTab,
  backups,
  apiProviders,
  selectedBackupID,
  selectedAPIProviderID,
  confirmMessage,
  busy,
  restartingAgent,
  restartResult,
  error,
  onChooseAgent,
  onSwitchTabChange,
  onSelectedBackupChange,
  onSelectedAPIProviderChange,
  onDeleteBackup,
  onDeleteAPIProvider,
  onSwitch,
  onRestartAgent,
  onConfirm,
  onCancel,
}: {
  inDialog: boolean;
  step: AgentConfigStep;
  agents: AgentStatus[];
  selectedAgent: string;
  switchTab: AgentConfigSwitchTab;
  backups: AgentConfigBackup[];
  apiProviders: AgentAPIProvider[];
  selectedBackupID: string;
  selectedAPIProviderID: string;
  confirmMessage: string;
  busy: boolean;
  restartingAgent: string;
  restartResult: null | boolean;
  error: string;
  onChooseAgent: (name: string) => void;
  onSwitchTabChange: (tab: AgentConfigSwitchTab) => void;
  onSelectedBackupChange: (value: string) => void;
  onSelectedAPIProviderChange: (value: string) => void;
  onDeleteBackup: (id: string) => void;
  onDeleteAPIProvider: (id: string) => void;
  onSwitch: () => void;
  onRestartAgent?: (agentName: string) => void | Promise<void>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const selectedAgentStatus = agents.find((item) => item.name === selectedAgent);
  const supportsAPIProvider = Boolean(selectedAgentStatus?.supports_api_provider_switch);
  const switchTabs: AgentConfigSwitchTab[] = supportsAPIProvider ? ["backup", "api_provider"] : ["backup"];
  const effectiveSwitchTab: AgentConfigSwitchTab = supportsAPIProvider ? switchTab : "backup";
  return (
    <div
      style={{
        width: "100%",
        ...(!inDialog && {
          padding: "10px",
          borderRadius: "12px",
          border: "1px solid var(--border-color)",
          background: "var(--menu-bg)",
          boxShadow: "0 12px 30px rgba(15, 23, 42, 0.14)",
        }),
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {step === "agent" ? (
        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>
          {t("agentConfig.chooseSwitchAgent")}
        </div>
      ) : null}
      {step === "agent" ? (
        <>
          {busy ? (
            <div style={agentConfigHintStyle}>{t("agentConfig.loading")}</div>
          ) : agents.length === 0 ? (
            <div style={agentConfigHintStyle}>{t("agentConfig.noInstalledAgents")}</div>
          ) : (
            <AgentMenuList
              agents={agents}
              selectedAgent={selectedAgent}
              maxHeight="220px"
              renderEnd={(agent) => {
                const name = String(agent.last_config_selection?.name || "").trim();
                const restarting = agent.name === restartingAgent;
                if (!onRestartAgent) {
                  if (!name) {
                    return null;
                  }
                  return (
                    <span
                      title={t("agentConfig.lastSelected", { name })}
                      style={{
                        maxWidth: "120px",
                        minWidth: 0,
                        flexShrink: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: "11px",
                        color: agent.name === selectedAgent ? "var(--accent-color)" : "var(--text-secondary)",
                      }}
                    >
                      {name}
                    </span>
                  );
                }
                return (
                  <>
                    {name ? (
                      <span
                        title={t("agentConfig.lastSelected", { name })}
                        style={{
                          maxWidth: "86px",
                          minWidth: 0,
                          flexShrink: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: "11px",
                          color: agent.name === selectedAgent ? "var(--accent-color)" : "var(--text-secondary)",
                        }}
                      >
                        {name}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy || restartingAgent !== ""}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onRestartAgent(agent.name);
                      }}
                      style={{
                        ...agentConfigSecondaryButtonStyle(busy || restartingAgent !== ""),
                        padding: "2px 6px",
                        minWidth: "36px",
                        height: "18px",
                        lineHeight: "12px",
                        fontSize: "11px",
                        borderRadius: "5px",
                        flexShrink: 0,
                      }}
                    >
                      {restarting ? <RestartSpinner /> : t("agentConfig.restart")}
                    </button>
                  </>
                );
              }}
              onSelect={onChooseAgent}
            />
          )}
        </>
      ) : step === "confirm" ? (
        <>
          <div style={{ ...agentConfigHintStyle, color: "#dc2626", whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
            {confirmMessage || t("agentConfig.targetExists")}
          </div>
          <div style={agentConfigActionRowStyle}>
            <button type="button" disabled={busy} onClick={onCancel} style={agentConfigSecondaryButtonStyle(busy)}>
              {t("common.cancel")}
            </button>
            <button type="button" disabled={busy} onClick={onConfirm} style={agentConfigPrimaryButtonStyle(busy)}>
              {t("agentConfig.continueSwitch")}
            </button>
          </div>
        </>
      ) : (
        <>
          {switchTabs.length > 1 ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              {switchTabs.map((tab) => {
                const active = effectiveSwitchTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    disabled={busy}
                    onClick={() => onSwitchTabChange(tab)}
                    style={{
                      border: "1px solid var(--border-color)",
                      background: active ? "var(--selection-bg)" : "transparent",
                      color: active ? "var(--accent-color)" : "var(--text-primary)",
                      borderRadius: "8px",
                      padding: "7px 8px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: busy ? "default" : "pointer",
                    }}
                  >
                    {tab === "backup" ? t("agentConfig.backup") : t("agentConfig.apiProvider")}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "260px", overflow: "auto" }}>
            {busy ? (
              <div style={agentConfigHintStyle}>{t("agentConfig.loading")}</div>
            ) : backups.length === 0 && (supportsAPIProvider ? apiProviders.length === 0 : true) ? (
              <div style={agentConfigHintStyle}>{t("agentConfig.noSwitchableConfig")}</div>
            ) : effectiveSwitchTab === "backup" ? (
              backups.length === 0 ? (
                <div style={agentConfigHintStyle}>{t("agentConfig.noBackups")}</div>
              ) : backups.map((item) => {
                const selected = item.id === selectedBackupID;
                return (
                  <div
                    key={item.id}
                    onClick={() => onSelectedBackupChange(item.id)}
                    style={{
                      border: "1px solid var(--border-color)",
                      background: selected ? "var(--selection-bg)" : "transparent",
                      color: selected ? "var(--accent-color)" : "var(--text-primary)",
                      borderRadius: "8px",
                      padding: "8px 10px",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ minWidth: 0, flex: 1, fontSize: "12px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                      <button
                        type="button"
                        aria-label={t("agentConfig.deleteConfig", { name: item.name })}
                        title={t("common.delete")}
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteBackup(item.id);
                        }}
                        style={agentConfigIconButtonStyle(busy)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              apiProviders.length === 0 ? (
                <div style={agentConfigHintStyle}>{t("agentConfig.noAPIProviders")}</div>
              ) : apiProviders.map((item) => {
                const selected = item.id === selectedAPIProviderID;
                const summary = (item.modelFamilies || []).join(", ");
                return (
                  <div
                    key={item.id}
                    onClick={() => onSelectedAPIProviderChange(item.id)}
                    style={{
                      border: "1px solid var(--border-color)",
                      background: selected ? "var(--selection-bg)" : "transparent",
                      color: selected ? "var(--accent-color)" : "var(--text-primary)",
                      borderRadius: "8px",
                      padding: "8px 10px",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                        <div style={{ marginTop: "4px", fontSize: "11px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</div>
                      </div>
                      <button
                        type="button"
                        aria-label={t("agentConfig.deleteAPIProvider", { name: item.name })}
                        title={t("common.delete")}
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteAPIProvider(item.id);
                        }}
                        style={agentConfigIconButtonStyle(busy)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div style={agentConfigActionRowStyle}>
            <button type="button" disabled={busy} onClick={onCancel} style={agentConfigSecondaryButtonStyle(busy)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={busy || (effectiveSwitchTab === "backup" ? !selectedBackupID : !selectedAPIProviderID)}
              onClick={onSwitch}
              style={agentConfigPrimaryButtonStyle(busy || (effectiveSwitchTab === "backup" ? !selectedBackupID : !selectedAPIProviderID))}
            >
              {t("agentConfig.switch")}
            </button>
          </div>
        </>
      )}
      {error ? <div style={{ ...agentConfigHintStyle, color: "#dc2626" }}>{error}</div> : null}
    </div>
  );
}
