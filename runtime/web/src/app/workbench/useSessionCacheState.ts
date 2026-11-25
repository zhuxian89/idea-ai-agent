import { useSessionCache } from "../useSessionCache";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useSessionList } from "./useSessionList";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  sessionListApi: ReturnType<typeof useSessionList>;
};

export function useSessionCacheState({ appFoundationApi, currentRootApi, sessionSelectionApi, sessionListApi }: Deps) {
  const { boundSessionByRootRef, currentSessionRef, drawerSessionByRootRef, lastMainSessionSnapshotRef, loadedSessionRef, loadingSessionRef, pendingBySessionRef, selectedSessionByRootRef, selectedSessionRef, sessionCacheRef, staleSessionKeysRef, t } = appFoundationApi;
  const { currentRootIdRef } = currentRootApi;
  const { bumpCacheVersion, cacheVersion, rootSessionKey, setBoundSessionForRoot, setDrawerSessionForRoot, setOpenSessionTabsByRoot, setPendingPlanMode, setSelectedSession } = sessionSelectionApi;
  const { sessions, setMultiProjectSessionPending, setSessions } = sessionListApi;

  const {
    getSessionSnapshot,
    setSelectedPendingByKey,
    resolvePendingForSession,
    clearLocalPendingForSession,
    markSessionStale,
    clearSessionStale,
    isSessionStale,
    restoreActiveSession,
    updateSessionRelatedFilesForKey,
    updateSessionRelatedWorktreeForKey,
    updateSessionAgentForKey,
    handleSetPlanMode,
    promotePendingSessionForRoot,
    appendAgentChunkForSession,
    appendThoughtChunkForSession,
    appendToolCallForSession,
    appendTodoUpdateForSession,
    appendPlanUpdateForSession,
    appendCompactNoticeForSession,
    attachContextWindowToLatestAssistant,
  } = useSessionCache({
    rootSessionKey,
    sessionCacheRef,
    drawerSessionByRootRef,
    cacheVersion,
    setSelectedSession,
    pendingBySessionRef,
    selectedSessionRef,
    currentRootIdRef,
    setDrawerSessionForRoot,
    setSessions,
    setMultiProjectSessionPending,
    bumpCacheVersion,
    staleSessionKeysRef,
    loadingSessionRef,
    lastMainSessionSnapshotRef,
    sessions,
    currentSessionRef,
    t,
    setPendingPlanMode,
    loadedSessionRef,
    boundSessionByRootRef,
    setBoundSessionForRoot,
    selectedSessionByRootRef,
    setOpenSessionTabsByRoot,
  });

  return { appendAgentChunkForSession, appendCompactNoticeForSession, appendPlanUpdateForSession, appendThoughtChunkForSession, appendTodoUpdateForSession, appendToolCallForSession, attachContextWindowToLatestAssistant, clearLocalPendingForSession, clearSessionStale, getSessionSnapshot, handleSetPlanMode, isSessionStale, markSessionStale, promotePendingSessionForRoot, resolvePendingForSession, restoreActiveSession, setSelectedPendingByKey, updateSessionAgentForKey, updateSessionRelatedFilesForKey, updateSessionRelatedWorktreeForKey };
}
