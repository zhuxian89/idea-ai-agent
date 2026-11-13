import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { copyText } from "../services/clipboard";
import { sessionService } from "../services/session";
import type { SessionItem } from "./SessionList";

export type SessionMenuActions = {
  onScheduledTask?: (session: SessionItem) => void;
  onHandoffPack?: (session: SessionItem) => void;
};

export function SessionMenu({ session, syncing, onPin, onSync, onRename, onDelete, onScheduledTask, onHandoffPack }: SessionMenuActions & {
  session: SessionItem;
  syncing: boolean;
  onPin?: (session: SessionItem, pinned: boolean) => Promise<boolean> | boolean;
  onSync?: (session: SessionItem) => Promise<void> | void;
  onRename: () => void;
  onDelete?: (session: SessionItem) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [copying, setCopying] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current!.getBoundingClientRect();
    const bounds = menu.current!.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - bounds.height - 8)),
    });
  }, [open, error, feedback]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const reposition = () => setOpen(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
    };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("wheel", scroll, true);
    document.addEventListener("touchmove", scroll, true);
    window.addEventListener("resize", reposition);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape, true); document.removeEventListener("wheel", scroll, true); document.removeEventListener("touchmove", scroll, true); window.removeEventListener("resize", reposition); };
  }, [open]);

  const copy = async (path: boolean, button: HTMLButtonElement) => {
    setCopying(true); setError(""); setFeedback("");
    try {
      const value = path
        ? (await sessionService.getSessionLogPath(session.root_id!, session.session_key || session.key)).path
        : session.session_key || session.key;
      await copyText(value);
      setFeedback(t("session.handoff.copied"));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally { setCopying(false); requestAnimationFrame(() => { if (button.isConnected) button.focus({ preventScroll: true }); }); }
  };

  return <>
    <button ref={trigger} type="button" className="workspace-session-menu-trigger" aria-label={t("sessionList.menu")}
      aria-haspopup="menu" aria-expanded={open} data-pinned={!!session.pinned_at}
      onClick={() => { setOpen(!open); setFeedback(""); setError(""); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
      {session.pinned_at ? <span className="workspace-pin-mark" aria-label={t("sessionList.pin")}>•</span> : null}
    </button>
    {open ? createPortal(<div ref={menu} role="menu" aria-label={t("sessionList.menu")} className="workspace-session-menu" style={position}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key === "Tab") { setOpen(false); return; }
        const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (current + 1) % buttons.length : event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); buttons[next].focus({ preventScroll: true }); }
      }}>
      <button role="menuitem" onClick={() => { close(); void onPin?.(session, !session.pinned_at); }}>{t(session.pinned_at ? "sessionList.unpin" : "sessionList.pin")}</button>
      {onScheduledTask && session.type !== "command" && session.type !== "plugin" ? <button role="menuitem" onClick={() => { close(); onScheduledTask(session); }}>{t("scheduled.title")}</button> : null}
      <button role="menuitem" disabled={syncing} onClick={() => { close(); void onSync?.(session); }}>{t("sessionList.sync")}</button>
      <button role="menuitem" onClick={() => { close(); onRename(); }}>{t("sessionList.rename")}</button>
      <div role="separator" />
      <button role="menuitem" disabled={copying} onClick={event => void copy(false, event.currentTarget)}>{t("sessionList.copyId")}</button>
      {session.root_id ? <button role="menuitem" disabled={copying} onClick={event => void copy(true, event.currentTarget)}>{t("sessionList.copyPath")}</button> : null}
      {onHandoffPack ? <button role="menuitem" onClick={() => { close(); onHandoffPack(session); }}>{t("sessionList.handoffPack")}</button> : null}
      <div role="separator" />
      <button role="menuitem" className="workspace-menu-delete" onClick={() => { close(); onDelete?.(session); }}>{t("common.delete")}</button>
      {feedback ? <p role="status">{feedback}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>, document.body) : null}
  </>;
}
