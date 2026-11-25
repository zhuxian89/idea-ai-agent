import { useProjectWorktrees } from "../useProjectWorktrees";
import { useAppUpdate } from "../useAppUpdate";
import { useCompletionSound } from "../useCompletionSound";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useProjectTree } from "./useProjectTree";

type Deps = {
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
};

export function useAppServices({ currentRootApi, projectTreeApi }: Deps) {
  const { currentRootId } = currentRootApi;
  const { projectTreeTab } = projectTreeApi;

  const {
    worktreeItemsByRoot,
    worktreeLoadingByRoot,
    worktreeErrorByRoot,
    expandedWorktreeByRoot,
    setExpandedWorktreeByRoot,
    worktreeStatusByPath,
    worktreeStatusLoadingByPath,
    refreshRelatedWorktree,
    loadProjectTreeWorktrees,
    loadProjectTreeWorktreeStatus,
  } = useProjectWorktrees({ currentRootId, projectTreeTab });
  const { updateState, setUpdateState, updateSubmitting, handleStartUpdate } =
    useAppUpdate();
  const { playCompletionSound } = useCompletionSound();

  return { expandedWorktreeByRoot, handleStartUpdate, loadProjectTreeWorktreeStatus, loadProjectTreeWorktrees, playCompletionSound, refreshRelatedWorktree, setExpandedWorktreeByRoot, setUpdateState, updateState, updateSubmitting, worktreeErrorByRoot, worktreeItemsByRoot, worktreeLoadingByRoot, worktreeStatusByPath, worktreeStatusLoadingByPath };
}
