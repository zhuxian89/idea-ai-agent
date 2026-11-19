import React, { useState } from "react";
import { useI18n } from "../i18n";
import { PhoneMoreHostContext, type PhoneMoreConnection } from "../components/remoteui/PhoneMoreHost";
import { PhoneSheet } from "../components/remoteui/PhoneSheet";
import { PhoneActivityHostContext, PhoneSessionFactsContext, phoneSessionFilters, type PhoneSessionFacts, type PhoneSessionFilter } from "../components/remoteui/phoneSessionFacts";
import type { ProjectSessionGroup, SessionItem } from "../components/SessionList";
import "./remotePhone.css";

type Page = "chat" | "sessions" | "projects" | "more";

const icons = {
  chat: "M4 5h16v11H9l-5 4V5Z",
  sessions: "M7 6h14M7 12h14M7 18h14M3 6h.1M3 12h.1M3 18h.1",
  projects: "M3 7h7l2 2h9v10H3V7Z",
  more: "M12 5h.1M12 12h.1M12 19h.1",
};

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
  const groups = phone.groups.map(group => ({
    ...group,
    sessions: group.sessions.filter(item => !item.parent_session_key),
  }));
  const localFirst = [...groups].sort((a, b) => Number(b.rootId === phone.root) - Number(a.rootId === phone.root));
  const all = groups.flatMap(group => group.sessions);
  const summary = all.map(item => {
    const facts = phone.facts(item);
    return { item, state: facts.state, id: `${item.root_id}:${item.key}:${facts.state}:${facts.attentionId || ""}` };
  });
  const listSummary = phone.multiProjectSessionsEnabled ? summary : summary.filter(({ item }) => item.root_id === phone.root);
  const attention = summary.find(({ item, state, id }) =>
    (state === "wait" || state === "error") &&
    !(item.key === phone.activeKey && item.root_id === phone.root) &&
    !dismissed.includes(id));

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

  function recent(group: ProjectSessionGroup) {
    const matches = group.sessions.filter(item => {
      const facts = phone.facts(item);
      return `${item.name || item.key} ${facts.preview || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    });
    return [...matches].sort((a, b) => Number(!!b.pinned_at) - Number(!!a.pinned_at) ||
      (b.updated_at || "").localeCompare(a.updated_at || "")).slice(0, 12);
  }

  function option(item: SessionItem) {
    const facts = phone.facts(item);
    return <button type="button" className="remote-phone-recent" key={item.key} onClick={() => select(item)}>
      <i data-state={facts.state} aria-label={t(`remote.phone.${facts.state}`)} />
      <span><strong>{item.name || item.key}</strong>{facts.preview && <small>{facts.preview}</small>}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
    </button>;
  }

  return (
    <PhoneSessionFactsContext.Provider value={phone.facts}>
    <div className="remote-phone" data-onboarding="shell" data-page={page}>
      <div className="remote-phone-chat" hidden={page !== "chat"}>
        <header className="remote-phone-chat-header">
          <button type="button" className="remote-phone-icon" aria-label={phone.viewingFile ? labels.projects : labels.sessions} onClick={() => go(phone.viewingFile ? "projects" : "sessions")}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m13 5-7 7 7 7m-7-7h14" /></svg>
          </button>
          <button type="button" className="remote-phone-title" aria-label={t("remote.phone.quickSwitch")} aria-haspopup="dialog" onClick={() => { setQuery(""); setQuick(true); }}>
            {phone.project && <small>{phone.project}</small>}
            <strong>{phone.title || labels.chat}</strong>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
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
    <PhoneSheet title={t("remote.phone.quickSwitch")} open={quick && page === "chat"} onClose={() => setQuick(false)}>
      <input className="remote-phone-search" type="search" aria-label={t("remote.phone.searchRecent")} placeholder={t("remote.phone.searchRecent")} value={query} onChange={event => setQuery(event.target.value)} />
      {localFirst.map(group => {
        const options = recent(group);
        if (!options.length) return null;
        return <details key={group.rootId} open={group.rootId === phone.root || !!query.trim()}>
          <summary>{group.rootName}</summary>{options.map(option)}
        </details>;
      })}
      <button type="button" className="remote-phone-all" onClick={() => { phone.onFilter(""); go("sessions"); }}>{t("remote.phone.allSessions")}</button>
    </PhoneSheet>
    </PhoneSessionFactsContext.Provider>
  );
}
