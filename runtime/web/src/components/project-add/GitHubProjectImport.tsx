import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { protectedJSON } from "../../services/api";
import { appPath } from "../../services/base";

type Props = {
  parentPath: string;
  url: string;
  onURLChange: (url: string) => void;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onImported: (rootId: string) => Promise<void>;
};

export function GitHubProjectImport({ parentPath, url, onURLChange, busy, onBusyChange, onImported }: Props) {
  const { t, locale } = useI18n();
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;
  const [taskId, setTaskId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!taskId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refreshImport() {
      try {
        const status = await protectedJSON<{ status: string; message: string; root_id?: string }>(
          appPath(`/api/imports/github/${encodeURIComponent(taskId)}`), { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setMessage(status.message);
        if (status.status === "failed") throw new Error(status.message);
        if (status.status === "done") {
          if (!status.root_id) throw new Error(t("root.githubImportFailed"));
          await onImportedRef.current(status.root_id);
          if (controller.signal.aborted) return;
          onBusyChange(false);
          setTaskId("");
          return;
        }
        timer = setTimeout(() => void refreshImport(), 1000);
      } catch (error) {
        if (controller.signal.aborted) return;
        onBusyChange(false);
        setTaskId("");
        setError(error instanceof Error ? error.message : String(error));
      }
    }
    void refreshImport();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [taskId, locale, onBusyChange]);

  async function startImport(event: React.FormEvent) {
    event.preventDefault();
    const repositoryURL = url.trim();
    if (!repositoryURL) return;
    onBusyChange(true);
    setError("");
    setMessage(t("projectAdd.cloning"));
    try {
      const response = await protectedJSON<{ task_id: string }>(appPath("/api/imports/github"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: repositoryURL, parent_path: parentPath }),
      });
      setTaskId(response.task_id);
    } catch (error) {
      onBusyChange(false);
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  return <form onSubmit={event => void startImport(event)}>
    <p className="remote-note">{t("projectAdd.githubLocation", { path: parentPath })}</p>
    <label className="standalone-project-path">GitHub
      <input autoFocus required type="url" value={url} onChange={event => onURLChange(event.target.value)}
        disabled={busy} placeholder="https://github.com/owner/repo" />
    </label>
    {message ? <p className="remote-note">{message}</p> : null}
    <div className="remote-actions"><button type="submit" className="remote-primary" disabled={busy || !url.trim()}>
      {busy ? t("projectAdd.cloning") : t("projectAdd.import")}
    </button></div>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}
