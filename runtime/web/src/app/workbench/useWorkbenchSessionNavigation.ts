import { useRef } from "react";
import { useSessionNavigation } from "../useSessionNavigation";
import type { useAppFoundation } from "./useAppFoundation";
import type { useWorkbenchLayout } from "./useWorkbenchLayout";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useProjectTree } from "./useProjectTree";
import type { usePluginState } from "./usePluginState";
import type { useFileViewerState } from "./useFileViewerState";
import type { useSessionList } from "./useSessionList";
import type { useSessionCacheState } from "./useSessionCacheState";
import type { useGit } from "./useGit";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  pluginStateApi: ReturnType<typeof usePluginState>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
  sessionListApi: ReturnType<typeof useSessionList>;
  sessionCacheStateApi: ReturnType<typeof useSessionCacheState>;
  gitApi: ReturnType<typeof useGit>;
};

export function useWorkbenchSessionNavigation({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, projectTreeApi, pluginStateApi, fileViewerStateApi, sessionListApi, sessionCacheStateApi, gitApi }: Deps) {
  const { boundSessionByRootRef, cancelRequestedBySessionRef, drawerSessionByRootRef, fileCursorRef, fileRef, handleSelectSessionRef, loadedSessionRef, loadingSessionRef, mainViewPreferenceByRootRef, pendingBySessionRef, selectedSessionByRootRef, selectedSessionRef, sessionCacheRef, staleSessionKeysRef, t } = appFoundationApi;
  const sessionSearchTargetCounterRef = useRef(0);
  const { isMobile, setIsLeftOpen, setIsRightOpen } = workbenchLayoutApi;
  const { currentRootIdRef, replaceURLState, setCurrentRootId } = currentRootApi;
  const { bumpCacheVersion, openSessionTab, removeSessionTabs, rootSessionKey, setBoundSessionForRoot, setDrawerOpenForRoot, setDrawerSessionForRoot, setInteractionMode, setMainViewPreferenceForRoot, setOpenSessionTabsByRoot, setSelectedSession, setSelectedSessionLoading } = sessionSelectionApi;
  const { setMainEntries, setSelectedDir, setSelectedDirKey } = projectTreeApi;
  const { pluginQuery, setPluginQuery } = pluginStateApi;
  const { setFile } = fileViewerStateApi;
  const { loadSessionsForRoot, sessionsRef, setMultiProjectSessionGroups, setMultiProjectSessionPending, setSessions, setSyncingSessionKeys } = sessionListApi;
  const { clearSessionStale, isSessionStale, resolvePendingForSession, restoreActiveSession } = sessionCacheStateApi;
  const { setGitDiff } = gitApi;

  const {
    handleSelectSession,
    tryShowBoundSessionForRoot,
    handleDeleteSession,
    handleRenameSession,
    handlePinSession,
    handleSyncSession,
    handleForkAgentMessage,
  } = useSessionNavigation({
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
  });

  return { handleDeleteSession, handleForkAgentMessage, handlePinSession, handleRenameSession, handleSelectSession, handleSyncSession, tryShowBoundSessionForRoot };
}
