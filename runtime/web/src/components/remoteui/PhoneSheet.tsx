import React, { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";

export function PhoneSheet({ title, open, onClose, children }: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (open && dialog) {
      dialog.showModal();
      return () => dialog.close();
    }
  }, [open]);
  return createPortal(
    <dialog className="remote-phone-sheet" ref={ref} aria-labelledby={titleId} onCancel={event => {
      event.preventDefault();
      ref.current?.close();
      onClose();
    }}>
      <header>
        <h2 id={titleId}>{title}</h2>
        <button type="button" aria-label={t("common.close")} onClick={() => { ref.current?.close(); onClose(); }}>×</button>
      </header>
      <div className="remote-phone-sheet-body">{children}</div>
    </dialog>,
    document.body,
  );
}
