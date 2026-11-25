import { basenameOfPath } from "./app/fileNavigation";
import { ActionBar } from "./components/ActionBar";
import { BottomSheet } from "./components/BottomSheet";
import { FileTree } from "./components/FileTree";
import { ConnectionErrorDialog } from "./components/remote/ConnectionErrorDialog";
import { HandoffPackDialog } from "./components/HandoffPackDialog";
import { ScheduledAgentTaskDialog } from "./components/ScheduledAgentTaskDialog";
import { SessionTabs } from "./components/SessionTabs";
import { SessionViewer } from "./components/SessionViewer";
import { ToastContainer } from "./components/Toast";

import { UserMessageSummaryButton } from "./components/UserMessageSummaryButton";
import { AppShell } from "./layout/AppShell";
import { isRelayNodePage } from "./services/base";
import { bootstrapService } from "./services/bootstrap";
import {
  isIdeaRuntime,
  isStandaloneRuntime,
  standaloneVersion,
  isIDEManagedProject,
} from "./services/ideaBridge";
import { RemoteAccessDialog, RemoteQRDialog } from "./components/remote/RemoteAccessDialog";
import { SystemMonitor } from "./components/SystemMonitor";
import { useAppFoundation } from "./app/workbench/useAppFoundation";
import { useSessionList } from "./app/workbench/useSessionList";
import { useExternalSessionImport } from "./app/workbench/useExternalSessionImport";
import { useAgentCatalog } from "./app/workbench/useAgentCatalog";
import { useSessionDialogs } from "./app/workbench/useSessionDialogs";
import { useDirectoryUpload } from "./app/workbench/useDirectoryUpload";
import { useSessionSelection } from "./app/workbench/useSessionSelection";
import { useWorkbenchLayout } from "./app/workbench/useWorkbenchLayout";
import { useCurrentRoot } from "./app/workbench/useCurrentRoot";
import { useManagedRoots } from "./app/workbench/useManagedRoots";
import { useRelayConnection } from "./app/workbench/useRelayConnection";
import { useProjectTree } from "./app/workbench/useProjectTree";
import { useFileViewerState } from "./app/workbench/useFileViewerState";
import { usePluginState } from "./app/workbench/usePluginState";
import { useAppServices } from "./app/workbench/useAppServices";
import { usePlugins } from "./app/workbench/usePlugins";
import { useRootReset } from "./app/workbench/useRootReset";
import { useSessionCacheState } from "./app/workbench/useSessionCacheState";
import { useGit } from "./app/workbench/useGit";
import { useWorkbenchSessionNavigation } from "./app/workbench/useWorkbenchSessionNavigation";
import { useSessionMessaging } from "./app/workbench/useSessionMessaging";
import { useFileViewerActions } from "./app/workbench/useFileViewerActions";
import { useActionHandlers } from "./app/workbench/useActionHandlers";
import { useManagedRootActions } from "./app/workbench/useManagedRootActions";
import { useGitFileStats } from "./app/workbench/useGitFileStats";
import { useWorkspaceEvents } from "./app/workbench/useWorkspaceEvents";
import { useAppBootstrap } from "./app/workbench/useAppBootstrap";
import { useUrlNavigation } from "./app/workbench/useUrlNavigation";
import { useActionBarModel } from "./app/workbench/useActionBarModel";
import { useSessionRestore } from "./app/workbench/useSessionRestore";
import { useSessionViewModel } from "./app/workbench/useSessionViewModel";
import { WorkspaceView } from "./components/workbench/WorkspaceView";
import { SelectedSessionView } from "./components/workbench/SelectedSessionView";
import { slashCommandResultForSession } from "./app/slashCommandResults";
import { SlashCommandResultBanner } from "./components/SlashCommandResultBanner";
import { useProjectSidebarModel } from "./app/workbench/useProjectSidebarModel";
import { useRelayChrome } from "./app/workbench/useRelayChrome";
import { useSessionSidebarModel } from "./app/workbench/useSessionSidebarModel";
import { SessionSidebar } from "./components/workbench/SessionSidebar";
import type { AppProps } from "./app/workbench/appProps";

