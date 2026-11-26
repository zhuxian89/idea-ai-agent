import { useMemo, useRef, useCallback, useEffect } from "react";
import {
  parseFileLocation,
  normalizePathForRoot,
  parentDirsOfFile,
  buildDirectorySelectionKey,
  dirnameOfPath,
} from "../fileNavigation";
import { normalizeCursor, parsePluginQuery, extractHTTPStatusFromErrorMessage } from "../urlState";
import { loadPersistedPluginQuery, persistPluginQuery } from "../storagePrefs";
import { protectedJSON as apiProtectedJSON, ProtectedAPIError } from "../../services/api";
import { appURL } from "../../services/base";
import { fetchFile, getCachedFile, type FilePayload } from "../../services/file";
import { buildMatchInputFromPath, inferReadModeFromPlugin } from "../pluginInput";
import { reportError } from "../../services/error";
import type { useAppFoundation } from "./useAppFoundation";
import type { useWorkbenchLayout } from "./useWorkbenchLayout";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useProjectTree } from "./useProjectTree";
import type { usePluginState } from "./usePluginState";
import type { useFileViewerState } from "./useFileViewerState";
import type { useRelayConnection } from "./useRelayConnection";
import type { useManagedRoots } from "./useManagedRoots";
import type { useSessionList } from "./useSessionList";
import type { useGit } from "./useGit";
import type { useWorkbenchSessionNavigation } from "./useWorkbenchSessionNavigation";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  pluginStateApi: ReturnType<typeof usePluginState>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
  relayConnectionApi: ReturnType<typeof useRelayConnection>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  sessionListApi: ReturnType<typeof useSessionList>;
  gitApi: ReturnType<typeof useGit>;
  workbenchSessionNavigationApi: ReturnType<typeof useWorkbenchSessionNavigation>;
};

