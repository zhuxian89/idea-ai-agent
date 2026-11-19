import React from "react";
import { useI18n, type MessageKey } from "../i18n";
import { fetchAgents } from "../services/agents";
import { ProtectedAPIError } from "../services/api";
import { exportUserConfig, importUserConfig, type ImportedAgentBackup } from "../services/configTransfer";
import {
  CONFIG_ARCHIVE_MAX_BYTES, CONFIG_CATEGORIES, importableConfigCategories,
  categoryDescription, categoryLabel, parseConfigArchive,
  type ConfigArchive, type ConfigCategory,
} from "../services/configTransferData";

const buttonStyle: React.CSSProperties = {
  border: "1px solid var(--border-color)", borderRadius: 8, padding: "8px 12px",
  background: "transparent", color: "var(--text-primary)", font: "inherit", cursor: "pointer",
};

export function ConfigTransferDialog({ mode, onClose, onUseBackup, embedded = false }: {
  embedded?: boolean;
  mode: "export" | "import";
  onClose: () => void;
  onUseBackup: (backup: ImportedAgentBackup) => void;
}) {
  const { t, formatDateTime } = useI18n();
  const [agents, setAgents] = React.useState<string[] | null>(null);
  const [selectedAgents, setSelectedAgents] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<ConfigCategory[]>([]);
  const [archive, setArchive] = React.useState<ConfigArchive | null>(null);
  const [filename, setFilename] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [imported, setImported] = React.useState(false);
  const [restart, setRestart] = React.useState(false);
  const [importedBackups, setImportedBackups] = React.useState<ImportedAgentBackup[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);

  React.useEffect(() => {
    if (mode !== "export") return;
    let active = true;
    fetchAgents(true, { throwOnError: true }).then(items => {
      if (!active) return;
      const installed = items.filter(item => item.installed).map(item => item.name);
      setAgents(installed);
      if (installed.length === 1) setSelectedAgents(installed);
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { active = false; };
  }, [mode]);

  const options = archive ? CONFIG_CATEGORIES.filter(c => importableConfigCategories(archive).includes(c.id)) : [];
  const canSubmit = mode === "export" ? selectedAgents.length > 0 : !!archive && selected.length > 0;
  const restartRequired = mode === "import" && (imported ? restart : selected.includes("custom_agents"));

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(""); setImported(false); setArchive(null); setFilename(""); setSelected([]);
    try {
      if (file.size > CONFIG_ARCHIVE_MAX_BYTES) throw new Error("configTransfer.tooLarge");
      let parsed: ConfigArchive;
      try { parsed = parseConfigArchive(await file.text()); }
      catch (err) {
        if (err instanceof Error && err.message.startsWith("configTransfer.")) throw err;
        throw new Error("configTransfer.invalidFile");
      }
      const ids = importableConfigCategories(parsed);
      if (!ids.length) throw new Error("configTransfer.emptyFile");
      setArchive(parsed); setFilename(file.name);
      setSelected(ids.length === 1 ? ids : ids.filter(id => id !== "api_keys" && id !== "custom_agents"));
    } catch (err) { showError(err); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const showError = (err: unknown) => {
    if (err instanceof ProtectedAPIError && err.payload?.code === "config.no_current_agent_config") {
      setError(t("configTransfer.emptyCurrent", { agent: err.payload.detail }));
      return;
    }
    if (err instanceof ProtectedAPIError && err.payload?.code === "config.no_agent_backups") {
      setError(t("configTransfer.emptyBackups"));
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    setError(message.startsWith("configTransfer.") ? t(message as MessageKey) : message);
  };

  const run = async () => {
    if (!canSubmit || busy) return;
    setBusy(true); setError(""); setImported(false);
    try {
      if (mode === "export") {
        await exportUserConfig(selectedAgents);
        onClose();
      } else if (archive) {
        let result = await importUserConfig(archive, selected);
        if (result.needs_confirm) {
          if (!window.confirm(t("configTransfer.confirmOverwrite"))) return;
          result = await importUserConfig(archive, selected, true);
        }
        setImported(true);
        setRestart(result.restart_required);
        setImportedBackups(result.backups || []);
      }
    } catch (err) { showError(err); }
    finally { setBusy(false); }
  };

  return (
      <div ref={dialogRef} role={embedded ? undefined : "dialog"} aria-label={embedded ? undefined : t(mode === "export" ? "configTransfer.exportAgent" : "configTransfer.importAgent")} tabIndex={-1}
        onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); if (!busy) onClose(); }
        }}
        style={{ width: "100%", boxSizing: "border-box", maxHeight: "calc(100dvh - 96px)", display: "flex", flexDirection: "column", borderRadius: 12, border: "1px solid var(--border-color)", background: "var(--menu-bg)", color: "var(--text-primary)", boxShadow: "0 16px 36px rgba(15,23,42,.18)", fontSize: 13, outline: "none", overflow: "hidden" }}>
        {!embedded && <h2 style={{ fontSize: 15, margin: "12px 12px 6px" }}>{t(mode === "export" ? "configTransfer.exportAgent" : "configTransfer.importAgent")}</h2>}
        <div style={{ overflowY: "auto", overscrollBehavior: "contain", padding: "6px 12px", minHeight: 0 }}>
          {mode === "export" && <>
            {agents === null && !error && <p>{t("agentConfig.loading")}</p>}
            {agents?.length === 0 && <p>{t("agentConfig.noInstalledAgents")}</p>}
            {agents?.map(name => <label key={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0" }}>
              <input type="checkbox" checked={selectedAgents.includes(name)} disabled={busy} onChange={event => {
                const checked = event.target.checked;
                setSelectedAgents(prev => checked ? [...prev, name] : prev.filter(item => item !== name));
                setError("");
              }} />
              {name}
            </label>)}
            {!!agents?.length && <p style={{ color: "var(--text-secondary)", fontSize: 12 }}>{t("configTransfer.currentHint")}</p>}
          </>}
          {mode === "import" && <div style={{ marginBottom: 14 }}>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={event => { void readFile(event.target.files?.[0]); }} />
            <button type="button" disabled={busy} style={buttonStyle} onClick={() => fileRef.current?.click()}>{t("configTransfer.chooseFile")}</button>
            {filename && <div style={{ marginTop: 8, overflowWrap: "anywhere", color: "var(--text-secondary)", fontSize: 12 }}>{filename}{archive && !Number.isNaN(Date.parse(archive.created_at)) ? ` · ${formatDateTime(archive.created_at)}` : ""}{archive?.platform ? ` · ${archive.platform}` : ""}</div>}
          </div>}
          {options.length > 0 && (options.length > 1 || options[0].id !== "agent_backups") && <>
            <fieldset disabled={busy || imported} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {options.map(category => <label key={category.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 0", borderBottom: "1px solid var(--border-color)", cursor: busy ? "wait" : "pointer" }}>
                <input type="checkbox" aria-label={t(categoryLabel(category.id))} aria-describedby={`config-description-${category.id}`} checked={selected.includes(category.id)} style={{ margin: "3px 0 0", accentColor: "var(--accent-color)" }} onChange={event => {
                  const checked = event.target.checked;
                  setSelected(previous => checked ? [...previous, category.id] : previous.filter(id => id !== category.id)); setImported(false);
                }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontWeight: 600 }}>{t(categoryLabel(category.id))}
                    {category.sensitive && <span style={{ color: "var(--text-secondary)", border: "1px solid var(--border-color)", borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 400 }}>{t("configTransfer.sensitive")}</span>}
                  </span>
                  <span id={`config-description-${category.id}`} style={{ display: "block", color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.55, marginTop: 3 }}>{t(categoryDescription(category.id))}</span>
                </span>
              </label>)}
            </fieldset>
          </>}
          {error && <div role="alert" style={{ marginTop: 12, color: "var(--error-color, #dc2626)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{error}</div>}
          {imported && <>
            <div role="status" style={{ marginTop: 14 }}>{t("configTransfer.imported")}</div>
            {importedBackups.map(backup => (
              <button key={backup.id} type="button" style={{ ...buttonStyle, display: "block", marginTop: 8, textAlign: "left", overflowWrap: "anywhere" }}
                onClick={() => onUseBackup(backup)}>
                {t("configTransfer.useBackup", { agent: backup.agent, name: backup.name })}
              </button>
            ))}
          </>}
          {restartRequired && <div role="status" style={{ marginTop: 8, color: "var(--error-color, #dc2626)" }}>{t("configTransfer.restartRequired")}</div>}
        </div>
        <footer style={{ padding: "6px 12px", borderTop: "1px solid var(--border-color)", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", flexShrink: 0, gap: 8 }}>
          <button type="button" disabled={busy} style={buttonStyle} onClick={onClose}>{t(imported ? "configTransfer.close" : "common.cancel")}</button>
          {!imported && <button type="button" disabled={busy || !canSubmit} onClick={() => { void run(); }}
            style={{ ...buttonStyle, background: "var(--accent-color)", color: "#fff", opacity: busy || !canSubmit ? .5 : 1 }}>{t(busy ? "configTransfer.busy" : mode === "export" ? "configTransfer.exportAction" : "configTransfer.import")}</button>}
        </footer>
      </div>
  );
}
