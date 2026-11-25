import { useWorkspaceGit } from "../useWorkspaceGit";
import type { useAppFoundation } from "./useAppFoundation";
import type { useWorkbenchLayout } from "./useWorkbenchLayout";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useProjectTree } from "./useProjectTree";
import type { useFileViewerState } from "./useFileViewerState";
import type { useManagedRoots } from "./useManagedRoots";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
};

export function useGit({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, projectTreeApi, fileViewerStateApi, managedRootsApi }: Deps) {
  const { fileOpenRequestRef, selectedDirRef, t } = appFoundationApi;
  const { isMobile, setIsLeftOpen } = workbenchLayoutApi;
  const { currentRootIdRef, replaceURLState, setCurrentRootId } = currentRootApi;
  const { setMainViewPreferenceForRoot, setSelectedSession, setSelectedSessionLoading } = sessionSelectionApi;
  const { refreshTreeDir, setRelatedSelectedFileKey } = projectTreeApi;
  const { setFile } = fileViewerStateApi;
  const { managedRootByIdRef } = managedRootsApi;

  const {
    gitStatus,
    setGitStatus,
    gitStatusLoading,
    gitHistory,
    setGitHistory,
    gitHistoryLoading,
    gitHistoryLoadingMore,
    gitStatusByRoot,
    gitStatusLoadingByRoot,
    gitHistoryByRoot,
    gitHistoryLoadingByRoot,
    gitDiff,
    setGitDiff,
    refreshGitStatus,
    refreshGitHistory,
    loadMoreGitHistory,
    openGitDiff,
    openGitCommitDiff,
    switchGitBranch,
    handleGitPull,
    handleGitPush,
    handleGitCommit,
    handleGitStageItem,
    handleGitUnstageItem,
    handleGitDiscardItem,
  } = useWorkspaceGit({
    currentRootIdRef,
    managedRootByIdRef,
    fileOpenRequestRef,
    setRelatedSelectedFileKey,
    setMainViewPreferenceForRoot,
    setSelectedSession,
    setSelectedSessionLoading,
    setFile,
    replaceURLState,
    setCurrentRootId,
    isMobile,
    setIsLeftOpen,
    refreshTreeDir,
    selectedDirRef,
    t,
  });

  return { gitDiff, gitHistory, gitHistoryByRoot, gitHistoryLoading, gitHistoryLoadingByRoot, gitHistoryLoadingMore, gitStatus, gitStatusByRoot, gitStatusLoading, gitStatusLoadingByRoot, handleGitCommit, handleGitDiscardItem, handleGitPull, handleGitPush, handleGitStageItem, handleGitUnstageItem, loadMoreGitHistory, openGitCommitDiff, openGitDiff, refreshGitHistory, refreshGitStatus, setGitDiff, setGitHistory, setGitStatus, switchGitBranch };
}
