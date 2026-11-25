import { useEffect } from "react";
import { createSessionReplay } from "../events/sessionReplay";
import { createSessionStreamHandlers } from "../events/sessionStream";
import { createSlashCommandHandlers } from "../events/slashCommands";
import { createFileChangeHandlers } from "../events/fileChanges";
import { createSessionLifecycleHandler } from "../events/sessionLifecycle";
import { createWorkspaceEventHandler } from "../events/workspaceEvents";
import { createConnectionEventHandler } from "../events/connectionEvents";
import { sessionService } from "../../services/session";
import type { useAppFoundation } from "./useAppFoundation";
import type { useWorkbenchLayout } from "./useWorkbenchLayout";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useProjectTree } from "./useProjectTree";
import type { useFileViewerState } from "./useFileViewerState";
import type { useRelayConnection } from "./useRelayConnection";
import type { useManagedRoots } from "./useManagedRoots";
import type { useSessionList } from "./useSessionList";
import type { useAppServices } from "./useAppServices";
import type { useSessionCacheState } from "./useSessionCacheState";
import type { useGit } from "./useGit";
import type { useExternalSessionImport } from "./useExternalSessionImport";
import type { useSessionMessaging } from "./useSessionMessaging";
import type { useAgentCatalog } from "./useAgentCatalog";
import type { useActionHandlers } from "./useActionHandlers";
import type { usePlugins } from "./usePlugins";
import type { useManagedRootActions } from "./useManagedRootActions";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
  relayConnectionApi: ReturnType<typeof useRelayConnection>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  sessionListApi: ReturnType<typeof useSessionList>;
  appServicesApi: ReturnType<typeof useAppServices>;
  sessionCacheStateApi: ReturnType<typeof useSessionCacheState>;
  gitApi: ReturnType<typeof useGit>;
  externalSessionImportApi: ReturnType<typeof useExternalSessionImport>;
  sessionMessagingApi: ReturnType<typeof useSessionMessaging>;
  agentCatalogApi: ReturnType<typeof useAgentCatalog>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
  pluginsApi: ReturnType<typeof usePlugins>;
  managedRootActionsApi: ReturnType<typeof useManagedRootActions>;
};

