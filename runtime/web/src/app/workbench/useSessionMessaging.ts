import { useMessageSending } from "../useMessageSending";
import { useCallback } from "react";
import { sessionService, type Session } from "../../services/session";
import { SessionItem } from "../sessionModel";
import { readURLState } from "../urlState";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { usePluginState } from "./usePluginState";
import type { useFileViewerState } from "./useFileViewerState";
import type { useSessionList } from "./useSessionList";
import type { useSessionCacheState } from "./useSessionCacheState";
import type { useWorkbenchSessionNavigation } from "./useWorkbenchSessionNavigation";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  pluginStateApi: ReturnType<typeof usePluginState>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
  sessionListApi: ReturnType<typeof useSessionList>;
  sessionCacheStateApi: ReturnType<typeof useSessionCacheState>;
  workbenchSessionNavigationApi: ReturnType<typeof useWorkbenchSessionNavigation>;
};

export function useSessionMessaging({ appFoundationApi, currentRootApi, sessionSelectionApi, pluginStateApi, fileViewerStateApi, sessionListApi, sessionCacheStateApi, workbenchSessionNavigationApi }: Deps) {
  const { boundSessionByRootRef, cancelRequestedBySessionRef, currentSessionRef, drawerSessionByRootRef, fileRef, interactionModeRef, optimisticDequeuedIdsRef, pendingDraftRef, pendingRequestRef, pluginBypassRef, pluginManagerRef, queuedMessagesBySessionRef, selectedSessionByRootRef, selectedSessionRef, sessionCacheRef, suppressedAutoBindSessionByRootRef, t } = appFoundationApi;
  const { currentRootIdRef, replaceURLState } = currentRootApi;
  const { bumpCacheVersion, clearSlashCommandResultForSession, openSessionTab, openSessionTabsByRoot, pendingPlanMode, removeSessionTabs, rootSessionKey, setBoundSessionForRoot, setDrawerOpenForRoot, setDrawerSessionForRoot, setInteractionMode, setMainViewPreferenceForRoot, setPendingPlanMode, setQueueVersion, setSelectedSession, setSelectedSessionLoading, setSlashCommandResults, slashCommandResults } = sessionSelectionApi;
  const { pluginQueryRef } = pluginStateApi;
  const { attachedFileContext } = fileViewerStateApi;
  const { sessionsRef, setMultiProjectSessionPending, setSessions } = sessionListApi;
  const { clearLocalPendingForSession, setSelectedPendingByKey, updateSessionAgentForKey } = sessionCacheStateApi;
  const { handleSelectSession } = workbenchSessionNavigationApi;

  const { handleSendMessage } = useMessageSending({
    currentRootIdRef,
    selectedSessionRef,
    boundSessionByRootRef,
    interactionModeRef,
    sessionCacheRef,
    rootSessionKey,
    currentSessionRef,
    updateSessionAgentForKey,
    setBoundSessionForRoot,
    setSelectedPendingByKey,
    setDrawerSessionForRoot,
    pendingPlanMode,
    t,
    slashCommandResults,
    setMultiProjectSessionPending,
    setSessions,
    drawerSessionByRootRef,
    setSlashCommandResults,
    clearSlashCommandResultForSession,
    pendingRequestRef,
    bumpCacheVersion,
    pendingDraftRef,
    openSessionTab,
    selectedSessionByRootRef,
    setSelectedSession,
    setSelectedSessionLoading,
    setMainViewPreferenceForRoot,
    setInteractionMode,
    setDrawerOpenForRoot,
    replaceURLState,
    attachedFileContext,
    fileRef,
    pluginBypassRef,
    pluginQueryRef,
    pluginManagerRef,
    setPendingPlanMode,
    removeSessionTabs,
  });
  const handleCancelCurrentTurn = useCallback(
    async (sessionKey: string) => {
      const activeRoot = currentRootIdRef.current;
      if (!activeRoot || !sessionKey) return;
      const cacheKey = rootSessionKey(activeRoot, sessionKey);
      cancelRequestedBySessionRef.current[cacheKey] = true;
      const sent = await sessionService.cancelMessage(activeRoot, sessionKey);
      if (!sent) {
        delete cancelRequestedBySessionRef.current[cacheKey];
        return;
      }
      clearLocalPendingForSession(activeRoot, sessionKey);
    },
    [clearLocalPendingForSession, rootSessionKey],
  );
  const markSessionPending = useCallback(
    (rootID: string, sessionKey: string) => {
      if (!rootID || !sessionKey) return;
      const now = new Date().toISOString();
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const cached = sessionCacheRef.current[cacheKey];
      if (cached) {
        sessionCacheRef.current[cacheKey] = {
          ...(cached as any),
          pending: true,
          updated_at: now,
        } as Session;
        bumpCacheVersion();
      }
      setSelectedPendingByKey(sessionKey, true);
      const drawer = drawerSessionByRootRef.current[rootID];
      if (
        drawer &&
        (drawer.key || (drawer as any).session_key) === sessionKey
      ) {
        setDrawerSessionForRoot(rootID, {
          ...(drawer as any),
          pending: true,
          updated_at: now,
        } as Session);
      }
      if (currentRootIdRef.current === rootID) {
        setSessions((prev) =>
          prev.map((item) => {
            const itemKey = item.key || item.session_key;
            if (itemKey !== sessionKey) {
              return item;
            }
            return {
              ...(item as any),
              pending: true,
              updated_at: now,
            } as SessionItem;
          }),
        );
      }
      setMultiProjectSessionPending(rootID, sessionKey, true);
    },
    [
      bumpCacheVersion,
      rootSessionKey,
      setDrawerSessionForRoot,
      setMultiProjectSessionPending,
      setSelectedPendingByKey,
    ],
  );
  const handleRemoveQueuedMessage = useCallback(async (queueId: string) => {
    const activeRoot = currentRootIdRef.current;
    const selected = selectedSessionRef.current;
    const selectedRoot =
      (selected?.root_id as string | undefined) || activeRoot || "";
    const selectedKey = selected?.key || selected?.session_key || "";
    const sessionKey =
      interactionModeRef.current !== "drawer" &&
      selectedRoot === activeRoot &&
      selectedKey &&
      !selectedKey.startsWith("pending-")
        ? selectedKey
        : boundSessionByRootRef.current[activeRoot || ""] || "";
    if (!activeRoot || !sessionKey || !queueId) return;
    await sessionService.removeQueuedMessage(activeRoot, sessionKey, queueId);
  }, []);
  const handleUpdateQueuedMessage = useCallback(
    async (queueId: string, content: string) => {
      const activeRoot = currentRootIdRef.current;
      const selected = selectedSessionRef.current;
      const selectedRoot =
        (selected?.root_id as string | undefined) || activeRoot || "";
      const selectedKey = selected?.key || selected?.session_key || "";
      const sessionKey =
        interactionModeRef.current !== "drawer" &&
        selectedRoot === activeRoot &&
        selectedKey &&
        !selectedKey.startsWith("pending-")
          ? selectedKey
          : boundSessionByRootRef.current[activeRoot || ""] || "";
      if (!activeRoot || !sessionKey || !queueId || !content.trim()) return;
      await sessionService.updateQueuedMessage(
        activeRoot,
        sessionKey,
        queueId,
        content,
      );
    },
    [],
  );
  const handleSendQueuedMessageNow = useCallback(
    async (queueId: string) => {
      const activeRoot = currentRootIdRef.current;
      const selected = selectedSessionRef.current;
      const selectedRoot =
        (selected?.root_id as string | undefined) || activeRoot || "";
      const selectedKey = selected?.key || selected?.session_key || "";
      const sessionKey =
        interactionModeRef.current !== "drawer" &&
        selectedRoot === activeRoot &&
        selectedKey &&
        !selectedKey.startsWith("pending-")
          ? selectedKey
          : boundSessionByRootRef.current[activeRoot || ""] || "";
      if (!activeRoot || !sessionKey || !queueId) return;
      const cacheKey = rootSessionKey(activeRoot, sessionKey);
      const previousQueue = queuedMessagesBySessionRef.current[cacheKey] || [];
      const nextQueue = previousQueue.filter((item) => item.id !== queueId);
      queuedMessagesBySessionRef.current[cacheKey] = nextQueue;
      if (!optimisticDequeuedIdsRef.current[cacheKey]) {
        optimisticDequeuedIdsRef.current[cacheKey] = new Set();
      }
      optimisticDequeuedIdsRef.current[cacheKey].add(queueId);
      setQueueVersion((v) => v + 1);
      markSessionPending(activeRoot, sessionKey);
      const sent = await sessionService.sendQueuedMessageNow(
        activeRoot,
        sessionKey,
        queueId,
      );
      if (!sent) {
        optimisticDequeuedIdsRef.current[cacheKey]?.delete(queueId);
        queuedMessagesBySessionRef.current[cacheKey] = previousQueue;
        setQueueVersion((v) => v + 1);
      }
    },
    [markSessionPending, rootSessionKey],
  );
  const handleNewSession = useCallback(() => {
    const rootID = currentRootIdRef.current;
    const previousBoundKey = rootID
      ? boundSessionByRootRef.current[rootID]
      : "";
    if (
      rootID &&
      previousBoundKey &&
      !previousBoundKey.startsWith("pending-")
    ) {
      suppressedAutoBindSessionByRootRef.current[rootID] = previousBoundKey;
    }
    setMainViewPreferenceForRoot(rootID, "session");
    selectedSessionRef.current = null;
    currentSessionRef.current = null;
    interactionModeRef.current = "main";
    setSelectedSession(null);
    if (rootID) {
      selectedSessionByRootRef.current[rootID] = null;
    }
    setBoundSessionForRoot(rootID, null);
    setDrawerSessionForRoot(rootID, null);
    setInteractionMode("main");
    setDrawerOpenForRoot(rootID, false);
    replaceURLState({
      ...readURLState(),
      root: rootID || "",
      session: "",
      cursor: 0,
    });
  }, [
    replaceURLState,
    setBoundSessionForRoot,
    setDrawerOpenForRoot,
    setDrawerSessionForRoot,
    setMainViewPreferenceForRoot,
  ]);
  const handleSelectSessionTab = useCallback(
    (rootID: string, sessionKey: string) => {
      const tab = (openSessionTabsByRoot[rootID] || []).find(
        (item) => (item.key || item.session_key) === sessionKey,
      );
      if (!tab) return;
      const latest = sessionsRef.current.find(
        (item) =>
          (item.key || item.session_key) === sessionKey &&
          ((item.root_id as string | undefined) || rootID) === rootID,
      );
      void handleSelectSession({ ...tab, ...latest, root_id: rootID });
    },
    [handleSelectSession, openSessionTabsByRoot],
  );
  const handleCloseSessionTab = useCallback(
    (rootID: string, sessionKey: string) => {
      const tabs = openSessionTabsByRoot[rootID] || [];
      const closedIndex = tabs.findIndex(
        (item) => (item.key || item.session_key) === sessionKey,
      );
      if (closedIndex < 0) return;
      removeSessionTabs(rootID, new Set([sessionKey]));

      const selected = selectedSessionRef.current;
      const selectedKey = selected?.key || selected?.session_key || "";
      const selectedRoot =
        (selected?.root_id as string | undefined) || currentRootIdRef.current;
      if (selectedKey !== sessionKey || selectedRoot !== rootID) return;

      const nextTab = tabs[closedIndex + 1] || tabs[closedIndex - 1];
      if (nextTab) {
        const nextKey = nextTab.key || nextTab.session_key;
        handleSelectSessionTab(rootID, nextKey);
      } else {
        handleNewSession();
      }
    },
    [
      handleNewSession,
      handleSelectSessionTab,
      openSessionTabsByRoot,
      removeSessionTabs,
    ],
  );

  return { handleCancelCurrentTurn, handleCloseSessionTab, handleNewSession, handleRemoveQueuedMessage, handleSelectSessionTab, handleSendMessage, handleSendQueuedMessageNow, handleUpdateQueuedMessage, markSessionPending };
}
