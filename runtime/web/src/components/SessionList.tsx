import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityEmoji } from "./ActivityEmoji";
import { SessionMenu, type SessionMenuActions } from "./SessionMenu";
import { buildSessionRows, type SessionRow } from "./sessionHierarchy";
import "./workspaceSidebar.css";
import { AgentIcon } from "./AgentIcon";
import { ModeIcon } from "./ModeIcon";
import { useI18n, type Locale } from "../i18n";
import { agentDisplayName } from "../services/agentSetup";

export type SessionType = "chat" | "plugin" | "command";

export type SessionItem = {
  key: string;
  session_key: string;
  root_id?: string;
  type?: SessionType;
  parent_session_key?: string;
  parent_tool_call_id?: string;
  source?: string;
  task_id?: string;
  agent?: string;
  shell?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  pinned_at?: string | null;
  closed_at?: string;
  pending?: boolean;
  related_files?: Array<{ path: string }>;
  search_seq?: number;
  search_snippet?: string;
  search_match_type?: "name" | "user" | "reply";
};

type SessionListProps = SessionMenuActions & {
  sessions: SessionItem[];
  selectedKey?: string;
  headerAction?: React.ReactNode;
  persistentSearch?: boolean;
  searchOpen?: boolean;
  searchResultsMode?: boolean;
  searchQuery?: string;
  searchLoading?: boolean;
  emptyText?: React.ReactNode;
  onSearchToggle?: () => void;
  onSearchBack?: () => void;
  onSearchQueryChange?: (query: string) => void;
  onSearchBlur?: () => void;
  syncingSessionKeys?: Set<string>;
  onSelect?: (session: SessionItem) => void;
  onSync?: (session: SessionItem) => Promise<void> | void;
  onPin?: (session: SessionItem, pinned: boolean) => Promise<boolean> | boolean;
  onRename?: (session: SessionItem, nextName: string) => Promise<boolean> | boolean;
  onDelete?: (session: SessionItem) => void;
  onLoadChildren?: (
    session: SessionItem,
    options?: { beforeTime?: string },
  ) => Promise<{ hasMore?: boolean } | void> | { hasMore?: boolean } | void;
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
  hasMore?: boolean;
};

const MULTI_PROJECT_VISIBLE_LIMIT = 6;
const MAIN_SESSION_ICON_OFFSET = "2px";
const PINNED_PROJECTS_STORAGE_KEY = "mindfs-pinned-session-projects";

export type ProjectSessionGroup = {
  rootId: string;
  rootName: string;
  latestSessionTime?: string;
  sessions: SessionItem[];
  totalCount: number;
};

type ProjectSessionListProps = SessionMenuActions & {
  groups: ProjectSessionGroup[];
  selectedKey?: string;
  selectedRootId?: string;
  headerAction?: React.ReactNode;
  loading?: boolean;
  emptyText?: React.ReactNode;
  syncingSessionKeys?: Set<string>;
  onSearchToggle?: () => void;
  onSelect?: (session: SessionItem) => void;
  onSync?: (session: SessionItem) => Promise<void> | void;
  onPin?: (session: SessionItem, pinned: boolean) => Promise<boolean> | boolean;
  onRename?: (session: SessionItem, nextName: string) => Promise<boolean> | boolean;
  onDelete?: (session: SessionItem) => void;
  onProjectClick?: (rootId: string) => void;
  onLoadMoreProject?: (group: ProjectSessionGroup) => Promise<void> | void;
  onLoadChildren?: (
    session: SessionItem,
    options?: { beforeTime?: string },
  ) => Promise<{ hasMore?: boolean } | void> | { hasMore?: boolean } | void;
};

function ToggleRowButton({
  label,
  loading,
  marginLeft,
  showExpandIcon = false,
  showCollapseIcon = false,
  onClick,
  onCollapse,
}: {
  label: string;
  loading?: boolean;
  marginLeft: string;
  showExpandIcon?: boolean;
  showCollapseIcon?: boolean;
  onClick: () => void;
  onCollapse?: () => void;
}) {
  const { t } = useI18n();
  const icon = (rotate = false) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{
        width: "13px",
        height: "13px",
        flexShrink: 0,
        transform: rotate ? "rotate(180deg)" : "none",
      }}
    >
      <path d="M0 0h16v16H0z" fill="none" />
      <path fill="currentColor" d="M12.146 7.146a.5.5 0 0 1 .708.708l-4.5 4.5a.5.5 0 0 1-.708 0l-4.5-4.5a.5.5 0 1 1 .708-.708L8 11.293zm0-4a.5.5 0 0 1 .708.708l-4.5 4.5a.5.5 0 0 1-.708 0l-4.5-4.5a.5.5 0 1 1 .708-.708L8 7.293z" />
    </svg>
  );

  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      style={{
        marginLeft,
        marginTop: "-2px",
        border: "none",
        background: "transparent",
        color: "var(--text-primary)",
        borderRadius: 0,
        padding: 0,
        minHeight: "13px",
        width: `calc(100% - ${marginLeft})`,
        boxSizing: "border-box",
        cursor: loading ? "default" : "pointer",
        fontSize: "11px",
        lineHeight: 1.1,
        textAlign: "center",
        opacity: loading ? 0.6 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", minWidth: 0, flexShrink: 1 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {showExpandIcon ? icon(false) : null}
        {showCollapseIcon ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("common.collapse")}
            title={t("common.collapse")}
            onClick={(event) => {
              event.stopPropagation();
              onCollapse?.();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onCollapse?.();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: loading ? "default" : "pointer",
            }}
          >
            {icon(true)}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ transform: expanded ? "rotate(90deg)" : undefined }}><path d="m6 3 5 5-5 5" /></svg>;
}

