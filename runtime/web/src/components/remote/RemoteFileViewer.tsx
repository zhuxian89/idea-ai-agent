import React, { useState, useSyncExternalStore } from "react";
import { FileViewer } from "../FileViewer";
import { FileEditor } from "../FileEditor";
import { HtmlFilePreview } from "./HtmlFilePreview";
import { FileEditStore, fileEditKey, MAX_EDITABLE_FILE_BYTES } from "../../services/fileEditing";
import type { FilePayload } from "../../services/file";
import { useI18n } from "../../i18n";

type Props = React.ComponentProps<typeof FileViewer> & {
  file: FilePayload; store: FileEditStore;
  onUpdated: (file: FilePayload) => void;
  onSaved: (file: FilePayload) => void;
};
export function RemoteFileViewer(props: Props) {
  const { file } = props;
  const editKey = fileEditKey(file.root || "", file.path);
  return <RemoteFilePanel key={JSON.stringify([editKey, file.targetLine, file.targetColumn])} editKey={editKey} {...props} />;
}

function RemoteFilePanel({ store, onUpdated, onSaved, editKey, ...props }: Props & { editKey: string }) {
  const { t } = useI18n();
  const { file } = props;
  const session = useSyncExternalStore(store.subscribe, () => store.get(editKey));
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const isHtml = /\.html?$/i.test(file.path) || file.mime?.split(";")[0].trim().toLowerCase() === "text/html";
  const previewRoot = isHtml && file.encoding !== "binary" ? file.root : undefined;
  const editable = file.root && file.encoding === "utf-8" && file.size <= MAX_EDITABLE_FILE_BYTES;
  const preview = showPreview && previewRoot
    ? <HtmlFilePreview key={file.mtime} file={file} root={previewRoot} />
    : null;
  return <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
    <div ref={setActions} style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--border-color)" }}>
      {!session && previewRoot && (
        <div className="remote-file-modes" role="group" aria-label={t("fileViewer.viewMode")}>
          <button type="button" aria-pressed={!showPreview} onClick={() => setShowPreview(false)}>{t("fileViewer.source")}</button>
          <button type="button" aria-pressed={showPreview} onClick={() => setShowPreview(true)}>{t("fileViewer.preview")}</button>
        </div>
      )}
      {!session && editable ? <button type="button" onClick={() => { setError(""); void store.open(file.root!, file.path); }}>{t("fileEditor.edit")}</button> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {session ? <FileEditor actionsTarget={actions} store={store} editKey={editKey} session={session} isVisible={props.isVisible !== false}
      onFileUpdated={onUpdated} onFileSaved={onSaved} onExitError={setError} /> : <FileViewer {...props} previewContent={preview} />}
  </div>;
}
