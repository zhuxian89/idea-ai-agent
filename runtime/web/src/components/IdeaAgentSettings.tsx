import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { AgentStatus } from "../services/agents";
import { APPEARANCE_CHANGE_EVENT, getAppearanceMode, setAppearanceMode, type AppearanceMode } from "../services/appearance";
import { getActiveVoiceProvider, sendVoice } from "../services/voiceInput";
import { AgentIcon } from "./AgentIcon";

type Props = {
  agents: AgentStatus[];
  busy: boolean;
  projectReady: boolean;
  notice: string;
  restartingAgent: string;
  error: string;
  configuration: React.ReactNode;
  onRefresh: () => void;
  onConfigure: (flow: "backup" | "switch", agent?: string) => void;
  onRestart: (agent: string) => void;
  onRun: (agent: AgentStatus, action: "install" | "update") => void;
};

export function IdeaAgentSettings(props: Props) {
  const { locale, setLocale, t } = useI18n();
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
  if (props.configuration) return <div className="idea-config-form">{props.configuration}</div>;
  const busy = props.busy || !!props.restartingAgent;
  const primaryAgents = props.agents.filter(agent => agent.installed || agent.name === "codex" || agent.name === "claude");
  const otherAgents = props.agents.filter(agent => !primaryAgents.includes(agent));
  const renderAgent = (agent: AgentStatus) => {
      const action = agent.installed ? "update" : "install";
      const commands = action === "update" ? agent.update_commands : agent.install_commands;
      return <article className="idea-agent-card" key={agent.name} data-agent={agent.name}>
        <div className="idea-agent-title"><AgentIcon agentName={agent.name} style={{ width: 18, height: 18 }} /><h2>{agent.name === "claude" ? "Claude Code" : agent.name === "codex" ? "Codex" : agent.name}</h2><span className={agent.installed ? "idea-detected" : "idea-undetected"}>{t(agent.installed ? "agentConfig.detected" : "agentConfig.notDetected")}</span></div>
        {agent.version ? <p className="idea-agent-version">{agent.version}</p> : null}
        {agent.error && agent.error !== "probe pending" ? <p className="idea-agent-diagnostic">{agent.error}</p> : null}
        {agent.installed && agent.error === "probe pending" ? <p className="idea-agent-version">{t("idea.probePending")}</p> : null}
        <div className="idea-agent-actions">
          <button type="button" disabled={busy || !agent.installed} onClick={() => props.onConfigure("switch", agent.name)}>{t("idea.configure")}</button>
          <button type="button" disabled={busy || !props.projectReady || !commands?.length} title={!commands?.length ? t("agentConfig.noCommand") : undefined} onClick={() => props.onRun(agent, action)}>{t(agent.installed ? "agentConfig.update" : "agentConfig.install")}</button>
          {agent.installed ? <button type="button" disabled={busy} onClick={() => props.onRestart(agent.name)}>{t(props.restartingAgent === agent.name ? "agentConfig.restarting" : "agentConfig.restart")}</button> : null}
        </div>
      </article>;
  };
  return <div className="idea-settings-content">
    <div className="idea-settings-actions">
      <button type="button" disabled={busy} onClick={() => props.onConfigure("backup")}>{t("idea.addConfig")}</button>
      <button type="button" disabled={busy} onClick={props.onRefresh}>{t("agentConfig.refreshList")}</button>
    </div>
    {props.error ? <p className="idea-error" role="alert">{props.error}</p> : null}
    {props.notice ? <p role="status">{props.notice}</p> : null}
    {!props.projectReady ? <p role="status">{t("idea.loadingProject")}</p> : null}
    {props.busy && props.agents.length === 0 ? <p role="status">{t("common.loading")}</p> : null}
    {!props.busy && !props.error && props.agents.length === 0 ? <p>{t("agentConfig.noAgents")}</p> : null}
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