function ChildGroupRow({ row, loading, onClick }: { row: Exclude<SessionRow, { type: "session" }>; loading: boolean; onClick: () => void }) {
  const { t } = useI18n();
  const group = row.type === "child-group";
  return <button type="button" className="workspace-child-group" style={{ marginLeft: `${row.depth * 12 + 8}px` }}
    aria-expanded={group ? row.expanded : undefined} disabled={loading} onClick={onClick}>
    {group ? <Chevron expanded={row.expanded} /> : null}
    {loading ? t("sessionList.loading") : group ? t(row.group === "running" ? "sessionList.runningChildren" : "sessionList.endedChildren", { count: row.count }) : t("sessionList.loadMoreChildren")}
  </button>;
}

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="m16.219 4.838l2.964 2.967c2.012 2.014 3.018 3.021 2.784 4.107c-.235 1.085-1.567 1.585-4.23 2.586l-1.845.693c-.713.268-1.07.402-1.345.64q-.181.158-.322.352c-.212.297-.313.664-.515 1.4c-.46 1.672-.69 2.508-1.239 2.821c-.23.132-.492.2-.758.2c-.63 0-1.243-.614-2.469-1.84l-1.466-1.468l-1.079-1.08L5.285 14.8c-1.218-1.219-1.827-1.828-1.83-2.455a1.53 1.53 0 0 1 .203-.773c.313-.543 1.143-.772 2.803-1.23c.737-.203 1.105-.304 1.402-.517q.199-.144.36-.332c.236-.278.368-.637.63-1.355l.669-1.823c.987-2.693 1.48-4.04 2.568-4.28s2.102.774 4.129 2.803"
        clipRule="evenodd"
        opacity={pinned ? 1 : 0.5}
      />
      <path fill="currentColor" d="m3.302 21.776l4.476-4.48l-1.079-1.08l-4.476 4.48a.764.764 0 0 0 1.08 1.08" />
    </svg>
  );
}

function shellBadgeLabel(shell?: string): string {
  const normalized = String(shell || "").trim().replace(/\\/g, "/");
  const base = (normalized.split("/").filter(Boolean).pop() || normalized || "sh").toLowerCase();
  if (base === "powershell.exe") return "ps";
  if (base === "pwsh.exe") return "pwsh";
  if (base === "cmd.exe") return "cmd";
  if (base.endsWith(".exe")) return base.slice(0, -4);
  return base;
}

type ForkSessionSource = {
  sessionKey: string;
  seq: number;
};

function parseForkSessionSource(source?: string): ForkSessionSource | null {
  const value = String(source || "").trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      type?: unknown;
      session_key?: unknown;
      seq?: unknown;
    };
    if (parsed?.type !== "fork") return null;
    return {
      sessionKey: String(parsed.session_key || "").trim(),
      seq: Number(parsed.seq || 0),
    };
  } catch {
    if (!value.includes('"type":"fork"') && !value.includes('"type": "fork"')) {
      return null;
    }
    return { sessionKey: "", seq: 0 };
  }
}

function forkSessionDisplayName(
  storedName: string,
  source: ForkSessionSource | null,
  sessionByKey: Map<string, SessionItem>,
  rootId?: string,
): string {
  if (!source) return storedName;
  const parentName = String(
    sessionByKey.get(rootId ? `${rootId}:${source.sessionKey}` : source.sessionKey)?.name ||
      sessionByKey.get(source.sessionKey)?.name ||
      "",
  ).trim();
  const fallbackName = storedName.replace(/\s+fork\s+@\d+\s*$/i, "").trim();
  const base = parentName || fallbackName || storedName;
  return source.seq > 0 ? `${base}#${source.seq}` : base;
}

function isSessionSyncing(
  session: SessionItem,
  syncingSessionKeys?: Set<string>,
): boolean {
  if (!syncingSessionKeys || syncingSessionKeys.size === 0) {
    return false;
  }
  const key = session.key || session.session_key || "";
  if (!key) {
    return false;
  }
  const rootId = session.root_id || "";
  return (
    syncingSessionKeys.has(key) ||
    (!!rootId && syncingSessionKeys.has(`${rootId}::${key}`))
  );
}

