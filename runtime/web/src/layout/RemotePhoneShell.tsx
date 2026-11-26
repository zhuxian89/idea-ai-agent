import React, { useState } from "react";
import { useI18n } from "../i18n";
import { PhoneMoreHostContext, type PhoneMoreConnection } from "../components/remoteui/PhoneMoreHost";
import { PhoneSheet } from "../components/remoteui/PhoneSheet";
import { PhoneActivityHostContext, PhoneSessionFactsContext, phoneSessionFilters, type PhoneSessionFacts, type PhoneSessionFilter } from "../components/remoteui/phoneSessionFacts";
import type { ProjectSessionGroup, SessionItem } from "../components/SessionList";
import "./remotePhone.css";

type Page = "chat" | "sessions" | "projects" | "more";

const icons = {
  back: "m13 5-7 7 7 7m-7-7h14",
  chat: "M4 5h16v11H9l-5 4V5Z",
  sessions: "M4 6h16M4 12h16M4 18h16",
  projects: "M3 7h7l2 2h9v10H3V7Z",
  more: "M12 5h.1M12 12h.1M12 19h.1",
};

const quickPriority = { wait: 0, work: 1, error: 2, idle: 2 };

export type RemotePhoneProps = {
  title: string;
  project: string;
  root: string;
  activeKey: string;
  viewingFile?: boolean;
  groups: ProjectSessionGroup[];
  filter: PhoneSessionFilter;
  onFilter: (filter: PhoneSessionFilter) => void;
  facts: (session: SessionItem) => PhoneSessionFacts;
  onSession: (session: SessionItem) => void;
  importOpen?: boolean;
  connection?: PhoneMoreConnection;
  multiProjectSessionsEnabled: boolean;
  onOpenCollab?: () => void;
  collabWaitingCount?: number;
};

