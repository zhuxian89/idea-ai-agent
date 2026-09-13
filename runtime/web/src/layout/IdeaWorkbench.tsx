import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";

export type IdeaWorkbenchOptions = {
  projectName: string;
  sessionName?: string;
  onNewSession: () => void;
};

type Props = IdeaWorkbenchOptions & {
  chat: React.ReactNode;
  history: React.ReactNode;
  settings: React.ReactNode;
  footer: React.ReactNode;
  drawer: React.ReactNode;
  settingsOpen: boolean;
  historyOpen: boolean;
  onCloseSettings?: () => void;
  onCloseHistory?: () => void;
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
};

function Icon({ kind }: { kind: "new" | "history" | "settings" | "back" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "new" ? <path d="M12 5v14M5 12h14" /> : kind === "history" ? <><path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l3 2" /></> : kind === "settings" ? <path d="M4 7h16M4 17h16M8 4v6M16 14v6" /> : <path d="m14 6-6 6 6 6" />}
  </svg>;
}

function ToolbarButton({ label, kind, pressed, onClick }: {
  label: string;
  kind: "new" | "history" | "settings";
  pressed?: boolean;
  onClick: () => void;
}) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const visible = (hovered || focused) && !dismissed;
  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [visible]);
  return <span className="idea-toolbar-action"
    onMouseEnter={() => { setHovered(true); setDismissed(false); }}
    onMouseLeave={() => setHovered(false)}>
    <button type="button" className="idea-icon-button" aria-label={label}
      aria-pressed={pressed} aria-describedby={visible ? tooltipId : undefined}
      onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => setFocused(false)}
      onClick={() => { setDismissed(true); onClick(); }}><Icon kind={kind} /></button>
    {visible ? <span id={tooltipId} role="tooltip" className="idea-toolbar-tooltip">{label}</span> : null}
  </span>;
}

export function IdeaWorkbench(props: Props) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const view = props.settingsOpen ? "settings" : props.historyOpen ? "history" : "chat";
  const previousView = useRef(view);
  const backToChat = () => { props.onCloseSettings?.(); props.onCloseHistory?.(); };
  useEffect(() => {
    if (previousView.current !== view) headingRef.current?.focus();
    previousView.current = view;
  }, [view]);
  return (
    <div className="idea-workbench" data-onboarding="shell" data-idea-view={view}>
      <header className="idea-toolbar">
        <strong>AI Agent</strong>
        <ToolbarButton kind="new" label={t("session.new")} onClick={() => { backToChat(); props.onNewSession(); }} />
        <ToolbarButton kind="history" label={t("idea.history")} pressed={view === "history"} onClick={() => { if (view === "history") backToChat(); else { props.onCloseSettings?.(); props.onOpenHistory?.(); } }} />
        <ToolbarButton kind="settings" label={t("idea.settings")} pressed={view === "settings"} onClick={() => { if (view === "settings") backToChat(); else { props.onCloseHistory?.(); props.onOpenSettings?.(); } }} />
      </header>
      <header className="idea-view-heading">
        {view !== "chat" ? <button type="button" className="idea-icon-button" aria-label={t("idea.backToChat")} title={t("idea.backToChat")} onClick={backToChat}><Icon kind="back" /></button> : null}
        <div>
          <h1 ref={headingRef} tabIndex={-1}>{view === "settings" ? t("idea.settings") : view === "history" ? t("idea.history") : props.sessionName || t("session.new")}</h1>
          <p title={props.projectName}>{props.projectName ? `${props.projectName} · ` : ""}{t("idea.currentProject")}</p>
        </div>
      </header>
      {/* Keep the composer and its draft mounted when opening history/settings. */}
      <section className="idea-chat" hidden={view !== "chat"} aria-label={t("idea.chat")}>
        <main className="idea-conversation">{props.chat}{props.drawer}</main>
        <footer className="idea-composer">{props.footer}</footer>
      </section>
      <section className="idea-history" hidden={view !== "history"} aria-label={t("idea.history")}>{props.history}</section>
      <section className="idea-settings" hidden={view !== "settings"} aria-label={t("idea.settings")}>{props.settings}</section>
    </div>
  );
}
