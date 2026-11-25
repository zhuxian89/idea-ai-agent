import React, { useCallback, useEffect, useMemo } from "react";
import {
  sessionService,
  setCachedSessionRelatedFiles,
  type RelatedFile,
} from "../../services/session";
import { type ProjectTreeTab } from "../../components/FileTree";
import { RootWorktreePanel } from "../../components/RootWorktreePanel";
import { normalizePath } from "../fileNavigation";
import { useRelatedFileStats } from "../../hooks/useRelatedFileStats";
import { RootRelatedFilesPanel } from "../../components/RootRelatedFilesPanel";
import { RootGitSidebarPanel } from "../../components/RootGitSidebarPanel";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useProjectTree } from "./useProjectTree";
import type { usePluginState } from "./usePluginState";
import type { useFileViewerState } from "./useFileViewerState";
import type { useManagedRoots } from "./useManagedRoots";
import type { useAppServices } from "./useAppServices";
import type { useSessionCacheState } from "./useSessionCacheState";
import type { useGit } from "./useGit";
import type { useActionHandlers } from "./useActionHandlers";
import type { useGitFileStats } from "./useGitFileStats";
import type { useSessionRestore } from "./useSessionRestore";
import type { useSessionViewModel } from "./useSessionViewModel";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  pluginStateApi: ReturnType<typeof usePluginState>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  appServicesApi: ReturnType<typeof useAppServices>;
  sessionCacheStateApi: ReturnType<typeof useSessionCacheState>;
  gitApi: ReturnType<typeof useGit>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
  gitFileStatsApi: ReturnType<typeof useGitFileStats>;
  sessionRestoreApi: ReturnType<typeof useSessionRestore>;
  sessionViewModelApi: ReturnType<typeof useSessionViewModel>;
};