export function SessionList({
  sessions,
  selectedKey = "",
  headerAction,
  persistentSearch = false,
  searchOpen = false,
  searchResultsMode = false,
  searchQuery = "",
  searchLoading = false,
  emptyText = "",
  onSearchToggle,
  onSearchBack,
  onSearchQueryChange,
  onSearchBlur,
  syncingSessionKeys,
  onSelect,
  onSync,
  onPin,
  onRename,
  onDelete,
  onScheduledTask,
  onHandoffPack,
  onLoadChildren,
  onLoadOlder,
  loadingOlder = false,
  hasMore = false,
}: SessionListProps) {
  const { t } = useI18n();
  const effectiveEmptyText = emptyText || t("sessionList.empty");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchBlurTimerRef = useRef<number | null>(null);
  const [collapsedRunning, setCollapsedRunning] = useState<Record<string, boolean>>({});
  const [expandedChildren, setExpandedChildren] = useState<Record<string, boolean>>({});
  const [loadingChildren, setLoadingChildren] = useState<Record<string, boolean>>({});
  const [childrenHasMore, setChildrenHasMore] = useState<Record<string, boolean>>({});
  const visibleSessions = useMemo(() => searchResultsMode
    ? sessions.map((session): SessionRow => ({ type: "session", session, depth: 0 }))
    : buildSessionRows(sessions, selectedKey || "", collapsedRunning, expandedChildren, childrenHasMore, session => session.key),
  [sessions, selectedKey, searchResultsMode, collapsedRunning, expandedChildren, childrenHasMore]);
  const selectedParentKey = useMemo(() => {
    if (!selectedKey) return "";
    return sessions.find((item) => item.key === selectedKey)?.parent_session_key || "";
  }, [selectedKey, sessions]);
  const sessionByKey = useMemo(() => {
    const byKey = new Map<string, SessionItem>();
    for (const item of sessions) {
      byKey.set(item.key, item);
    }
    return byKey;
  }, [sessions]);

  useEffect(() => {
    if (!searchOpen || persistentSearch) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [persistentSearch, searchOpen]);

  useEffect(() => {
    return () => {
      if (searchBlurTimerRef.current) {
        window.clearTimeout(searchBlurTimerRef.current);
      }
    };
  }, []);

  const loadChildren = async (parent: SessionItem, beforeTime?: string) => {
    if (!onLoadChildren || loadingChildren[parent.key]) {
      return;
    }
    setLoadingChildren((prev) => ({ ...prev, [parent.key]: true }));
    try {
      const result = await onLoadChildren(parent, beforeTime ? { beforeTime } : undefined);
      setChildrenHasMore((prev) => ({ ...prev, [parent.key]: !!result?.hasMore }));
    } finally {
      setLoadingChildren((prev) => ({ ...prev, [parent.key]: false }));
    }
  };

  const handleChildToggle = async (row: Exclude<SessionRow, { type: "session" }>) => {
    const key = row.parent.key;
    if (row.type === "child-group") {
      if (row.group === "running") setCollapsedRunning(prev => ({ ...prev, [key]: row.expanded }));
      else {
        setExpandedChildren(prev => ({ ...prev, [key]: !row.expanded }));
        if (!row.expanded) await loadChildren(row.parent);
      }
    } else {
      const oldest = sessions.filter(item => item.parent_session_key === key)
        .sort((a, b) => Date.parse(a.updated_at || "") - Date.parse(b.updated_at || ""))[0];
      await loadChildren(row.parent, oldest?.updated_at);
    }
  };

  return (
    <div className="workspace-sessions"
      style={{
        flex: 1,
        width: "100%",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "transparent",
      }}
    >
      {!persistentSearch ? (
        <div
          data-onboarding="session-actions"
          style={{
            height: "36px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: searchResultsMode ? "0 10px 0 4px" : "0 10px 0 2px",
            borderBottom: "1px solid var(--border-color)",
            background: "var(--mindfs-topbar-bg, transparent)",
            flexShrink: 0,
            boxSizing: "border-box",
          }}
        >
          {searchResultsMode ? (
            <button
              type="button"
              onClick={onSearchBack}
              aria-label={t("sessionList.back")}
              style={iconButtonStyle(false)}
            >
              <ChevronLeftIcon />
            </button>
          ) : (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <span className="workspace-sessions-title">{t("sessionList.title")}</span>
              {onSearchToggle ? (
                <button
                  type="button"
                  aria-label={searchOpen ? t("sessionList.closeSearch") : t("sessionList.search")}
                  title={searchOpen ? t("sessionList.closeSearch") : t("sessionList.search")}
                  onClick={onSearchToggle}
                  style={{
                    width: "34px",
                    height: "34px",
                    minWidth: "34px",
                    border: "none",
                    borderRadius: "8px",
                    padding: 0,
                    background: "transparent",
                    color: searchOpen ? "var(--accent-color)" : "var(--text-secondary)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14" />
                  </svg>
                </button>
              ) : null}
            </div>
          )}
          {headerAction ? (
            <div style={{ display: "inline-flex", alignItems: "center" }}>
              {headerAction}
            </div>
          ) : null}
        </div>
      ) : null}

      {persistentSearch || searchOpen ? (
        <div
          data-onboarding={persistentSearch ? "session-actions" : undefined}
          role="search"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 12px",
            borderBottom: "1px solid var(--border-color)",
            flexShrink: 0,
            background: "var(--mindfs-topbar-bg, transparent)",
          }}
        >
          <div
            className="mindfs-session-search-field"
            aria-busy={searchLoading}
            style={{
              display: "flex",
              flex: 1,
              minWidth: 0,
              alignItems: "center",
              gap: "9px",
              border: "1px solid var(--border-color)",
              borderRadius: "7px",
              padding: "0 10px",
              height: "40px",
              boxSizing: "border-box",
              background: "var(--content-bg)",
            }}
          >
            {searchLoading ? (
              <span
                role="status"
                aria-label={t("sessionList.searching")}
                style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  border: "1.5px solid rgba(100,116,139,0.45)",
                  borderTopColor: "var(--accent-color)",
                  display: "inline-block",
                  flexShrink: 0,
                  animation: "spin 0.8s linear infinite",
                }}
              />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--text-secondary)", flexShrink: 0 }}>
                <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14" />
              </svg>
            )}
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              aria-label={t("sessionList.search")}
              placeholder={t("sessionList.searchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onSearchQueryChange?.(e.target.value)}
              onBlur={() => {
                if (persistentSearch) {
                  return;
                }
                if (searchResultsMode) {
                  return;
                }
                if (searchBlurTimerRef.current) {
                  window.clearTimeout(searchBlurTimerRef.current);
                }
                searchBlurTimerRef.current = window.setTimeout(() => {
                  onSearchBlur?.();
                }, 120);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                outline: "none",
                background: "transparent",
                color: "var(--text-primary)",
                fontSize: "14px",
                lineHeight: 1.4,
                WebkitAppearance: "none",
              }}
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => onSearchQueryChange?.("")}
                onMouseDown={(e) => e.preventDefault()}
                aria-label={t("sessionList.clearSearch")}
                style={{
                  width: "24px",
                  height: "24px",
                  border: "none",
                  borderRadius: "999px",
                  padding: 0,
                  background: "rgba(148,163,184,0.18)",
                  color: "var(--text-secondary)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : null}
          </div>
          {persistentSearch && headerAction ? (
            <div style={{ display: "inline-flex", flex: "0 0 auto", alignItems: "center" }}>
              {headerAction}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px" }}>
        {!sessions.length ? (
          emptyText ? (
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                minHeight: "100%",
                padding: "12px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                lineHeight: 1.6,
              }}
            >
              {effectiveEmptyText}
            </div>
          ) : null
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {visibleSessions.map((row) => {
              if (row.type !== "session") return <ChildGroupRow key={`${row.parent.key}:${row.type}:${row.type === "child-group" ? row.group : "more"}`} row={row}
                loading={!!loadingChildren[row.parent.key]} onClick={() => void handleChildToggle(row)} />;
              const session = row.session;
              return (
                <SessionCard
                  key={session.key}
                  session={session}
                  sessionByKey={sessionByKey}
                  selected={session.key === selectedKey}
                  parentHighlighted={!!selectedParentKey && session.key === selectedParentKey}
                  highlightQuery={searchResultsMode ? searchQuery : ""}
                  syncing={isSessionSyncing(session, syncingSessionKeys)}
                  depth={row.depth}
                  onSelect={onSelect}
                  onSync={onSync}
                  onPin={onPin}
                  onRename={onRename}
                  onDelete={onDelete}
                  onScheduledTask={onScheduledTask}
                  onHandoffPack={onHandoffPack}
                />
              );
            })}
            {hasMore ? (
              <button
                type="button"
                onClick={onLoadOlder}
                disabled={loadingOlder}
                style={{
                  marginTop: "8px",
                  border: "1px solid var(--border-color)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  cursor: loadingOlder ? "default" : "pointer",
                  fontSize: "12px",
                }}
              >
                {loadingOlder ? t("sessionList.loading") : t("sessionList.loadMore")}
              </button>
            ) : null}
          </div>
        )}
      </div>
      <style>{`
        @keyframes mindfs-bound-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 1.5px rgba(37,99,235,0.14); }
          50% { opacity: 0.18; box-shadow: 0 0 0 4px rgba(37,99,235,0.08); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .mindfs-session-search-field:focus-within {
          border-color: var(--accent-color) !important;
          box-shadow: none;
        }
        .idea-workbench .mindfs-session-search-field input:focus-visible {
          outline: none !important;
        }
        .mindfs-session-search-field input[type="search"]::-webkit-search-cancel-button {
          display: none;
        }
      `}</style>
    </div>
  );
}

export function MultiProjectSessionList({
  groups,
  selectedKey = "",
  selectedRootId = "",
  headerAction,
  loading = false,
  emptyText = "",
  syncingSessionKeys,
  onSearchToggle,
  onSelect,
  onSync,
  onPin,
  onRename,
  onDelete,
  onScheduledTask,
  onHandoffPack,
  onProjectClick,
  onLoadMoreProject,
  onLoadChildren,
}: ProjectSessionListProps) {
  const { t } = useI18n();
  const effectiveEmptyText = emptyText || t("sessionList.empty");
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [loadingProjects, setLoadingProjects] = useState<Record<string, boolean>>({});
  const [collapsedRunning, setCollapsedRunning] = useState<Record<string, boolean>>({});
  const [expandedChildren, setExpandedChildren] = useState<Record<string, boolean>>({});
  const [loadingChildren, setLoadingChildren] = useState<Record<string, boolean>>({});
  const [childrenHasMore, setChildrenHasMore] = useState<Record<string, boolean>>({});
  const [pinnedProjects, setPinnedProjects] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") {
      return {};
    }
    try {
      const parsed = JSON.parse(window.localStorage.getItem(PINNED_PROJECTS_STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      const next: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const timestamp = Number(value);
        if (key && Number.isFinite(timestamp) && timestamp > 0) {
          next[key] = timestamp;
        }
      }
      return next;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify(pinnedProjects));
  }, [pinnedProjects]);
  const orderedGroups = useMemo(
    () =>
      groups.slice().sort((left, right) => {
        const leftPinnedAt = pinnedProjects[left.rootId] || 0;
        const rightPinnedAt = pinnedProjects[right.rootId] || 0;
        if (leftPinnedAt || rightPinnedAt) {
          if (leftPinnedAt !== rightPinnedAt) {
            return rightPinnedAt - leftPinnedAt;
          }
        }
        return 0;
      }),
    [groups, pinnedProjects],
  );
  const togglePinnedProject = (rootId: string) => {
    setPinnedProjects((prev) => {
      const next = { ...prev };
      if (next[rootId]) {
        delete next[rootId];
      } else {
        next[rootId] = Date.now();
      }
      return next;
    });
  };
  const sessionByKey = useMemo(() => {
    const byKey = new Map<string, SessionItem>();
    for (const group of groups) {
      for (const item of group.sessions) {
        const sessionRoot = item.root_id || group.rootId;
        byKey.set(`${sessionRoot}:${item.key}`, item);
        byKey.set(item.key, item);
      }
    }
    return byKey;
  }, [groups]);
  const childStateKey = (session: SessionItem, fallbackRootId = "") => `${session.root_id || fallbackRootId}:${session.key}`;

  const loadChildren = async (parent: SessionItem, beforeTime?: string) => {
    const stateKey = childStateKey(parent);
    if (!onLoadChildren || loadingChildren[stateKey]) {
      return;
    }
    setLoadingChildren((prev) => ({ ...prev, [stateKey]: true }));
    try {
      const result = await onLoadChildren(parent, beforeTime ? { beforeTime } : undefined);
      setChildrenHasMore((prev) => ({ ...prev, [stateKey]: !!result?.hasMore }));
    } finally {
      setLoadingChildren((prev) => ({ ...prev, [stateKey]: false }));
    }
  };

  const buildRows = (sessions: SessionItem[], rootId: string) => buildSessionRows(
    sessions, selectedRootId === rootId ? selectedKey : "", collapsedRunning, expandedChildren, childrenHasMore,
    session => childStateKey(session, rootId),
  );

  const handleChildToggle = async (row: Exclude<SessionRow, { type: "session" }>, sessions: SessionItem[], rootId: string) => {
    const key = childStateKey(row.parent, rootId);
    const parent = { ...row.parent, root_id: rootId };
    if (row.type === "child-group") {
      if (row.group === "running") setCollapsedRunning(prev => ({ ...prev, [key]: row.expanded }));
      else {
        setExpandedChildren(prev => ({ ...prev, [key]: !row.expanded }));
        if (!row.expanded) await loadChildren(parent);
      }
    } else {
      const oldest = sessions.filter(item => item.parent_session_key === parent.key)
        .sort((a, b) => Date.parse(a.updated_at || "") - Date.parse(b.updated_at || ""))[0];
      await loadChildren(parent, oldest?.updated_at);
    }
  };

  const handleProjectToggle = async (group: ProjectSessionGroup) => {
    const expanded = !!expandedProjects[group.rootId];
    const remaining = Math.max(0, group.totalCount - topLevelSessionsForGroup(group.sessions).length);
    if (!expanded) {
      setExpandedProjects((prev) => ({ ...prev, [group.rootId]: true }));
      if (remaining > 0 && onLoadMoreProject) {
        setLoadingProjects((prev) => ({ ...prev, [group.rootId]: true }));
        try {
          await onLoadMoreProject(group);
        } finally {
          setLoadingProjects((prev) => ({ ...prev, [group.rootId]: false }));
        }
      }
      return;
    }
    if (remaining > 0 && onLoadMoreProject) {
      setLoadingProjects((prev) => ({ ...prev, [group.rootId]: true }));
      try {
        await onLoadMoreProject(group);
      } finally {
        setLoadingProjects((prev) => ({ ...prev, [group.rootId]: false }));
      }
    } else {
      setExpandedProjects((prev) => ({ ...prev, [group.rootId]: false }));
    }
  };

  const handleProjectCollapse = (rootId: string) => {
    setExpandedProjects((prev) => ({ ...prev, [rootId]: false }));
  };

  const topLevelSessionsForGroup = (sessions: SessionItem[]) => {
    const keys = new Set(sessions.map(session => session.key));
    return sessions.filter(session => !session.parent_session_key || !keys.has(session.parent_session_key));
  };

  const sessionsForTopLevelLimit = (sessions: SessionItem[], limit: number, rootId: string) => {
    const topLevel = topLevelSessionsForGroup(sessions);
    if (limit >= topLevel.length) return sessions;
    const byKey = new Map(sessions.map(session => [session.key, session]));
    const topParent = (session: SessionItem): string => {
      let parent = session;
      const visited = new Set<string>();
      while (parent.parent_session_key && byKey.has(parent.parent_session_key) && !visited.has(parent.key)) {
        visited.add(parent.key);
        parent = byKey.get(parent.parent_session_key)!;
      }
      return parent.key;
    };
    const visibleKeys = new Set(topLevel.slice(0, limit).map(session => session.key));
    const selected = selectedRootId === rootId ? byKey.get(selectedKey) : undefined;
    if (selected) visibleKeys.add(topParent(selected));
    return sessions.filter(session => visibleKeys.has(topParent(session)));
  };

  return (
    <div className="workspace-sessions" style={{ flex: 1, width: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "transparent" }}>
      <div
        data-onboarding="session-actions"
        style={{
          height: "36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px 0 2px",
          borderBottom: "1px solid var(--border-color)",
          background: "var(--mindfs-topbar-bg, transparent)",
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
          <span className="workspace-sessions-title">{t("sessionList.title")}</span>
          {onSearchToggle ? (
            <button
              type="button"
              aria-label={t("sessionList.searchCurrentProject")}
              title={t("sessionList.searchCurrentProject")}
              onClick={onSearchToggle}
              style={{
                width: "34px",
                height: "34px",
                minWidth: "34px",
                border: "none",
                borderRadius: "8px",
                padding: 0,
                background: "transparent",
                color: "var(--text-secondary)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14" />
              </svg>
            </button>
          ) : null}
        </div>
        {headerAction ? <div style={{ display: "inline-flex", alignItems: "center" }}>{headerAction}</div> : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px" }}>
        {loading && groups.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", padding: "18px", textAlign: "center" }}>{t("sessionList.loading")}</div>
        ) : groups.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", minHeight: "100%", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", lineHeight: 1.6 }}>
            {effectiveEmptyText}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
            {orderedGroups.map((group) => {
              const expanded = !!expandedProjects[group.rootId];
              const pinned = !!pinnedProjects[group.rootId];
              const topLevelSessions = topLevelSessionsForGroup(group.sessions);
              const sessions = expanded
                ? group.sessions
                : sessionsForTopLevelLimit(group.sessions, MULTI_PROJECT_VISIBLE_LIMIT, group.rootId);
              const rows = buildRows(sessions, group.rootId);
              const remaining = Math.max(0, group.totalCount - topLevelSessions.length);
              const projectLoading = !!loadingProjects[group.rootId];
              return (
                <section key={group.rootId} className="workspace-session-project" style={{ minWidth: 0 }}>
                  <div className="workspace-project-heading">
                    <button type="button" className="workspace-group-toggle" aria-expanded={!collapsedProjects[group.rootId]}
                      aria-label={`${t(collapsedProjects[group.rootId] ? "common.expand" : "common.collapse")} ${group.rootName || group.rootId}`}
                      onClick={() => setCollapsedProjects(prev => ({ ...prev, [group.rootId]: !prev[group.rootId] }))}>
                      <Chevron expanded={!collapsedProjects[group.rootId]} />
                    </button>
                    <button type="button" className="workspace-project-name" onClick={() => onProjectClick?.(group.rootId)} title={group.rootName || group.rootId}>{group.rootName || group.rootId}</button>
                    <span className="workspace-project-count">{group.totalCount}</span>
                    <button type="button" className="workspace-project-pin" aria-label={pinned ? t("sessionList.unpinProject") : t("sessionList.pinProject")}
                      aria-pressed={pinned} onClick={() => togglePinnedProject(group.rootId)}><PinIcon pinned={pinned} /></button>
                  </div>
                  <div className="workspace-project-sessions" hidden={!!collapsedProjects[group.rootId]}>
                    {rows.map((row) => {
                      if (row.type !== "session") return <ChildGroupRow key={`${row.parent.key}:${row.type}:${row.type === "child-group" ? row.group : "more"}`} row={row}
                        loading={!!loadingChildren[childStateKey(row.parent, group.rootId)]} onClick={() => void handleChildToggle(row, group.sessions, group.rootId)} />;
                      const session = row.session;
                      const sessionRoot = session.root_id || group.rootId;
                      return (
                        <SessionCard
                          key={`${sessionRoot}:${session.key}`}
                          session={{ ...session, root_id: sessionRoot }}
                          sessionByKey={sessionByKey}
                          selected={session.key === selectedKey && sessionRoot === selectedRootId}
                          parentHighlighted={false}
                          highlightQuery=""
                          syncing={isSessionSyncing({ ...session, root_id: sessionRoot }, syncingSessionKeys)}
                          depth={row.depth}
                          onSelect={onSelect}
                          onSync={onSync}
                          onPin={onPin}
                          onRename={onRename}
                          onDelete={onDelete}
                          onScheduledTask={onScheduledTask}
                          onHandoffPack={onHandoffPack}
                        />
                      );
                    })}
                    {group.totalCount > MULTI_PROJECT_VISIBLE_LIMIT ? (
                      <ToggleRowButton
                        loading={projectLoading}
                        label={
                          projectLoading
                            ? t("sessionList.loading")
                            : expanded
                              ? remaining > 0
                                ? t("sessionList.remainingSessions", { count: remaining })
                                : t("common.collapse")
                              : t("sessionList.remainingSessions", { count: Math.max(0, group.totalCount - MULTI_PROJECT_VISIBLE_LIMIT) })
                        }
                        showExpandIcon={!projectLoading && (!expanded || remaining > 0)}
                        showCollapseIcon={!projectLoading && expanded}
                        marginLeft={MAIN_SESSION_ICON_OFFSET}
                        onClick={() => void handleProjectToggle(group)}
                        onCollapse={() => handleProjectCollapse(group.rootId)}
                      />
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
      <style>{`
        @keyframes mindfs-bound-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 1.5px rgba(37,99,235,0.14); }
          50% { opacity: 0.18; box-shadow: 0 0 0 4px rgba(37,99,235,0.08); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function SessionCard({
  session,
  sessionByKey,
  selected,
  parentHighlighted,
  highlightQuery,
  syncing = false,
  depth = 0,
  onSelect,
  onSync,
  onPin,
  onRename,
  onDelete,
  onScheduledTask,
  onHandoffPack,
}: SessionMenuActions & {
  session: SessionItem;
  sessionByKey: Map<string, SessionItem>;
  selected: boolean;
  parentHighlighted?: boolean;
  highlightQuery?: string;
  syncing?: boolean;
  depth?: number;
  onSelect?: (session: SessionItem) => void;
  onSync?: (session: SessionItem) => Promise<void> | void;
  onPin?: (session: SessionItem, pinned: boolean) => Promise<boolean> | boolean;
  onRename?: (session: SessionItem, nextName: string) => Promise<boolean> | boolean;
  onDelete?: (session: SessionItem) => void;
}) {
  const { locale, t } = useI18n();
  const isClosed = !!session.closed_at;
  const isPinned = !!session.pinned_at;
  const isSubagent = !!session.parent_session_key;
  const forkSource = parseForkSessionSource(session.source);
  const isForkSession = !!forkSource;
  const storedName = session.name || `Session ${session.key.slice(0, 8)}`;
  const displayName = isForkSession
    ? forkSessionDisplayName(storedName, forkSource, sessionByKey, session.root_id)
    : storedName;
  const snippet = (session.search_snippet || "").trim();
  const isSearchResult = !!session.search_match_type;
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(storedName);
  const [saving, setSaving] = useState(false);
  const rowBackground = selected
    ? "var(--workspace-selected)"
    : parentHighlighted
      ? "var(--workspace-hover)"
      : "transparent";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      setDraftName(storedName);
    }
  }, [storedName, editing]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    const atEnd = input.selectionStart === input.value.length;
    if (atEnd) {
      input.scrollLeft = input.scrollWidth;
    }
  }, [draftName, editing]);

  const cancelEditing = () => {
    setEditing(false);
    setSaving(false);
    setDraftName(storedName);
  };

  const submitRename = async () => {
    if (submittingRef.current) return;
    const trimmed = draftName.trim();
    if (!trimmed) {
      cancelEditing();
      return;
    }
    if (trimmed === storedName.trim()) {
      cancelEditing();
      return;
    }
    if (!onRename) {
      cancelEditing();
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      const ok = await onRename(session, trimmed);
      if (ok === false) {
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      setEditing(false);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      className={`workspace-session-row${isSubagent ? " workspace-child-session" : ""}`}
      data-session-key={session.key} data-selected={selected} data-root-id={session.root_id}
      style={{
        background: rowBackground,
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "2px 0",
        borderRadius: "8px",
        position: "relative",
        paddingLeft: `${Math.max(depth, isSubagent ? 1 : 0) * 12 + 4}px`,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          textAlign: "left" as const,
          padding: editing ? "7px 0 7px 2px" : isSubagent ? "3px 4px 3px 2px" : "7px 4px 7px 2px",
          borderRadius: "8px",
          border: "1px solid transparent",
          background: "transparent",
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: isSubagent ? "3px" : "6px",
          transition: "all 0.15s ease",
        }}
      >
        {!isSearchResult ? (
          <span
            style={{
              position: "relative",
              width: "18px",
              height: "18px",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isSubagent ? (
              isForkSession ? (
                <ForkSessionIcon />
              ) : (
                session.pending ? <ActivityEmoji emoji="👀" /> : <SubSessionIcon />
              )
            ) : (
              isForkSession ? (
                <ForkSessionIcon />
              ) : (
                <ModeIcon type={session.task_id ? "task" : session.type || "chat"} size={16} />
              )
            )}
            {!isSubagent && session.type === "command" ? (
              <span
                title={session.shell || "shell"}
                style={{
                  position: "absolute",
                  right: "-8px",
                  bottom: "-4px",
                  minWidth: 0,
                  maxWidth: "26px",
                  height: "auto",
                  padding: "1px 3px",
                  borderRadius: "5px",
                  background: "#1d4ed8",
                  border: "none",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "7px",
                  fontWeight: 700,
                  lineHeight: 1.1,
                  letterSpacing: 0,
                }}
              >
                {shellBadgeLabel(session.shell)}
              </span>
            ) : !isSubagent ? (
              <span
                style={{
                  position: "absolute",
                  right: "-2px",
                  bottom: "-2px",
                  width: "10px",
                  height: "10px",
                  borderRadius: "999px",
                  background: "var(--content-bg, #fff)",
                  border: "1px solid rgba(255,255,255,0.9)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <AgentIcon
                  agentName={session.agent || ""}
                  style={{ width: "10px", height: "10px", display: "block" }}
                />
              </span>
            ) : null}

          </span>
        ) : null}

        {editing ? (
          <input
            ref={inputRef}
            value={draftName}
            disabled={saving}
            onChange={(e) => {
              setDraftName(e.target.value);
              e.currentTarget.scrollLeft = e.currentTarget.scrollWidth;
            }}
            onClick={(e) => e.stopPropagation()}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEditing();
                return;
              }
              if (e.key !== "Enter") {
                return;
              }
              const nativeEvent = e.nativeEvent as KeyboardEvent;
              const isComposing =
                composingRef.current ||
                nativeEvent.isComposing ||
                nativeEvent.keyCode === 229;
              if (isComposing) {
                return;
              }
              e.preventDefault();
              void submitRename();
            }}
            style={{
              minWidth: 0,
              flex: 1,
              height: "28px",
              borderRadius: "6px",
              border: "1px solid var(--accent-color)",
              background: "var(--content-bg, #fff)",
              color: "var(--text-primary)",
              fontSize: "13px",
              fontWeight: 600,
              padding: "0 10px 0 8px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => onSelect?.(session)}
            style={{
              minWidth: 0,
              flex: 1,
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
              color: selected ? "var(--accent-hover)" : "var(--text-primary)",
            }}

          >
            <span
              style={{
                display: "block",
                fontSize: isSubagent ? "12px" : "13px",
                lineHeight: isSubagent ? 1.3 : 1.45,
                fontWeight: selected ? 600 : 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {renderHighlightedText(displayName, highlightQuery, {
                color: selected ? "var(--accent-hover)" : "var(--text-primary)",
              })}
            </span>
            <span className="idea-session-agent" style={{ display: isSubagent ? "block" : "none", fontSize: "11px", lineHeight: 1.3, color: "var(--text-secondary)", marginTop: "2px" }}>{session.agent ? agentDisplayName(session.agent) : session.type}</span>
            {snippet ? (
              <span
                style={{
                  marginTop: "2px",
                  display: "block",
                  fontSize: "11px",
                  lineHeight: 1.45,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {renderHighlightedText(snippet, highlightQuery, {
                  color: "var(--text-secondary)",
                })}
              </span>
            ) : null}
          </button>
        )}

        {editing ? (
          <div
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 0,
            }}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                void submitRename();
              }}
              disabled={saving}
              aria-label={t("sessionList.confirmRename")}
              style={{
                ...inlineActionStyle,
                width: "18px",
                color: "var(--accent-color)",
                opacity: saving ? 0.6 : 1,
                cursor: saving ? "default" : "pointer",
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                cancelEditing();
              }}
              disabled={saving}
              aria-label={t("sessionList.cancelRename")}
              style={{
                ...inlineActionStyle,
                width: "18px",
                opacity: saving ? 0.6 : 1,
                cursor: saving ? "default" : "pointer",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ) : null}

      </div>

      {!editing ? (
        <div
          style={{
            flexShrink: 0,
            minWidth: "24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingLeft: "2px",
          }}
        >
          {syncing ? (
            <span
              aria-label={t("sessionList.syncing")}
              title={t("sessionList.syncing")}
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                border: "1.5px solid rgba(100,116,139,0.35)",
                borderTopColor: "var(--accent-color)",
                display: "inline-block",
                flexShrink: 0,
                animation: "spin 0.8s linear infinite",
              }}
            />
          ) : session.pending && !isSubagent ? (
            <span
              aria-label={t("sessionList.replying")}
              title={t("sessionList.replying")}
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "999px",
                flexShrink: 0,
                boxSizing: "border-box",
                border: "1.5px solid #2563eb",
                background: "#2563eb",
                animation: "mindfs-bound-pulse 2.2s ease-in-out infinite",
                boxShadow: "0 0 0 1.5px rgba(37,99,235,0.14)",
              }}
            />
          ) : (
            <span
              style={{
                fontSize: "11px",
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
                textAlign: "right",
              }}
            >
              {formatTime(
                isClosed && session.closed_at
                  ? session.closed_at
                  : session.updated_at || "",
                locale,
                t("time.justNow"),
              )}
            </span>
          )}
        </div>
      ) : null}

      <SessionMenu session={session} syncing={syncing} onPin={onPin} onSync={onSync} onDelete={onDelete}
        onScheduledTask={onScheduledTask} onHandoffPack={onHandoffPack}
        onRename={() => { setDraftName(storedName); setEditing(true); }} />
    </div>
  );
}

function formatTime(isoString: string, locale: Locale, justNow: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return justNow;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (now.getFullYear() === date.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { year: "2-digit", month: "numeric" }).format(date);
}

function renderHighlightedText(
  text: string,
  query?: string,
  palette?: { color?: string },
): React.ReactNode {
  const source = String(text || "");
  const needle = String(query || "").trim();
  if (!source || !needle) {
    return source;
  }
  const lowerSource = source.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (;;) {
    const index = lowerSource.indexOf(lowerNeedle, cursor);
    if (index < 0) {
      break;
    }
    if (index > cursor) {
      parts.push(source.slice(cursor, index));
    }
    const match = source.slice(index, index + needle.length);
    parts.push(
      <mark
        key={`${index}:${match}`}
        style={{
          background: "transparent",
          color: "var(--accent-color)",
          padding: 0,
        }}
      >
        {match}
      </mark>,
    );
    cursor = index + needle.length;
  }

  if (cursor < source.length) {
    parts.push(source.slice(cursor));
  }
  return parts.length ? parts : source;
}

function iconButtonStyle(withGap: boolean): React.CSSProperties {
  return {
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: withGap ? "2px" : 0,
    height: "28px",
    minWidth: "28px",
    borderRadius: "8px",
    cursor: "pointer",
    padding: withGap ? "0 6px" : 0,
  };
}

function ChevronLeftIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function SubSessionIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 32 32"
      aria-hidden="true"
      style={{ color: "var(--accent-color)", display: "block" }}
    >
      <path d="M0 0h32v32H0z" fill="none" />
      <path
        fill="currentColor"
        d="M23 20c-2.41 0-4.43 1.72-4.9 4H14c-2.21 0-4-1.79-4-4v-8.1A5 5 0 1 0 4 7c0 2.41 1.72 4.43 4 4.9V20c0 3.31 2.69 6 6 6h4.1a5 5 0 1 0 4.9-6M6 7c0-1.65 1.35-3 3-3s3 1.35 3 3s-1.35 3-3 3s-3-1.35-3-3"
      />
    </svg>
  );
}

function ForkSessionIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{
        color: "var(--accent-color)",
        display: "block",
        transform: "rotate(180deg) scaleX(-1)",
      }}
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        d="M17 7a2 2 0 1 0 0-4a2 2 0 0 0 0 4M7 7a2 2 0 1 0 0-4a2 2 0 0 0 0 4m0 14a2 2 0 1 0 0-4a2 2 0 0 0 0 4M7 7v10M17 7v1c0 2.5-2 3-2 3l-6 2s-2 .5-2 3v1"
      />
      <circle cx="17" cy="5" r="2" fill="currentColor" />
    </svg>
  );
}

const inlineActionStyle: React.CSSProperties = {
  width: "24px",
  height: "24px",
  border: "none",
  borderRadius: "6px",
  background: "transparent",
  color: "var(--text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};
