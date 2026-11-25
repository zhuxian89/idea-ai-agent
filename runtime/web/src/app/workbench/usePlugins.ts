import { useRef } from "react";
import React, { useEffect, useCallback, useMemo } from "react";
import {
  scanPluginSources,
  snapshotFromPluginSources,
  loadPluginsFromSources,
} from "../../plugins/manager";
import {
  isPluginSnapshotTrusted,
  readTrustedPluginSet,
  saveTrustedPluginSet,
} from "../../plugins/trust";
import { readURLState, normalizeCursor } from "../urlState";
import { URLState } from "../runtimeTypes";
import { persistPluginQuery } from "../storagePrefs";
import { toPluginInput, inferReadModeFromPlugin } from "../pluginInput";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { usePluginState } from "./usePluginState";
import type { useFileViewerState } from "./useFileViewerState";
import type { useManagedRoots } from "./useManagedRoots";
import type { useSessionList } from "./useSessionList";
import type { useWorkbenchSessionNavigation } from "./useWorkbenchSessionNavigation";
import type { useActionHandlers } from "./useActionHandlers";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  pluginStateApi: ReturnType<typeof usePluginState>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  sessionListApi: ReturnType<typeof useSessionList>;
  workbenchSessionNavigationApi: ReturnType<typeof useWorkbenchSessionNavigation>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
};

