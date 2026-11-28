import { useEffect } from "react";
import {
  isRelayPWAContext,
  RELAY_LAST_NODE_ID_STORAGE_KEY,
  syncRelayNodesToNative,
} from "../relayContext";
import { isRelayNodePage } from "../../services/base";
import { projectStorage } from "../../services/remoteScope";
import { bootstrapService } from "../../services/bootstrap";
import { ManagedRootPayload } from "../projectModel";
import { mapManagedRootsToEntries, readURLState } from "../urlState";
import { loadLastRootId } from "../storagePrefs";
import { reportError } from "../../services/error";
import type { useAppFoundation } from "./useAppFoundation";
import type { useWorkbenchLayout } from "./useWorkbenchLayout";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useProjectTree } from "./useProjectTree";
import type { usePluginState } from "./usePluginState";
import type { useRelayConnection } from "./useRelayConnection";
import type { useManagedRoots } from "./useManagedRoots";
import type { useSessionList } from "./useSessionList";
import type { useWorkbenchSessionNavigation } from "./useWorkbenchSessionNavigation";
import type { useAgentCatalog } from "./useAgentCatalog";
import type { useActionHandlers } from "./useActionHandlers";
import type { usePlugins } from "./usePlugins";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  pluginStateApi: ReturnType<typeof usePluginState>;
  relayConnectionApi: ReturnType<typeof useRelayConnection>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  sessionListApi: ReturnType<typeof useSessionList>;
  workbenchSessionNavigationApi: ReturnType<typeof useWorkbenchSessionNavigation>;
  agentCatalogApi: ReturnType<typeof useAgentCatalog>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
  pluginsApi: ReturnType<typeof usePlugins>;
};

export function useAppBootstrap({ appFoundationApi, workbenchLayoutApi, currentRootApi, projectTreeApi, pluginStateApi, relayConnectionApi, managedRootsApi, sessionListApi, workbenchSessionNavigationApi, agentCatalogApi, actionHandlersApi, pluginsApi }: Deps) {
  const { didInitRef, handleSelectSessionRef, managedRootIdsRef, t } = appFoundationApi;
  const { remotePhone } = workbenchLayoutApi;
  const { setCurrentRootId } = currentRootApi;
  const { refreshTreeDir } = projectTreeApi;
  const { setPluginQuery } = pluginStateApi;
  const { bootstrapState, handleRelayNavigationFailure } = relayConnectionApi;
  const { loadManagedRootPayloads, managedRootByIdRef, setManagedRootIds, setRootEntries } = managedRootsApi;
  const { loadMultiProjectSessionGroups, loadSessionsForRoot, multiProjectSessionsEnabled } = sessionListApi;
  const { tryShowBoundSessionForRoot } = workbenchSessionNavigationApi;
  const { setAgentsVersion } = agentCatalogApi;
  const { actionHandlersRef } = actionHandlersApi;
  const { ensurePluginsLoaded } = pluginsApi;

  useEffect(() => {
    if (didInitRef.current || bootstrapState.phase === "error") {
      return;
    }
    didInitRef.current = true;
    let cancelled = false;
    let settled = false;
    if (isRelayPWAContext() && !isRelayNodePage()) {
      const lastNodeID = projectStorage().getItem(
        RELAY_LAST_NODE_ID_STORAGE_KEY,
      );
      if (lastNodeID) {
        window.location.replace(`/n/${lastNodeID}/`);
        return;
      }
    }
    void (async () => {
      try {
        const bootstrap = await bootstrapService.start();
        if (bootstrap.phase !== "ready") {
          didInitRef.current = false;
          return;
        }
        const dirs = await loadManagedRootPayloads();
        if (!dirs) {
          return;
        }
        if (cancelled || !dirs.length) {
          return;
        }
        const nextDirs = dirs as ManagedRootPayload[];
        syncRelayNodesToNative(nextDirs);
        const ids = nextDirs.map((d) => d.id);
        managedRootByIdRef.current = Object.fromEntries(
          nextDirs.filter((dir) => !!dir.id).map((dir) => [dir.id, dir]),
        );
        managedRootIdsRef.current = new Set(ids);
        setManagedRootIds(ids);
        setRootEntries(mapManagedRootsToEntries(nextDirs));
        const urlState = readURLState();
        const lastRoot = loadLastRootId();
        const preferredRoot =
          urlState.root && ids.includes(urlState.root)
            ? urlState.root
            : lastRoot && ids.includes(lastRoot)
              ? lastRoot
              : ids[0];
        setCurrentRootId(preferredRoot);
        setPluginQuery(urlState.pluginQuery);
        if (urlState.session) {
          if (cancelled) return;
          await handleSelectSessionRef.current?.({
            key: urlState.session,
            session_key: urlState.session,
            root_id: preferredRoot,
          });
        } else if (urlState.file) {
          await ensurePluginsLoaded(preferredRoot);
          if (cancelled) return;
          actionHandlersRef.current.open({
            path: urlState.file,
            root: preferredRoot,
            cursor: urlState.cursor,
            preservePluginQuery: true,
          });
        } else {
          const restored = await tryShowBoundSessionForRoot(preferredRoot, {
            pluginQuery: urlState.pluginQuery,
          });
          if (!restored) {
            actionHandlersRef.current.open_dir({
              path: preferredRoot,
              root: preferredRoot,
              preservePluginQuery: true,
              isRoot: true,
            });
          } else {
            void loadSessionsForRoot(preferredRoot, {
              replace: true,
              force: true,
            });
            await refreshTreeDir(preferredRoot, ".", false);
          }
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        reportError(
          "app.init_failed",
          String((err as Error)?.message || err || t("app.initFailed")),
        );
      } finally {
        settled = true;
      }
    })();
    return () => {
      cancelled = true;
      if (!settled) {
        didInitRef.current = false;
      }
    };
  }, [
    ensurePluginsLoaded,
    handleRelayNavigationFailure,
    loadManagedRootPayloads,
    loadSessionsForRoot,
    refreshTreeDir,
    tryShowBoundSessionForRoot,
    bootstrapState.phase,
  ]);
  useEffect(() => {
    if (bootstrapState.phase !== "ready") {
      return;
    }
    setAgentsVersion((v) => v + 1);
    if (multiProjectSessionsEnabled || remotePhone) {
      void loadMultiProjectSessionGroups();
    }
  }, [
    bootstrapState.phase,
    loadMultiProjectSessionGroups,
    multiProjectSessionsEnabled,
    remotePhone,
  ]);
}
