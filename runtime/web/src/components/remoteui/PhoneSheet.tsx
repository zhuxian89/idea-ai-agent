import React, { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";

export function PhoneSheet({ title, open, onClose, children, side }: {
  title: string;
  side?: "left";
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (open && dialog) {
      dialog.showModal();
      return () => dialog.close();
    }
  }, [open]);
  return createPortal(
    <dialog className="remote-phone-sheet" data-side={side} ref={ref}
      onTouchStart={event => {
        if (side !== "left" || event.touches.length !== 1) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, select")) {
          swipeStart.current = null;
          return;
        }
        swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }}
      onTouchEnd={event => {
        if (side !== "left" || !swipeStart.current || event.changedTouches.length !== 1) return;
        const dx = event.changedTouches[0].clientX - swipeStart.current.x;
        const dy = event.changedTouches[0].clientY - swipeStart.current.y;
        swipeStart.current = null;
        if (dx < -56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          ref.current?.close();
          onClose();
        }
      }}
      onClick={event => {
      if (side !== "left" || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX >= bounds.right || event.clientX < bounds.left) onClose();
    }} aria-labelledby={titleId} onCancel={event => {
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