export function useActionHandlers({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, projectTreeApi, pluginStateApi, fileViewerStateApi, relayConnectionApi, managedRootsApi, sessionListApi, gitApi, workbenchSessionNavigationApi }: Deps) {
  const { expandedRef, fileCursorRef, fileOpenRequestRef, fileRef, invalidTreeCacheKeysRef, pluginBypassRef, pluginManagerRef, t } = appFoundationApi;
  const { isMobile, setIsLeftOpen } = workbenchLayoutApi;
  const { currentRootIdRef, replaceURLState, setCurrentRootId } = currentRootApi;
  const { setDrawerOpenForRoot, setMainViewPreferenceForRoot, setSelectedSession, setSelectedSessionLoading } = sessionSelectionApi;
  const { entriesByPathRef, formatDirectoryLoadError, normalizeTreeResponse, refreshTreeDir, setEntriesByPath, setExpanded, setMainDirectoryError, setMainEntries, setSelectedDir, setSelectedDirKey, treeCacheKey } = projectTreeApi;
  const { setPluginBypass, setPluginQuery } = pluginStateApi;
  const { file, rememberCurrentFileScroll, setFile } = fileViewerStateApi;
  const { handleRelayNavigationFailure } = relayConnectionApi;
  const { managedRootByIdRef } = managedRootsApi;
  const { loadSessionsForRoot, sessions } = sessionListApi;
  const { setGitDiff } = gitApi;
  const { handleSelectSession, tryShowBoundSessionForRoot } = workbenchSessionNavigationApi;

  const actionHandlers = useMemo(
    () => ({
      open: async (params: any) => {
        const requestId = ++fileOpenRequestRef.current;
        const isStale = () => fileOpenRequestRef.current !== requestId;
        const parsedLocation = parseFileLocation(String(params.path || ""));
        const root = params.root || currentRootIdRef.current;
        const rootInfo = root
          ? managedRootByIdRef.current[String(root)]
          : undefined;
        const path = normalizePathForRoot(
          parsedLocation.path,
          rootInfo?.root_path,
        );
        if (!path || !root) return;
        setMainViewPreferenceForRoot(String(root), "file");
        rememberCurrentFileScroll();
        setGitDiff(null);
        const currentFilePath = fileRef.current?.path || "";
        const currentFileRoot =
          fileRef.current?.root || currentRootIdRef.current || "";
        const isFileSwitch =
          currentFilePath !== String(path) || currentFileRoot !== String(root);
        if (isFileSwitch) {
          pluginBypassRef.current = false;
          setPluginBypass(false);
          // Only tear down the current file view when switching to a different file/root.
          // Reopening the same file (for example from session view back to file view) should
          // preserve the existing scroll position and DOM state until fresh content arrives.
          setFile(null);
        }
        if (currentRootIdRef.current !== root) {
          setCurrentRootId(root);
        }
        setSelectedDir(String(root));
        setSelectedDirKey(null);
        const requestedCursor = normalizeCursor(params.cursor);
        const cursor = requestedCursor === null ? 0 : requestedCursor;
        const preserveQuery = !!params.preservePluginQuery;
        const persistedQuery = loadPersistedPluginQuery(
          String(root),
          String(path),
        );
        const urlQuery = preserveQuery
          ? parsePluginQuery(window.location.search)
          : {};
        // Priority: URL query > localStorage persisted query.
        const nextPluginQuery = preserveQuery
          ? { ...persistedQuery, ...urlQuery }
          : persistedQuery;
        setPluginQuery(nextPluginQuery);
        replaceURLState({
          root,
          file: path,
          session: "",
          cursor,
          pluginQuery: nextPluginQuery,
        });
        persistPluginQuery(String(root), String(path), nextPluginQuery);

        const expandAndLoadTreeForFile = async () => {
          const dirs = parentDirsOfFile(String(path));
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(String(root));
            dirs.forEach((dir) => next.add(`${root}:${dir}`));
            return Array.from(next);
          });
          const toLoad = [".", ...dirs];
          for (const dir of toLoad) {
            const cacheKey = treeCacheKey(String(root), dir);
            if (
              Object.prototype.hasOwnProperty.call(
                entriesByPathRef.current,
                cacheKey,
              ) &&
              !invalidTreeCacheKeysRef.current.has(cacheKey)
            ) {
              continue;
            }
            try {
              const payload = await apiProtectedJSON<any>(
                appURL(
                  "/api/tree",
                  new URLSearchParams({ root: String(root), dir }),
                ),
              );
              const parsed = normalizeTreeResponse(payload);
              invalidTreeCacheKeysRef.current.delete(cacheKey);
              setEntriesByPath((prev) => ({
                ...prev,
                [cacheKey]: parsed.entries,
              }));
            } catch {}
          }
        };

        void expandAndLoadTreeForFile();
        try {
          const fetchFileWithMode = async (
            mode: "full" | "incremental",
            timeoutMs?: number,
          ) =>
            fetchFile({
              rootId: String(root),
              path: String(path),
              readMode: mode,
              cursor,
              timeoutMs,
            });

          let readMode: "incremental" | "full" =
            params.readMode === "full" ? "full" : "incremental";
          let requiresFull = params.readMode === "full";
          if (params.readMode !== "full" && params.readMode !== "incremental") {
            const currentFilePath = fileRef.current?.path || "";
            const currentFileRoot =
              fileRef.current?.root || currentRootIdRef.current || "";
            const targetPath = String(path);
            const targetRoot = String(root);
            const sameFileReload =
              pluginBypassRef.current &&
              currentFilePath === targetPath &&
              currentFileRoot === targetRoot;

            if (sameFileReload) {
              readMode = "incremental";
            } else {
              try {
                const plugin = pluginManagerRef.current.match(
                  root,
                  buildMatchInputFromPath(path, nextPluginQuery),
                );
                readMode = inferReadModeFromPlugin(plugin);
                requiresFull = readMode === "full";
              } catch {
                readMode = "incremental";
              }
            }
          }
          const cached = await getCachedFile({
            rootId: String(root),
            path: String(path),
            readMode,
            cursor,
          });
          if (cached && !isStale()) {
            setFile({
              ...cached,
              targetLine: parsedLocation.targetLine,
              targetColumn: parsedLocation.targetColumn,
            });
          }

          let next: FilePayload | null;
          try {
            next = await fetchFileWithMode(
              readMode,
              requiresFull ? undefined : readMode === "full" ? 1500 : undefined,
            );
          } catch (err) {
            if (readMode === "full" && !requiresFull) {
              next = await fetchFileWithMode("incremental");
              readMode = "incremental";
            } else {
              throw err;
            }
          }
          if (isStale()) {
            return;
          }
          if (next) {
            setFile({
              ...next,
              targetLine: parsedLocation.targetLine,
              targetColumn: parsedLocation.targetColumn,
            });
          }
          fileCursorRef.current = cursor;
          setSelectedSession(null);
          setSelectedSessionLoading(false);
          setDrawerOpenForRoot(root, false);
          if (isMobile) setIsLeftOpen(false);
        } catch (err) {
          const status = extractHTTPStatusFromErrorMessage(
            (err as Error)?.message || "",
          );
          if (status && (await handleRelayNavigationFailure(status, ""))) {
            return;
          }
          console.error("[file.open] failed", { root, path, cursor, err });
        }
      },
      open_dir: async (params: any) => {
        fileOpenRequestRef.current += 1;
        const path = params.path,
          rootParam = params.root || currentRootIdRef.current,
          isToggle = !!params.toggle,
          forceDirectory = !!params.forceDirectory,
          suppressTreeExpand = !!params.suppressTreeExpand;
        if (!path || !rootParam) return;
        setGitDiff(null);
        const isActuallyRoot = params.isRoot === true;
        const root = isActuallyRoot ? path : rootParam;
        const expandedKey = isActuallyRoot ? path : `${root}:${path}`;
        const preserveCollapsedRoot =
          isActuallyRoot &&
          suppressTreeExpand &&
          !expandedRef.current.includes(expandedKey);
        const restoreSuppressedRootExpansion = () => {
          if (!preserveCollapsedRoot) {
            return;
          }
          setExpanded((prev) => prev.filter((k) => k !== expandedKey));
        };
        const preserveQuery = !!params.preservePluginQuery;
        const nextPluginQuery = preserveQuery
          ? parsePluginQuery(window.location.search)
          : {};
        const loadDirectoryView = async (
          targetPath: string,
          targetIsRoot: boolean,
        ) => {
          const apiDir = targetIsRoot ? "." : targetPath;
          const cacheKey = treeCacheKey(root, apiDir);
          if (currentRootIdRef.current !== root) {
            setCurrentRootId(root);
          }
          setMainViewPreferenceForRoot(root, "directory");
          setFile(null);
          setSelectedSession(null);
          setSelectedSessionLoading(false);
          setMainEntries([]);
          setMainDirectoryError("");
          setPluginQuery(nextPluginQuery);
          replaceURLState({
            root,
            file: "",
            session: "",
            cursor: 0,
            pluginQuery: nextPluginQuery,
          });
          const cachedEntries = entriesByPathRef.current[cacheKey];
          if (
            Object.prototype.hasOwnProperty.call(
              entriesByPathRef.current,
              cacheKey,
            ) &&
            !invalidTreeCacheKeysRef.current.has(cacheKey)
          ) {
            setMainEntries(cachedEntries || []);
            setMainDirectoryError("");
            setSelectedDir(targetPath);
            setSelectedDirKey(
              buildDirectorySelectionKey(root, targetPath, targetIsRoot),
            );
            setFile(null);
            setSelectedSession(null);
            setSelectedSessionLoading(false);
            fileCursorRef.current = 0;
            setDrawerOpenForRoot(root, false);
            if (!isToggle && isMobile) setIsLeftOpen(false);
            return;
          }
          try {
            const payload = await apiProtectedJSON<any>(
              appURL("/api/tree", new URLSearchParams({ root, dir: apiDir })),
            );
            const parsed = normalizeTreeResponse(payload);
            invalidTreeCacheKeysRef.current.delete(cacheKey);
            setMainDirectoryError("");
            setEntriesByPath((prev) => ({
              ...prev,
              [cacheKey]: parsed.entries,
            }));
            setMainEntries(parsed.entries);
            setSelectedDir(targetPath);
            setSelectedDirKey(
              buildDirectorySelectionKey(root, targetPath, targetIsRoot),
            );
            setFile(null);
            setSelectedSession(null);
            setSelectedSessionLoading(false);
            fileCursorRef.current = 0;
            setDrawerOpenForRoot(root, false);
            if (!isToggle && isMobile) setIsLeftOpen(false);
          } catch (error) {
            if (error instanceof ProtectedAPIError) {
              if (
                await handleRelayNavigationFailure(
                  error.status,
                  typeof error.payload?.error === "string"
                    ? error.payload.error
                    : "",
                )
              ) {
                return;
              }
              const message = formatDirectoryLoadError(
                typeof error.payload?.error === "string"
                  ? error.payload.error
                  : "",
              );
              setSelectedDir(targetPath);
              setSelectedDirKey(
                buildDirectorySelectionKey(root, targetPath, targetIsRoot),
              );
              setMainEntries([]);
              setMainDirectoryError(message);
              reportError("file.read_failed", message);
              return;
            }
            const message = t("directory.loadFailedRetry");
            setSelectedDir(targetPath);
            setSelectedDirKey(
              buildDirectorySelectionKey(root, targetPath, targetIsRoot),
            );
            setMainEntries([]);
            setMainDirectoryError(message);
            reportError("file.read_failed", message);
          }
        };
        const isExpanded = expandedRef.current.includes(expandedKey);
        const isCurrentExpandedRoot =
          isActuallyRoot && isExpanded && currentRootIdRef.current === root;
        if (
          isToggle &&
          ((!isActuallyRoot && isExpanded) || isCurrentExpandedRoot)
        ) {
          setExpanded((prev) => prev.filter((k) => k !== expandedKey));
          if (!isActuallyRoot) {
            const parentDir = dirnameOfPath(path);
            const parentPath = parentDir === "." ? root : parentDir;
            await loadDirectoryView(parentPath, parentDir === ".");
          }
          return;
        }
        if (isActuallyRoot) {
          setCurrentRootId(path);
          if (!suppressTreeExpand) {
            setExpanded((prev) => Array.from(new Set([...prev, path])));
          }
          if (!forceDirectory) {
            const restored = await tryShowBoundSessionForRoot(path, {
              pluginQuery: nextPluginQuery,
              closeLeftSidebar: !isToggle,
            });
            if (restored) {
              void loadSessionsForRoot(path, { replace: true, force: true });
              await refreshTreeDir(path, ".", false);
              restoreSuppressedRootExpansion();
              return;
            }
          }
        } else {
          setExpanded((prev) => Array.from(new Set([...prev, expandedKey])));
        }
        await loadDirectoryView(path, isActuallyRoot);
        restoreSuppressedRootExpansion();
      },
    }),
    [
      handleRelayNavigationFailure,
      isMobile,
      normalizeTreeResponse,
      setMainViewPreferenceForRoot,
      setDrawerOpenForRoot,
      replaceURLState,
      rememberCurrentFileScroll,
      treeCacheKey,
      tryShowBoundSessionForRoot,
      loadSessionsForRoot,
    ],
  );
  const actionHandlersRef = useRef(actionHandlers);
  const openProject = useCallback(
    (
      rootId: string,
      options?: { forceDirectory?: boolean; preservePluginQuery?: boolean },
    ) =>
      actionHandlersRef.current.open_dir({
        path: rootId,
        root: rootId,
        isRoot: true,
        ...options,
      }),
    [],
  );
  useEffect(() => {
    actionHandlersRef.current = actionHandlers;
  }, [actionHandlers]);
  const handleSessionChipClick = useCallback(
    (sessionKey: string, rootOverride?: string | null) => {
      if (!sessionKey) return;
      const root = rootOverride || file?.root || currentRootIdRef.current;
      if (!root) return;
      const matched = sessions.find((item) => {
        const key = item.key || item.session_key;
        return key === sessionKey;
      });
      if (matched) {
        handleSelectSession(matched);
        return;
      }
      handleSelectSession({
        key: sessionKey,
        session_key: sessionKey,
        root_id: root,
      });
    },
    [file, sessions, handleSelectSession],
  );
  useEffect(() => {
    function openReplySession(detail: any) {
      const rootId =
        typeof detail?.rootId === "string" ? detail.rootId.trim() : "";
      const sessionKey =
        typeof detail?.sessionKey === "string" ? detail.sessionKey.trim() : "";
      if (!rootId || !sessionKey) {
        return;
      }
      handleSessionChipClick(sessionKey, rootId);
    }

    function handleOpenReplySession(event: Event) {
      openReplySession((event as CustomEvent).detail);
    }

    window.addEventListener(
      "mindfs:open-reply-session",
      handleOpenReplySession,
    );
    openReplySession((window as any).__mindfsPendingReplySession);
    delete (window as any).__mindfsPendingReplySession;
    return () => {
      window.removeEventListener(
        "mindfs:open-reply-session",
        handleOpenReplySession,
      );
    };
  }, [handleSessionChipClick]);

  return { actionHandlers, actionHandlersRef, handleSessionChipClick, openProject };
}
