import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { protectedJSON } from "../services/api";
import { appPath } from "../services/base";
import { ProjectDirectoryPicker } from "./project-add/ProjectDirectoryPicker";
import { GitHubProjectImport } from "./project-add/GitHubProjectImport";
import "./remote/remoteAccess.css";

type Mode = "menu" | "local" | "blank-location" | "blank" | "github-location" | "github";

function joinPath(parent: string, name: string): string {
  const separator = /^[A-Za-z]:[\\/]/.test(parent) || parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${name}`;
}

export function StandaloneProjects({ onAdded, compact = false }: { onAdded?: (rootId: string) => void | Promise<void>; compact?: boolean }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("menu");
  const [parentPath, setParentPath] = useState("");
  const [name, setName] = useState("");
  const [githubURL, setGitHubURL] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setMode("menu");
    setParentPath("");
    setName("");
    setGitHubURL("");
    setBusy(false);
    setError("");
  }

  async function finish(rootId: string) {
    await onAdded?.(rootId);
    dialog.current?.close();
  }

  async function registerDirectory(path: string, create: boolean) {
    const root = await protectedJSON<{ id: string }>(appPath("/api/dirs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, create }),
    });
    await finish(root.id);
  }

  async function createBlankProject(event: React.FormEvent) {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName) return;
    if (projectName === "." || projectName === ".." || /[\\/]/.test(projectName)) {
      setError(t("projectAdd.invalidName"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await registerDirectory(joinPath(parentPath, projectName), true);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const browsing = mode === "local" || mode === "blank-location" || mode === "github-location";

  return <>
    <button type="button" className="standalone-add-project" aria-label={t("fileTree.addProject")} title={t("fileTree.addProject")} onClick={() => { reset(); dialog.current?.showModal(); }}>
      <span aria-hidden="true">＋</span> {compact ? null : t("fileTree.addProject")}
    </button>
    <dialog ref={dialog} className="remote-access-dialog remote-access-panel standalone-project-dialog" aria-labelledby="standalone-project-title"
      onClose={reset}
      onCancel={event => { if (busy) event.preventDefault(); }}
      onClick={event => { if (event.target === dialog.current && !busy) dialog.current.close(); }}>
      <header>
        {mode !== "menu" ? <button type="button" className="remote-text-button" disabled={busy}
          onClick={() => { setMode("menu"); setError(""); }}>← {t("projectAdd.back")}</button> : null}
        <h2 id="standalone-project-title">{t("fileTree.addProject")}</h2>
        <button type="button" className="remote-close" aria-label={t("common.close")} disabled={busy}
          onClick={() => dialog.current?.close()}>×</button>
      </header>

      {mode === "menu" ? <div className="standalone-project-modes">
        <button type="button" onClick={() => setMode("blank-location")}>＋ {t("projectAdd.blankProject")}</button>
        <button type="button" onClick={() => setMode("local")}>▣ {t("projectAdd.localDirectory")}</button>
        <button type="button" onClick={() => setMode("github-location")}>◆ {t("projectAdd.githubImport")}</button>
      </div> : null}

      {browsing ? <ProjectDirectoryPicker busy={busy} onBusyChange={setBusy} selectExisting={mode === "local"}
        onChoose={path => {
          if (mode === "local") return registerDirectory(path, false);
          setParentPath(path);
          setMode(mode === "blank-location" ? "blank" : "github");
        }} /> : null}

      {mode === "blank" ? <form onSubmit={event => void createBlankProject(event)}>
        <p className="remote-note">{t("projectAdd.blankLocation", { path: parentPath })}</p>
        <label className="standalone-project-path">{t("projectAdd.projectName")}
          <input autoFocus required value={name} onChange={event => setName(event.target.value)} disabled={busy} />
        </label>
        <div className="remote-actions"><button type="submit" className="remote-primary" disabled={busy || !name.trim()}>
          {busy ? t("projectAdd.processing") : t("projectAdd.create")}
        </button></div>
      </form> : null}

      {mode === "github" ? <GitHubProjectImport parentPath={parentPath} url={githubURL} onURLChange={setGitHubURL}
        busy={busy} onBusyChange={setBusy} onImported={finish} /> : null}

      {error ? <p role="alert">{error}</p> : null}
    </dialog>
  </>;
}
