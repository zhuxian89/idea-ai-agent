import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { protectedJSON } from "../../services/api";
import { appURL } from "../../services/base";

type LocalDirItem = {
  name: string;
  path: string;
  is_added_root?: boolean;
};

type LocalDirsPayload = {
  path: string;
  parent?: string;
  volumes?: LocalDirItem[];
  items: LocalDirItem[];
};

type Props = {
  selectExisting: boolean;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onChoose: (path: string) => void | Promise<void>;
};

export function ProjectDirectoryPicker({ selectExisting, busy, onBusyChange, onChoose }: Props) {
  const { t } = useI18n();
  const [directory, setDirectory] = useState<LocalDirsPayload>({ path: "", items: [] });
  const [selectedPath, setSelectedPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void loadDirectories(""); }, []);

  async function loadDirectories(path: string) {
    onBusyChange(true);
    setError("");
    setSelectedPath("");
    try {
      const params = path ? new URLSearchParams({ path }) : undefined;
      const payload = await protectedJSON<LocalDirsPayload>(appURL("/api/local_dirs", params));
      setDirectory(payload);
      setPathInput(payload.path);
    } catch (error) {
      setDirectory({ path, items: [] });
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      onBusyChange(false);
    }
  }

  async function chooseDirectory() {
    onBusyChange(true);
    setError("");
    try {
      await onChoose(selectedPath || directory.path);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      onBusyChange(false);
    }
  }

  return <section className="standalone-directory-browser">
    <div className="standalone-directory-path">
      <button type="button" disabled={busy || !directory.parent}
        aria-label={t("projectAdd.parentDirectory")}
        onClick={() => void loadDirectories(directory.parent!)}>↑</button>
      <span title={directory.path}>{directory.path}</span>
    </div>
    {directory.volumes?.length ? <div className="standalone-directory-volumes" aria-label={t("projectAdd.selectVolume")}>
      {directory.volumes.map(volume => <button key={volume.path} type="button" disabled={busy}
        onClick={() => void loadDirectories(volume.path)}>{volume.name}</button>)}
    </div> : null}
    <form className="standalone-directory-path-input" onSubmit={event => {
      event.preventDefault();
      void loadDirectories(pathInput.trim());
    }}>
      <input aria-label={t("projectAdd.directoryPath")} value={pathInput} disabled={busy}
        onChange={event => setPathInput(event.target.value)} placeholder={t("projectAdd.directoryPath")} />
      <button type="submit" disabled={busy || !pathInput.trim()}>{t("projectAdd.go")}</button>
    </form>
    <div className="standalone-directory-list">
      {busy ? <p className="remote-note">{t("projectAdd.loading")}</p> : null}
      {!busy && !error && directory.items.length === 0 ? <p className="remote-note">{t("projectAdd.emptyDirectory")}</p> : null}
      {!busy ? directory.items.map(item => <div key={item.path} className="standalone-directory-item">
        <button type="button" className={selectedPath === item.path ? "selected" : ""}
          disabled={selectExisting && item.is_added_root}
          aria-pressed={selectExisting ? selectedPath === item.path : undefined}
          title={item.path}
          onClick={() => {
            if (selectExisting) { setError(""); setSelectedPath(item.path); }
            else void loadDirectories(item.path);
          }}>
          <span>▣</span><span>{item.name}</span>{item.is_added_root ? <small>{t("projectAdd.added")}</small> : null}
        </button>
        <button type="button" aria-label={`${t("projectAdd.openDirectory")} ${item.name}`}
          onClick={() => void loadDirectories(item.path)}>›</button>
      </div>) : null}
    </div>
    <div className="remote-actions">
      <button type="button" className="remote-primary" disabled={busy || !!error || !directory.path}
        onClick={() => void chooseDirectory()}>
        {selectExisting
          ? busy ? t("projectAdd.processing") : selectedPath ? t("projectAdd.add") : t("projectAdd.addCurrent")
          : t("projectAdd.placeHere")}
      </button>
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