export function RemotePhoneShell({ leftOpen, rightOpen, onProjects, onSessions, onChat, sidebar, sessions, main, footer, drawer, phone }: {
  leftOpen: boolean;
  rightOpen: boolean;
  onProjects: () => void;
  onSessions: () => void;
  onChat: () => void;
  sidebar?: React.ReactNode;
  sessions?: React.ReactNode;
  main: React.ReactNode;
  footer: React.ReactNode;
  drawer: React.ReactNode;
  phone: RemotePhoneProps;
}) {
  const { t } = useI18n();
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState(false);
  const [query, setQuery] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [activityHost, setActivityHost] = useState<HTMLDivElement | null>(null);
  const [moreHost, setMoreHost] = useState<HTMLDivElement | null>(null);

  const page: Page = more ? "more" : rightOpen ? "sessions" : leftOpen ? "projects" : "chat";
  const labels = { chat: t("remote.phone.chat"), sessions: t("sessionList.title"), projects: t("fileTree.projects"), more: t("remote.phone.more") };
  const summary = phone.groups.flatMap(group => group.sessions.filter(item => !item.parent_session_key).map(item => {
    const { state, preview, project, attentionId } = phone.facts(item);
    return { item, state, preview, project: project || group.rootName || group.rootId, id: `${item.root_id}:${item.key}:${state}:${attentionId || ""}` };
  }));
  const listSummary = phone.multiProjectSessionsEnabled ? summary : summary.filter(({ item }) => item.root_id === phone.root);
  const attention = summary.find(({ item, state, id }) =>
    (state === "wait" || state === "error") &&
    !(item.key === phone.activeKey && item.root_id === phone.root) &&
    !dismissed.includes(id));
  const search = query.trim().toLocaleLowerCase();
  const quickOptions = quick ? summary
    .filter(({ item, project, preview }) => `${item.name || item.key} ${project} ${preview || ""}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => quickPriority[a.state] - quickPriority[b.state] ||
      Number(!!b.item.pinned_at) - Number(!!a.item.pinned_at) ||
      (b.item.updated_at || "").localeCompare(a.item.updated_at || "")) : [];

  function go(to: Page) {
    setMore(to === "more");
    setQuick(false);
    if (to === "projects") onProjects();
    else if (to === "sessions") onSessions();
    else onChat();
  }

  function select(session: SessionItem) {
    go("chat");
    phone.onSession(session);
  }

  return (
    <PhoneSessionFactsContext.Provider value={phone.facts}>
    <div className="remote-phone" data-onboarding="shell" data-page={page}>
      <div className="remote-phone-chat" hidden={page !== "chat"}>
        <header className="remote-phone-chat-header">
          <button type="button" className="remote-phone-icon remote-phone-leading" aria-label={phone.viewingFile ? labels.projects : labels.sessions} aria-haspopup={phone.viewingFile ? undefined : "dialog"} aria-expanded={phone.viewingFile ? undefined : quick}
            onClick={() => {
              if (phone.viewingFile) go("projects");
              else { setQuery(""); setQuick(true); }
            }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={phone.viewingFile ? icons.back : icons.sessions} /></svg>
          </button>
          <div className="remote-phone-title">
            <strong>{phone.title || phone.project || labels.chat}</strong>
          </div>
          {phone.onOpenCollab ? (
            <button
              type="button"
              className="collab-entry-btn collab-entry-btn--phone"
              onClick={phone.onOpenCollab}
              title={t("collab.entryTitle")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="9" cy="8" r="3" />
                <path d="M3.5 18.5c.8-2.7 2.9-4.2 5.5-4.2s4.7 1.5 5.5 4.2" />
                <circle cx="17" cy="9" r="2.5" />
                <path d="M15.5 14.8c2.1.2 3.8 1.4 4.6 3.7" />
              </svg>
              <span>{t("collab.entryMode")}</span>
              {(phone.collabWaitingCount || 0) > 0 ? (
                <span className="collab-entry-badge">{phone.collabWaitingCount}</span>
              ) : null}
            </button>
          ) : null}
          <button type="button" className="remote-phone-icon" aria-label={labels.projects} onClick={() => go("projects")}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={icons.projects} /></svg>
          </button>
        </header>
        {attention && <div className="remote-phone-attention" data-state={attention.state}>
          <button type="button" onClick={() => select(attention.item)}>{t(attention.state === "wait" ? "remote.phone.otherWait" : "remote.phone.otherError")} · {attention.item.name || attention.item.key}</button>
          <button type="button" className="remote-phone-dismiss" aria-label={t("common.close")} onClick={() => setDismissed(items => [...items, attention.id])}>×</button>
        </div>}
        <main className="remote-phone-thread">
          <PhoneActivityHostContext.Provider value={activityHost}>{main}</PhoneActivityHostContext.Provider>
          {drawer}
        </main>
        <footer className="remote-phone-composer">
          <div className="remote-phone-activity remote-glow-frame" ref={setActivityHost} />
          {footer}
        </footer>
      </div>
      <section className="remote-phone-page remote-phone-sessions" hidden={page !== "sessions"} aria-label={labels.sessions}>
        {!phone.importOpen && <div className="remote-phone-filters" role="group" aria-label={labels.sessions}>
          {(["", ...phoneSessionFilters] as const).map(state => <button key={state} type="button" aria-pressed={phone.filter === state} onClick={() => phone.onFilter(state)}>
            {state ? t(`remote.phone.${state}`) : t("remote.phone.allSessions")} <span>{state ? listSummary.filter(item => item.state === state).length : listSummary.length}</span>
          </button>)}
        </div>}
        {sessions}
      </section>
      <section className="remote-phone-page remote-phone-projects" hidden={page !== "projects"} aria-label={labels.projects}>
        <PhoneMoreHostContext.Provider value={page === "more" && moreHost ? { host: moreHost, connection: phone.connection } : null}>{sidebar}</PhoneMoreHostContext.Provider>
      </section>
      <section className="remote-phone-page remote-phone-more" hidden={page !== "more"} aria-label={labels.more}>
        <h1>{labels.more}</h1>
        <div className="remote-phone-settings" ref={setMoreHost} />
      </section>
      {page !== "chat" && <nav className="remote-phone-nav">
        {(["chat", "sessions", "projects", "more"] as const).map(to => <button key={to} type="button" aria-current={page === to ? "page" : undefined} onClick={() => go(to)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[to]} /></svg>{labels[to]}
        </button>)}
      </nav>}
    </div>
    <PhoneSheet side="left" title={labels.sessions} open={quick && page === "chat"} onClose={() => setQuick(false)}>
      <div className="remote-phone-search-bar">
        <input className="remote-phone-search" type="search" aria-label={t("remote.phone.searchRecent")} placeholder={t("remote.phone.searchRecent")} value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      {quickOptions.length ? <ul className="remote-phone-recent-list" role="list">
        {quickOptions.map(({ item, project, state, preview }) => {
          const current = item.key === phone.activeKey && item.root_id === phone.root;
          return <li key={`${item.root_id}:${item.key}`}>
            <button type="button" className="remote-phone-recent" aria-current={current || undefined} onClick={() => select(item)}>
              <span>
                <strong>{item.name || item.key}</strong>
                {preview && <small>{preview}</small>}
                <small className="remote-phone-recent-meta">
                  <span>{project}</span>
                  <span className="remote-phone-recent-state"><i data-state={state} aria-hidden="true" />{t(`remote.phone.${state}`)}</span>
                </small>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d={current ? "m5 12 4 4L19 6" : "m9 6 6 6-6 6"} />
              </svg>
            </button>
          </li>;
        })}
      </ul> : <p className="remote-phone-recent-empty">{t(search ? "sessionList.noSearchMatch" : "sessionList.empty")}</p>}
      <button type="button" className="remote-phone-all" onClick={() => { phone.onFilter(""); go("sessions"); }}>{t("remote.phone.allSessions")}</button>
    </PhoneSheet>
    </PhoneSessionFactsContext.Provider>
  );
}