export function usePlugins({ appFoundationApi, currentRootApi, pluginStateApi, fileViewerStateApi, managedRootsApi, sessionListApi, workbenchSessionNavigationApi, actionHandlersApi }: Deps) {
  const { fileCursorRef, fileRef, pluginBypassRef, pluginContentRef, pluginManagerRef, pluginsLoadedByRootRef, pluginsLoadingByRootRef, pluginsTrustPendingByRootRef } = appFoundationApi;
  const lastPluginChapterRef = useRef<string>("");
  const lastPluginResetFileKeyRef = useRef<string>("");
  const fullUpgradeAttemptRef = useRef("");
  const { currentRootId, currentRootIdRef, replaceURLState } = currentRootApi;
  const { pendingPluginTrust, pluginBypass, pluginQuery, pluginQueryRef, pluginVersion, setPendingPluginTrust, setPluginBypass, setPluginLoading, setPluginQuery, setPluginVersion } = pluginStateApi;
  const { file, handleViewerSelectionChange } = fileViewerStateApi;
  const { managedRootByIdRef } = managedRootsApi;
  const { sessions } = sessionListApi;
  const { handleSelectSession } = workbenchSessionNavigationApi;
  const { actionHandlers } = actionHandlersApi;

  useEffect(() => {
    pluginQueryRef.current = pluginQuery;
  }, [pluginQuery]);
  useEffect(() => {
    if (!file?.path || !currentRootId) return;
    const nextKey = `${currentRootId}:${file.path}`;
    if (lastPluginResetFileKeyRef.current !== nextKey) {
      pluginBypassRef.current = false;
      setPluginBypass(false);
      lastPluginResetFileKeyRef.current = nextKey;
    }
  }, [file?.path, currentRootId]);
  useEffect(() => {
    pluginBypassRef.current = pluginBypass;
  }, [pluginBypass]);
  const ensurePluginsLoaded = useCallback(async (rootId: string) => {
    if (!rootId || pluginsLoadedByRootRef.current[rootId]) {
      return;
    }
    if (pluginsTrustPendingByRootRef.current[rootId]) {
      return;
    }
    const inflight = pluginsLoadingByRootRef.current[rootId];
    if (inflight) {
      await inflight;
      return;
    }
    setPluginLoading(true);
    const request = scanPluginSources(
      rootId,
      managedRootByIdRef.current[rootId]?.root_path || rootId,
    )
      .then(async (bundle) => {
        const snapshot = snapshotFromPluginSources(bundle);
        if (
          bundle.plugins.length > 0 &&
          !isPluginSnapshotTrusted(snapshot, readTrustedPluginSet(rootId))
        ) {
          pluginManagerRef.current.clear(rootId);
          pluginsTrustPendingByRootRef.current[rootId] = true;
          setPendingPluginTrust({ rootId, bundle });
          setPluginVersion((v) => v + 1);
          return;
        }
        const plugins = await loadPluginsFromSources(bundle.plugins);
        pluginManagerRef.current.set(rootId, plugins);
        pluginsLoadedByRootRef.current[rootId] = true;
        setPluginVersion((v) => v + 1);
      })
      .catch(() => {
        pluginManagerRef.current.clear(rootId);
        pluginsLoadedByRootRef.current[rootId] = true;
        setPluginVersion((v) => v + 1);
      })
      .finally(() => {
        delete pluginsLoadingByRootRef.current[rootId];
        setPluginLoading(false);
      });
    pluginsLoadingByRootRef.current[rootId] = request;
    await request;
  }, []);
  const handleTrustPendingPlugins = useCallback(async () => {
    const pending = pendingPluginTrust;
    if (!pending) return;
    setPluginLoading(true);
    try {
      const snapshot = snapshotFromPluginSources(pending.bundle);
      saveTrustedPluginSet(pending.rootId, snapshot);
      const plugins = await loadPluginsFromSources(pending.bundle.plugins);
      pluginManagerRef.current.set(pending.rootId, plugins);
      pluginsLoadedByRootRef.current[pending.rootId] = true;
      delete pluginsTrustPendingByRootRef.current[pending.rootId];
      setPendingPluginTrust((current) =>
        current?.rootId === pending.rootId ? null : current,
      );
      setPluginVersion((v) => v + 1);
    } finally {
      setPluginLoading(false);
    }
  }, [pendingPluginTrust]);
  const handleDisablePendingPlugins = useCallback(() => {
    const pending = pendingPluginTrust;
    if (!pending) return;
    pluginManagerRef.current.clear(pending.rootId);
    pluginsLoadedByRootRef.current[pending.rootId] = true;
    delete pluginsTrustPendingByRootRef.current[pending.rootId];
    setPendingPluginTrust((current) =>
      current?.rootId === pending.rootId ? null : current,
    );
    setPluginVersion((v) => v + 1);
  }, [pendingPluginTrust]);
  const invalidatePluginsForRoot = useCallback(
    (rootId: string) => {
      if (!rootId) return;
      pluginManagerRef.current.clear(rootId);
      delete pluginsLoadedByRootRef.current[rootId];
      delete pluginsLoadingByRootRef.current[rootId];
      delete pluginsTrustPendingByRootRef.current[rootId];
      setPendingPluginTrust((current) =>
        current?.rootId === rootId ? null : current,
      );
      setPluginVersion((v) => v + 1);
      if (rootId === currentRootIdRef.current) {
        void ensurePluginsLoaded(rootId).catch(() => {});
      }
    },
    [ensurePluginsLoaded],
  );
  const pluginHandlers = useMemo(
    () => ({
      open: async (params: Record<string, unknown>) => {
        await actionHandlers.open(params);
      },
      open_dir: async (params: Record<string, unknown>) => {
        await actionHandlers.open_dir(params);
      },
      select_session: async (params: Record<string, unknown>) => {
        const key = typeof params?.key === "string" ? params.key : "";
        if (!key) return;
        const root = currentRootIdRef.current;
        if (!root) return;
        const matched = sessions.find(
          (item) => (item.key || item.session_key) === key,
        );
        if (matched) {
          await handleSelectSession(matched);
          return;
        }
        await handleSelectSession({ key, session_key: key, root_id: root });
      },
      navigate: async (params: Record<string, unknown>) => {
        const current = readURLState();
        const nextRoot = current.root || currentRootIdRef.current || "";
        const nextPath =
          typeof params?.path === "string" ? params.path : current.file;
        const explicitCursor = normalizeCursor(params?.cursor);
        const rawQuery =
          params?.query &&
          typeof params.query === "object" &&
          !Array.isArray(params.query)
            ? (params.query as Record<string, unknown>)
            : null;

        const nextPluginQuery: Record<string, string> = {
          ...current.pluginQuery,
        };
        if (rawQuery) {
          Object.entries(rawQuery).forEach(([key, value]) => {
            if (!key) return;
            nextPluginQuery[key] = String(value);
          });
        }

        let nextCursor = current.cursor;
        if (explicitCursor !== null) {
          nextCursor = explicitCursor;
        } else if (
          typeof params?.path === "string" &&
          params.path !== current.file
        ) {
          nextCursor = 0;
        }
        if (!nextPath) {
          nextCursor = 0;
        }

        const nextState: URLState = {
          root: nextRoot || "",
          file: nextPath || "",
          session: "",
          cursor: nextCursor,
          pluginQuery: nextPluginQuery,
        };
        replaceURLState(nextState);
        if (nextState.file) {
          persistPluginQuery(
            nextState.root,
            nextState.file,
            nextState.pluginQuery,
          );
        }

        const rootChanged =
          (nextState.root || "") !== (currentRootIdRef.current || "");
        const fileChanged =
          (nextState.file || "") !== (fileRef.current?.path || "");
        const pluginChanged =
          JSON.stringify(nextState.pluginQuery) !==
          JSON.stringify(current.pluginQuery);

        if (pluginChanged) {
          setPluginQuery(nextState.pluginQuery);
        }

        if (!nextState.file) {
          if (nextState.root) {
            await actionHandlers.open_dir({
              path: nextState.root,
              root: nextState.root,
              preservePluginQuery: true,
              isRoot: true,
            });
          }
          return;
        }

        const cursorChanged = nextState.cursor !== fileCursorRef.current;
        if (rootChanged || fileChanged || cursorChanged) {
          await actionHandlers.open({
            path: nextState.file,
            root: nextState.root,
            cursor: nextState.cursor,
            preservePluginQuery: true,
          });
        }
      },
    }),
    [actionHandlers, sessions, handleSelectSession, replaceURLState],
  );
  useEffect(() => {
    if (!currentRootId) return;
    if (pluginsLoadedByRootRef.current[currentRootId]) return;
    void ensurePluginsLoaded(currentRootId).catch(() => {});
  }, [currentRootId, ensurePluginsLoaded]);
  const matchedPlugin = useMemo(() => {
    if (!currentRootId || !file) return null;
    const input = toPluginInput(file, pluginQuery);
    return pluginManagerRef.current.match(currentRootId, input);
  }, [currentRootId, file, pluginVersion, pluginQuery]);
  useEffect(() => {
    if (!file || pluginBypass || !matchedPlugin) return;
    if (inferReadModeFromPlugin(matchedPlugin) !== "full") return;
    if (!file.truncated) return;
    const root = file.root || currentRootId;
    if (!root) return;
    const upgradeKey = `${root}:${file.path}:${matchedPlugin.name}:${JSON.stringify(pluginQuery)}`;
    if (fullUpgradeAttemptRef.current === upgradeKey) return;
    fullUpgradeAttemptRef.current = upgradeKey;
    void actionHandlers.open({
      path: file.path,
      root,
      cursor: fileCursorRef.current || 0,
      readMode: "full",
      preservePluginQuery: true,
    });
  }, [
    file,
    pluginBypass,
    matchedPlugin,
    currentRootId,
    pluginQuery,
    actionHandlers,
  ]);
  const pluginRender = useMemo(() => {
    if (!file || pluginBypass || !matchedPlugin) return null;
    const input = toPluginInput(file, pluginQuery);
    try {
      const output = pluginManagerRef.current.run(matchedPlugin, input);
      return { plugin: matchedPlugin, output, error: "" };
    } catch (err: any) {
      return {
        plugin: matchedPlugin,
        output: null,
        error: String(err?.message || err || "plugin process failed"),
      };
    }
  }, [file, pluginBypass, matchedPlugin, pluginQuery]);
  useEffect(() => {
    if (!file || pluginBypass || !pluginRender?.output) {
      return;
    }
    const handleSelectionChange = () => {
      const root = pluginContentRef.current;
      const selection = window.getSelection();
      if (
        !root ||
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed
      ) {
        handleViewerSelectionChange(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const commonAncestor = range.commonAncestorContainer;
      if (!root.contains(commonAncestor)) {
        handleViewerSelectionChange(null);
        return;
      }
      const text = selection.toString();
      if (!text.trim()) {
        handleViewerSelectionChange(null);
        return;
      }
      handleViewerSelectionChange({
        filePath: file.path,
        text,
      });
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      handleViewerSelectionChange(null);
    };
  }, [file, pluginBypass, pluginRender?.output, handleViewerSelectionChange]);
  useEffect(() => {
    if (!file || pluginBypass || !pluginRender?.output) {
      lastPluginChapterRef.current = "";
      return;
    }
    const chapterKey = `${file.path}:${pluginQuery.chapter || "1"}`;
    if (!lastPluginChapterRef.current) {
      lastPluginChapterRef.current = chapterKey;
      return;
    }
    if (lastPluginChapterRef.current === chapterKey) {
      return;
    }
    lastPluginChapterRef.current = chapterKey;
    requestAnimationFrame(() => {
      pluginContentRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [file, pluginBypass, pluginRender?.output, pluginQuery.chapter]);
  const pluginRendererKey = `${currentRootId || ""}:${file?.path || ""}:${fileCursorRef.current}:${JSON.stringify(pluginQuery)}`;
  const pluginThemeVars = useMemo(() => {
    const theme = pluginRender?.plugin?.theme;
    if (!theme) return null;
    return {
      "--vp-overlay-bg": theme.overlayBg,
      "--vp-surface-bg": theme.surfaceBg,
      "--vp-surface-bg-elevated": theme.surfaceBgElevated,
      "--vp-text": theme.text,
      "--vp-text-muted": theme.textMuted,
      "--vp-border": theme.border,
      "--vp-primary": theme.primary,
      "--vp-primary-text": theme.primaryText,
      "--vp-radius": theme.radius,
      "--vp-shadow": theme.shadow,
      "--vp-focus-ring": theme.focusRing,
      "--vp-danger": theme.danger,
      "--vp-warning": theme.warning,
      "--vp-success": theme.success,
    } as React.CSSProperties;
  }, [pluginRender]);
  useEffect(() => {
    const body = document.body;
    if (!pluginThemeVars || pluginBypass || !pluginRender?.output) {
      body.removeAttribute("data-plugin-theme");
      body.style.removeProperty("--vp-overlay-bg");
      body.style.removeProperty("--vp-surface-bg");
      body.style.removeProperty("--vp-surface-bg-elevated");
      body.style.removeProperty("--vp-text");
      body.style.removeProperty("--vp-text-muted");
      body.style.removeProperty("--vp-border");
      body.style.removeProperty("--vp-primary");
      body.style.removeProperty("--vp-primary-text");
      body.style.removeProperty("--vp-radius");
      body.style.removeProperty("--vp-shadow");
      body.style.removeProperty("--vp-focus-ring");
      body.style.removeProperty("--vp-danger");
      body.style.removeProperty("--vp-warning");
      body.style.removeProperty("--vp-success");
      return;
    }
    body.setAttribute("data-plugin-theme", "1");
    Object.entries(pluginThemeVars).forEach(([key, value]) => {
      body.style.setProperty(key, String(value));
    });
    return () => {
      body.removeAttribute("data-plugin-theme");
      body.style.removeProperty("--vp-overlay-bg");
      body.style.removeProperty("--vp-surface-bg");
      body.style.removeProperty("--vp-surface-bg-elevated");
      body.style.removeProperty("--vp-text");
      body.style.removeProperty("--vp-text-muted");
      body.style.removeProperty("--vp-border");
      body.style.removeProperty("--vp-primary");
      body.style.removeProperty("--vp-primary-text");
      body.style.removeProperty("--vp-radius");
      body.style.removeProperty("--vp-shadow");
      body.style.removeProperty("--vp-focus-ring");
      body.style.removeProperty("--vp-danger");
      body.style.removeProperty("--vp-warning");
      body.style.removeProperty("--vp-success");
    };
  }, [pluginThemeVars, pluginBypass, pluginRender]);

  return { ensurePluginsLoaded, handleDisablePendingPlugins, handleTrustPendingPlugins, invalidatePluginsForRoot, matchedPlugin, pluginHandlers, pluginRender, pluginRendererKey, pluginThemeVars };
}
