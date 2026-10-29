import React, { useState, useSyncExternalStore } from "react";
import { FileViewer } from "../FileViewer";
import { FileEditor } from "../FileEditor";
import { FileEditStore, fileEditKey, MAX_EDITABLE_FILE_BYTES } from "../../services/fileEditing";
import type { FilePayload } from "../../services/file";
import { useI18n } from "../../i18n";

type Props = React.ComponentProps<typeof FileViewer> & {
  file: FilePayload; store: FileEditStore;
  onUpdated: (file: FilePayload) => void;
  onSaved: (file: FilePayload) => void;
};
export function RemoteFileViewer({ store, onUpdated, onSaved, ...props }: Props) {
  const { t } = useI18n();
  const { file } = props;
  const key = fileEditKey(file.root || "", file.path);
  const session = useSyncExternalStore(store.subscribe, () => store.get(key));
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  const editable = file.root && file.encoding === "utf-8" && file.size <= MAX_EDITABLE_FILE_BYTES;
  return <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
    <div ref={setActions} style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--border-color)" }}>
      {!session && editable ? <button type="button" onClick={() => { setError(""); void store.open(file.root!, file.path); }}>{t("fileEditor.edit")}</button> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {session ? <FileEditor actionsTarget={actions} store={store} editKey={key} session={session} isVisible={props.isVisible !== false}
      onFileUpdated={onUpdated} onFileSaved={onSaved} onExitError={setError} /> : <FileViewer {...props} />}
  </div>;
}
