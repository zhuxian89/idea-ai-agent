import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { fetchAgents, type AgentStatus } from "../../services/agents";
import { createAgentConfigBackup, fetchAgentConfigDefaults } from "../../services/agentConfig";
import { AgentMenuList } from "../AgentMenuList";

export function PhoneAgentBackup({ onSaved }: { onSaved: () => void }) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentStatus[] | null>(null);
  const [agent, setAgent] = useState("");
  const [name, setName] = useState("");
  const [files, setFiles] = useState("");
  const [env, setEnv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetchAgents(true, { throwOnError: true }).then(
      items => setAgents(items.filter(item => item.installed)),
      reason => { setAgents([]); setError(reason instanceof Error ? reason.message : t("agentConfig.loadAgentFailed")); },
    );
  }, [t]);
  const choose = async (value: string) => {
    setAgent(value);
    setBusy(true);
    setError("");
    try {
      const defaults = await fetchAgentConfigDefaults(value);
      setFiles((defaults.file_sources || []).join("\n"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("agentConfig.loadConfigFailed"));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await createAgentConfigBackup({
        agent, name: name.trim(),
        fileSources: files.split("\n").map(line => line.trim()).filter(Boolean),
        envLines: env.split("\n").map(line => line.trim()).filter(Boolean),
      });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("agentConfig.saveBackupFailed"));
    } finally {
      setBusy(false);
    }
  };
  return <div className="phone-more-backup">
    {agent ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <strong>{agent}</strong>
      <label>{t("agentConfig.backupName")}<input value={name} onChange={event => setName(event.target.value)} required /></label>
      <label>{t("agentConfig.fileSources")}<textarea value={files} rows={3} onChange={event => setFiles(event.target.value)} placeholder={t("agentConfig.fileSourcePlaceholder")} /></label>
      <label>{t("agentConfig.env")}<textarea value={env} rows={2} onChange={event => setEnv(event.target.value)} placeholder={t("agentConfig.envPlaceholder")} /></label>
      <button type="submit" disabled={busy || !name.trim() || (!files.trim() && !env.trim())}>{busy ? t("common.saving") : t("common.save")}</button>
    </form> : agents?.length ? <AgentMenuList agents={agents} selectedAgent="" onSelect={value => void choose(value)} />
      : <p>{agents ? t("agentConfig.noInstalledAgents") : t("agentConfig.loading")}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
