import { useEffect, useMemo, useRef, useState } from "react";

import { buildSessionRows, type SessionRow } from "./sessionHierarchy";
import "./workspaceSidebar.css";

import { useI18n } from "../i18n";

import { SessionItem, SessionListProps, ProjectSessionGroup } from "./sessionListTypes";
import {
  ChildGroupRow,
  isSessionSyncing,
  iconButtonStyle,
  ChevronLeftIcon,
} from "./sessionListParts";
import { SessionCard } from "./SessionCard";
export { MultiProjectSessionList } from "./MultiProjectSessionList";
export type { SessionType, SessionItem, ProjectSessionGroup } from "./sessionListTypes";

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
