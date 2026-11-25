import { useCallback } from "react";
import { clearGitHistoryCache } from "../../services/git";
import { clearFileCacheForRoot } from "../../services/file";
import { clearCachedSessionsForRoot } from "../../services/session";
import {
  persistFileScrollPositions,
  removeLocalStorageByPrefix,
  PLUGIN_QUERY_STORAGE_PREFIX,
  LAST_ROOT_STORAGE_KEY,
} from "../storagePrefs";
import { projectStorage } from "../../services/remoteScope";
import type { useAppFoundation } from "./useAppFoundation";
import type { useSessionSelection } from "./useSessionSelection";
import type { useProjectTree } from "./useProjectTree";
import type { useSessionList } from "./useSessionList";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  sessionListApi: ReturnType<typeof useSessionList>;
};

export function useRootReset({ appFoundationApi, sessionSelectionApi, projectTreeApi, sessionListApi }: Deps) {
  const { boundSessionByRootRef, cancelRequestedBySessionRef, drawerOpenByRootRef, drawerSessionByRootRef, fileScrollPositionsRef, invalidTreeCacheKeysRef, loadedSessionRef, loadingSessionRef, mainViewPreferenceByRootRef, optimisticDequeuedIdsRef, pendingBySessionRef, pendingRequestRef, pluginsLoadedByRootRef, pluginsLoadingByRootRef, pluginsTrustPendingByRootRef, queueFrozenBySessionRef, queuedMessagesBySessionRef, selectedSessionByRootRef, sessionCacheRef, staleSessionKeysRef, suppressedAutoBindSessionByRootRef } = appFoundationApi;
  const { bumpCacheVersion, setOpenSessionTabsByRoot, setQueueVersion, setSlashCommandResults } = sessionSelectionApi;
  const { entriesByPathRef, setDirectorySortOverrides, setEntriesByPath, setGitHistoryExpandedByRoot, setGitStatusExpandedByRoot } = projectTreeApi;
  const { multiProjectPendingRef, setMultiProjectPendingByKey, setMultiProjectSessionGroups } = sessionListApi;

  const clearRootScopedClientState = useCallback(
    (rootID: string, options?: { removeLastRoot?: boolean }) => {
      const root = String(rootID || "").trim();
      if (!root) {
        return;
      }
      const sessionPrefix = `${root}::`;
      const treePrefix = `${root}:`;

      const deleteRecordKeys = <T,>(
        record: Record<string, T>,
        predicate: (key: string) => boolean,
      ) => {
        for (const key of Object.keys(record)) {
          if (predicate(key)) {
            delete record[key];
          }
        }
      };
      const deleteSessionRecordKeys = <T,>(record: Record<string, T>) => {
        deleteRecordKeys(record, (key) => key.startsWith(sessionPrefix));
      };

      clearGitHistoryCache(root);
      clearFileCacheForRoot(root);
      void clearCachedSessionsForRoot(root);

      delete boundSessionByRootRef.current[root];
      delete suppressedAutoBindSessionByRootRef.current[root];
      delete drawerSessionByRootRef.current[root];
      delete selectedSessionByRootRef.current[root];
      delete mainViewPreferenceByRootRef.current[root];
      delete drawerOpenByRootRef.current[root];
      delete pluginsLoadedByRootRef.current[root];
      delete pluginsLoadingByRootRef.current[root];
      delete pluginsTrustPendingByRootRef.current[root];
      setOpenSessionTabsByRoot((prev) => {
        if (!(root in prev)) return prev;
        const next = { ...prev };
        delete next[root];
        return next;
      });

      deleteSessionRecordKeys(sessionCacheRef.current);
      deleteSessionRecordKeys(loadedSessionRef.current);
      deleteSessionRecordKeys(loadingSessionRef.current);
      deleteSessionRecordKeys(pendingBySessionRef.current);
      deleteSessionRecordKeys(queuedMessagesBySessionRef.current);
      deleteSessionRecordKeys(queueFrozenBySessionRef.current);
      deleteSessionRecordKeys(cancelRequestedBySessionRef.current);
      deleteSessionRecordKeys(pendingRequestRef.current);
      deleteRecordKeys(optimisticDequeuedIdsRef.current, (key) =>
        key.startsWith(sessionPrefix),
      );
      staleSessionKeysRef.current = new Set(
        Array.from(staleSessionKeysRef.current).filter(
          (key) => !key.startsWith(sessionPrefix),
        ),
      );

      deleteRecordKeys(
        entriesByPathRef.current,
        (key) => key === root || key.startsWith(treePrefix),
      );
      setEntriesByPath((prev) => {
        const next = { ...prev };
        deleteRecordKeys(
          next,
          (key) => key === root || key.startsWith(treePrefix),
        );
        return next;
      });
      invalidTreeCacheKeysRef.current = new Set(
        Array.from(invalidTreeCacheKeysRef.current).filter(
          (key) => key !== root && !key.startsWith(treePrefix),
        ),
      );

      setGitStatusExpandedByRoot((prev) => {
        if (!(root in prev)) return prev;
        const next = { ...prev };
        delete next[root];
        return next;
      });
      setGitHistoryExpandedByRoot((prev) => {
        if (!(root in prev)) return prev;
        const next = { ...prev };
        delete next[root];
        return next;
      });

      setDirectorySortOverrides((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key === root || key.startsWith(treePrefix)) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setMultiProjectPendingByKey((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(sessionPrefix)) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setMultiProjectSessionGroups((prev) => {
        const next = prev.filter((group) => group.rootId !== root);
        return next.length === prev.length ? prev : next;
      });
      multiProjectPendingRef.current = Object.fromEntries(
        Object.entries(multiProjectPendingRef.current).filter(
          ([key]) => !key.startsWith(sessionPrefix),
        ),
      );
      setSlashCommandResults((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(sessionPrefix)) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      deleteRecordKeys(fileScrollPositionsRef.current, (key) =>
        key.startsWith(sessionPrefix),
      );
      persistFileScrollPositions(fileScrollPositionsRef.current);
      removeLocalStorageByPrefix(`${PLUGIN_QUERY_STORAGE_PREFIX}${root}:`);
      if (
        options?.removeLastRoot === true &&
        typeof window !== "undefined" &&
        projectStorage().getItem(LAST_ROOT_STORAGE_KEY) === root
      ) {
        projectStorage().removeItem(LAST_ROOT_STORAGE_KEY);
      }

      bumpCacheVersion();
      setQueueVersion((value) => value + 1);
    },
    [bumpCacheVersion],
  );

  return { clearRootScopedClientState };
}
