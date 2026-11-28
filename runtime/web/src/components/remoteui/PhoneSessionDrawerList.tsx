import React, { useState } from "react";
import { useI18n } from "../../i18n";
import { ConfirmDialog } from "../ConfirmDialog";
import type { ProjectSessionGroup, SessionItem } from "../SessionList";
import type { PhoneSessionFacts, PhoneSessionState } from "./phoneSessionFacts";

export type DrawerSessionFilter = "all" | "wait" | "work";

const FOLD_LIMIT = 6;
const STATE_PRIORITY: Record<PhoneSessionState, number> = {
  wait: 0,
  work: 1,
  error: 2,
  idle: 2,
};

type SessionEntry = {
  item: SessionItem;
  state: PhoneSessionState;
  preview?: string;
  project: string;
};

type DrawerGroup = {
  group: ProjectSessionGroup;
  rootId: string;
  rootName: string;
  current: boolean;
  all: SessionEntry[];
  filtered: SessionEntry[];
  totalCount: number;
};

function matchesFilter(state: PhoneSessionState, filter: DrawerSessionFilter): boolean {
  if (filter === "wait") return state === "wait" || state === "error";
  if (filter === "work") return state === "work";
  return true;
}

function sortEntries(entries: SessionEntry[]): SessionEntry[] {
  return entries.slice().sort(
    (a, b) =>
      STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] ||
      Number(!!b.item.pinned_at) - Number(!!a.item.pinned_at) ||
      (b.item.updated_at || "").localeCompare(a.item.updated_at || ""),
  );
}

