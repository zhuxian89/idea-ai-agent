import React, { useCallback, useState } from "react";
import { type MessageKey, type MessageParams } from "../i18n";
import { ProtectedAPIError } from "../services/api";
import { reportError } from "../services/error";
import { type FilePayload } from "../services/file";
import {
  buildGitDiffCacheSignature,
  checkoutGitBranch,
  clearGitHistoryCache,
  commitGit,
  discardGitItem,
  fetchGitCommitDiff,
  fetchGitDiff,
  fetchGitHistory,
  fetchGitStatus,
  getCachedGitHistory,
  getCachedGitHistoryHead,
  pullGit,
  pushGit,
  stageGitItem,
  unstageGitItem,
  type GitDiffPayload,
  type GitHistoryItem,
  type GitHistoryPayload,
  type GitStatusItem,
  type GitStatusPayload,
} from "../services/git";
import { ManagedRootPayload } from "./projectModel";
import { URLState } from "./runtimeTypes";
import { SessionItem } from "./sessionModel";

type Options = {
  currentRootIdRef: React.RefObject<string | null>;
  managedRootByIdRef: React.RefObject<Record<string, ManagedRootPayload>>;
  fileOpenRequestRef: React.RefObject<number>;
  setRelatedSelectedFileKey: React.Dispatch<React.SetStateAction<string>>;
  setMainViewPreferenceForRoot: (
    rootID: string | null | undefined,
    preference: "session" | "file" | "directory" | "git-diff",
  ) => void;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionItem | null>>;
  setSelectedSessionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setFile: React.Dispatch<React.SetStateAction<FilePayload | null>>;
  replaceURLState: (next: URLState) => void;
  setCurrentRootId: React.Dispatch<React.SetStateAction<string | null>>;
  isMobile: boolean;
  setIsLeftOpen: React.Dispatch<React.SetStateAction<boolean>>;
  refreshTreeDir: (
    rootID: string,
    dirPath: string,
    syncMain: boolean,
  ) => Promise<void>;
  selectedDirRef: React.RefObject<string | null>;
  t: (key: MessageKey, params?: MessageParams) => string;
};

