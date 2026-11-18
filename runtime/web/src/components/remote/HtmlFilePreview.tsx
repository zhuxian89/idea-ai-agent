import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { fetchFile, type FilePayload } from "../../services/file";

// The preview runs the page's inline code and limits subresources to embedded data.
const policy = "default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:";

export function HtmlFilePreview({ file, root }: { file: FilePayload; root: string }) {
  const { t } = useI18n();
  const { content, encoding, path, size, truncated } = file;
  const [url, setURL] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let objectURL: string | undefined;
    async function load() {
      let html = content;
      // The last incremental chunk can have truncated=false even if it starts mid-file.
      if (truncated || encoding !== "utf-8" || new Blob([content]).size !== size) {
        const full = await fetchFile({ rootId: root, path, readMode: "full" });
        if (!active) return;
        if (!full || full.truncated || full.encoding === "binary") throw new Error(t("fileViewer.previewFailed"));
        html = full.content;
      }
      const prefix = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`;
      objectURL = URL.createObjectURL(new Blob([prefix, html], { type: "text/html;charset=utf-8" }));
      setError("");
      setURL(objectURL);
    }
    void load().catch((cause: Error) => { if (active) setError(cause.message); });
    return () => {
      active = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [content, encoding, path, root, size, truncated, t]);

  if (error) return <div role="alert" className="file-editor-error">{error}</div>;
  if (!url) return <div role="status" className="file-editor-loading">{t("fileViewer.previewLoading")}</div>;
  return <iframe className="remote-html-preview" title={t("fileViewer.htmlPreview")} sandbox="allow-scripts" referrerPolicy="no-referrer" src={url} />;
}