function PhoneProjectGroup({
  data,
  activeKey,
  activeRootId,
  filter,
  search,
  onSelect,
  onDelete,
  onLoadMoreProject,
}: {
  data: DrawerGroup;
  activeKey: string;
  activeRootId: string;
  filter: DrawerSessionFilter;
  search: string;
  onSelect: (session: SessionItem) => void;
  onDelete?: (session: SessionItem) => void;
  onLoadMoreProject?: (group: ProjectSessionGroup) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const activeIndex = data.filtered.findIndex(
    ({ item }) => item.key === activeKey && (item.root_id || data.rootId) === activeRootId,
  );
  const showAll = expanded || Boolean(search) || activeIndex >= FOLD_LIMIT;
  const visible = showAll ? data.filtered : data.filtered.slice(0, FOLD_LIMIT);
  const waiting = data.all.filter((entry) => entry.state === "wait" || entry.state === "error").length;

  const localHidden = Math.max(0, data.filtered.length - visible.length);
  const serverRemaining =
    !search && filter === "all" && onLoadMoreProject
      ? Math.max(0, data.totalCount - data.all.length)
      : 0;
  const remaining = localHidden + serverRemaining;
  const displayCount =
    !search && filter === "all" ? Math.max(data.filtered.length, data.totalCount) : data.filtered.length;

  async function handleMore() {
    if (localHidden > 0) {
      setExpanded(true);
      return;
    }
    if (serverRemaining > 0 && onLoadMoreProject && !loadingMore) {
      setExpanded(true);
      setLoadingMore(true);
      try {
        await onLoadMoreProject(data.group);
      } finally {
        setLoadingMore(false);
      }
    }
  }

  return (
    <section
      className="remote-phone-group"
      data-current={data.current ? "1" : undefined}
      aria-label={data.rootName}
    >
      <button
        type="button"
        className="remote-phone-group-head"
        aria-expanded={!collapsed}
        title={data.rootName}
        onClick={() => setCollapsed((value) => !value)}
      >
        <svg
          className="remote-phone-group-chevron"
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
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span className="remote-phone-group-name">{data.rootName}</span>
        {data.current ? (
          <span className="remote-phone-group-current">{t("remote.phone.currentProject")}</span>
        ) : null}
        {waiting > 0 ? (
          <span
            className="remote-phone-group-wait"
            title={t("remote.phone.waitingCount", { count: waiting })}
          >
            {waiting}
          </span>
        ) : null}
        <span className="remote-phone-group-count">{displayCount}</span>
      </button>
      {collapsed ? null : (
        <div className="remote-phone-group-body">
          {data.filtered.length === 0 ? (
            <div className="remote-phone-group-empty" role="status">
              {data.all.length > 0 && filter !== "all"
                ? t("remote.phone.projectNoFilteredSessions", { project: data.rootName })
                : t("remote.phone.projectNoSessions", { project: data.rootName })}
            </div>
          ) : (
            <>
              <ul className="remote-phone-recent-list" role="list">
                {visible.map(({ item, state, preview }) => {
                  const sessionRoot = item.root_id || data.rootId;
                  const isCurrent = item.key === activeKey && sessionRoot === activeRootId;
                  const title = item.name || item.key;
                  return (
                    <li key={`${sessionRoot}:${item.key}`} className="remote-phone-session-row">
                      <button
                        type="button"
                        className="remote-phone-recent"
                        aria-current={isCurrent || undefined}
                        onClick={() => onSelect({ ...item, root_id: sessionRoot })}
                      >
                        <span className="remote-phone-session-body">
                          <strong title={title}>{title}</strong>
                          <small className="remote-phone-recent-meta">
                            <span className="remote-phone-recent-state">
                              <i data-state={state} aria-hidden="true" />
                              {t(`remote.phone.${state}`)}
                            </span>
                            {item.pinned_at ? (
                              <span className="remote-phone-session-pin" aria-label={t("sessionList.pin")}>
                                {t("sessionList.pin")}
                              </span>
                            ) : null}
                          </small>
                          {preview ? <small className="remote-phone-session-preview">{preview}</small> : null}
                        </span>
                      </button>
                      {onDelete && state !== "work" ? (
                        <button
                          type="button"
                          className="remote-phone-session-delete"
                          aria-label={t("common.delete")}
                          title={t("common.delete")}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDelete({ ...item, root_id: sessionRoot });
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {remaining > 0 ? (
                <button
                  type="button"
                  className="remote-phone-group-more"
                  disabled={loadingMore}
                  onClick={() => void handleMore()}
                >
                  {loadingMore
                    ? t("sessionList.loading")
                    : t("remote.phone.moreItems", { count: remaining })}
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** 手机端单聊抽屉的会话列表：与多 Agent 侧栏一致，按项目分组、当前项目置顶并可折叠。 */
export function PhoneSessionDrawerList({
  groups,
  currentRootId,
  currentProjectName,
  activeKey,
  filter,
  search,
  facts,
  onSelect,
  onDelete,
  onLoadMoreProject,
}: {
  groups: ProjectSessionGroup[];
  currentRootId: string;
  currentProjectName: string;
  activeKey: string;
  filter: DrawerSessionFilter;
  search: string;
  facts: (session: SessionItem) => PhoneSessionFacts;
  onSelect: (session: SessionItem) => void;
  onDelete?: (session: SessionItem) => Promise<void> | void;
  onLoadMoreProject?: (group: ProjectSessionGroup) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [pendingDelete, setPendingDelete] = useState<SessionItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const normalizedSearch = search.trim().toLocaleLowerCase();

  const byRoot = new Map<string, ProjectSessionGroup>();
  for (const group of groups) {
    if (!group.rootId || byRoot.has(group.rootId)) continue;
    byRoot.set(group.rootId, group);
  }

  const orderedRaw: Array<{ group: ProjectSessionGroup; current: boolean }> = [];
  if (currentRootId) {
    const existing = byRoot.get(currentRootId);
    orderedRaw.push({
      group: existing || {
        rootId: currentRootId,
        rootName: currentProjectName || currentRootId,
        sessions: [],
        totalCount: 0,
      },
      current: true,
    });
  }
  for (const group of groups) {
    if (!group.rootId || group.rootId === currentRootId) continue;
    orderedRaw.push({ group, current: false });
  }

  const drawerGroups: DrawerGroup[] = [];
  for (const { group, current } of orderedRaw) {
    const rootName = group.rootName || (current ? currentProjectName : "") || group.rootId;
    const all = sortEntries(
      group.sessions
        .filter((item) => !item.parent_session_key)
        .map((item) => {
          const info = facts(item);
          return {
            item: { ...item, root_id: item.root_id || group.rootId },
            state: info.state,
            preview: info.preview,
            project: info.project || rootName,
          };
        }),
    );
    // 非当前项目没有会话就不占位，避免一长串空分组。
    if (!current && all.length === 0) continue;

    const filtered = all.filter((entry) => {
      if (!matchesFilter(entry.state, filter)) return false;
      if (!normalizedSearch) return true;
      return `${entry.item.name || entry.item.key} ${entry.project} ${entry.preview || ""}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
    });

    if (normalizedSearch) {
      if (filtered.length === 0) continue;
    } else if (!current && filter !== "all" && filtered.length === 0) {
      continue;
    }

    drawerGroups.push({
      group,
      rootId: group.rootId,
      rootName,
      current,
      all,
      filtered,
      totalCount: Math.max(all.length, group.totalCount || 0),
    });
  }

  if (drawerGroups.length === 0) {
    return (
      <p className="remote-phone-recent-empty" role="status">
        {t(normalizedSearch ? "sessionList.noSearchMatch" : "sessionList.empty")}
      </p>
    );
  }

  async function confirmDelete() {
    if (!pendingDelete || !onDelete || deleting) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="remote-phone-drawer-list">
        {drawerGroups.map((data) => (
          <PhoneProjectGroup
            key={data.rootId}
            data={data}
            activeKey={activeKey}
            activeRootId={currentRootId}
            filter={filter}
            search={normalizedSearch}
            onSelect={onSelect}
            onDelete={onDelete ? (session) => setPendingDelete(session) : undefined}
            onLoadMoreProject={onLoadMoreProject}
          />
        ))}
      </div>
      <ConfirmDialog
        open={!!pendingDelete}
        title={t("remote.phone.deleteSessionTitle")}
        description={t("remote.phone.deleteSessionConfirm", {
          name: pendingDelete?.name || pendingDelete?.key || "",
        })}
        confirmLabel={deleting ? t("common.loading") : t("remote.phone.confirmDelete")}
        cancelLabel={t("common.cancel")}
        danger
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
