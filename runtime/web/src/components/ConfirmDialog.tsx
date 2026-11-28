import React, { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <dialog
      ref={ref}
      className="mindfs-confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onClick={(event) => {
        if (busy || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom;
        if (outside) onCancel();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h3 id={titleId} className="mindfs-confirm-title">
        {title}
      </h3>
      <p id={descId} className="mindfs-confirm-desc">
        {description}
      </p>
      <div className="mindfs-confirm-actions">
        <button
          type="button"
          className="mindfs-confirm-btn mindfs-confirm-btn--cancel"
          disabled={busy}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`mindfs-confirm-btn ${danger ? "mindfs-confirm-btn--danger" : "mindfs-confirm-btn--primary"}`}
          disabled={busy}
          onClick={() => void onConfirm()}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
