import { useEffect } from "react";
import { readURLState } from "../urlState";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useProjectTree } from "./useProjectTree";
import type { usePluginState } from "./usePluginState";
import type { useSessionList } from "./useSessionList";
import type { useWorkbenchSessionNavigation } from "./useWorkbenchSessionNavigation";
import type { useActionHandlers } from "./useActionHandlers";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  pluginStateApi: ReturnType<typeof usePluginState>;
  sessionListApi: ReturnType<typeof useSessionList>;
  workbenchSessionNavigationApi: ReturnType<typeof useWorkbenchSessionNavigation>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
};

export function useUrlNavigation({ appFoundationApi, currentRootApi, projectTreeApi, pluginStateApi, sessionListApi, workbenchSessionNavigationApi, actionHandlersApi }: Deps) {
  const { fileCursorRef, fileRef, handleSelectSessionRef, selectedSessionRef } = appFoundationApi;
  const { currentRootIdRef, setCurrentRootId } = currentRootApi;
  const { refreshTreeDir } = projectTreeApi;
  const { setPluginQuery } = pluginStateApi;
  const { loadSessionsForRoot } = sessionListApi;
  const { tryShowBoundSessionForRoot } = workbenchSessionNavigationApi;
  const { actionHandlers } = actionHandlersApi;

  useEffect(() => {
    function handlePopState() {
      const state = readURLState();
      if (state.root) {
        setCurrentRootId(state.root);
      }
      setPluginQuery(state.pluginQuery);
      if (!state.root) {
        return;
      }
      if (state.session) {
        const currentSessionKey =
          selectedSessionRef.current?.key ||
          selectedSessionRef.current?.session_key ||
          "";
        const currentSessionRoot =
          (selectedSessionRef.current?.root_id as string | undefined) ||
          currentRootIdRef.current ||
          "";
        if (
          state.session !== currentSessionKey ||
          state.root !== currentSessionRoot
        ) {
          void handleSelectSessionRef.current?.({
            key: state.session,
            session_key: state.session,
            root_id: state.root,
          });
        }
        return;
      }
      if (state.file) {
        const currentPath = fileRef.current?.path || "";
        const currentRoot = currentRootIdRef.current || "";
        const currentCursor = fileCursorRef.current;
        if (
          state.file !== currentPath ||
          state.root !== currentRoot ||
          state.cursor !== currentCursor
        ) {
          actionHandlers.open({
            path: state.file,
            root: state.root,
            cursor: state.cursor,
            preservePluginQuery: true,
          });
        }
        return;
      }
      void (async () => {
        const restored = await tryShowBoundSessionForRoot(state.root, {
          pluginQuery: state.pluginQuery,
        });
        if (restored) {
          void loadSessionsForRoot(state.root, { replace: true, force: true });
          await refreshTreeDir(state.root, ".", false);
          return;
        }
        actionHandlers.open_dir({
          path: state.root,
          root: state.root,
          preservePluginQuery: true,
          isRoot: true,
        });
      })();
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [
    actionHandlers,
    loadSessionsForRoot,
    refreshTreeDir,
    tryShowBoundSessionForRoot,
  ]);
}