export function App(props: AppProps) {
  const { onGoHome } = props;
  const appFoundationApi = useAppFoundation();
  const sessionDialogsApi = useSessionDialogs();
  const workbenchLayoutApi = useWorkbenchLayout();
  const currentRootApi = useCurrentRoot();
  const sessionSelectionApi = useSessionSelection({ appFoundationApi, workbenchLayoutApi, currentRootApi });
  const projectTreeApi = useProjectTree({ appFoundationApi, currentRootApi });
  const directoryUploadApi = useDirectoryUpload({ appFoundationApi, currentRootApi, projectTreeApi });
  const pluginStateApi = usePluginState();
  const fileViewerStateApi = useFileViewerState({ appFoundationApi, currentRootApi, pluginStateApi });
  const relayConnectionApi = useRelayConnection({ currentRootApi, fileViewerStateApi });
  const managedRootsApi = useManagedRoots({ appFoundationApi, sessionSelectionApi, projectTreeApi, relayConnectionApi });
  const sessionListApi = useSessionList({ workbenchLayoutApi, currentRootApi, sessionSelectionApi, managedRootsApi });
  const appServicesApi = useAppServices({ currentRootApi, projectTreeApi });
  const rootResetApi = useRootReset({ appFoundationApi, sessionSelectionApi, projectTreeApi, sessionListApi });
  const sessionCacheStateApi = useSessionCacheState({ appFoundationApi, currentRootApi, sessionSelectionApi, sessionListApi });
  const gitApi = useGit({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, projectTreeApi, fileViewerStateApi, managedRootsApi });
  const workbenchSessionNavigationApi = useWorkbenchSessionNavigation({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, projectTreeApi, pluginStateApi, fileViewerStateApi, sessionListApi, sessionCacheStateApi, gitApi });
  const externalSessionImportApi = useExternalSessionImport({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionListApi, workbenchSessionNavigationApi });
  const sessionMessagingApi = useSessionMessaging({ appFoundationApi, currentRootApi, sessionSelectionApi, pluginStateApi, fileViewerStateApi, sessionListApi, sessionCacheStateApi, workbenchSessionNavigationApi });
  const agentCatalogApi = useAgentCatalog({ appFoundationApi, currentRootApi, sessionSelectionApi, relayConnectionApi, sessionMessagingApi });
  const actionHandlersApi = useActionHandlers({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, projectTreeApi, pluginStateApi, fileViewerStateApi, relayConnectionApi, managedRootsApi, sessionListApi, gitApi, workbenchSessionNavigationApi });
  const pluginsApi = usePlugins({ appFoundationApi, currentRootApi, pluginStateApi, fileViewerStateApi, managedRootsApi, sessionListApi, workbenchSessionNavigationApi, actionHandlersApi });
  const fileViewerActionsApi = useFileViewerActions({ appFoundationApi, currentRootApi, fileViewerStateApi, gitApi, actionHandlersApi });
  const managedRootActionsApi = useManagedRootActions({ appFoundationApi, currentRootApi, sessionSelectionApi, projectTreeApi, fileViewerStateApi, managedRootsApi, sessionListApi, rootResetApi, actionHandlersApi });
  const gitFileStatsApi = useGitFileStats({ currentRootApi, sessionListApi, gitApi, externalSessionImportApi });
  useWorkspaceEvents({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, projectTreeApi, fileViewerStateApi, relayConnectionApi, managedRootsApi, sessionListApi, appServicesApi, sessionCacheStateApi, gitApi, externalSessionImportApi, sessionMessagingApi, agentCatalogApi, actionHandlersApi, pluginsApi, managedRootActionsApi });
  useAppBootstrap({ appFoundationApi, currentRootApi, projectTreeApi, pluginStateApi, relayConnectionApi, managedRootsApi, sessionListApi, workbenchSessionNavigationApi, agentCatalogApi, actionHandlersApi, pluginsApi });
  useUrlNavigation({ appFoundationApi, currentRootApi, projectTreeApi, pluginStateApi, sessionListApi, workbenchSessionNavigationApi, actionHandlersApi });
  const actionBarModelApi = useActionBarModel({ appFoundationApi, currentRootApi, sessionSelectionApi, sessionCacheStateApi });
  const sessionRestoreApi = useSessionRestore({ appFoundationApi, currentRootApi, sessionSelectionApi, sessionListApi, sessionCacheStateApi, actionHandlersApi });
  const sessionViewModelApi = useSessionViewModel({ appFoundationApi, currentRootApi, sessionSelectionApi, projectTreeApi, managedRootsApi, sessionListApi, sessionCacheStateApi, actionHandlersApi, sessionRestoreApi });
  const projectSidebarModelApi = useProjectSidebarModel({ appFoundationApi, currentRootApi, sessionSelectionApi, projectTreeApi, pluginStateApi, fileViewerStateApi, managedRootsApi, appServicesApi, sessionCacheStateApi, gitApi, actionHandlersApi, gitFileStatsApi, sessionRestoreApi, sessionViewModelApi });
  const relayChromeApi = useRelayChrome({ appFoundationApi, currentRootApi, relayConnectionApi, managedRootsApi, appServicesApi });
  const sessionSidebarModelApi = useSessionSidebarModel({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, managedRootsApi, sessionListApi, sessionCacheStateApi, sessionRestoreApi });
  const { didInitRef, drawerOpenByRootRef, interactionModeRef, t } = appFoundationApi;
  const { handoffSession, scheduledAgentDialogOpen, scheduledAgentSession, setHandoffSession, setScheduledAgentDialogOpen } = sessionDialogsApi;
  const { gitDiffSideBySide, isLeftOpen, isMobile, isRightOpen, phoneFilter, remoteDevice, remotePhone, setGitDiffSideBySide, setIsLeftOpen, setIsRightOpen, setPhoneFilter, setSidebarsSwapped, sidebarsSwapped } = workbenchLayoutApi;
  const { currentRootId, currentRootIdRef } = currentRootApi;
  const { activeBoundSessionKey, currentSession, drawerLoadingSessionByRoot, editDraftRequest, interactionMode, isDrawerOpen, pendingPlanMode, rootSessionKey, selectedSession, setDrawerOpenForRoot, setEditDraftRequest, setInteractionMode, slashCommandResults } = sessionSelectionApi;
  const { entriesByPath, expanded, projectTreeTabRequest, selectedDirKey, setProjectTreeTab, setShowHiddenFiles, setTreeSortMode, showHiddenFiles, treeSortMode } = projectTreeApi;
  const { attachedFileContext, file, status } = fileViewerStateApi;
  const { bootstrapState, relayStatus } = relayConnectionApi;
  const { managedRootByIdRef, rootEntries } = managedRootsApi;
  const { multiProjectSessionsEnabled, sessionListMode, sessionSearchResultsMode, setMultiProjectSessionsEnabled } = sessionListApi;
  const { handleStartUpdate } = appServicesApi;
  const { handleSetPlanMode } = sessionCacheStateApi;
  const { gitDiff } = gitApi;
  const { handleForkAgentMessage, handleSelectSession } = workbenchSessionNavigationApi;
  const { handleCancelCurrentTurn, handleCloseSessionTab, handleNewSession, handleRemoveQueuedMessage, handleSelectSessionTab, handleSendMessage, handleSendQueuedMessageNow, handleUpdateQueuedMessage } = sessionMessagingApi;
  const { agentsVersion, availableAgents, handleRestartAgent, handleRunAgentLifecycleCommand } = agentCatalogApi;
  const { actionHandlers, actionHandlersRef } = actionHandlersApi;
  const { handleClearFileContext, handleRequestFileContext } = fileViewerActionsApi;
  const { refreshManagedRoots } = managedRootActionsApi;
  const { gitFileStatsByPath } = gitFileStatsApi;
  const { actionBarInputHistory, actionBarQueuedMessages, actionBarSession, canOpenSessionDrawer, detachedBoundSession, selectedKey, selectedRoot } = actionBarModelApi;
  const { drawerSessionSnapshot, handleAskUserAnswer, handleDrawerSessionFileClick, handleEditUserMessage, handleRemoveSessionRelatedFile, ideaUserMessageSummaries, rootSessionIndicators } = sessionViewModelApi;
  const { handleProjectTreeRefresh, renderRootGitContent, renderRootRelatedContent, renderRootWorktreeContent } = projectSidebarModelApi;
  const { handleRelayAction, publicStandaloneVersion, relayActionDisabled, relayActionLabel, setStandaloneRemoteOpen, showUpdateButton, standalonePage, standaloneRemoteOpen, updateBusy, updateHelp, updateLabel, updateSummary } = relayChromeApi;
  const { activeSessionTabKey, currentOpenSessionTabs, getPhoneFacts, phoneGroups } = sessionSidebarModelApi;

  const currentRootSlashCommandResult = slashCommandResultForSession(
    slashCommandResults,
    rootSessionKey,
    currentRootId,
    null,
  );

  return (
    <>
      <AppShell
        ideaWorkbench={
          isIdeaRuntime
            ? {
                projectName: basenameOfPath(
                  managedRootByIdRef.current[currentRootId || ""]?.root_path ||
                    currentRootId ||
                    "",
                ),
                onNewSession: handleNewSession,
                composerAction: ideaUserMessageSummaries.length ? (
                  <UserMessageSummaryButton
                    key={activeSessionTabKey}
                    summaries={ideaUserMessageSummaries}
                  />
                ) : null,
              }
            : undefined
        }
        leftOpen={isLeftOpen}
        rightOpen={isRightOpen}
        sidebarsSwapped={sidebarsSwapped}
        onCloseLeft={() => setIsLeftOpen(false)}
        onCloseRight={() => setIsRightOpen(false)}
        onOpenLeft={() => { setIsLeftOpen(true); if (isMobile) setIsRightOpen(false); }}
        onOpenRight={() => { setIsRightOpen(true); if (isMobile) setIsLeftOpen(false); }}
        remotePhoneProps={remotePhone ? {
          title: selectedSession?.name || (file?.name ?? ""),
          viewingFile: !selectedSession && !!(file || gitDiff),
          project: managedRootByIdRef.current[selectedRoot]?.display_name || selectedRoot,
          root: selectedRoot || currentRootId || "",
          activeKey: selectedKey,
          groups: phoneGroups,
          filter: phoneFilter,
          onFilter: setPhoneFilter,
          facts: getPhoneFacts,
          onSession: handleSelectSession,
          importOpen: sessionListMode === "import" || sessionSearchResultsMode,
          connection: status,
          multiProjectSessionsEnabled,
        } : undefined}
        remoteTopBar={{
          multiProjectSessionsEnabled,
          onMultiProjectSessionsChange: setMultiProjectSessionsEnabled,
        }}
        sidebar={
          <FileTree
            onProjectAdded={async (rootId) => {
              await refreshManagedRoots();
              await actionHandlersRef.current.open_dir({ path: rootId, root: rootId, isRoot: true });
            }}
            agentSettingsOnly={isIdeaRuntime}
            agentSettingsActive={isLeftOpen}
            agentsVersion={agentsVersion}
            entries={rootEntries}
            childrenByPath={entriesByPath}
            expanded={expanded}
            sortMode={treeSortMode}
            showHiddenFiles={showHiddenFiles}
            onSortModeChange={setTreeSortMode}
            onShowHiddenFilesChange={setShowHiddenFiles}
            onRefresh={handleProjectTreeRefresh}
            selectedDirKey={selectedDirKey}
            selectedPath={file?.path}
            rootId={currentRootId}
            rootSessionIndicators={rootSessionIndicators}
            onSelectFile={(e, r) => {
              actionHandlers.open({ path: e.path, root: r });
              if (isMobile) setIsLeftOpen(false);
            }}
            onSelectRoot={(e, r) =>
              actionHandlers.open_dir({
                path: e.path,
                root: r,
                isRoot: e.is_root === true,
                suppressTreeExpand: !remotePhone,
                toggle: remotePhone,
              })
            }
            onToggleDir={(e, r) =>
              actionHandlers.open_dir({
                path: e.path,
                root: r,
                toggle: true,
                isRoot: e.is_root === true,
              })
            }
            renderRootExtraContent={renderRootGitContent}
            renderRootWorktreeContent={renderRootWorktreeContent}
            renderRootRelatedContent={renderRootRelatedContent}
            projectTreeTabRequest={projectTreeTabRequest}
            onProjectTreeTabChange={setProjectTreeTab}
            relayActionLabel={relayActionLabel}
            relayActionDisabled={relayActionDisabled}
            footerTop={isStandaloneRuntime && !isMobile ? <SystemMonitor /> : null}
            relayActionHelp={standalonePage && standaloneVersion && !publicStandaloneVersion ? t("standalone.version", { version: standaloneVersion }) : null}
            publicStandaloneVersion={publicStandaloneVersion}
            onRelayAction={handleRelayAction}
            relayNodeId={relayStatus?.node_id || ""}
            relayBaseURL={relayStatus?.relay_base_url || ""}
            relayNoRelayer={
              isIDEManagedProject || relayStatus?.no_relayer === true
            }
            updateActionLabel={showUpdateButton ? updateLabel : null}
            updateActionDisabled={updateBusy}
            updateActionHelp={showUpdateButton ? updateHelp : ""}
            updateActionBusy={updateBusy}
            updateActionSummary={showUpdateButton ? updateSummary : ""}
            onUpdateAction={() => {
              void handleStartUpdate();
            }}
            sidebarsSwapped={sidebarsSwapped}
            onSidebarsSwappedChange={setSidebarsSwapped}
            gitDiffSideBySide={gitDiffSideBySide}
            onGitDiffSideBySideChange={setGitDiffSideBySide}
            multiProjectSessionsEnabled={multiProjectSessionsEnabled}
            onMultiProjectSessionsChange={setMultiProjectSessionsEnabled}
            onRunAgentLifecycleCommand={async (...args) => {
              await handleRunAgentLifecycleCommand(...args);
              if (isIdeaRuntime) {
                setIsLeftOpen(false);
                setIsRightOpen(false);
              }
            }}
            onRestartAgent={handleRestartAgent}
            onGoHome={onGoHome}
          />
        }
        rightSidebar={
          <SessionSidebar
          appFoundationApi={appFoundationApi}
          sessionDialogsApi={sessionDialogsApi}
          workbenchLayoutApi={workbenchLayoutApi}
          currentRootApi={currentRootApi}
          sessionSelectionApi={sessionSelectionApi}
          sessionListApi={sessionListApi}
          workbenchSessionNavigationApi={workbenchSessionNavigationApi}
          externalSessionImportApi={externalSessionImportApi}
          agentCatalogApi={agentCatalogApi}
          actionHandlersApi={actionHandlersApi}
          sessionSidebarModelApi={sessionSidebarModelApi}
          />
        }
        main={
          <div
            data-onboarding="workspace"
            style={{
              width: "100%",
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              position: "relative",
            }}
          >
            {isIdeaRuntime && currentRootId ? (
              <SessionTabs
                tabs={currentOpenSessionTabs}
                activeKey={activeSessionTabKey}
                ariaLabel={t("sessionTabs.label")}
                previousLabel={t("sessionTabs.previous")}
                nextLabel={t("sessionTabs.next")}
                closeLabel={(name) => t("sessionTabs.close", { name })}
                runningLabel={t("sessionList.replying")}
                onSelect={(key) => handleSelectSessionTab(currentRootId, key)}
                onClose={(key) => handleCloseSessionTab(currentRootId, key)}
              />
            ) : null}

            <div
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                id="idea-active-session-panel"
                role="tabpanel"
                style={{
                  display: selectedSession ? "flex" : "none",
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                }}
              >
                <SelectedSessionView
                  workbenchLayoutApi={workbenchLayoutApi}
                  currentRootApi={currentRootApi}
                  sessionSelectionApi={sessionSelectionApi}
                  fileViewerStateApi={fileViewerStateApi}
                  managedRootsApi={managedRootsApi}
                  workbenchSessionNavigationApi={workbenchSessionNavigationApi}
                  agentCatalogApi={agentCatalogApi}
                  actionHandlersApi={actionHandlersApi}
                  gitFileStatsApi={gitFileStatsApi}
                  sessionRestoreApi={sessionRestoreApi}
                  sessionViewModelApi={sessionViewModelApi}
                />
              </div>
              <div
                style={{
                  display: selectedSession ? "none" : "flex",
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  flexDirection: "column",
                }}
              >
                {isIdeaRuntime ? (
                  <div className="idea-empty-chat">
                    <h2>{t("idea.startChat")}</h2>
                    <p>{t("idea.startHint")}</p>
                  </div>
                ) : (
                  <WorkspaceView
                    appFoundationApi={appFoundationApi}
                    sessionDialogsApi={sessionDialogsApi}
                    workbenchLayoutApi={workbenchLayoutApi}
                    currentRootApi={currentRootApi}
                    sessionSelectionApi={sessionSelectionApi}
                    projectTreeApi={projectTreeApi}
                    directoryUploadApi={directoryUploadApi}
                    pluginStateApi={pluginStateApi}
                    fileViewerStateApi={fileViewerStateApi}
                    managedRootsApi={managedRootsApi}
                    gitApi={gitApi}
                    actionHandlersApi={actionHandlersApi}
                    pluginsApi={pluginsApi}
                    fileViewerActionsApi={fileViewerActionsApi}
                    managedRootActionsApi={managedRootActionsApi}
                    projectSidebarModelApi={projectSidebarModelApi}
                  />
                )}
              </div>
            </div>
          </div>
        }
        footer={
          <div
            style={{
              width: "100%",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              background: "var(--content-bg)",
            }}
          >
            {currentRootSlashCommandResult ? (
              <div
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: isMobile ? "0 0 6px" : "0 16px 8px",
                }}
              >
                <SlashCommandResultBanner result={currentRootSlashCommandResult} />
              </div>
            ) : null}
            <ActionBar
              compactWorkbench={isIdeaRuntime}
              remoteDevice={remoteDevice}
              status={status}
              agentsVersion={agentsVersion}
              currentRootId={currentRootId}
              currentSession={actionBarSession}
              pendingPlanMode={pendingPlanMode}
              attachedFileContext={attachedFileContext}
              canOpenSessionDrawer={canOpenSessionDrawer}
              sessionDrawerOpen={isDrawerOpen}
              detachedBoundSession={detachedBoundSession}
              editDraftRequest={editDraftRequest}
              queuedMessages={actionBarQueuedMessages}
              inputHistory={actionBarInputHistory}
              onSendMessage={handleSendMessage}
              onSetPlanMode={handleSetPlanMode}
              onCancelCurrentTurn={handleCancelCurrentTurn}
              onRemoveQueuedMessage={handleRemoveQueuedMessage}
              onUpdateQueuedMessage={handleUpdateQueuedMessage}
              onSendQueuedMessageNow={handleSendQueuedMessageNow}
              onNewSession={handleNewSession}
              onRequestFileContext={handleRequestFileContext}
              onClearFileContext={handleClearFileContext}
              onToggleLeftSidebar={() => { setIsLeftOpen(v => !v); if (isMobile) setIsRightOpen(false); }}
              onToggleRightSidebar={() => { setIsRightOpen(v => !v); if (isMobile) setIsLeftOpen(false); }}
              sidebarsSwapped={sidebarsSwapped}
              onSessionClick={() => {
                const rootID = currentRootIdRef.current;
                if (!activeBoundSessionKey) return;
                const selectedKey =
                  selectedSession?.key || selectedSession?.session_key;
                const isBoundSessionInMain =
                  selectedKey === activeBoundSessionKey &&
                  interactionMode !== "drawer";
                if (isBoundSessionInMain) return;
                const isDrawerCurrentlyOpen =
                  !!drawerOpenByRootRef.current[rootID || ""];
                if (isDrawerCurrentlyOpen) {
                  interactionModeRef.current = "main";
                  setInteractionMode("main");
                  setDrawerOpenForRoot(rootID, false);
                  return;
                }
                setInteractionMode("drawer");
                setDrawerOpenForRoot(rootID, true);
              }}
            />
          </div>
        }
        drawer={
          <BottomSheet
            inline={isIdeaRuntime}
            isOpen={isDrawerOpen}
            onClose={() => {
              interactionModeRef.current = "main";
              setInteractionMode("main");
              setDrawerOpenForRoot(currentRootIdRef.current, false);
            }}
            onExpand={() => {
              handleSelectSession(currentSession);
              setDrawerOpenForRoot(currentRootIdRef.current, false);
            }}
          >
            {drawerSessionSnapshot ? (
              <SessionViewer
                connected={status === "connected"}
                session={drawerSessionSnapshot}
                agents={availableAgents}
                slashCommandResult={slashCommandResultForSession(
                  slashCommandResults,
                  rootSessionKey,
                  currentRootId,
                  drawerSessionSnapshot,
                )}
                targetSeq={currentSession?.search_seq}
                targetSeqRequestKey={currentSession?.search_target_id}
                loading={
                  drawerLoadingSessionByRoot[currentRootId || ""] ===
                  (drawerSessionSnapshot.key ||
                    drawerSessionSnapshot.session_key)
                }
                rootId={currentRootId}
                rootPath={
                  managedRootByIdRef.current[currentRootId || ""]?.root_path ||
                  null
                }
                interactionMode="drawer"
                gitFileStatsByPath={gitFileStatsByPath}
                onFileClick={handleDrawerSessionFileClick}
                onRootClick={(root) => {
                  void actionHandlers.open_dir({
                    path: root,
                    root,
                    isRoot: true,
                    forceDirectory: true,
                    suppressTreeExpand: true,
                  });
                }}
                onRemoveRelatedFile={(path, head, repoPath, repoKind) =>
                  void handleRemoveSessionRelatedFile(
                    currentRootId,
                    drawerSessionSnapshot?.key ||
                      drawerSessionSnapshot?.session_key,
                    path,
                    head,
                    repoPath,
                    repoKind,
                  )
                }
                onAskUserAnswer={handleAskUserAnswer}
                onEditUserMessage={handleEditUserMessage}
                onForkAgentMessage={(seq) =>
                  void handleForkAgentMessage(
                    currentRootId,
                    drawerSessionSnapshot?.key ||
                      drawerSessionSnapshot?.session_key,
                    seq,
                  )
                }
              />
            ) : (
              <div style={{ padding: "40px", textAlign: "center" }}>
                {t("session.startHint")}
              </div>
            )}
          </BottomSheet>
        }
      />

      {bootstrapState.phase === "error" ? (
        <ConnectionErrorDialog
          error={bootstrapState.error}
          onRetry={() => {
            didInitRef.current = false;
            void bootstrapService.start();
          }}
        />
      ) : null}

      <ScheduledAgentTaskDialog
        open={scheduledAgentDialogOpen}
        rootId={scheduledAgentSession?.root_id || currentRootId}
        session={scheduledAgentSession}
        agents={availableAgents}
        onClose={() => setScheduledAgentDialogOpen(false)}
      />

      <HandoffPackDialog session={handoffSession} onClose={() => setHandoffSession(null)} onInsert={pack => {
        setEditDraftRequest(prev => ({ id: (prev?.id || 0) + 1, content: pack, mode: "append" }));
        if (isMobile) setIsRightOpen(false);
      }} />
      <ToastContainer />
      {standaloneRemoteOpen ? (
        isRelayNodePage()
          ? <RemoteQRDialog url={window.location.href} onClose={() => setStandaloneRemoteOpen(false)} />
          : <RemoteAccessDialog projectName={basenameOfPath(managedRootByIdRef.current[currentRootId || ""]?.root_path || currentRootId || "")} onClose={() => setStandaloneRemoteOpen(false)} />
      ) : null}
    </>
  );
}
