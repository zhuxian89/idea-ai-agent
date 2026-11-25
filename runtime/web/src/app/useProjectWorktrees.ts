import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  fetchGitStatusByPath,
  fetchGitWorktrees,
  type GitStatusPayload,
  type GitWorktreeItem,
} from "../services/git";
import { type ProjectTreeTab } from "../components/FileTree";

/**
 * Worktree lists and per-worktree git status for the project tree's "worktrees" tab,
 * plus the refresh used when a session touches a related worktree.
 */
export function useProjectWorktrees({
  currentRootId,
  projectTreeTab,
}: {
  currentRootId: string | null;
  projectTreeTab: ProjectTreeTab;
}) {
  const { t } = useI18n();
  const knownWorktreePathsRef = useRef<Set<string>>(new Set());
  const [worktreeItemsByRoot, setWorktreeItemsByRoot] = useState<
    Record<string, GitWorktreeItem[]>
  >({});
  const [worktreeLoadingByRoot, setWorktreeLoadingByRoot] = useState<
    Record<string, boolean>
  >({});
  const [worktreeErrorByRoot, setWorktreeErrorByRoot] = useState<
    Record<string, string>
  >({});
  const [expandedWorktreeByRoot, setExpandedWorktreeByRoot] = useState<
    Record<string, string>
  >({});
  const [worktreeStatusByPath, setWorktreeStatusByPath] = useState<
    Record<string, GitStatusPayload | null>
  >({});
  const [worktreeStatusLoadingByPath, setWorktreeStatusLoadingByPath] =
    useState<Record<string, boolean>>({});

  async function refreshRelatedWorktree(
    rootId: string,
    worktreePath: string,
    force = true,
  ) {
    const normalizedRootId = String(rootId || "").trim();
    const normalizedWorktreePath = String(worktreePath || "").trim();
    if (!normalizedRootId || !normalizedWorktreePath) {
      return;
    }
    if (!force && knownWorktreePathsRef.current.has(normalizedWorktreePath)) {
      return;
    }
    knownWorktreePathsRef.current.add(normalizedWorktreePath);
    setExpandedWorktreeByRoot((prev) => ({
      ...prev,
      [normalizedRootId]: normalizedWorktreePath,
    }));
    setWorktreeLoadingByRoot((prev) => ({ ...prev, [normalizedRootId]: true }));
    setWorktreeErrorByRoot((prev) => ({ ...prev, [normalizedRootId]: "" }));
    try {
      const payload = await fetchGitWorktrees(normalizedRootId);
      (payload.items || []).forEach((item) => {
        if (item.path) {
          knownWorktreePathsRef.current.add(item.path);
        }
      });
      setWorktreeItemsByRoot((prev) => ({
        ...prev,
        [normalizedRootId]: (payload.items || []).filter(
          (item) => !!item.branch,
        ),
      }));
    } catch (error) {
      knownWorktreePathsRef.current.delete(normalizedWorktreePath);
      setWorktreeErrorByRoot((prev) => ({
        ...prev,
        [normalizedRootId]:
          error instanceof Error ? error.message : t("worktree.loadFailed"),
      }));
    } finally {
      setWorktreeLoadingByRoot((prev) => ({
        ...prev,
        [normalizedRootId]: false,
      }));
    }
    setWorktreeStatusLoadingByPath((prev) => ({
      ...prev,
      [normalizedWorktreePath]: true,
    }));
    try {
      const status = await fetchGitStatusByPath(normalizedWorktreePath);
      setWorktreeStatusByPath((prev) => ({
        ...prev,
        [normalizedWorktreePath]: status,
      }));
    } catch {
      setWorktreeStatusByPath((prev) => ({
        ...prev,
        [normalizedWorktreePath]: null,
      }));
    } finally {
      setWorktreeStatusLoadingByPath((prev) => ({
        ...prev,
        [normalizedWorktreePath]: false,
      }));
    }
  }

  const loadProjectTreeWorktrees = useCallback(
    async (rootID: string): Promise<GitWorktreeItem[]> => {
      if (!rootID) {
        return [];
      }
      setWorktreeLoadingByRoot((prev) => ({ ...prev, [rootID]: true }));
      setWorktreeErrorByRoot((prev) => ({ ...prev, [rootID]: "" }));
      try {
        const payload = await fetchGitWorktrees(rootID);
        (payload.items || []).forEach((item) => {
          if (item.path) {
            knownWorktreePathsRef.current.add(item.path);
          }
        });
        const items = (payload.items || []).filter((item) => !!item.branch);
        setWorktreeItemsByRoot((prev) => ({
          ...prev,
          [rootID]: items,
        }));
        return items;
      } catch (error) {
        setWorktreeItemsByRoot((prev) => ({ ...prev, [rootID]: [] }));
        setWorktreeErrorByRoot((prev) => ({
          ...prev,
          [rootID]:
            error instanceof Error ? error.message : t("worktree.loadFailed"),
        }));
        return [];
      } finally {
        setWorktreeLoadingByRoot((prev) => ({ ...prev, [rootID]: false }));
      }
    },
    [t],
  );

  const loadProjectTreeWorktreeStatus = useCallback(
    async (worktreePath: string) => {
      if (!worktreePath) {
        return;
      }
      setWorktreeStatusLoadingByPath((prev) => ({
        ...prev,
        [worktreePath]: true,
      }));
      try {
        const status = await fetchGitStatusByPath(worktreePath);
        setWorktreeStatusByPath((prev) => ({
          ...prev,
          [worktreePath]: status,
        }));
      } catch (error) {
        console.error("[git.worktree.status] failed", { worktreePath, error });
        setWorktreeStatusByPath((prev) => ({
          ...prev,
          [worktreePath]: {
            available: false,
            dirty_count: 0,
            items: [],
          } as GitStatusPayload,
        }));
      } finally {
        setWorktreeStatusLoadingByPath((prev) => ({
          ...prev,
          [worktreePath]: false,
        }));
      }
    },
    [],
  );

  useEffect(() => {
    if (projectTreeTab !== "worktrees" || !currentRootId) {
      return;
    }
    if (
      worktreeItemsByRoot[currentRootId] ||
      worktreeLoadingByRoot[currentRootId]
    ) {
      return;
    }
    void loadProjectTreeWorktrees(currentRootId);
  }, [
    currentRootId,
    loadProjectTreeWorktrees,
    projectTreeTab,
    worktreeItemsByRoot,
    worktreeLoadingByRoot,
  ]);

  return {
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
  };
}
