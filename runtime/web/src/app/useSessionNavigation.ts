import React, { useCallback, useEffect } from "react";
import { type MessageKey, type MessageParams } from "../i18n";
import { type FileEntry } from "../services/directorySort";
import { reportError } from "../services/error";
import { type FilePayload } from "../services/file";
import type { GitDiffPayload } from "../services/git";
import {
  deleteCachedSession,
  getCachedSession,
  hasCurrentActivityHistory,
  sessionService,
  syncSession,
  type Session,
  type SyncSessionResult,
} from "../services/session";
import { mergeSessionItems } from "../services/sessionListMerge";
import { buildDirectorySelectionKey, waitForNextPaint } from "./fileNavigation";
import { URLState } from "./runtimeTypes";
import {
  hasSessionExchanges,
  MultiProjectSessionGroup,
  OpenSessionTab,
  PendingSend,
  SessionItem,
  toSessionItem,
} from "./sessionModel";

type Options = {
  currentRootIdRef: React.RefObject<string | null>;
  openSessionTab: (rootID: string, session: SessionItem) => void;
  setCurrentRootId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDir: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDirKey: React.Dispatch<React.SetStateAction<string | null>>;
  setMainViewPreferenceForRoot: (
    rootID: string | null | undefined,
    preference: "session" | "file" | "directory" | "git-diff",
  ) => void;
  drawerSessionByRootRef: React.RefObject<Record<string, SessionItem | null>>;
  sessionSearchTargetCounterRef: React.RefObject<number>;
  replaceURLState: (next: URLState) => void;
  selectedSessionByRootRef: React.RefObject<Record<string, string | null>>;
  rootSessionKey: (rootId: string, sessionKey: string) => string;
  isSessionStale: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
  ) => boolean;
  pendingBySessionRef: React.RefObject<Record<string, PendingSend>>;
  sessionCacheRef: React.RefObject<Record<string, Session>>;
  setSelectedSessionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionItem | null>>;
  setInteractionMode: React.Dispatch<React.SetStateAction<"main" | "drawer">>;
  setDrawerOpenForRoot: (
    rootID: string | null | undefined,
    open: boolean,
  ) => void;
  isMobile: boolean;
  setIsRightOpen: React.Dispatch<React.SetStateAction<boolean>>;
  resolvePendingForSession: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
    fallback?: boolean,
  ) => boolean;
  boundSessionByRootRef: React.RefObject<Record<string, string | null>>;
  setDrawerSessionForRoot: (
    rootID: string | null | undefined,
    session: Session | SessionItem | null,
  ) => void;
  bumpCacheVersion: () => void;
  loadedSessionRef: React.RefObject<Record<string, boolean>>;
  restoreActiveSession: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
    canApply?: () => boolean,
  ) => Promise<Session | null>;
  clearSessionStale: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
  ) => void;
  mainViewPreferenceByRootRef: React.RefObject<
    Record<string, "session" | "file" | "directory" | "git-diff">
  >;
  setGitDiff: React.Dispatch<React.SetStateAction<GitDiffPayload | null>>;
  setFile: React.Dispatch<React.SetStateAction<FilePayload | null>>;
  setMainEntries: React.Dispatch<React.SetStateAction<FileEntry[]>>;
  setPluginQuery: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  fileCursorRef: React.RefObject<number>;
  setIsLeftOpen: React.Dispatch<React.SetStateAction<boolean>>;
  t: (key: MessageKey, params?: MessageParams) => string;
  sessionsRef: React.RefObject<SessionItem[]>;
  setSessions: React.Dispatch<React.SetStateAction<SessionItem[]>>;
  removeSessionTabs: (rootID: string, keys: Set<string>) => void;
  loadingSessionRef: React.RefObject<
    Partial<Record<string, Promise<SyncSessionResult>>>
  >;
  cancelRequestedBySessionRef: React.RefObject<Record<string, boolean>>;
  staleSessionKeysRef: React.RefObject<Set<string>>;
  setBoundSessionForRoot: (
    rootID: string | null | undefined,
    key: string | null,
  ) => void;
  setMultiProjectSessionGroups: React.Dispatch<
    React.SetStateAction<MultiProjectSessionGroup[]>
  >;
  setMultiProjectSessionPending: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
    pending: boolean,
  ) => void;
  selectedSessionRef: React.RefObject<SessionItem | null>;
  fileRef: React.RefObject<FilePayload | null>;
  pluginQuery: Record<string, string>;
  setOpenSessionTabsByRoot: React.Dispatch<
    React.SetStateAction<Record<string, OpenSessionTab[]>>
  >;
  setSyncingSessionKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  loadSessionsForRoot: (
    rootID: string,
    options?: {
      beforeTime?: string;
      afterTime?: string;
      replace?: boolean;
      force?: boolean;
    },
  ) => Promise<void>;
  handleSelectSessionRef: React.RefObject<
    ((session: Partial<SessionItem> | null) => Promise<void>) | null
  >;
};

