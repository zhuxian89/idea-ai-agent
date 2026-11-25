import { useCallback } from "react";
import { syncRelayNodesToNative } from "../relayContext";
import { comparableManagedRootPath, mapManagedRootsToEntries } from "../urlState";
import { OpenSessionTab } from "../sessionModel";
import { loadLastRootId } from "../storagePrefs";
import { reportError } from "../../services/error";
import { protectedJSON as apiProtectedJSON } from "../../services/api";
import { appURL } from "../../services/base";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useProjectTree } from "./useProjectTree";
import type { useFileViewerState } from "./useFileViewerState";
import type { useManagedRoots } from "./useManagedRoots";
import type { useSessionList } from "./useSessionList";
import type { useRootReset } from "./useRootReset";
import type { useActionHandlers } from "./useActionHandlers";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  sessionListApi: ReturnType<typeof useSessionList>;
  rootResetApi: ReturnType<typeof useRootReset>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
};

export function useManagedRootActions({ appFoundationApi, currentRootApi, sessionSelectionApi, projectTreeApi, fileViewerStateApi, managedRootsApi, sessionListApi, rootResetApi, actionHandlersApi }: Deps) {
  const { managedRootIdsRef, selectedSessionByRootRef, t } = appFoundationApi;
  const { currentRootIdRef, replaceURLState, setCurrentRootId } = currentRootApi;
  const { setActiveBoundSessionKey, setCurrentSession, setInteractionMode, setIsDrawerOpen, setOpenSessionTabsByRoot, setSelectedSession, setSelectedSessionLoading } = sessionSelectionApi;
  const { setMainEntries, setSelectedDir, setSelectedDirKey } = projectTreeApi;
  const { setFile } = fileViewerStateApi;
  const { loadManagedRootPayloads, managedRootByIdRef, setManagedRootIds, setRootEntries } = managedRootsApi;
  const { loadMultiProjectSessionGroups, multiProjectSessionsEnabled, refreshMultiProjectReplyingSessions, setSessions } = sessionListApi;
  const { clearRootScopedClientState } = rootResetApi;
  const { actionHandlersRef } = actionHandlersApi;

  const refreshManagedRoots = useCallback(async () => {
    const dirs = await loadManagedRootPayloads();
    if (!dirs) {
      return;
    }
    const nextDirs = Array.isArray(dirs) ? dirs : [];
    syncRelayNodesToNative(nextDirs);
    const nextRootIds = nextDirs.map((dir) => dir.id).filter(Boolean);
    const previousRootById = managedRootByIdRef.current;
    const nextRootById = Object.fromEntries(
      nextDirs.filter((dir) => !!dir.id).map((dir) => [dir.id, dir]),
    );
    let clearedRootScopedState = false;
    for (const rootID of Object.keys(previousRootById)) {
      if (!(rootID in nextRootById)) {
        clearRootScopedClientState(rootID, { removeLastRoot: true });
        clearedRootScopedState = true;
      }
    }
    for (const rootID of nextRootIds) {
      const previousPath = comparableManagedRootPath(
        previousRootById[rootID]?.root_path,
      );
      const nextPath = comparableManagedRootPath(
        nextRootById[rootID]?.root_path,
      );
      if (previousPath && nextPath && previousPath !== nextPath) {
        clearRootScopedClientState(rootID);
        clearedRootScopedState = true;
      }
    }
    managedRootByIdRef.current = nextRootById;
    if (clearedRootScopedState && multiProjectSessionsEnabled) {
      void refreshMultiProjectReplyingSessions();
      void loadMultiProjectSessionGroups();
    }

    managedRootIdsRef.current = new Set(nextRootIds);
    setManagedRootIds(nextRootIds);
    setRootEntries(mapManagedRootsToEntries(nextDirs));
    Object.keys(selectedSessionByRootRef.current).forEach((rootID) => {
      if (!nextRootIds.includes(rootID)) {
        delete selectedSessionByRootRef.current[rootID];
      }
    });
    setOpenSessionTabsByRoot((prev) => {
      let changed = false;
      const next: Record<string, OpenSessionTab[]> = {};
      for (const [rootID, tabs] of Object.entries(prev)) {
        if (nextRootIds.includes(rootID)) next[rootID] = tabs;
        else changed = true;
      }
      return changed ? next : prev;
    });

    if (nextRootIds.length === 0) {
      setCurrentRootId(null);
      setSelectedDir(null);
      setSelectedDirKey(null);
      setMainEntries([]);
      setFile(null);
      setSelectedSession(null);
      setSelectedSessionLoading(false);
      setSessions([]);
      setCurrentSession(null);
      setActiveBoundSessionKey(null);
      selectedSessionByRootRef.current = {};
      setOpenSessionTabsByRoot({});
      setInteractionMode("main");
      setIsDrawerOpen(false);
      replaceURLState({
        root: "",
        file: "",
        session: "",
        cursor: 0,
        pluginQuery: {},
      });
      return;
    }

    const currentRoot = currentRootIdRef.current;
    if (currentRoot && nextRootIds.includes(currentRoot)) {
      return;
    }

    const lastRoot = loadLastRootId();
    const nextRoot =
      lastRoot && nextRootIds.includes(lastRoot) ? lastRoot : nextRootIds[0];
    await actionHandlersRef.current.open_dir({
      path: nextRoot,
      root: nextRoot,
      preservePluginQuery: true,
      isRoot: true,
    });
  }, [
    clearRootScopedClientState,
    loadManagedRootPayloads,
    loadMultiProjectSessionGroups,
    multiProjectSessionsEnabled,
    refreshMultiProjectReplyingSessions,
    replaceURLState,
  ]);
  const handleRemoveCurrentRoot = useCallback(async () => {
    const rootID = currentRootIdRef.current;
    if (!rootID) {
      return;
    }
    const rootInfo = managedRootByIdRef.current[rootID];
    const rootPath = rootInfo?.root_path || "";
    if (!rootPath) {
      reportError("root.delete_failed", t("root.missingPathRemove"));
      return;
    }
    if (!window.confirm(t("root.confirmRemove", { name: rootID }))) {
      return;
    }
    try {
      await apiProtectedJSON<any>(
        appURL("/api/dirs", new URLSearchParams({ path: rootPath })),
        {
          method: "DELETE",
        },
      );
      clearRootScopedClientState(rootID, { removeLastRoot: true });
      await refreshManagedRoots();
    } catch (err) {
      reportError(
        "root.delete_failed",
        String((err as Error)?.message || t("root.removeFailed")),
      );
    }
  }, [clearRootScopedClientState, refreshManagedRoots, t]);

  return { handleRemoveCurrentRoot, refreshManagedRoots };
}
