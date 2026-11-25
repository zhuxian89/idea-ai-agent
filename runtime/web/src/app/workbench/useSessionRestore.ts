import { useMemo, useEffect } from "react";
import { SessionItem, hasSessionExchanges, toSessionItem } from "../sessionModel";
import { type Session, hasCurrentActivityHistory } from "../../services/session";
import { isIdeaRuntime } from "../../services/ideaBridge";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useSessionList } from "./useSessionList";
import type { useSessionCacheState } from "./useSessionCacheState";
import type { useActionHandlers } from "./useActionHandlers";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  sessionListApi: ReturnType<typeof useSessionList>;
  sessionCacheStateApi: ReturnType<typeof useSessionCacheState>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
};

export function useSessionRestore({ appFoundationApi, currentRootApi, sessionSelectionApi, sessionListApi, sessionCacheStateApi, actionHandlersApi }: Deps) {
  const { boundSessionByRootRef, lastMainSessionSnapshotRef, loadedSessionRef, loadingSessionRef, sessionCacheRef } = appFoundationApi;
  const { currentRootId, currentRootIdRef } = currentRootApi;
  const { bumpCacheVersion, rootSessionKey, selectedSession, selectedSessionLoading, setDrawerSessionForRoot, setSelectedSession } = sessionSelectionApi;
  const { sessions } = sessionListApi;
  const { clearSessionStale, getSessionSnapshot, isSessionStale, resolvePendingForSession, restoreActiveSession } = sessionCacheStateApi;
  const { actionHandlers } = actionHandlersApi;

  const selectedSessionSnapshot = useMemo(() => {
    if (!selectedSession) {
      return null;
    }
    return getSessionSnapshot(
      selectedSession.root_id || currentRootId,
      selectedSession,
    );
  }, [
    selectedSession,
    selectedSessionLoading,
    currentRootId,
    getSessionSnapshot,
  ]);
  const sessionByKey = useMemo(
    () =>
      sessions.reduce<Record<string, SessionItem>>((acc, session) => {
        const key = session.key || session.session_key || "";
        if (key) acc[key] = session;
        return acc;
      }, {}),
    [sessions],
  );
  useEffect(() => {
    if (selectedSessionSnapshot) {
      lastMainSessionSnapshotRef.current = selectedSessionSnapshot as Session;
    }
  }, [selectedSessionSnapshot]);
  useEffect(() => {
    const sessionKey =
      selectedSession?.key || selectedSession?.session_key || "";
    const rootID =
      (selectedSession?.root_id as string | undefined) || currentRootId || "";
    if (!rootID || !sessionKey || sessionKey.startsWith("pending-")) {
      return;
    }
    if (selectedSessionLoading) {
      return;
    }
    const cacheKey = rootSessionKey(rootID, sessionKey);
    const isStale = isSessionStale(rootID, sessionKey);
    const cached = sessionCacheRef.current[cacheKey];
    if (!isStale && loadedSessionRef.current[cacheKey]) {
      return;
    }
    if (
      !isStale &&
      hasSessionExchanges(cached) &&
      hasCurrentActivityHistory(cached)
    ) {
      return;
    }
    if (
      !isStale &&
      hasSessionExchanges(selectedSessionSnapshot as Session | null) &&
      hasCurrentActivityHistory(selectedSessionSnapshot as Session | null)
    ) {
      return;
    }
    if (loadingSessionRef.current[cacheKey]) {
      return;
    }
    void restoreActiveSession(rootID, sessionKey).then((restored) => {
      if (!restored) {
        return;
      }
      loadedSessionRef.current[cacheKey] = true;
      clearSessionStale(rootID, sessionKey);
      setSelectedSession((prev) => {
        const prevKey = prev?.key || prev?.session_key;
        const prevRoot =
          (prev?.root_id as string | undefined) || currentRootIdRef.current;
        if (!prev || prevKey !== sessionKey || prevRoot !== rootID) {
          return prev;
        }
        return toSessionItem(rootID, {
          ...(prev as any),
          ...(restored as any),
          key: sessionKey,
          session_key: sessionKey,
          root_id: rootID,
        });
      });
      if (boundSessionByRootRef.current[rootID] === sessionKey) {
        setDrawerSessionForRoot(rootID, restored);
      }
    });
  }, [
    selectedSession,
    selectedSessionLoading,
    selectedSessionSnapshot,
    currentRootId,
    rootSessionKey,
    bumpCacheVersion,
    clearSessionStale,
    isSessionStale,
    resolvePendingForSession,
    restoreActiveSession,
    setDrawerSessionForRoot,
  ]);
  useEffect(() => {
    if (isIdeaRuntime) return;
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ root: string; path: string }>)
        .detail;
      actionHandlers.open(detail);
    };
    window.addEventListener("ideaRemoteOpenFile", open);
    return () => window.removeEventListener("ideaRemoteOpenFile", open);
  }, [actionHandlers]);

  return { selectedSessionSnapshot, sessionByKey };
}