export function useSessionNavigation({
  currentRootIdRef,
  openSessionTab,
  setCurrentRootId,
  setSelectedDir,
  setSelectedDirKey,
  setMainViewPreferenceForRoot,
  drawerSessionByRootRef,
  sessionSearchTargetCounterRef,
  replaceURLState,
  selectedSessionByRootRef,
  rootSessionKey,
  isSessionStale,
  pendingBySessionRef,
  sessionCacheRef,
  setSelectedSessionLoading,
  setSelectedSession,
  setInteractionMode,
  setDrawerOpenForRoot,
  isMobile,
  setIsRightOpen,
  resolvePendingForSession,
  boundSessionByRootRef,
  setDrawerSessionForRoot,
  bumpCacheVersion,
  loadedSessionRef,
  restoreActiveSession,
  clearSessionStale,
  mainViewPreferenceByRootRef,
  setGitDiff,
  setFile,
  setMainEntries,
  setPluginQuery,
  fileCursorRef,
  setIsLeftOpen,
  t,
  sessionsRef,
  setSessions,
  removeSessionTabs,
  loadingSessionRef,
  cancelRequestedBySessionRef,
  staleSessionKeysRef,
  setBoundSessionForRoot,
  setMultiProjectSessionGroups,
  setMultiProjectSessionPending,
  selectedSessionRef,
  fileRef,
  pluginQuery,
  setOpenSessionTabsByRoot,
  setSyncingSessionKeys,
  loadSessionsForRoot,
  handleSelectSessionRef,
}: Options) {
  const handleSelectSession = useCallback(
    async (session: Partial<SessionItem> | null) => {
      const key = session?.key || session?.session_key;
      const targetRoot =
        (session?.root_id as string | undefined) || currentRootIdRef.current;
      if (!targetRoot || !key) return;
      openSessionTab(targetRoot, session as SessionItem);
      if (currentRootIdRef.current !== targetRoot) {
        setCurrentRootId(targetRoot);
      }
      setSelectedDir(targetRoot);
      setSelectedDirKey(
        buildDirectorySelectionKey(targetRoot, targetRoot, true),
      );
      setMainViewPreferenceForRoot(targetRoot, "session");
      const currentDrawer = drawerSessionByRootRef.current[targetRoot];
      const preservePending =
        currentDrawer?.key === key
          ? !!(currentDrawer as any)?.pending
          : !!(session as any)?.pending;
      const searchTargetId =
        typeof session?.search_seq === "number"
          ? `${key}:${session.search_seq}:${++sessionSearchTargetCounterRef.current}`
          : undefined;
      replaceURLState({
        root: targetRoot,
        file: "",
        session: key,
        cursor: 0,
        pluginQuery: {},
      });
      selectedSessionByRootRef.current[targetRoot] = key;
      const cacheKey = rootSessionKey(targetRoot, key);
      const wasStale = isSessionStale(targetRoot, key);
      const hadInMemoryState =
        !!pendingBySessionRef.current[cacheKey] ||
        hasSessionExchanges(sessionCacheRef.current[cacheKey]);
      const shouldSyncHistory = wasStale || !hadInMemoryState;
      setSelectedSessionLoading(true);
      setSelectedSession(
        toSessionItem(targetRoot, {
          ...(session as any),
          pending: preservePending,
          search_target_id: searchTargetId || session?.search_target_id,
        }),
      );
      setInteractionMode("main");
      setDrawerOpenForRoot(targetRoot, false);
      if (isMobile) setIsRightOpen(false);
      const finishLoading = () => {
        if (
          currentRootIdRef.current === targetRoot &&
          selectedSessionByRootRef.current[targetRoot] === key
        ) {
          setSelectedSessionLoading(false);
        }
      };
      await waitForNextPaint();
      const applySession = (
        fullSession: Session,
        options?: { writeCache?: boolean },
      ) => {
        const shouldWriteCache = options?.writeCache !== false;
        const serverPending =
          typeof (fullSession as any)?.pending === "boolean"
            ? !!(fullSession as any).pending
            : undefined;
        const pending =
          serverPending !== undefined
            ? serverPending
            : resolvePendingForSession(targetRoot, key, preservePending);
        const normalized = {
          ...(fullSession as any),
          key,
          pending,
        } as Session;
        if (shouldWriteCache) {
          sessionCacheRef.current[cacheKey] = normalized;
        }
        setSelectedSession((prev) => {
          const prevKey = prev?.key || prev?.session_key;
          const prevRoot =
            (prev?.root_id as string | undefined) || currentRootIdRef.current;
          if (prevKey !== key || prevRoot !== targetRoot) {
            return prev;
          }
          return toSessionItem(targetRoot, {
            ...(prev as any),
            ...(normalized as any),
            key,
            session_key: key,
            root_id: targetRoot,
          });
        });
        if ((boundSessionByRootRef.current[targetRoot] || null) === key) {
          setDrawerSessionForRoot(targetRoot, {
            ...(normalized as any),
          } as Session);
        }
        finishLoading();
        if (shouldWriteCache) {
          bumpCacheVersion();
        }
      };
      const cached = sessionCacheRef.current[cacheKey];
      if (cached) {
        applySession(cached);
        if (
          !shouldSyncHistory &&
          hasSessionExchanges(cached) &&
          hasCurrentActivityHistory(cached)
        ) {
          loadedSessionRef.current[cacheKey] = true;
          return;
        }
      } else {
        const persisted = await getCachedSession(targetRoot, key);
        if (persisted) {
          applySession(persisted);
          if (
            !shouldSyncHistory &&
            hasSessionExchanges(persisted) &&
            hasCurrentActivityHistory(persisted)
          ) {
            loadedSessionRef.current[cacheKey] = true;
            return;
          }
        }
      }
      if (
        !shouldSyncHistory &&
        loadedSessionRef.current[cacheKey] &&
        hasCurrentActivityHistory(sessionCacheRef.current[cacheKey])
      ) {
        return;
      }
      try {
        const restored = await restoreActiveSession(targetRoot, key);
        if (restored) {
          applySession(restored, { writeCache: false });
          loadedSessionRef.current[cacheKey] = true;
          clearSessionStale(targetRoot, key);
        } else {
          finishLoading();
        }
      } catch (err) {
        finishLoading();
      }
    },
    [
      isMobile,
      openSessionTab,
      rootSessionKey,
      bumpCacheVersion,
      clearSessionStale,
      isSessionStale,
      resolvePendingForSession,
      restoreActiveSession,
      setDrawerOpenForRoot,
      setDrawerSessionForRoot,
      setMainViewPreferenceForRoot,
      replaceURLState,
    ],
  );

  const tryShowBoundSessionForRoot = useCallback(
    async (
      rootID: string | null | undefined,
      options?: {
        pluginQuery?: Record<string, string>;
        closeLeftSidebar?: boolean;
      },
    ): Promise<boolean> => {
      const resolvedRoot = String(rootID || "");
      if (!resolvedRoot) {
        return false;
      }
      if (mainViewPreferenceByRootRef.current[resolvedRoot] !== "session") {
        return false;
      }
      const selectedKey = String(
        selectedSessionByRootRef.current[resolvedRoot] || "",
      ).trim();
      const boundKey = String(
        boundSessionByRootRef.current[resolvedRoot] || "",
      ).trim();
      const drawerKey = String(
        drawerSessionByRootRef.current[resolvedRoot]?.key || "",
      ).trim();
      const preferredKey =
        (selectedKey && !selectedKey.startsWith("pending-")
          ? selectedKey
          : "") ||
        (boundKey && !boundKey.startsWith("pending-") ? boundKey : "") ||
        (drawerKey && !drawerKey.startsWith("pending-") ? drawerKey : "");
      if (!preferredKey) {
        return false;
      }
      if (currentRootIdRef.current !== resolvedRoot) {
        setCurrentRootId(resolvedRoot);
      }
      setGitDiff(null);
      setFile(null);
      setMainEntries([]);
      setPluginQuery(options?.pluginQuery || {});
      setSelectedDir(resolvedRoot);
      setSelectedDirKey(
        buildDirectorySelectionKey(resolvedRoot, resolvedRoot, true),
      );
      fileCursorRef.current = 0;
      const cacheKey = rootSessionKey(resolvedRoot, preferredKey);
      let initialSession =
        sessionCacheRef.current[cacheKey] ||
        (await getCachedSession(resolvedRoot, preferredKey));
      if (initialSession) {
        sessionCacheRef.current[cacheKey] = {
          ...(initialSession as any),
          key: preferredKey,
        } as Session;
      }
      await handleSelectSession(
        initialSession
          ? ({
              ...(initialSession as any),
              key: preferredKey,
              session_key: preferredKey,
              root_id: resolvedRoot,
            } as SessionItem)
          : {
              key: preferredKey,
              session_key: preferredKey,
              root_id: resolvedRoot,
            },
      );
      if (options?.closeLeftSidebar && isMobile) {
        setIsLeftOpen(false);
      }
      return true;
    },
    [handleSelectSession, isMobile, rootSessionKey, bumpCacheVersion],
  );

  const handleDeleteSession = useCallback(
    async (session: SessionItem) => {
      const sessionKey = session?.key || session?.session_key;
      const rootID =
        (session?.root_id as string | undefined) || currentRootIdRef.current;
      if (!rootID || !sessionKey) return;

      const deleted = await sessionService.deleteSession(rootID, sessionKey);
      if (!deleted) {
        reportError("session.delete_failed", t("session.deleteFailed"));
        return;
      }

      const deletedKeys = new Set<string>();
      const collectDeletedKeys = (key: string) => {
        if (!key || deletedKeys.has(key)) return;
        deletedKeys.add(key);
        for (const item of sessionsRef.current) {
          const itemKey = item.key || item.session_key || "";
          if (String(item.parent_session_key || "").trim() === key) {
            collectDeletedKeys(itemKey);
          }
        }
      };
      collectDeletedKeys(sessionKey);

      setSessions((prev) =>
        prev.filter(
          (item) => !deletedKeys.has(item.key || item.session_key || ""),
        ),
      );
      removeSessionTabs(rootID, deletedKeys);

      for (const deletedKey of deletedKeys) {
        const cacheKey = rootSessionKey(rootID, deletedKey);
        delete sessionCacheRef.current[cacheKey];
        delete loadedSessionRef.current[cacheKey];
        delete loadingSessionRef.current[cacheKey];
        delete pendingBySessionRef.current[cacheKey];
        delete cancelRequestedBySessionRef.current[cacheKey];
        staleSessionKeysRef.current.delete(cacheKey);
        void deleteCachedSession(rootID, deletedKey);
      }

      if (deletedKeys.has(boundSessionByRootRef.current[rootID] || "")) {
        setBoundSessionForRoot(rootID, null);
      }
      if (deletedKeys.has(selectedSessionByRootRef.current[rootID] || "")) {
        selectedSessionByRootRef.current[rootID] = null;
      }
      if (deletedKeys.has(drawerSessionByRootRef.current[rootID]?.key || "")) {
        setDrawerSessionForRoot(rootID, null);
        setDrawerOpenForRoot(rootID, false);
      }
      setMultiProjectSessionGroups((prev) =>
        prev
          .map((group) => {
            if (group.rootId !== rootID) {
              return group;
            }
            const sessions = group.sessions.filter(
              (item) => !deletedKeys.has(item.key || item.session_key || ""),
            );
            return {
              ...group,
              sessions,
              totalCount: Math.max(
                0,
                group.totalCount - (group.sessions.length - sessions.length),
              ),
            };
          })
          .filter((group) => group.totalCount > 0 || group.sessions.length > 0),
      );
      for (const deletedKey of deletedKeys) {
        setMultiProjectSessionPending(rootID, deletedKey, false);
      }

      const selectedKey =
        selectedSessionRef.current?.key ||
        selectedSessionRef.current?.session_key;
      const selectedRoot =
        (selectedSessionRef.current?.root_id as string | undefined) ||
        currentRootIdRef.current;
      if (deletedKeys.has(selectedKey || "") && selectedRoot === rootID) {
        setSelectedSession(null);
        setSelectedSessionLoading(false);
        replaceURLState({
          root: rootID,
          file: fileRef.current?.root === rootID ? fileRef.current.path : "",
          session: "",
          cursor: fileCursorRef.current || 0,
          pluginQuery: fileRef.current?.root === rootID ? pluginQuery : {},
        });
      }

      bumpCacheVersion();
    },
    [
      bumpCacheVersion,
      pluginQuery,
      replaceURLState,
      rootSessionKey,
      removeSessionTabs,
      setBoundSessionForRoot,
      setDrawerOpenForRoot,
      setDrawerSessionForRoot,
      setMultiProjectSessionPending,
    ],
  );

  const handleRenameSession = useCallback(
    async (session: SessionItem, nextName: string) => {
      const sessionKey = session?.key || session?.session_key;
      const rootID =
        (session?.root_id as string | undefined) || currentRootIdRef.current;
      if (!rootID || !sessionKey) return false;

      const trimmedName = nextName.trim();
      if (!trimmedName || trimmedName === String(session?.name || "").trim()) {
        return true;
      }

      const renamed = await sessionService.renameSession(
        rootID,
        sessionKey,
        trimmedName,
      );
      if (!renamed) {
        reportError("session.rename_failed", t("session.renameFailed"));
        return false;
      }

      setSessions((prev) =>
        prev.map((item) =>
          (item.key || item.session_key) === sessionKey
            ? ({
                ...item,
                name: renamed.name,
                updated_at: renamed.updated_at,
              } as SessionItem)
            : item,
        ),
      );
      setOpenSessionTabsByRoot((prev) => {
        const current = prev[rootID] || [];
        if (
          !current.some((item) => (item.key || item.session_key) === sessionKey)
        ) {
          return prev;
        }
        return {
          ...prev,
          [rootID]: current.map((item) =>
            (item.key || item.session_key) === sessionKey
              ? { ...item, name: renamed.name, updated_at: renamed.updated_at }
              : item,
          ),
        };
      });

      const cacheKey = rootSessionKey(rootID, sessionKey);
      const cached = sessionCacheRef.current[cacheKey];
      if (cached) {
        sessionCacheRef.current[cacheKey] = {
          ...cached,
          name: renamed.name,
          updated_at: renamed.updated_at,
        } as Session;
      }

      if (
        (selectedSessionRef.current?.key ||
          selectedSessionRef.current?.session_key) === sessionKey
      ) {
        setSelectedSession((prev) =>
          prev
            ? ({
                ...prev,
                name: renamed.name,
                updated_at: renamed.updated_at,
              } as SessionItem)
            : prev,
        );
      }

      if (boundSessionByRootRef.current[rootID] === sessionKey) {
        const latest = sessionCacheRef.current[cacheKey];
        if (latest) {
          setDrawerSessionForRoot(rootID, latest);
        }
      }
      setMultiProjectSessionGroups((prev) =>
        prev.map((group) =>
          group.rootId === rootID
            ? {
                ...group,
                sessions: group.sessions.map((item) =>
                  (item.key || item.session_key) === sessionKey
                    ? ({
                        ...item,
                        name: renamed.name,
                        updated_at: renamed.updated_at,
                      } as SessionItem)
                    : item,
                ),
              }
            : group,
        ),
      );

      bumpCacheVersion();
      return true;
    },
    [bumpCacheVersion, rootSessionKey, setDrawerSessionForRoot],
  );

  const handlePinSession = useCallback(
    async (session: SessionItem, pinned: boolean) => {
      const sessionKey = session?.key || session?.session_key;
      const rootID =
        (session?.root_id as string | undefined) || currentRootIdRef.current;
      if (!rootID || !sessionKey) return false;

      const updated = await sessionService.setSessionPinned(
        rootID,
        sessionKey,
        pinned,
      );
      if (!updated) {
        reportError("session.pin_failed", t("session.pinFailed"));
        return false;
      }

      const nextItem = toSessionItem(rootID, updated);
      if (nextItem) {
        setSessions((prev) => mergeSessionItems(prev, [nextItem]));
        setMultiProjectSessionGroups((prev) =>
          prev.map((group) =>
            group.rootId === rootID
              ? {
                  ...group,
                  sessions: mergeSessionItems(group.sessions, [nextItem]),
                }
              : group,
          ),
        );
      }

      const cacheKey = rootSessionKey(rootID, sessionKey);
      const cached = sessionCacheRef.current[cacheKey];
      if (cached) {
        sessionCacheRef.current[cacheKey] = {
          ...cached,
          pinned_at: updated.pinned_at || undefined,
        } as Session;
      }

      if (
        (selectedSessionRef.current?.key ||
          selectedSessionRef.current?.session_key) === sessionKey
      ) {
        setSelectedSession((prev) =>
          prev
            ? ({
                ...prev,
                pinned_at: updated.pinned_at || undefined,
              } as SessionItem)
            : prev,
        );
      }

      if (boundSessionByRootRef.current[rootID] === sessionKey) {
        const latest = sessionCacheRef.current[cacheKey];
        if (latest) {
          setDrawerSessionForRoot(rootID, latest);
        }
      }

      bumpCacheVersion();
      return true;
    },
    [bumpCacheVersion, rootSessionKey, setDrawerSessionForRoot, t],
  );

  const handleSyncSession = useCallback(
    async (session: SessionItem) => {
      const sessionKey = session?.key || session?.session_key;
      const rootID =
        (session?.root_id as string | undefined) || currentRootIdRef.current;
      if (!rootID || !sessionKey || sessionKey.startsWith("pending-")) return;

      const cacheKey = rootSessionKey(rootID, sessionKey);
      setSyncingSessionKeys((prev) => {
        const next = new Set(prev);
        next.add(cacheKey);
        next.add(sessionKey);
        return next;
      });
      try {
        const result = await syncSession(rootID, sessionKey, { full: true });
        const synced = result.session;
        if (!synced) {
          reportError("session.sync_failed", t("session.syncFailed"));
          return;
        }
        const normalized = {
          ...(synced as any),
          key: sessionKey,
        } as Session;
        sessionCacheRef.current[cacheKey] = normalized;
        loadedSessionRef.current[cacheKey] = true;
        clearSessionStale(rootID, sessionKey);

        const nextItem = toSessionItem(rootID, normalized);
        if (nextItem) {
          setSessions((prev) => mergeSessionItems(prev, [nextItem]));
        }

        setSelectedSession((prev) => {
          const prevKey = prev?.key || prev?.session_key;
          const prevRoot =
            (prev?.root_id as string | undefined) || currentRootIdRef.current;
          if (!prev || prevKey !== sessionKey || prevRoot !== rootID) {
            return prev;
          }
          return toSessionItem(rootID, {
            ...(prev as any),
            ...(normalized as any),
            key: sessionKey,
            session_key: sessionKey,
            root_id: rootID,
          });
        });

        if (drawerSessionByRootRef.current[rootID]?.key === sessionKey) {
          setDrawerSessionForRoot(rootID, normalized);
        }

        bumpCacheVersion();
      } catch {
        reportError("session.sync_failed", t("session.syncFailed"));
      } finally {
        setSyncingSessionKeys((prev) => {
          const next = new Set(prev);
          next.delete(cacheKey);
          next.delete(sessionKey);
          return next;
        });
      }
    },
    [
      bumpCacheVersion,
      clearSessionStale,
      mergeSessionItems,
      rootSessionKey,
      setDrawerSessionForRoot,
    ],
  );

  const handleForkAgentMessage = useCallback(
    async (
      rootID: string | null | undefined,
      sessionKey: string | null | undefined,
      seq: number,
    ) => {
      const resolvedRoot = String(
        rootID || currentRootIdRef.current || "",
      ).trim();
      const resolvedKey = String(sessionKey || "").trim();
      if (!resolvedRoot || !resolvedKey || seq <= 0) {
        reportError("session.sync_failed", t("session.forkMissing"));
        return;
      }
      const result = await sessionService.forkSession(
        resolvedRoot,
        resolvedKey,
        seq,
      );
      const forked = result?.session;
      const forkedKey = String(result?.session_key || forked?.key || "").trim();
      if (!forkedKey) {
        reportError("session.sync_failed", t("session.forkFailed"));
        return;
      }
      if (forked) {
        const normalized = {
          ...(forked as any),
          key: forkedKey,
          session_key: forkedKey,
          root_id: resolvedRoot,
        } as Session;
        const cacheKey = rootSessionKey(resolvedRoot, forkedKey);
        sessionCacheRef.current[cacheKey] = normalized;
        loadedSessionRef.current[cacheKey] = true;
        const item = toSessionItem(resolvedRoot, normalized);
        if (item) {
          setSessions((prev) => mergeSessionItems(prev, [item]));
          await handleSelectSession(item);
        } else {
          await handleSelectSession({
            key: forkedKey,
            session_key: forkedKey,
            root_id: resolvedRoot,
          });
        }
      } else {
        await handleSelectSession({
          key: forkedKey,
          session_key: forkedKey,
          root_id: resolvedRoot,
        });
      }
      void loadSessionsForRoot(resolvedRoot, { replace: true, force: true });
      bumpCacheVersion();
    },
    [
      bumpCacheVersion,
      handleSelectSession,
      loadSessionsForRoot,
      mergeSessionItems,
      rootSessionKey,
    ],
  );

  useEffect(() => {
    handleSelectSessionRef.current = handleSelectSession;
  }, [handleSelectSession]);
  return {
    handleSelectSession,
    tryShowBoundSessionForRoot,
    handleDeleteSession,
    handleRenameSession,
    handlePinSession,
    handleSyncSession,
    handleForkAgentMessage,
  };
}

export type SessionNavigation = ReturnType<typeof useSessionNavigation>;