export function useWorkspaceGit({
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
}: Options) {
  const [gitStatus, setGitStatus] = useState<GitStatusPayload | null>(null);

  const [gitStatusLoading, setGitStatusLoading] = useState(false);

  const [gitHistory, setGitHistory] = useState<GitHistoryPayload | null>(null);

  const [gitHistoryLoading, setGitHistoryLoading] = useState(false);

  const [gitHistoryLoadingMore, setGitHistoryLoadingMore] = useState(false);

  const [gitStatusByRoot, setGitStatusByRoot] = useState<
    Record<string, GitStatusPayload | null>
  >({});

  const [gitStatusLoadingByRoot, setGitStatusLoadingByRoot] = useState<
    Record<string, boolean>
  >({});

  const [gitHistoryByRoot, setGitHistoryByRoot] = useState<
    Record<string, GitHistoryPayload | null>
  >({});

  const [gitHistoryLoadingByRoot, setGitHistoryLoadingByRoot] = useState<
    Record<string, boolean>
  >({});

  const [gitDiff, setGitDiff] = useState<GitDiffPayload | null>(null);

  const refreshGitStatus = useCallback(async (rootID: string) => {
    if (!rootID) {
      if (!currentRootIdRef.current) {
        setGitStatus(null);
        setGitStatusLoading(false);
      }
      return null;
    }
    const shouldApply = () => currentRootIdRef.current === rootID;
    if (managedRootByIdRef.current[rootID]?.is_git_repo !== true) {
      const fallback = {
        available: false,
        dirty_count: 0,
        items: [],
      } as GitStatusPayload;
      setGitStatusByRoot((prev) => ({ ...prev, [rootID]: fallback }));
      setGitStatusLoadingByRoot((prev) => ({ ...prev, [rootID]: false }));
      if (shouldApply()) {
        setGitStatus(fallback);
        setGitStatusLoading(false);
      }
      return fallback;
    }
    setGitStatusLoadingByRoot((prev) => ({ ...prev, [rootID]: true }));
    if (shouldApply()) {
      setGitStatusLoading(true);
    }
    try {
      const next = await fetchGitStatus(rootID);
      setGitStatusByRoot((prev) => ({ ...prev, [rootID]: next }));
      if (shouldApply()) {
        setGitStatus(next);
      }
      return next;
    } catch (err) {
      console.error("[git.status] failed", { rootID, err });
      const fallback = {
        available: false,
        dirty_count: 0,
        items: [],
      } as GitStatusPayload;
      setGitStatusByRoot((prev) => ({ ...prev, [rootID]: fallback }));
      if (shouldApply()) {
        setGitStatus(fallback);
      }
      return fallback;
    } finally {
      setGitStatusLoadingByRoot((prev) => ({ ...prev, [rootID]: false }));
      if (shouldApply()) {
        setGitStatusLoading(false);
      }
    }
  }, []);

  const refreshGitHistory = useCallback(
    async (
      rootID: string,
      options?: { force?: boolean; waitForIncremental?: boolean },
    ) => {
      if (!rootID) {
        setGitHistory(null);
        setGitHistoryLoading(false);
        return null;
      }
      if (!options?.force) {
        const cachedHead = getCachedGitHistoryHead(rootID);
        if (cachedHead && cachedHead.items.length > 0) {
          setGitHistoryByRoot((prev) => ({ ...prev, [rootID]: cachedHead }));
          if (currentRootIdRef.current === rootID) {
            setGitHistory(cachedHead);
          }
          const newest = cachedHead.items[0]?.hash || "";
          if (newest) {
            const refreshAfterNewest = async () => {
              try {
                const next = await fetchGitHistory(rootID, {
                  afterCommit: newest,
                });
                if (next.commit_missing || (next.items || []).length > 0) {
                  clearGitHistoryCache(rootID);
                  const fresh = await fetchGitHistory(rootID, { force: true });
                  setGitHistoryByRoot((prev) => ({ ...prev, [rootID]: fresh }));
                  if (currentRootIdRef.current === rootID) {
                    setGitHistory(fresh);
                  }
                  return fresh;
                }
                const fresh = getCachedGitHistoryHead(rootID) || next;
                setGitHistoryByRoot((prev) => ({ ...prev, [rootID]: fresh }));
                if (currentRootIdRef.current === rootID) {
                  setGitHistory(fresh);
                }
                return fresh;
              } catch (err) {
                console.error("[git.history.after] failed", {
                  rootID,
                  afterCommit: newest,
                  err,
                });
                return cachedHead;
              }
            };
            if (options?.waitForIncremental) {
              return refreshAfterNewest();
            }
            void refreshAfterNewest();
          }
          return cachedHead;
        }
      }
      setGitHistoryLoadingByRoot((prev) => ({ ...prev, [rootID]: true }));
      if (currentRootIdRef.current === rootID) {
        setGitHistoryLoading(true);
      }
      try {
        const next = await fetchGitHistory(rootID, { force: options?.force });
        if (next.commit_missing) {
          clearGitHistoryCache(rootID);
          const fresh = await fetchGitHistory(rootID, { force: true });
          setGitHistoryByRoot((prev) => ({ ...prev, [rootID]: fresh }));
          if (currentRootIdRef.current === rootID) {
            setGitHistory(fresh);
          }
          return fresh;
        }
        setGitHistoryByRoot((prev) => ({ ...prev, [rootID]: next }));
        if (currentRootIdRef.current === rootID) {
          setGitHistory(next);
        }
        return next;
      } catch (err) {
        console.error("[git.history] failed", { rootID, err });
        const fallback = {
          available: false,
          items: [],
          has_more: false,
        } as GitHistoryPayload;
        setGitHistoryByRoot((prev) => ({ ...prev, [rootID]: fallback }));
        if (currentRootIdRef.current === rootID) {
          setGitHistory(fallback);
        }
        return fallback;
      } finally {
        setGitHistoryLoadingByRoot((prev) => ({ ...prev, [rootID]: false }));
        if (currentRootIdRef.current === rootID) {
          setGitHistoryLoading(false);
        }
      }
    },
    [],
  );

  const loadMoreGitHistory = useCallback(
    async (targetRootID?: string) => {
      const rootID = targetRootID || currentRootIdRef.current;
      if (!rootID || gitHistoryLoadingMore) {
        return;
      }
      const currentItems =
        (targetRootID ? gitHistoryByRoot[rootID]?.items : gitHistory?.items) ||
        [];
      const beforeCommit = currentItems[currentItems.length - 1]?.hash || "";
      if (!beforeCommit) {
        return;
      }
      setGitHistoryLoadingMore(true);
      try {
        const next = await fetchGitHistory(rootID, { beforeCommit });
        if (next.commit_missing) {
          clearGitHistoryCache(rootID);
          const fresh = await fetchGitHistory(rootID, { force: true });
          setGitHistoryByRoot((prev) => ({ ...prev, [rootID]: fresh }));
          if (currentRootIdRef.current === rootID) {
            setGitHistory(fresh);
          }
          return;
        }
        const cached = getCachedGitHistory(rootID);
        const loadedCount = currentItems.length + next.items.length;
        if (currentRootIdRef.current === rootID) {
          if (cached) {
            setGitHistory({
              ...cached,
              items: cached.items.slice(0, loadedCount),
              has_more: cached.items.length > loadedCount || cached.has_more,
            });
          } else {
            setGitHistory(next);
          }
        }
        setGitHistoryByRoot((prev) => ({
          ...prev,
          [rootID]: cached
            ? {
                ...cached,
                items: cached.items.slice(0, loadedCount),
                has_more: cached.items.length > loadedCount || cached.has_more,
              }
            : next,
        }));
      } catch (err) {
        console.error("[git.history.more] failed", {
          rootID,
          beforeCommit,
          err,
        });
      } finally {
        setGitHistoryLoadingMore(false);
      }
    },
    [gitHistory, gitHistoryByRoot, gitHistoryLoadingMore],
  );

  const openGitDiff = useCallback(
    async (
      rootID: string,
      item: GitStatusItem,
      options?: { preserveRelatedSelection?: boolean; repoPath?: string },
    ) => {
      if (!rootID || !item?.path) {
        return;
      }
      fileOpenRequestRef.current += 1;
      if (!options?.preserveRelatedSelection) {
        setRelatedSelectedFileKey("");
      }
      setMainViewPreferenceForRoot(rootID, "git-diff");
      setSelectedSession(null);
      setSelectedSessionLoading(false);
      setFile(null);
      setGitDiff(null);
      replaceURLState({
        root: rootID,
        file: "",
        session: "",
        cursor: 0,
        pluginQuery: {},
      });
      try {
        const next = await fetchGitDiff(rootID, item.path, {
          cacheSignature: buildGitDiffCacheSignature(item),
          repoPath: options?.repoPath,
        });
        setGitDiff(next);
        if (currentRootIdRef.current !== rootID) {
          setCurrentRootId(rootID);
        }
        if (isMobile) {
          setIsLeftOpen(false);
        }
      } catch (err) {
        console.error("[git.diff] failed", { rootID, path: item.path, err });
      }
    },
    [isMobile, replaceURLState, setMainViewPreferenceForRoot],
  );

  const openGitCommitDiff = useCallback(
    async (rootID: string, commit: GitHistoryItem, item: GitStatusItem) => {
      if (!rootID || !commit?.hash || !item?.path) {
        return;
      }
      fileOpenRequestRef.current += 1;
      setRelatedSelectedFileKey("");
      setMainViewPreferenceForRoot(rootID, "git-diff");
      setSelectedSession(null);
      setSelectedSessionLoading(false);
      setFile(null);
      setGitDiff(null);
      replaceURLState({
        root: rootID,
        file: "",
        session: "",
        cursor: 0,
        pluginQuery: {},
      });
      try {
        const next = await fetchGitCommitDiff(rootID, commit.hash, item);
        setGitDiff(next);
        if (currentRootIdRef.current !== rootID) {
          setCurrentRootId(rootID);
        }
        if (isMobile) {
          setIsLeftOpen(false);
        }
      } catch (err) {
        console.error("[git.commit.diff] failed", {
          rootID,
          commit: commit.hash,
          path: item.path,
          err,
        });
      }
    },
    [isMobile, replaceURLState, setMainViewPreferenceForRoot],
  );

  const switchGitBranch = useCallback(
    async (rootID: string, branch: string) => {
      if (!rootID || !branch) {
        return;
      }
      try {
        const nextStatus = await checkoutGitBranch(rootID, branch);
        clearGitHistoryCache(rootID);
        setGitStatusByRoot((prev) => ({ ...prev, [rootID]: nextStatus }));
        await refreshGitHistory(rootID, { force: true });
        if (currentRootIdRef.current === rootID) {
          setGitStatus(nextStatus);
          setGitDiff(null);
          setFile(null);
          await refreshTreeDir(rootID, selectedDirRef.current || ".", true);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("git.checkoutFailed");
        console.error("[git.checkout] failed", {
          rootID,
          branch,
          message,
          payload: err instanceof ProtectedAPIError ? err.payload : undefined,
          err,
        });
        reportError("git.checkout_failed", message, {
          severity: "error",
          recoverable: true,
          details: {
            root: rootID,
            branch,
            payload: err instanceof ProtectedAPIError ? err.payload : undefined,
          },
        });
        throw err;
      }
    },
    [refreshGitHistory, refreshTreeDir, t],
  );

  const applyGitActionResult = useCallback(
    async (
      rootID: string,
      nextStatus: GitStatusPayload,
      options?: { refreshHistory?: boolean; clearDiff?: boolean },
    ) => {
      clearGitHistoryCache(rootID);
      setGitStatusByRoot((prev) => ({ ...prev, [rootID]: nextStatus }));
      if (options?.refreshHistory !== false) {
        await refreshGitHistory(rootID, { force: true });
      }
      if (currentRootIdRef.current !== rootID) {
        return;
      }
      setGitStatus(nextStatus);
      if (options?.clearDiff) {
        setGitDiff(null);
      }
      await refreshTreeDir(rootID, selectedDirRef.current || ".", true);
    },
    [refreshGitHistory, refreshTreeDir],
  );

  const runGitAction = useCallback(
    async (
      rootID: string,
      action: string,
      run: () => Promise<{ status: GitStatusPayload; output?: string }>,
      options?: { refreshHistory?: boolean; clearDiff?: boolean },
    ) => {
      if (!rootID) {
        return;
      }
      try {
        const result = await run();
        await applyGitActionResult(rootID, result.status, options);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t("common.actionFailed", { action });
        console.error(`[git.${action}] failed`, {
          rootID,
          message,
          payload: err instanceof ProtectedAPIError ? err.payload : undefined,
          err,
        });
        window.alert(message);
        throw err;
      }
    },
    [applyGitActionResult, t],
  );

  const handleGitPull = useCallback(
    (rootID: string) =>
      runGitAction(rootID, "pull", () => pullGit(rootID), { clearDiff: true }),
    [runGitAction],
  );

  const handleGitPush = useCallback(
    (rootID: string) => runGitAction(rootID, "push", () => pushGit(rootID)),
    [runGitAction],
  );

  const handleGitCommit = useCallback(
    (rootID: string, message: string) =>
      runGitAction(rootID, "commit", () => commitGit(rootID, message), {
        clearDiff: true,
      }),
    [runGitAction],
  );

  const handleGitStageItem = useCallback(
    (rootID: string, item: GitStatusItem) =>
      runGitAction(rootID, "stage", () => stageGitItem(rootID, item), {
        refreshHistory: false,
        clearDiff: true,
      }),
    [runGitAction],
  );

  const handleGitUnstageItem = useCallback(
    (rootID: string, item: GitStatusItem) =>
      runGitAction(rootID, "unstage", () => unstageGitItem(rootID, item), {
        refreshHistory: false,
        clearDiff: true,
      }),
    [runGitAction],
  );

  const handleGitDiscardItem = useCallback(
    (rootID: string, item: GitStatusItem) =>
      runGitAction(rootID, "discard", () => discardGitItem(rootID, item), {
        refreshHistory: false,
        clearDiff: true,
      }),
    [runGitAction],
  );
  return {
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
  };
}

export type WorkspaceGit = ReturnType<typeof useWorkspaceGit>;