export function useProjectSidebarModel({ appFoundationApi, currentRootApi, sessionSelectionApi, projectTreeApi, pluginStateApi, fileViewerStateApi, managedRootsApi, appServicesApi, sessionCacheStateApi, gitApi, actionHandlersApi, gitFileStatsApi, sessionRestoreApi, sessionViewModelApi }: Deps) {
  const { lastMainSessionSnapshotRef, selectedDirRef, t } = appFoundationApi;
  const { currentRootId, currentRootIdRef } = currentRootApi;
  const { selectedSession } = sessionSelectionApi;
  const { gitHistoryExpandedByRoot, gitStatusExpandedByRoot, projectTreeTab, refreshTreeDir, relatedSelectedFileKey, setGitHistoryExpandedByRoot, setGitStatusExpandedByRoot } = projectTreeApi;
  const { pendingPluginTrust } = pluginStateApi;
  const { file } = fileViewerStateApi;
  const { findManagedRootByPath, managedRootByIdRef } = managedRootsApi;
  const { expandedWorktreeByRoot, loadProjectTreeWorktreeStatus, loadProjectTreeWorktrees, setExpandedWorktreeByRoot, worktreeErrorByRoot, worktreeItemsByRoot, worktreeLoadingByRoot, worktreeStatusByPath, worktreeStatusLoadingByPath } = appServicesApi;
  const { updateSessionRelatedFilesForKey } = sessionCacheStateApi;
  const { gitDiff, gitHistory, gitHistoryByRoot, gitHistoryLoading, gitHistoryLoadingByRoot, gitHistoryLoadingMore, gitStatus, gitStatusByRoot, gitStatusLoading, gitStatusLoadingByRoot, handleGitCommit, handleGitDiscardItem, handleGitPull, handleGitPush, handleGitStageItem, handleGitUnstageItem, loadMoreGitHistory, openGitCommitDiff, openGitDiff, refreshGitHistory, refreshGitStatus, switchGitBranch } = gitApi;
  const { actionHandlers } = actionHandlersApi;
  const { gitFileStatsByPath } = gitFileStatsApi;
  const { selectedSessionSnapshot } = sessionRestoreApi;
  const { drawerSessionSnapshot, handleRemoveSessionRelatedFile, handleSelectedSessionFileClick } = sessionViewModelApi;

  const gitStatusAvailable = gitStatus?.available === true;
  const gitHistoryAvailable = gitHistory?.available === true;
  const gitStatusExpanded = currentRootId
    ? gitStatusExpandedByRoot[currentRootId] !== false
    : true;
  const gitHistoryExpandedCommits = currentRootId
    ? gitHistoryExpandedByRoot[currentRootId] || {}
    : {};
  const shouldRenderGitPanel = gitStatusLoading || gitStatusAvailable;
  const shouldRenderGitHistoryPanel =
    gitHistoryLoading ||
    (gitHistoryAvailable && (gitHistory?.items.length || 0) > 0);
  const activePendingPluginTrust =
    pendingPluginTrust && pendingPluginTrust.rootId === currentRootId
      ? pendingPluginTrust
      : null;
  const relatedSessionSnapshot =
    selectedSessionSnapshot ||
    drawerSessionSnapshot ||
    lastMainSessionSnapshotRef.current;
  const relatedSessionRootId =
    (relatedSessionSnapshot?.root_id as string | undefined) ||
    (selectedSession?.root_id as string | undefined) ||
    currentRootId;
  const relatedSessionKey =
    relatedSessionSnapshot?.key || relatedSessionSnapshot?.session_key;
  const relatedSelectedPath = gitDiff?.path || file?.path || "";
  const relatedWorktree = relatedSessionSnapshot?.related_worktree || null;
  const refreshProjectTreeRelatedFiles = useCallback(async () => {
    try {
      const root = relatedSessionRootId || currentRootId || "";
      const sessionKey = String(relatedSessionKey || "").trim();
      if (!root || !sessionKey) {
        return;
      }
      const relatedFiles = await sessionService.getSessionRelatedFiles(
        root,
        sessionKey,
      );
      await setCachedSessionRelatedFiles(root, sessionKey, relatedFiles);
      updateSessionRelatedFilesForKey(root, sessionKey, relatedFiles);
    } catch (error) {
      console.error("[session.related_files] manual refresh failed", { error });
    }
  }, [
    currentRootId,
    relatedSessionKey,
    relatedSessionRootId,
    updateSessionRelatedFilesForKey,
  ]);
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
        case "related":
          await Promise.all([
            refreshProjectTreeRelatedFiles(),
            refreshGitStatus(root),
          ]);
      }
    },
    [
      expandedWorktreeByRoot,
      loadProjectTreeWorktreeStatus,
      loadProjectTreeWorktrees,
      refreshGitHistory,
      refreshGitStatus,
      refreshProjectTreeRelatedFiles,
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
  const selectedSessionRelatedFiles = useMemo(() => {
    const rawRelated =
      relatedSessionSnapshot?.related_files ||
      (relatedSessionSnapshot as any)?.outputs ||
      [];
    return (Array.isArray(rawRelated) ? rawRelated : [])
      .map(
        (
          file:
            | RelatedFile
            | string
            | {
                path?: unknown;
                name?: unknown;
                head?: unknown;
                repo_path?: unknown;
                repo_name?: unknown;
                repo_kind?: unknown;
                root_id?: unknown;
              },
        ) => {
          const path =
            typeof file === "string"
              ? file
              : typeof file?.path === "string"
                ? file.path
                : "";
          const rawName =
            typeof file !== "string" ? (file as { name?: unknown }).name : "";
          const name =
            typeof rawName === "string"
              ? rawName
              : path.split("/").pop() || path;
          const head =
            typeof file !== "string" && typeof file?.head === "string"
              ? file.head
              : "";
          const repoPath =
            typeof file !== "string" && typeof file?.repo_path === "string"
              ? file.repo_path
              : "";
          const repoName =
            typeof file !== "string" && typeof file?.repo_name === "string"
              ? file.repo_name
              : repoPath.split(/[\\/]/).filter(Boolean).pop() || "";
          const repoKind =
            typeof file !== "string" && typeof file?.repo_kind === "string"
              ? file.repo_kind
              : "";
          const rootID =
            typeof file !== "string" && typeof file?.root_id === "string"
              ? file.root_id
              : "";
          return {
            path,
            name,
            head,
            repo_path: repoPath,
            repo_name: repoName,
            repo_kind: repoKind,
            root_id: rootID,
          };
        },
      )
      .filter((file) => file.path);
  }, [relatedSessionSnapshot]);
  const selectedSessionRelatedFileGroups = useMemo(() => {
    const currentRootPath = normalizePath(
      managedRootByIdRef.current[relatedSessionRootId || currentRootId || ""]
        ?.root_path || "",
    );
    const repoGroups = selectedSessionRelatedFiles.reduce<
      Array<{
        key: string;
        repoPath: string;
        repoName: string;
        repoKind: string;
        headGroups: Array<{
          key: string;
          head: string;
          files: typeof selectedSessionRelatedFiles;
        }>;
      }>
    >((groups, file) => {
      const head = file.head || "";
      const rawRepoPath = file.repo_path || "";
      const isCurrentRepoRecord =
        !rawRepoPath ||
        file.repo_name === t("session.currentProject") ||
        (currentRootPath && normalizePath(rawRepoPath) === currentRootPath);
      const repoPath = isCurrentRepoRecord ? "" : rawRepoPath;
      const rawRepoKind = file.repo_kind || "";
      const repoKind =
        isCurrentRepoRecord && rawRepoKind !== "plain" ? "" : rawRepoKind;
      const repoKey = `${repoKind}\0${repoPath}`;
      let repoGroup = groups.find((group) => group.key === repoKey);
      if (!repoGroup) {
        repoGroup = {
          key: repoKey,
          repoPath,
          repoName: isCurrentRepoRecord
            ? t("session.currentProject")
            : file.repo_name ||
              repoPath.split(/[\\/]/).filter(Boolean).pop() ||
              t("session.currentProject"),
          repoKind,
          headGroups: [],
        };
        groups.push(repoGroup);
      }
      const headKey = `${repoKey}\0${head}`;
      const existing = repoGroup.headGroups.find(
        (group) => group.key === headKey,
      );
      if (existing) {
        existing.files.push(file);
      } else {
        repoGroup.headGroups.push({
          key: headKey,
          head,
          files: [file],
        });
      }
      return groups;
    }, []);
    return repoGroups.flatMap((repoGroup) =>
      repoGroup.headGroups.map((headGroup) => ({
        key: headGroup.key,
        head: headGroup.head,
        repoPath: repoGroup.repoPath,
        repoName: repoGroup.repoName,
        repoKind: repoGroup.repoKind,
        files: headGroup.files,
      })),
    );
  }, [currentRootId, relatedSessionRootId, selectedSessionRelatedFiles]);
  const gitStatsRefreshKey = useMemo(
    () =>
      Object.entries(gitFileStatsByPath)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([path, stats]) =>
            `${path}:${stats.status}:${stats.additions}:${stats.deletions}`,
        )
        .join("|"),
    [gitFileStatsByPath],
  );
  const selectedRelatedFileStatsByKey = useRelatedFileStats(
    relatedSessionRootId || currentRootId,
    selectedSessionRelatedFiles,
    gitStatsRefreshKey,
  );
  const renderRootRelatedContent = (root: string): React.ReactNode => {
    if (!root || root !== currentRootId || root !== relatedSessionRootId) {
      return null;
    }
    return (
      <RootRelatedFilesPanel
        root={root}
        rootPath={managedRootByIdRef.current[root]?.root_path || ""}
        hasSessionSnapshot={Boolean(relatedSessionSnapshot)}
        fileCount={selectedSessionRelatedFiles.length}
        groups={selectedSessionRelatedFileGroups}
        relatedFileStatsByKey={selectedRelatedFileStatsByKey}
        gitFileStatsByPath={gitFileStatsByPath}
        relatedSelectedFileKey={relatedSelectedFileKey}
        relatedSelectedPath={relatedSelectedPath}
        onSelectFile={handleSelectedSessionFileClick}
        onRemoveFile={(file) => {
          void handleRemoveSessionRelatedFile(
            relatedSessionRootId,
            relatedSessionKey,
            file.path,
            file.head,
            file.repo_path,
            file.repo_kind,
          );
        }}
      />
    );
  };
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

  return { activePendingPluginTrust, handleProjectTreeRefresh, renderRootGitContent, renderRootRelatedContent, renderRootWorktreeContent };
}
