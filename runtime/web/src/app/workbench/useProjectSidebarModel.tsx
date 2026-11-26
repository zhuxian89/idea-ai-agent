import React, { useCallback, useEffect } from "react";
import { type ProjectTreeTab } from "../../components/FileTree";
import { RootWorktreePanel } from "../../components/RootWorktreePanel";
import { RootGitSidebarPanel } from "../../components/RootGitSidebarPanel";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useProjectTree } from "./useProjectTree";
import type { usePluginState } from "./usePluginState";
import type { useManagedRoots } from "./useManagedRoots";
import type { useAppServices } from "./useAppServices";
import type { useGit } from "./useGit";
import type { useActionHandlers } from "./useActionHandlers";
import type { useSessionRestore } from "./useSessionRestore";
import type { useSessionViewModel } from "./useSessionViewModel";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  pluginStateApi: ReturnType<typeof usePluginState>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  appServicesApi: ReturnType<typeof useAppServices>;
  gitApi: ReturnType<typeof useGit>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
  sessionRestoreApi: ReturnType<typeof useSessionRestore>;
  sessionViewModelApi: ReturnType<typeof useSessionViewModel>;
};

export function useProjectSidebarModel({ appFoundationApi, currentRootApi, projectTreeApi, pluginStateApi, managedRootsApi, appServicesApi, gitApi, actionHandlersApi, sessionRestoreApi, sessionViewModelApi }: Deps) {
  const { lastMainSessionSnapshotRef, selectedDirRef } = appFoundationApi;
  const { currentRootId, currentRootIdRef } = currentRootApi;
  const { gitHistoryExpandedByRoot, gitStatusExpandedByRoot, projectTreeTab, refreshTreeDir, setGitHistoryExpandedByRoot, setGitStatusExpandedByRoot } = projectTreeApi;
  const { pendingPluginTrust } = pluginStateApi;
  const { findManagedRootByPath, managedRootByIdRef } = managedRootsApi;
  const { expandedWorktreeByRoot, loadProjectTreeWorktreeStatus, loadProjectTreeWorktrees, setExpandedWorktreeByRoot, worktreeErrorByRoot, worktreeItemsByRoot, worktreeLoadingByRoot, worktreeStatusByPath, worktreeStatusLoadingByPath } = appServicesApi;
  const { gitHistory, gitHistoryByRoot, gitHistoryLoading, gitHistoryLoadingByRoot, gitHistoryLoadingMore, gitStatus, gitStatusByRoot, gitStatusLoading, gitStatusLoadingByRoot, handleGitCommit, handleGitDiscardItem, handleGitPull, handleGitPush, handleGitStageItem, handleGitUnstageItem, loadMoreGitHistory, openGitCommitDiff, openGitDiff, refreshGitHistory, refreshGitStatus, switchGitBranch } = gitApi;
  const { actionHandlers } = actionHandlersApi;
  const { selectedSessionSnapshot } = sessionRestoreApi;
  const { drawerSessionSnapshot } = sessionViewModelApi;

  const activePendingPluginTrust =
    pendingPluginTrust && pendingPluginTrust.rootId === currentRootId
      ? pendingPluginTrust
      : null;
  const relatedSessionSnapshot =
    selectedSessionSnapshot ||
    drawerSessionSnapshot ||
    lastMainSessionSnapshotRef.current;
  const relatedWorktree = relatedSessionSnapshot?.related_worktree || null;
  const handleProjectTreeRefresh = useCallback(
    async (tab: ProjectTreeTab) => {
      const root = currentRootIdRef.current;
      if (!root) {
        return;
      }
      switch (tab) {
        case "files": {
          const dir =
            selectedDirRef.current === root
              ? "."
              : selectedDirRef.current || ".";
          await refreshTreeDir(root, dir, true);
          return;
        }
        case "git":
          await Promise.all([
            refreshGitStatus(root),
            refreshGitHistory(root, { waitForIncremental: true }),
          ]);
          return;
        case "worktrees": {
          const items = await loadProjectTreeWorktrees(root);
          const expandedPath = expandedWorktreeByRoot[root] || "";
          if (
            expandedPath &&
            items.some((item) => item.path === expandedPath)
          ) {
            await loadProjectTreeWorktreeStatus(expandedPath);
          }
          return;
        }
      }
    },
    [
      expandedWorktreeByRoot,
      loadProjectTreeWorktreeStatus,
      loadProjectTreeWorktrees,
      refreshGitHistory,
      refreshGitStatus,
      refreshTreeDir,
    ],
  );
  useEffect(() => {
    const rootID = String(relatedWorktree?.root_id || "");
    const worktreePath = String(relatedWorktree?.path || "");
    if (projectTreeTab !== "worktrees" || !rootID || !worktreePath) {
      return;
    }
    setExpandedWorktreeByRoot((prev) => {
      if (prev[rootID] === worktreePath) {
        return prev;
      }
      return { ...prev, [rootID]: worktreePath };
    });
    void loadProjectTreeWorktreeStatus(worktreePath);
  }, [
    loadProjectTreeWorktreeStatus,
    projectTreeTab,
    relatedWorktree?.path,
    relatedWorktree?.root_id,
  ]);
  const renderRootWorktreeContent = (root: string): React.ReactNode => (
    <RootWorktreePanel
      root={root}
      currentRootId={currentRootId}
      relatedPath={
        relatedWorktree?.root_id === root
          ? String(relatedWorktree?.path || "")
          : ""
      }
      items={worktreeItemsByRoot[root] || []}
      loading={worktreeLoadingByRoot[root] === true}
      error={worktreeErrorByRoot[root] || ""}
      expandedPath={expandedWorktreeByRoot[root] || ""}
      worktreeStatusByPath={worktreeStatusByPath}
      worktreeStatusLoadingByPath={worktreeStatusLoadingByPath}
      findManagedRootByPath={findManagedRootByPath}
      onToggleExpand={async (worktreePath, selected) => {
        if (selected) {
          setExpandedWorktreeByRoot((prev) => ({ ...prev, [root]: "" }));
          return;
        }
        setExpandedWorktreeByRoot((prev) => ({ ...prev, [root]: worktreePath }));
        await loadProjectTreeWorktreeStatus(worktreePath);
      }}
      onSelectDiff={(nextRoot, statusItem, options) => {
        void openGitDiff(nextRoot, statusItem, options);
      }}
      onOpenFile={(path, nextRoot) => {
        actionHandlers.open({ path, root: nextRoot });
      }}
    />
  );
  const renderRootGitContent = (root: string): React.ReactNode => (
    <RootGitSidebarPanel
      root={root}
      isGitRepo={managedRootByIdRef.current[root]?.is_git_repo === true}
      gitStatus={root === currentRootId ? gitStatus : gitStatusByRoot[root] || null}
      gitHistory={root === currentRootId ? gitHistory : gitHistoryByRoot[root] || null}
      gitStatusLoading={
        root === currentRootId
          ? gitStatusLoading
          : gitStatusLoadingByRoot[root] === true
      }
      gitHistoryLoading={
        root === currentRootId
          ? gitHistoryLoading
          : gitHistoryLoadingByRoot[root] === true
      }
      gitHistoryLoadingMore={gitHistoryLoadingMore}
      gitStatusExpanded={gitStatusExpandedByRoot[root] !== false}
      gitHistoryExpandedCommits={gitHistoryExpandedByRoot[root] || {}}
      onRefresh={() => {
        void refreshGitStatus(root);
        void refreshGitHistory(root);
      }}
      onExpandedChange={(expanded) => {
        if (!root) return;
        setGitStatusExpandedByRoot((prev) => ({ ...prev, [root]: expanded }));
      }}
      onSelectDiff={(item) => {
        if (!root) return;
        void openGitDiff(root, item);
      }}
      onOpenItem={(item) => {
        if (!root || item.is_dir === true) return;
        actionHandlers.open({ path: item.path, root });
      }}
      onDiscardItem={(item) => {
        if (!root) return;
        return handleGitDiscardItem(root, item);
      }}
      onStageItem={(item) => {
        if (!root) return;
        return item.staged === true
          ? handleGitUnstageItem(root, item)
          : handleGitStageItem(root, item);
      }}
      onPull={() => (root ? handleGitPull(root) : undefined)}
      onPush={() => (root ? handleGitPush(root) : undefined)}
      onCommit={(message) => (root ? handleGitCommit(root, message) : undefined)}
      onSwitchBranch={(branch) => (root ? switchGitBranch(root, branch) : undefined)}
      onToggleCommit={(hash) => {
        if (!root) return;
        setGitHistoryExpandedByRoot((prev) => {
          const current = prev[root] || {};
          return {
            ...prev,
            [root]: { ...current, [hash]: current[hash] !== true },
          };
        });
      }}
      onLoadMoreHistory={() => {
        void loadMoreGitHistory(root);
      }}
      onSelectCommitFile={(commit, item) => {
        if (!root) return;
        void openGitCommitDiff(root, commit, item);
      }}
    />
  );

  return { activePendingPluginTrust, handleProjectTreeRefresh, renderRootGitContent, renderRootWorktreeContent };
}
