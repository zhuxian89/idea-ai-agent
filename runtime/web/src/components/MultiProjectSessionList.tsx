import { useEffect, useMemo, useState } from "react";
import { buildSessionRows, type SessionRow } from "./sessionHierarchy";
import { useI18n } from "../i18n";
import { remoteUiActive } from "../services/remoteUiFlag";
import { SessionItem, ProjectSessionGroup, ProjectSessionListProps } from "./sessionListTypes";
import {
  MULTI_PROJECT_VISIBLE_LIMIT,
  MAIN_SESSION_ICON_OFFSET,
  PINNED_PROJECTS_STORAGE_KEY,
  ToggleRowButton,
  Chevron,
  ChildGroupRow,
  PinIcon,
  isSessionSyncing,
} from "./sessionListParts";
import { SessionCard } from "./SessionCard";

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
                    {remoteUiActive() && group.sessions.some((item) => item.pending && !item.parent_session_key) ? (
                      <i className="workspace-group-live" role="img" aria-label={t("sessionList.replying")} title={t("sessionList.replying")} />
                    ) : null}
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
