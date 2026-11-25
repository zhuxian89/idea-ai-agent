import { sessionInputHistory } from "../sessionModel";
import { useMemo } from "react";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useSessionCacheState } from "./useSessionCacheState";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  sessionCacheStateApi: ReturnType<typeof useSessionCacheState>;
};

export function useActionBarModel({ appFoundationApi, currentRootApi, sessionSelectionApi, sessionCacheStateApi }: Deps) {
  const { queuedMessagesBySessionRef, sessionCacheRef } = appFoundationApi;
  const { currentRootId } = currentRootApi;
  const { activeBoundSessionKey, currentSession, interactionMode, isDrawerOpen, queueVersion, rootSessionKey, selectedSession } = sessionSelectionApi;
  const { getSessionSnapshot } = sessionCacheStateApi;

  const selectedRoot =
    (selectedSession?.root_id as string | undefined) || currentRootId || "";
  const selectedInCurrentRoot =
    !!selectedSession && !!currentRootId && selectedRoot === currentRootId;
  const selectedKey =
    selectedSession?.key || selectedSession?.session_key || "";
  const boundFromSelected =
    selectedInCurrentRoot && selectedKey === activeBoundSessionKey
      ? (selectedSession as any)
      : null;
  const boundFromCache =
    activeBoundSessionKey && currentRootId
      ? (sessionCacheRef.current[
          rootSessionKey(currentRootId, activeBoundSessionKey)
        ] as any)
      : null;
  const isDetachedMainSessionTarget =
    !!activeBoundSessionKey &&
    selectedInCurrentRoot &&
    !!selectedKey &&
    selectedKey !== activeBoundSessionKey &&
    interactionMode !== "drawer";
  const boundFromCurrent =
    activeBoundSessionKey &&
    (currentSession?.key || currentSession?.session_key) ===
      activeBoundSessionKey &&
    (!currentSession?.root_id || currentSession.root_id === currentRootId)
      ? currentSession
      : null;
  // Match the same main/drawer target used by handleSendMessage, even while
  // a previously bound drawer is being replaced or receiving background events.
  const actionBarSession =
    selectedInCurrentRoot && interactionMode !== "drawer"
      ? selectedSession
      : activeBoundSessionKey
        ? boundFromCurrent || boundFromCache || boundFromSelected
        : null;
  const actionBarSessionKey =
    (actionBarSession as any)?.key ||
    (actionBarSession as any)?.session_key ||
    "";
  const actionBarInputHistory = sessionInputHistory(
    getSessionSnapshot(
      ((actionBarSession as any)?.root_id as string | undefined) ||
        currentRootId,
      actionBarSession as any,
    ) || (actionBarSession as any),
  );
  const isBoundSessionInMain =
    !!activeBoundSessionKey &&
    selectedKey === activeBoundSessionKey &&
    interactionMode !== "drawer";
  const canOpenSessionDrawer = !!activeBoundSessionKey && !isBoundSessionInMain;
  const detachedBoundSession = isDetachedMainSessionTarget && !isDrawerOpen;
  const actionBarQueuedMessages = useMemo(() => {
    void queueVersion;
    if (!currentRootId || !actionBarSessionKey) return [];
    return (
      queuedMessagesBySessionRef.current[
        rootSessionKey(currentRootId, actionBarSessionKey)
      ] || []
    );
  }, [actionBarSessionKey, currentRootId, queueVersion, rootSessionKey]);

  return { actionBarInputHistory, actionBarQueuedMessages, actionBarSession, canOpenSessionDrawer, detachedBoundSession, selectedKey, selectedRoot };
}
