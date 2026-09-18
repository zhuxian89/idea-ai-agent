import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { isIdeaChromeHost, requestIdeaFileContext, subscribeIdeaNativeCommand } from "../services/ideaBridge";

export type IdeaUserMessageSummary = {
  id: string;
  seq: number;
  summary: string;
};

export type IdeaWorkbenchOptions = {
  projectName: string;
  sessionName?: string;
  onNewSession: () => void;
  userMessageSummaries?: IdeaUserMessageSummary[];
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

function UserMessageListIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
}

function UserMessageSummaryButton({ summaries }: { summaries: IdeaUserMessageSummary[] }) {
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
  return <div className="idea-user-summary" data-user-summary-root>
    <button type="button" className="idea-icon-button idea-user-summary-button" aria-label={open ? t("session.hideUserSummary") : t("session.showUserSummary")} aria-pressed={open} title={open ? t("session.hideUserSummary") : t("session.showUserSummary")} onClick={() => setOpen((value) => !value)}>
      <UserMessageListIcon />
      <span>{summaries.length > 99 ? "99+" : summaries.length}</span>
    </button>
    {open ? <div role="dialog" aria-label={t("session.userSummary")} className="idea-user-summary-menu">
      {summaries.map((item) => <button key={item.id} type="button" className={item.seq === activeSeq ? "active" : undefined} onClick={() => {
        document.querySelector<HTMLElement>(`[data-user-message-index="${item.seq}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        setOpen(false);
      }} title={item.summary}><span>{item.summary}</span></button>)}
    </div> : null}
  </div>;
}

export function IdeaWorkbench(props: Props) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Only the IDE host loads the page with ide_chrome=1; its native tool window
  // already carries the "AI Agent" title, new/history/settings actions, and a
  // gear menu. A plain browser keeps the embedded toolbar for standalone use.
  const [chrome] = useState(isIdeaChromeHost);
  const view = props.settingsOpen ? "settings" : props.historyOpen ? "history" : "chat";
  const previousView = useRef(view);
  const commandView = useRef(view);
  commandView.current = view;
  const backToChat = () => { commandView.current = "chat"; props.onCloseSettings?.(); props.onCloseHistory?.(); };
  const newSession = () => { backToChat(); props.onNewSession(); };
  const toggleHistory = () => { if (commandView.current === "history") backToChat(); else { commandView.current = "history"; props.onCloseSettings?.(); props.onOpenHistory?.(); } };
  const toggleSettings = () => { if (commandView.current === "settings") backToChat(); else { commandView.current = "settings"; props.onCloseHistory?.(); props.onOpenSettings?.(); } };
  const commandRef = useRef<(command: string) => void>(() => {});
  commandRef.current = (command) => {
    if (command === "new") newSession();
    else if (command === "history") toggleHistory();
    else if (command === "settings") toggleSettings();
    else if (command === "chat") backToChat();
  };
  useEffect(() => {
    if (!chrome) return;
    // Native title actions arrive as commands; queued ones replay on subscribe.
    return subscribeIdeaNativeCommand((command) => commandRef.current(command));
  }, [chrome]);
  useEffect(() => {
    if (previousView.current !== view) headingRef.current?.focus();
    previousView.current = view;
  }, [view]);
  return (
    <div className="idea-workbench" data-onboarding="shell" data-idea-view={view} data-idea-chrome={chrome ? "true" : undefined}>
      {!chrome ? <header className="idea-toolbar">
        <strong>AI Agent</strong>
        <ToolbarButton kind="new" label={t("session.new")} onClick={newSession} />
        <ToolbarButton kind="history" label={t("idea.history")} pressed={view === "history"} onClick={toggleHistory} />
        <ToolbarButton kind="settings" label={t("idea.settings")} pressed={view === "settings"} onClick={toggleSettings} />
      </header> : null}
      <header className="idea-view-heading">
        {view !== "chat" ? <button type="button" className="idea-icon-button" aria-label={t("idea.backToChat")} title={t("idea.backToChat")} onClick={backToChat}><Icon kind="back" /></button> : null}
        <div className="idea-view-heading-title">
          <h1 ref={headingRef} tabIndex={-1}>{view === "settings" ? t("idea.settings") : view === "history" ? t("idea.history") : props.sessionName || t("session.new")}</h1>
          <p title={props.projectName}>{props.projectName ? `${props.projectName} · ` : ""}{t("idea.currentProject")}</p>
        </div>
        {view === "chat" ? <UserMessageSummaryButton summaries={props.userMessageSummaries || []} /> : null}
      </header>
      {/* Keep the composer and its draft mounted when opening history/settings. */}
      <section className="idea-chat" hidden={view !== "chat"} aria-label={t("idea.chat")}>
        <main className="idea-conversation">{props.chat}{props.drawer}</main>
        <footer className="idea-composer">
          {chrome ? <div className="idea-file-context-actions">
            <button type="button" className="idea-file-context-button" onClick={requestIdeaFileContext} title={t("idea.addCurrentFileHint")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 11v6M9 14h6" />
              </svg>
              {t("idea.addCurrentFile")}
            </button>
          </div> : null}
          {props.footer}
        </footer>
      </section>
      <section className="idea-history" hidden={view !== "history"} aria-label={t("idea.history")}>{props.history}</section>
      <section className="idea-settings" hidden={view !== "settings"} aria-label={t("idea.settings")}>{props.settings}</section>
    </div>
  );
}
