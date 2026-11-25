import { useState, useRef, useEffect, useCallback } from "react";
import {
  SessionItem,
  MultiProjectSessionGroup,
  toSessionItem,
  isTopLevelSessionItem,
} from "../sessionModel";
import { projectStorage } from "../../services/remoteScope";
import {
  MULTI_PROJECT_SESSION_STORAGE_KEY,
  CHILD_SESSION_PAGE_SIZE,
  MULTI_PROJECT_SESSION_LIMIT,
  SESSION_PAGE_SIZE,
} from "../storagePrefs";
import {
  getCachedSessionList,
  sessionService,
  saveCachedSessionList,
  getCachedMultiRootSessionList,
  type MultiRootSessionGroup,
  saveCachedMultiRootSessionList,
} from "../../services/session";
import { applyPinnedSnapshotToSessions, mergeSessionItems } from "../../services/sessionListMerge";
import { protectedAPIReady, protectedJSON as apiProtectedJSON } from "../../services/api";
import { type ProjectSessionGroup } from "../../components/SessionList";
import { appPath } from "../../services/base";
import { isIDEManagedProject } from "../../services/ideaBridge";
import type { useWorkbenchLayout } from "./useWorkbenchLayout";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useManagedRoots } from "./useManagedRoots";

type Deps = {
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
};

