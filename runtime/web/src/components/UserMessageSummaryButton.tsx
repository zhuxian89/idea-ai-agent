import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n";

export type IdeaUserMessageSummary = {
  id: string;
  seq: number;
  summary: string;
};

function UserMessageListIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    <path d="M8 8h8M8 12h6" />
  </svg>;
}

export function UserMessageSummaryButton({ summaries }: { summaries: IdeaUserMessageSummary[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [activeSeq, setActiveSeq] = useState<number | null>(null);
  useEffect(() => {
    if (!open) {
      setActiveSeq(null);
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-user-summary-root]")) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onUserScroll = () => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-user-message-index]"));
      if (!nodes.length) return;
      let active = activeSeq;
      for (const node of nodes) {
        if (node.getBoundingClientRect().bottom < window.innerHeight * 0.5) active = Number(node.dataset.userMessageIndex || 0) || active;
      }
      setActiveSeq(active);
    };
    onUserScroll();
    window.addEventListener("scroll", onUserScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onUserScroll, { capture: true, passive: true } as EventListenerOptions);
  }, [activeSeq, open]);
  if (!summaries.length) return null;
  const visibleCount = summaries.length > 99 ? "99+" : String(summaries.length);
  return <div className="idea-user-summary" data-user-summary-root>
    <button type="button" className="idea-icon-button idea-user-summary-button" aria-label={open ? t("session.hideUserSummary") : t("session.showUserSummary")} aria-pressed={open} title={open ? t("session.hideUserSummary") : t("session.showUserSummary")} onClick={() => setOpen((value) => !value)}>
      <UserMessageListIcon />
      <span>{t("session.userMessageCount", { count: visibleCount })}</span>
    </button>
    {open ? <div role="dialog" aria-label={t("session.userSummary")} className="idea-user-summary-menu">
      {summaries.map((item) => <button key={item.id} type="button" className={item.seq === activeSeq ? "active" : undefined} onClick={() => {
        document.querySelector<HTMLElement>(`[data-user-message-index="${item.seq}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        setOpen(false);
      }} title={item.summary}><span>{item.summary}</span></button>)}
    </div> : null}
  </div>;
}
