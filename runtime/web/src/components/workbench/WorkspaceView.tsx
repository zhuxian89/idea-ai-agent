import { buildFileScrollKey } from "../../app/fileNavigation";
import React, { useCallback } from "react";
import { PluginTrustPrompt } from "../PluginTrustPrompt";
import { GitDiffViewer } from "../GitDiffViewer";
import { ModeIcon } from "../ModeIcon";
import { Renderer } from "../../renderer/Renderer";
import { persistFileScrollPositions } from "../../app/storagePrefs";
import { DefaultListView } from "../DefaultListView";
import { isIDEManagedProject } from "../../services/ideaBridge";
import type { useAppFoundation } from "../../app/workbench/useAppFoundation";
import type { useSessionDialogs } from "../../app/workbench/useSessionDialogs";
import type { useWorkbenchLayout } from "../../app/workbench/useWorkbenchLayout";
import type { useCurrentRoot } from "../../app/workbench/useCurrentRoot";
import type { useSessionSelection } from "../../app/workbench/useSessionSelection";
import type { useProjectTree } from "../../app/workbench/useProjectTree";
import type { useDirectoryUpload } from "../../app/workbench/useDirectoryUpload";
import type { usePluginState } from "../../app/workbench/usePluginState";
import type { useFileViewerState } from "../../app/workbench/useFileViewerState";
import type { useManagedRoots } from "../../app/workbench/useManagedRoots";
import type { useGit } from "../../app/workbench/useGit";
import type { useActionHandlers } from "../../app/workbench/useActionHandlers";
import type { usePlugins } from "../../app/workbench/usePlugins";
import type { useFileViewerActions } from "../../app/workbench/useFileViewerActions";
import type { useManagedRootActions } from "../../app/workbench/useManagedRootActions";
import type { useProjectSidebarModel } from "../../app/workbench/useProjectSidebarModel";
import { WorkspaceFileViewer } from "../../app/workbench/WorkspaceFileViewer";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  sessionDialogsApi: ReturnType<typeof useSessionDialogs>;
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  directoryUploadApi: ReturnType<typeof useDirectoryUpload>;
  pluginStateApi: ReturnType<typeof usePluginState>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  gitApi: ReturnType<typeof useGit>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
  pluginsApi: ReturnType<typeof usePlugins>;
  fileViewerActionsApi: ReturnType<typeof useFileViewerActions>;
  managedRootActionsApi: ReturnType<typeof useManagedRootActions>;
  projectSidebarModelApi: ReturnType<typeof useProjectSidebarModel>;
};