export function useWorkspaceEvents({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, projectTreeApi, fileViewerStateApi, relayConnectionApi, managedRootsApi, sessionListApi, appServicesApi, sessionCacheStateApi, gitApi, externalSessionImportApi, sessionMessagingApi, agentCatalogApi, actionHandlersApi, pluginsApi, managedRootActionsApi }: Deps) {
  const { boundSessionByRootRef, cancelRequestedBySessionRef, currentSessionRef, drawerSessionByRootRef, fileRef, invalidTreeCacheKeysRef, loadedSessionRef, loadingSessionRef, managedRootIdsRef, optimisticDequeuedIdsRef, pendingBySessionRef, pendingDraftRef, pendingRequestRef, queueFrozenBySessionRef, queuedMessagesBySessionRef, selectedDirRef, selectedSessionByRootRef, selectedSessionRef, sessionCacheRef, suppressedAutoBindSessionByRootRef, t } = appFoundationApi;
  const { remotePhone } = workbenchLayoutApi;
  const { currentRootId, currentRootIdRef } = currentRootApi;
  const { bumpCacheVersion, resolveRootForSessionKey, rootSessionKey, setBoundSessionForRoot, setDrawerSessionForRoot, setQueueVersion, setSelectedSession, setSlashCommandResults } = sessionSelectionApi;
  const { refreshTreeDir, treeCacheKey } = projectTreeApi;
  const { refreshCurrentFileContent, setStatus } = fileViewerStateApi;
  const { handleRelayWebSocketClosed } = relayConnectionApi;
  const { applyManagedRootRename } = managedRootsApi;
  const { loadMultiProjectSessionGroups, loadSessionsForRoot, multiProjectSessionsEnabled, refreshMultiProjectReplyingSessions, sessionListModeRef, sessionsRef, setMultiProjectSessionPending, setSessions } = sessionListApi;
  const { playCompletionSound, refreshRelatedWorktree, setUpdateState } = appServicesApi;
  const { appendAgentChunkForSession, appendCompactNoticeForSession, appendPlanUpdateForSession, appendThoughtChunkForSession, appendTodoUpdateForSession, appendToolCallForSession, attachContextWindowToLatestAssistant, clearSessionStale, markSessionStale, promotePendingSessionForRoot, resolvePendingForSession, restoreActiveSession, setSelectedPendingByKey, updateSessionAgentForKey, updateSessionRelatedFilesForKey, updateSessionRelatedWorktreeForKey } = sessionCacheStateApi;
  const { gitDiff, refreshGitStatus, setGitDiff } = gitApi;
  const { externalImportAgentRef, loadExternalSessions, setConfirmingExternalImport, setImportingExternalSessionKeys, setSelectedExternalImportKeys } = externalSessionImportApi;
  const { markSessionPending } = sessionMessagingApi;
  const { setAgentsVersion } = agentCatalogApi;
  const { openProject } = actionHandlersApi;
  const { invalidatePluginsForRoot } = pluginsApi;
  const { refreshManagedRoots } = managedRootActionsApi;

  useEffect(() => {
    if (!currentRootId) return;
    let cancelled = false;
    const {
      advanceTurnVersion,
      reloadSessionForReplay,
      replayTargetsForAllRoots,
      refreshSessionRelatedFiles,
    } = createSessionReplay({
      rootSessionKey,
      isCancelled: () => cancelled,
      sessionCacheRef,
      loadingSessionRef,
      restoreActiveSession,
      loadedSessionRef,
      clearSessionStale,
      selectedSessionRef,
      setSelectedSession,
      boundSessionByRootRef,
      setDrawerSessionForRoot,
      selectedSessionByRootRef,
      drawerSessionByRootRef,
      currentRootIdRef,
      managedRootIdsRef,
      markSessionStale,
      updateSessionRelatedFilesForKey,
    });

    const { handleSessionStreamDone, handleSessionStream } =
      createSessionStreamHandlers({
        rootSessionKey,
        cancelRequestedBySessionRef,
        pendingBySessionRef,
        queuedMessagesBySessionRef,
        queueFrozenBySessionRef,
        optimisticDequeuedIdsRef,
        markSessionPending,
        sessionCacheRef,
        setSelectedPendingByKey,
        setSelectedSession,
        currentRootIdRef,
        drawerSessionByRootRef,
        setDrawerSessionForRoot,
        setSessions,
        setMultiProjectSessionPending,
        bumpCacheVersion,
        resolveRootForSessionKey,
        pendingDraftRef,
        suppressedAutoBindSessionByRootRef,
        boundSessionByRootRef,
        setBoundSessionForRoot,
        selectedSessionRef,
        t,
        promotePendingSessionForRoot,
        appendAgentChunkForSession,
        appendThoughtChunkForSession,
        appendToolCallForSession,
        appendTodoUpdateForSession,
        appendPlanUpdateForSession,
        appendCompactNoticeForSession,
        attachContextWindowToLatestAssistant,
      });

    const { handleSlashCommandStream, handleSlashCommandDone } =
      createSlashCommandHandlers({
        resolveRootForSessionKey,
        currentRootIdRef,
        rootSessionKey,
        setSlashCommandResults,
        t,
      });

    const { handleFileChangedBatch, handleFileChanged } =
      createFileChangeHandlers({
        selectedDirRef,
        invalidatePluginsForRoot,
        fileRef,
        currentRootIdRef,
        refreshCurrentFileContent,
        refreshGitStatus,
        setGitDiff,
        gitDiff,
        invalidTreeCacheKeysRef,
        treeCacheKey,
        refreshTreeDir,
      });

    const handleSessionLifecycle = createSessionLifecycleHandler({
      currentRootIdRef,
      loadSessionsForRoot,
      sessionListModeRef,
      externalImportAgentRef,
      setImportingExternalSessionKeys,
      setSelectedExternalImportKeys,
      setConfirmingExternalImport,
      loadExternalSessions,
      multiProjectSessionsEnabled,
      loadMultiProjectSessionGroups,
      rootSessionKey,
      optimisticDequeuedIdsRef,
      queueFrozenBySessionRef,
      queuedMessagesBySessionRef,
      setQueueVersion,
      pendingRequestRef,
      pendingBySessionRef,
      setMultiProjectSessionPending,
      pendingDraftRef,
      promotePendingSessionForRoot,
      sessionCacheRef,
      bumpCacheVersion,
      drawerSessionByRootRef,
      setDrawerSessionForRoot,
      resolveRootForSessionKey,
      playCompletionSound,
      handleSessionStreamDone,
      advanceTurnVersion,
      reloadSessionForReplay,
      isCancelled: () => cancelled,
      markSessionStale,
      sessionsRef,
      refreshMultiProjectReplyingSessions,
      currentSessionRef,
      selectedSessionRef,
      t,
      updateSessionAgentForKey,
      setSelectedSession,
      boundSessionByRootRef,
      refreshRelatedWorktree,
      refreshSessionRelatedFiles,
      updateSessionRelatedWorktreeForKey,
    });
    const handleWorkspaceEvent = createWorkspaceEventHandler({
      applyManagedRootRename,
      currentRootIdRef,
      onOpenProject: openProject,
      refreshManagedRoots,
      setAgentsVersion,
      setUpdateState,
    });
    const handleConnectionEvent = createConnectionEventHandler({
      setStatus,
      setAgentsVersion,
      refreshManagedRoots,
      currentRootIdRef,
      sessionsRef,
      loadSessionsForRoot,
      multiProjectSessionsEnabled: multiProjectSessionsEnabled || remotePhone,
      refreshMultiProjectReplyingSessions,
      loadMultiProjectSessionGroups,
      replayTargetsForAllRoots,
      handleRelayWebSocketClosed,
    });
    const unsubscribeEvents = sessionService.subscribeEvents((event) => {
      const payload = (event.payload || {}) as any;
      switch (event.type) {
        case "ws.connecting":
        case "ws.connected":
        case "ws.reconnecting":
        case "ws.reconnected":
        case "ws.closed":
          handleConnectionEvent(event);
          break;

        case "root.changed":
        case "agent.status.changed":
        case "app.update":
        case "github.import":
          handleWorkspaceEvent(event);
          break;
        case "session.imported":
        case "session.created":
        case "session.queue.updated":
        case "session.accepted":
        case "session.error":
        case "session.done":
        case "session.user_message":
        case "session.meta.updated":
        case "session.related_files.updated":
          handleSessionLifecycle(event);
          break;

        case "session.stream":
          handleSessionStream(payload);
          break;
        case "session.slash_command.stream":
          handleSlashCommandStream(payload);
          break;
        case "session.slash_command.done":
          handleSlashCommandDone(payload);
          break;

        case "file.changed.batch":
          handleFileChangedBatch(payload);
          break;
        case "file.changed":
          handleFileChanged(payload);
          break;
      }
    });
    void loadSessionsForRoot(currentRootId, { replace: true });
    return () => {
      cancelled = true;
      unsubscribeEvents();
    };
  }, [
    currentRootId,
    loadExternalSessions,
    loadMultiProjectSessionGroups,
    loadSessionsForRoot,
    multiProjectSessionsEnabled,
    remotePhone,
    refreshMultiProjectReplyingSessions,
    rootSessionKey,
    resolveRootForSessionKey,
    promotePendingSessionForRoot,
    appendAgentChunkForSession,
    appendThoughtChunkForSession,
    appendToolCallForSession,
    appendTodoUpdateForSession,
    appendPlanUpdateForSession,
    appendCompactNoticeForSession,
    clearSessionStale,
    markSessionPending,
    markSessionStale,
    resolvePendingForSession,
    setSelectedPendingByKey,
    setBoundSessionForRoot,
    setDrawerSessionForRoot,
    setMultiProjectSessionPending,
    refreshManagedRoots,
    handleRelayWebSocketClosed,
    invalidatePluginsForRoot,
    refreshTreeDir,
    refreshCurrentFileContent,
    refreshGitStatus,
    refreshManagedRoots,
    updateSessionRelatedWorktreeForKey,
    updateSessionRelatedFilesForKey,
    updateSessionAgentForKey,
    treeCacheKey,
    t,
  ]);
}
