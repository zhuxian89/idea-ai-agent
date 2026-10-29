import React, { useEffect, useRef } from "react";
import { useI18n } from "../../i18n";
import "./remoteAccess.css";

export function ConnectionErrorDialog({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="remote-access-dialog" aria-labelledby="connection-error-title"
    onCancel={event => event.preventDefault()}>
    <h2 id="connection-error-title">{t("remote.connectionFailed")}</h2>
    <p>{t("remote.connectionRetryHint")}</p>
    <p role="alert">{error}</p>
    <button type="button" onClick={onRetry}>{t("common.retry")}</button>
  </dialog>;
}