export function WorkspaceView({ appFoundationApi, sessionDialogsApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, projectTreeApi, directoryUploadApi, pluginStateApi, fileViewerStateApi, managedRootsApi, gitApi, actionHandlersApi, pluginsApi, fileViewerActionsApi, managedRootActionsApi, projectSidebarModelApi }: Deps) {
  const { fileCursorRef, fileRef, fileScrollPositionsRef, pluginBypassRef, pluginContentRef, selectedDirRef, t } = appFoundationApi;
  const { setScheduledAgentDialogOpen, setScheduledAgentSession } = sessionDialogsApi;
  const { gitDiffSideBySide } = workbenchLayoutApi;
  const { currentRootId, currentRootIdRef } = currentRootApi;
  const { selectedSession } = sessionSelectionApi;
  const { currentDirectorySortMode, currentDirectorySortOverride, getDirectorySortKey, mainDirectoryError, selectedDir, setDirectorySortOverrides, showHiddenFiles, visibleMainEntries } = projectTreeApi;
  const { directoryUploadAbortRef, directoryUploadProgress, handleTreeUpload } = directoryUploadApi;
  const { pluginBypass, pluginLoading, setPluginBypass } = pluginStateApi;
  const { file, fileEditStore, handleViewerSelectionChange, setFile } = fileViewerStateApi;
  const { managedRootByIdRef } = managedRootsApi;
  const { gitDiff, refreshGitStatus } = gitApi;
  const { actionHandlers, handleSessionChipClick } = actionHandlersApi;
  const { handleDisablePendingPlugins, handleTrustPendingPlugins, matchedPlugin, pluginHandlers, pluginRender, pluginRendererKey, pluginThemeVars } = pluginsApi;
  const { handleDirectoryPathClick, handleFileViewerFileClick, handleFileViewerPathClick, handleGitDiffPathClick } = fileViewerActionsApi;
  const { handleRemoveCurrentRoot } = managedRootActionsApi;
  const { activePendingPluginTrust } = projectSidebarModelApi;

  const currentFileScrollKey = buildFileScrollKey(
    file?.root || currentRootId,
    file?.path,
  );
  let workspaceView: React.ReactNode;
  const switchToRawFileView = useCallback(async () => {
    if (!file) return;
    const root = file.root || currentRootIdRef.current;
    if (!root) return;
    pluginBypassRef.current = true;
    setPluginBypass(true);
    await actionHandlers.open({
      path: file.path,
      root,
      cursor: fileCursorRef.current || 0,
      readMode: "incremental",
      preservePluginQuery: true,
    });
  }, [file, actionHandlers]);
  const switchToPluginView = useCallback(async () => {
    if (!file) return;
    const root = file.root || currentRootIdRef.current;
    if (!root) return;
    pluginBypassRef.current = false;
    setPluginBypass(false);
    await actionHandlers.open({
      path: file.path,
      root,
      cursor: fileCursorRef.current || 0,
      preservePluginQuery: true,
    });
  }, [file, actionHandlers]);
  if (activePendingPluginTrust) {
    workspaceView = (
      <PluginTrustPrompt
        bundle={activePendingPluginTrust.bundle}
        loading={pluginLoading}
        onDisable={handleDisablePendingPlugins}
        onAllow={() => {
          void handleTrustPendingPlugins();
        }}
      />
    );
  } else if (gitDiff) {
    workspaceView = (
      <GitDiffViewer
        diff={gitDiff}
        root={currentRootId}
        sideBySide={gitDiffSideBySide}
        onPathClick={handleGitDiffPathClick}
        onSessionClick={(sessionKey) =>
          handleSessionChipClick(sessionKey, currentRootIdRef.current)
        }
        onSelectionChange={handleViewerSelectionChange}
      />
    );
  } else if (file) {
    if (pluginRender && pluginRender.output) {
      workspaceView = (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              height: "36px",
              borderBottom: "1px solid var(--border-color)",
              padding: "0 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--mindfs-topbar-bg, transparent)",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ModeIcon type="plugin" size={16} />
              <span>{pluginRender.plugin.name}</span>
              {pluginLoading ? (
                <span style={{ opacity: 0.7 }}>{t("plugin.loading")}</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                void switchToRawFileView();
              }}
              style={{
                border: "1px solid var(--border-color)",
                background: "transparent",
                borderRadius: 6,
                padding: "3px 8px",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              {t("plugin.rawFile")}
            </button>
          </div>
          <div
            ref={pluginContentRef}
            className="plugin-shadcn-sandbox"
            style={{
              ...pluginThemeVars,
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: 12,
            }}
          >
            <Renderer
              key={pluginRendererKey}
              tree={pluginRender.output.tree as any}
              initialState={
                (pluginRender.output.data || {}) as Record<string, unknown>
              }
              handlers={pluginHandlers}
            />
          </div>
        </div>
      );
    } else {
      workspaceView = (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          {pluginBypass && matchedPlugin ? (
            <div
              style={{
                borderBottom: "1px solid var(--border-color)",
                padding: "8px 12px",
                fontSize: 12,
                color: "var(--text-secondary)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {t("plugin.rawViewActive", { name: matchedPlugin.name })}
              </span>
              <button
                type="button"
                onClick={() => {
                  void switchToPluginView();
                }}
                style={{
                  border: "1px solid var(--border-color)",
                  background: "transparent",
                  borderRadius: 6,
                  padding: "3px 8px",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                {t("plugin.usePlugin")}
              </button>
            </div>
          ) : null}
          {pluginRender && pluginRender.error ? (
            <div
              style={{
                borderBottom: "1px solid var(--border-color)",
                padding: "8px 12px",
                fontSize: 12,
                color: "#d97706",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {t("plugin.renderFailedFallback", {
                  name: pluginRender.plugin.name,
                })}
              </span>
              <button
                type="button"
                onClick={() => setPluginBypass(true)}
                style={{
                  border: "1px solid var(--border-color)",
                  background: "transparent",
                  borderRadius: 6,
                  padding: "3px 8px",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                {t("plugin.ignorePlugin")}
              </button>
            </div>
          ) : null}
          <WorkspaceFileViewer
            file={file}
            store={fileEditStore}
            onUpdated={(next) => {
              if (
                fileRef.current?.root === next.root &&
                fileRef.current?.path === next.path
              )
                setFile(next);
            }}
            onSaved={(next) => {
              if (
                fileRef.current?.root === next.root &&
                fileRef.current?.path === next.path
              )
                setFile(next);
              if (next.root) void refreshGitStatus(next.root);
            }}
            isVisible={!selectedSession}
            onSelectionChange={handleViewerSelectionChange}
            initialScrollTop={
              fileScrollPositionsRef.current[currentFileScrollKey] || 0
            }
            onScrollTopChange={(scrollTop) => {
              if (!currentFileScrollKey) return;
              fileScrollPositionsRef.current[currentFileScrollKey] = scrollTop;
              persistFileScrollPositions(fileScrollPositionsRef.current);
            }}
            onSessionClick={(sessionKey) =>
              handleSessionChipClick(
                sessionKey,
                file?.root || currentRootIdRef.current,
              )
            }
            onPathClick={handleFileViewerPathClick}
            onFileClick={handleFileViewerFileClick}
          />
        </div>
      );
    }
  } else {
    workspaceView = (
      <DefaultListView
        root={currentRootId || undefined}
        path={selectedDir || ""}
        entries={visibleMainEntries}
        errorMessage={mainDirectoryError}
        showHiddenFiles={showHiddenFiles}
        sortMode={currentDirectorySortMode}
        sortControlValue={currentDirectorySortOverride || "inherit"}
        uploadProgress={directoryUploadProgress}
        onCancelUpload={() => directoryUploadAbortRef.current?.abort()}
        onSortModeChange={(nextMode) => {
          const rootID = currentRootIdRef.current;
          const nextKey = getDirectorySortKey(rootID, selectedDirRef.current);
          if (!nextKey) {
            return;
          }
          setDirectorySortOverrides((prev) => {
            if (nextMode === "inherit") {
              if (!(nextKey in prev)) {
                return prev;
              }
              const next = { ...prev };
              delete next[nextKey];
              return next;
            }
            return { ...prev, [nextKey]: nextMode };
          });
        }}
        onUploadFiles={handleTreeUpload}
        isGitRepo={
          managedRootByIdRef.current[currentRootId || ""]?.is_git_repo === true
        }
        isGitWorktree={
          managedRootByIdRef.current[currentRootId || ""]?.is_git_worktree ===
          true
        }
        enableGitHistoryToggle={false}
        onOpenScheduledAgentTasks={() => { setScheduledAgentSession(null); setScheduledAgentDialogOpen(true); }}
        onRemoveRoot={isIDEManagedProject ? undefined : handleRemoveCurrentRoot}
        onItemClick={(e) =>
          e.is_dir
            ? actionHandlers.open_dir({ path: e.path })
            : actionHandlers.open({ path: e.path })
        }
        onPathClick={handleDirectoryPathClick}
      />
    );
  }

  return <>{workspaceView}</>;
}
