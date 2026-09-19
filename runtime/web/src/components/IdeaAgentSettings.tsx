import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { checkAgentUpdate, type AgentStatus } from "../services/agents";
import { APPEARANCE_CHANGE_EVENT, getAppearanceMode, setAppearanceMode, type AppearanceMode } from "../services/appearance";
import { getActiveVoiceProvider, sendVoice } from "../services/voiceInput";
import { AgentIcon } from "./AgentIcon";
import { AgentConnectionTest } from "./AgentConnectionTest";
import { AgentSetupGuide } from "./AgentSetupGuide";

type Props = {
  agents: AgentStatus[];
  busy: boolean;
  projectReady: boolean;
  notice: string;
  probingAgent: string;
  error: string;
  onProbe: (agent: string) => void | Promise<void>;
  onRun: (agent: AgentStatus, action: "install" | "update") => void;
};

type UpdateCheckState = {
  phase: "idle" | "checking" | "current" | "available" | "error";
  currentVersion?: string;
  latestVersion?: string;
};

export function IdeaAgentSettings(props: Props) {
  const { locale, setLocale, t } = useI18n();
  const [testingAgent, setTestingAgent] = useState<AgentStatus | null>(null);
  const [updateChecks, setUpdateChecks] = useState<Record<string, UpdateCheckState>>({});
  const [voiceProvider, setVoiceProvider] = useState(getActiveVoiceProvider);
  useEffect(() => {
    const sync = () => setVoiceProvider(getActiveVoiceProvider());
    window.addEventListener("ideaAgentReady", sync);
    window.addEventListener("ideaAgentVoiceSettingsChanged", sync);
    sync();
    return () => {
      window.removeEventListener("ideaAgentReady", sync);
      window.removeEventListener("ideaAgentVoiceSettingsChanged", sync);
    };
  }, []);
  const [appearance, setAppearance] = useState(getAppearanceMode);
  useEffect(() => {
    const sync = () => setAppearance(getAppearanceMode());
    window.addEventListener(APPEARANCE_CHANGE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, sync);
  }, []);
  const primaryAgents = props.agents.filter(agent => agent.installed || agent.name === "codex" || agent.name === "claude");
  const otherAgents = props.agents.filter(agent => !primaryAgents.includes(agent));
  const runUpdateCheck = async (agent: AgentStatus) => {
    setUpdateChecks((current) => ({ ...current, [agent.name]: { phase: "checking" } }));
    try {
      const result = await checkAgentUpdate(agent.name);
      setUpdateChecks((current) => ({
        ...current,
        [agent.name]: {
          phase: result.has_update ? "available" : "current",
          currentVersion: result.current_version,
          latestVersion: result.latest_version,
        },
      }));
    } catch {
      setUpdateChecks((current) => ({ ...current, [agent.name]: { phase: "error" } }));
    }
  };
  const renderAgent = (agent: AgentStatus) => {
      const updateCheck = updateChecks[agent.name] || { phase: "idle" };
      const probing = props.probingAgent === agent.name || agent.probe_pending;
      const unavailable = agent.installed && !agent.available && !probing;
      const updatingAvailable = updateCheck.phase === "available";
      const updateCommands = agent.update_commands || [];
      return <article className={`idea-agent-card${props.probingAgent === agent.name ? " idea-agent-card-restarting" : ""}`} key={agent.name} data-agent={agent.name}>
        <div className="idea-agent-title"><AgentIcon agentName={agent.name} style={{ width: 18, height: 18 }} /><h2>{agent.name === "claude" ? "Claude Code" : agent.name === "codex" ? "Codex" : agent.name}</h2><span className={agent.installed ? "idea-detected" : "idea-undetected"}>{t(agent.installed ? "agentConfig.detected" : "agentConfig.notDetected")}</span></div>
        {agent.version ? <p className="idea-agent-version">{agent.version}</p> : null}
        {!agent.installed || unavailable || probing ? <AgentSetupGuide key={agent.name} agent={agent}
          showTitle={false} probing={!!probing} disabled={props.busy || (!!props.probingAgent && props.probingAgent !== agent.name)}
          onProbe={props.onProbe} onTest={() => setTestingAgent(agent)} /> : null}
        {updateCheck.phase === "current" ? <p className="idea-agent-status idea-agent-success" role="status">{t("agentConfig.upToDate", { version: updateCheck.currentVersion || agent.version || updateCheck.latestVersion || "" })}</p> : null}
        {updatingAvailable ? <p className="idea-agent-status" role="status">{t("agentConfig.updateAvailable", { version: updateCheck.latestVersion || "" })}</p> : null}
        {updateCheck.phase === "error" ? <p className="idea-agent-status idea-agent-error" role="alert">{t("agentConfig.updateCheckFailed")}</p> : null}
        <div className="idea-agent-actions">
          {agent.installed && agent.available && !probing ? <button type="button" onClick={() => setTestingAgent(agent)}>{t("agentTest.title")}</button> : null}
          {agent.installed && agent.available && agent.update_check_supported && !updatingAvailable ? <button type="button" disabled={props.busy || updateCheck.phase === "checking"} onClick={() => void runUpdateCheck(agent)}>{t(updateCheck.phase === "checking" ? "agentConfig.checkingUpdate" : "agentConfig.checkUpdate")}</button> : null}
          {agent.installed && agent.available && updatingAvailable ? <button type="button" disabled={props.busy || !props.projectReady || updateCommands.length === 0} title={updateCommands.length === 0 ? t("agentConfig.noCommand") : undefined} onClick={() => {
            setUpdateChecks((current) => ({ ...current, [agent.name]: { phase: "idle" } }));
            props.onRun(agent, "update");
          }}>{t("agentConfig.updateToVersion", { version: updateCheck.latestVersion || "" })}</button> : null}
        </div>
      </article>;
  };
  return <div className="idea-settings-content">
    {testingAgent ? <AgentConnectionTest key={testingAgent.name} agent={testingAgent} onClose={() => setTestingAgent(null)} /> : null}
    {props.error ? <p className="idea-error" role="alert">{props.error}</p> : null}
    {props.notice ? <p role="status">{props.notice}</p> : null}
    {!props.projectReady ? <p role="status">{t("idea.loadingProject")}</p> : null}
    {props.busy && props.agents.length === 0 ? <p role="status">{t("common.loading")}</p> : null}
    {!props.busy && !props.error && props.agents.length === 0 ? <p>{t("idea.noAgents")}</p> : null}
    {primaryAgents.map(renderAgent)}
    {otherAgents.length ? <details className="idea-more-agents"><summary>{t("idea.otherAgents", { count: otherAgents.length })}</summary>{otherAgents.map(renderAgent)}</details> : null}
    <section className="idea-preferences idea-voice-settings" aria-labelledby="idea-voice-settings-title">
      <h2 id="idea-voice-settings-title">{t("voice.input")}</h2>
      <p className="idea-voice-active" role="status">
        <span>{t("voice.activeProvider")}</span>
        <strong>{voiceProvider === undefined ? t("voice.provider.loading") : voiceProvider === null ? t("voice.notConfigured") : t(`voice.provider.${voiceProvider}`)}</strong>
      </p>
      <p>{t("voice.settingsHint")}</p>
      <button type="button" onClick={() => sendVoice("voiceConfigure", "settings")}>{t("voice.settingsAction")}</button>
    </section>
    <section className="idea-preferences">
      <h2>{t("idea.preferences")}</h2>
      <label>{t("appearance.title")}<select value={appearance} onChange={event => setAppearanceMode(event.target.value as AppearanceMode)}>
        <option value="system">{t("appearance.system")}</option><option value="dark">{t("appearance.dark")}</option><option value="light">{t("appearance.light")}</option>
        {appearance === "meadow" || appearance === "moss" ? <option value={appearance}>{t(`appearance.${appearance}`)}</option> : null}
      </select></label>
      <label>{t("locale.language")}<select value={locale} onChange={event => setLocale(event.target.value as "zh-CN" | "en-US")}><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></label>
    </section>
  </div>;
}