export function useSessionList({ workbenchLayoutApi, currentRootApi, sessionSelectionApi, managedRootsApi }: Deps) {
  const { remotePhone } = workbenchLayoutApi;
  const { currentRootId, currentRootIdRef } = currentRootApi;
  const { rootSessionKey } = sessionSelectionApi;
  const { managedRootByIdRef } = managedRootsApi;

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const sessionsRef = useRef<SessionItem[]>([]);
  const [multiProjectSessionsEnabled, setMultiProjectSessionsEnabled] =
    useState(() => {
      if (typeof window === "undefined") return false;
      return (
        projectStorage().getItem(MULTI_PROJECT_SESSION_STORAGE_KEY) === "1"
      );
    });
  const [multiProjectSessionGroups, setMultiProjectSessionGroups] = useState<
    MultiProjectSessionGroup[]
  >([]);
  const [multiProjectSessionsLoading, setMultiProjectSessionsLoading] =
    useState(false);
  const [multiProjectPendingByKey, setMultiProjectPendingByKey] = useState<
    Record<string, boolean>
  >({});
  const multiProjectPendingRef = useRef<Record<string, boolean>>({});
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchResultsMode, setSessionSearchResultsMode] =
    useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [sessionSearchAppliedQuery, setSessionSearchAppliedQuery] =
    useState("");
  const [sessionSearchResults, setSessionSearchResults] = useState<
    SessionItem[]
  >([]);
  const [sessionSearchLoading, setSessionSearchLoading] = useState(false);
  const [syncingSessionKeys, setSyncingSessionKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [loadingOlderSessions, setLoadingOlderSessions] = useState(false);
  const [sessionListMode, setSessionListMode] = useState<"local" | "import">(
    "local",
  );
  const sessionListModeRef = useRef<"local" | "import">("local");
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    multiProjectPendingRef.current = multiProjectPendingByKey;
  }, [multiProjectPendingByKey]);
  useEffect(() => {
    projectStorage().setItem(
      MULTI_PROJECT_SESSION_STORAGE_KEY,
      multiProjectSessionsEnabled ? "1" : "0",
    );
  }, [multiProjectSessionsEnabled]);
  useEffect(() => {
    sessionListModeRef.current = sessionListMode;
    if (sessionListMode !== "local") {
      setSessionSearchOpen(false);
      setSessionSearchResultsMode(false);
      setSessionSearchQuery("");
      setSessionSearchAppliedQuery("");
      setSessionSearchResults([]);
      setSessionSearchLoading(false);
    }
  }, [sessionListMode]);
  useEffect(() => {
    setSessionSearchQuery("");
    setSessionSearchResultsMode(false);
    setSessionSearchAppliedQuery("");
    setSessionSearchResults([]);
    setSessionSearchLoading(false);
  }, [currentRootId]);
  const applyPendingToMultiProjectGroups = useCallback(
    (
      groups: MultiProjectSessionGroup[],
      pendingByKey: Record<string, boolean>,
    ) =>
      groups.map((group) => ({
        ...group,
        sessions: group.sessions.map(
          (session) =>
            ({
              ...(session as any),
              pending:
                !!pendingByKey[
                  rootSessionKey(
                    group.rootId,
                    session.key || session.session_key,
                  )
                ],
            }) as SessionItem,
        ),
      })),
    [rootSessionKey],
  );
  const setMultiProjectSessionPending = useCallback(
    (
      rootID: string | null | undefined,
      sessionKey: string | null | undefined,
      pending: boolean,
    ) => {
      const resolvedRoot = String(rootID || "");
      const resolvedKey = String(sessionKey || "");
      if (!resolvedRoot || !resolvedKey) {
        return;
      }
      const key = rootSessionKey(resolvedRoot, resolvedKey);
      setMultiProjectPendingByKey((prev) => {
        const next = { ...prev };
        if (pending) {
          next[key] = true;
        } else {
          delete next[key];
        }
        multiProjectPendingRef.current = next;
        setMultiProjectSessionGroups((groups) =>
          applyPendingToMultiProjectGroups(groups, next),
        );
        return next;
      });
    },
    [applyPendingToMultiProjectGroups, rootSessionKey],
  );
  const loadSessionsForRoot = useCallback(
    async (
      rootID: string,
      options?: {
        beforeTime?: string;
        afterTime?: string;
        replace?: boolean;
        force?: boolean;
      },
    ) => {
      try {
        const shouldReplace =
          options?.replace || (!options?.beforeTime && !options?.afterTime);
        if (shouldReplace) {
          const cached = await getCachedSessionList(rootID);
          if (
            cached &&
            (options?.force || currentRootIdRef.current === rootID)
          ) {
            const cachedItems = [...cached.items, ...cached.pinnedItems]
              .map((item) => toSessionItem(rootID, item))
              .filter((item): item is SessionItem => !!item);
            setHasMoreSessions(cached.totalCount > cached.items.length);
            setSessions(
              applyPinnedSnapshotToSessions(
                mergeSessionItems([], cachedItems),
                rootID,
                cached.pinnedKeys,
              ),
            );
          }
        }
        const payload = await sessionService.fetchSessions(rootID, {
          beforeTime: options?.beforeTime,
          afterTime: options?.afterTime,
        });
        const next = [...payload.items, ...payload.pinnedItems]
          .map((item) => toSessionItem(rootID, item))
          .filter((item): item is SessionItem => !!item);
        if (!options?.force && currentRootIdRef.current !== rootID) return;
        setHasMoreSessions(payload.totalCount > payload.items.length);
        if (shouldReplace) {
          setSessions(
            applyPinnedSnapshotToSessions(
              mergeSessionItems([], next),
              rootID,
              payload.pinnedKeys,
            ),
          );
          void saveCachedSessionList(rootID, payload);
          return;
        }
        setSessions((prev) =>
          applyPinnedSnapshotToSessions(
            mergeSessionItems(prev, next),
            rootID,
            payload.pinnedKeys,
          ),
        );
      } catch {}
    },
    [],
  );
  const loadChildSessionsForParent = useCallback(
    async (
      parent: SessionItem,
      options?: { beforeTime?: string },
    ): Promise<{ hasMore: boolean }> => {
      const rootID =
        (parent.root_id as string | undefined) ||
        currentRootIdRef.current ||
        "";
      const parentKey = parent.key || parent.session_key || "";
      if (!rootID || !parentKey) {
        return { hasMore: false };
      }
      const items = await sessionService.fetchChildSessions(rootID, parentKey, {
        beforeTime: options?.beforeTime,
        limit: CHILD_SESSION_PAGE_SIZE,
      });
      const next = items
        .map((item) => toSessionItem(rootID, item))
        .filter((item): item is SessionItem => !!item);
      if (currentRootIdRef.current === rootID && next.length > 0) {
        setSessions((prev) => mergeSessionItems(prev, next));
      }
      if (next.length > 0) {
        setMultiProjectSessionGroups((prev) =>
          applyPendingToMultiProjectGroups(
            prev.map((group) =>
              group.rootId === rootID
                ? {
                    ...group,
                    sessions: mergeSessionItems(group.sessions, next),
                  }
                : group,
            ),
            multiProjectPendingRef.current,
          ),
        );
      }
      return { hasMore: items.length >= CHILD_SESSION_PAGE_SIZE };
    },
    [applyPendingToMultiProjectGroups, mergeSessionItems],
  );
  const loadMultiProjectSessionGroups = useCallback(async () => {
    if ((!multiProjectSessionsEnabled && !remotePhone) || !protectedAPIReady()) {
      return;
    }
    setMultiProjectSessionsLoading(true);
    try {
      const cachedGroups = await getCachedMultiRootSessionList();
      if (cachedGroups?.length) {
        setMultiProjectSessionGroups(
          applyPendingToMultiProjectGroups(
            cachedGroups.map(
              (group): MultiProjectSessionGroup => ({
                rootId: group.rootId,
                rootName:
                  group.rootName ||
                  managedRootByIdRef.current[group.rootId]?.display_name ||
                  group.rootId,
                latestSessionTime: group.latestSessionTime,
                sessions: applyPinnedSnapshotToSessions(
                  mergeSessionItems(
                    [],
                    [...group.items, ...group.pinnedItems]
                      .map((item) =>
                        toSessionItem(group.rootId, {
                          ...(item as any),
                          root_id: group.rootId,
                        }),
                      )
                      .filter((item): item is SessionItem => !!item),
                  ),
                  group.rootId,
                  group.pinnedKeys,
                ),
                totalCount: group.totalCount,
              }),
            ),
            multiProjectPendingRef.current,
          ),
        );
      }
      const groups = await sessionService.fetchMultiRootSessions(
        MULTI_PROJECT_SESSION_LIMIT,
      );
      const nextGroups = groups.map(
        (group: MultiRootSessionGroup): MultiProjectSessionGroup => ({
          rootId: group.rootId,
          rootName:
            group.rootName ||
            managedRootByIdRef.current[group.rootId]?.display_name ||
            group.rootId,
          latestSessionTime: group.latestSessionTime,
          sessions: applyPinnedSnapshotToSessions(
            mergeSessionItems(
              [],
              [...group.items, ...group.pinnedItems]
                .map((item) =>
                  toSessionItem(group.rootId, {
                    ...(item as any),
                    root_id: group.rootId,
                  }),
                )
                .filter((item): item is SessionItem => !!item),
            ),
            group.rootId,
            group.pinnedKeys,
          ).filter((item): item is SessionItem => !!item),
          totalCount: group.totalCount,
        }),
      );
      setMultiProjectSessionGroups(
        applyPendingToMultiProjectGroups(
          nextGroups,
          multiProjectPendingRef.current,
        ),
      );
      void saveCachedMultiRootSessionList(groups);
    } finally {
      setMultiProjectSessionsLoading(false);
    }
  }, [applyPendingToMultiProjectGroups, multiProjectSessionsEnabled, remotePhone]);
  const loadMoreMultiProjectSessions = useCallback(
    async (group: ProjectSessionGroup) => {
      const topLevelSessions = group.sessions.filter(isTopLevelSessionItem);
      const oldest =
        topLevelSessions[topLevelSessions.length - 1]?.updated_at || "";
      if (!group.rootId || !oldest) {
        return;
      }
      const previousLoaded = topLevelSessions.length;
      const payload = await sessionService.fetchSessions(group.rootId, {
        beforeTime: oldest,
        limit: SESSION_PAGE_SIZE,
        topLevel: true,
        includeChildren: true,
      });
      const nextItems = payload.items
        .concat(payload.pinnedItems)
        .map((item) =>
          toSessionItem(group.rootId, {
            ...(item as any),
            root_id: group.rootId,
          }),
        )
        .filter((item): item is SessionItem => !!item);
      setMultiProjectSessionGroups((prev) =>
        applyPendingToMultiProjectGroups(
          prev.map((current) => {
            if (current.rootId !== group.rootId) {
              return current;
            }
            const sessions = applyPinnedSnapshotToSessions(
              mergeSessionItems(current.sessions, nextItems),
              group.rootId,
              payload.pinnedKeys,
            );
            return {
              ...current,
              sessions,
              totalCount: previousLoaded + payload.totalCount,
            };
          }),
          multiProjectPendingRef.current,
        ),
      );
    },
    [applyPendingToMultiProjectGroups, mergeSessionItems],
  );
  const refreshMultiProjectReplyingSessions = useCallback(async () => {
    try {
      const payload = await apiProtectedJSON<any>(
        appPath("/api/replying-sessions"),
      );
      const items = Array.isArray(payload?.sessions) ? payload.sessions : [];
      const next: Record<string, boolean> = {};
      for (const item of items) {
        const rootID = String(item?.rootId || item?.root_id || "");
        const sessionKey = String(item?.sessionKey || item?.session_key || "");
        if (rootID && sessionKey) {
          next[rootSessionKey(rootID, sessionKey)] = true;
        }
      }
      multiProjectPendingRef.current = next;
      setMultiProjectPendingByKey(next);
      setMultiProjectSessionGroups((groups) =>
        applyPendingToMultiProjectGroups(groups, next),
      );
    } catch (error) {
      console.warn("[multi-project-sessions] replying refresh failed", error);
    }
  }, [applyPendingToMultiProjectGroups, rootSessionKey]);
  useEffect(() => {
    if (!multiProjectSessionsEnabled && !remotePhone) {
      return;
    }
    void refreshMultiProjectReplyingSessions();
    void loadMultiProjectSessionGroups();
  }, [
    loadMultiProjectSessionGroups,
    multiProjectSessionsEnabled,
    remotePhone,
    refreshMultiProjectReplyingSessions,
  ]);
  useEffect(() => {
    if (sessionListMode !== "local") {
      return;
    }
    const trimmed = sessionSearchQuery.trim();
    if (!trimmed) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSessionSearchAppliedQuery(trimmed);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [sessionListMode, sessionSearchQuery]);
  useEffect(() => {
    const currentQuery = sessionSearchQuery.trim();
    if (
      sessionListMode !== "local" ||
      !sessionSearchOpen ||
      !currentRootId ||
      !sessionSearchAppliedQuery ||
      sessionSearchAppliedQuery !== currentQuery
    ) {
      if (
        !currentQuery ||
        sessionListMode !== "local" ||
        !sessionSearchOpen ||
        !currentRootId
      ) {
        setSessionSearchLoading(false);
      }
      return;
    }

    let cancelled = false;
    const searchAcrossRoots =
      !isIDEManagedProject && multiProjectSessionsEnabled;
    setSessionSearchLoading(true);
    void sessionService
      .searchSessions(currentRootId, sessionSearchAppliedQuery, 20, {
        multiRoot: searchAcrossRoots,
      })
      .then((hits) => {
        if (cancelled) return;
        const mapped = hits
          .map((hit) => {
            const hitRootId = String(hit.root_id || currentRootId || "");
            const item = toSessionItem(hitRootId, {
              ...hit,
              root_id: hitRootId,
              search_seq: hit.seq,
              search_snippet: hit.snippet,
              search_match_type: hit.match_type,
            });
            return item;
          })
          .filter((item): item is SessionItem => !!item);
        setSessionSearchResults(mapped);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[session.search] failed", {
          rootId: currentRootId,
          query: sessionSearchAppliedQuery,
          err,
        });
        setSessionSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) {
          setSessionSearchLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentRootId,
    multiProjectSessionsEnabled,
    sessionListMode,
    sessionSearchAppliedQuery,
    sessionSearchOpen,
    sessionSearchQuery,
  ]);
  const handleLoadOlderSessions = useCallback(async () => {
    const rootID = currentRootIdRef.current;
    const oldest =
      sessionsRef.current[sessionsRef.current.length - 1]?.updated_at || "";
    if (!rootID || !oldest || loadingOlderSessions) {
      return;
    }
    setLoadingOlderSessions(true);
    try {
      const payload = await sessionService.fetchSessions(rootID, {
        beforeTime: oldest,
      });
      const next = [...payload.items, ...payload.pinnedItems]
        .map((item) => toSessionItem(rootID, item))
        .filter((item): item is SessionItem => !!item);
      setHasMoreSessions(payload.totalCount > payload.items.length);
      setSessions((prev) =>
        applyPinnedSnapshotToSessions(
          mergeSessionItems(prev, next),
          rootID,
          payload.pinnedKeys,
        ),
      );
    } finally {
      setLoadingOlderSessions(false);
    }
  }, [loadingOlderSessions]);

  return { handleLoadOlderSessions, hasMoreSessions, loadChildSessionsForParent, loadMoreMultiProjectSessions, loadMultiProjectSessionGroups, loadSessionsForRoot, loadingOlderSessions, multiProjectPendingByKey, multiProjectPendingRef, multiProjectSessionGroups, multiProjectSessionsEnabled, multiProjectSessionsLoading, refreshMultiProjectReplyingSessions, sessionListMode, sessionListModeRef, sessionSearchLoading, sessionSearchOpen, sessionSearchQuery, sessionSearchResults, sessionSearchResultsMode, sessions, sessionsRef, setHasMoreSessions, setMultiProjectPendingByKey, setMultiProjectSessionGroups, setMultiProjectSessionPending, setMultiProjectSessionsEnabled, setSessionListMode, setSessionSearchAppliedQuery, setSessionSearchLoading, setSessionSearchOpen, setSessionSearchQuery, setSessionSearchResults, setSessionSearchResultsMode, setSessions, setSyncingSessionKeys, syncingSessionKeys };
}
