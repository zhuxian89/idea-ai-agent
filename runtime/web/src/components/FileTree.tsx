import "./workspaceSidebar.css";
import React from "react";
import { StandaloneProjects } from "./StandaloneProjects";
import { isIDEManagedProject } from "../services/ideaBridge";
import { isRemoteWebUi } from "../services/remoteUi";
import { PhoneAgentBackup } from "./remoteui/PhoneAgentBackup";
import { PhoneSheet } from "./remoteui/PhoneSheet";
import { GlowSettingsDialog } from "./remoteui/GlowSettingsDialog";
import { IdeaAgentSettings } from "./IdeaAgentSettings";
import { FileTreeProps } from "./fileTreeModel";
import { useFileTreeMenus } from "./fileTree/useFileTreeMenus";
import { useEntryRenderer } from "./fileTree/useEntryRenderer";
import { useFileTreeMenuBehavior } from "./fileTree/useFileTreeMenuBehavior";
import { useProjectTreeTab } from "./fileTree/useProjectTreeTab";
import { useFileTreePreferenceState } from "./fileTree/useFileTreePreferenceState";
import { useAgentConfigFlow } from "./fileTree/useAgentConfigFlow";
import { useAgentLifecycleState } from "./fileTree/useAgentLifecycleState";
import { useRelayServices } from "./fileTree/useRelayServices";
import { useFooterState } from "./fileTree/useFooterState";
import { useFileTreePreferences } from "./fileTree/useFileTreePreferences";
import { useAgentConfigurationView } from "./fileTree/useAgentConfigurationView";
import { useAgentLifecycle } from "./fileTree/useAgentLifecycle";
import { useAgentLifecycleOutsideClick } from "./fileTree/useAgentLifecycleOutsideClick";
import { usePhonePanels } from "./fileTree/usePhonePanels";
import { FileTreeFooter } from "./fileTree/FileTreeFooter";
import { FileTreeSettingsMenu } from "./fileTree/FileTreeSettingsMenu";
import { FileTreeAgentConfigDialog } from "./fileTree/FileTreeAgentConfigDialog";
export type { ProjectTreeTab, AgentConfigSwitchRequest } from "./fileTreeModel";

export function FileTree({
  onProjectAdded,
  agentSettingsOnly = false,
  agentSettingsActive = false,
  agentsVersion = 0,
  entries,
  childrenByPath,
  expanded,
  sortMode,
  showHiddenFiles = false,
  selectedDirKey,
  selectedPath,
  rootId,
  rootSessionIndicators = {},
  fileMetas = {},
  activeSessionKey,
  onSortModeChange,
  onShowHiddenFilesChange,
  onRefresh,
  onSelectFile,
  onSelectRoot,
  onToggleDir,
  renderRootExtraContent,
  renderRootWorktreeContent,
  agentConfigSwitchRequest = null,
  agentMenuRequest = null,
  onAgentMenuOpened,
  onAgentConfigSwitched,
  onProjectTreeTabChange,
  relayActionLabel = null,
  relayActionDisabled = false,
  relayActionHelp = null,
  footerTop = null,
  publicStandaloneVersion,
  onRelayAction,
  relayNodeId = "",
  relayBaseURL = "",
  relayNoRelayer = false,
  updateActionLabel = null,
  updateActionDisabled = false,
  updateActionHelp = null,
  updateActionBusy = false,
  updateActionSummary = null,
  onUpdateAction,
  sidebarsSwapped = false,
  onSidebarsSwappedChange,
  gitDiffSideBySide = false,
  onGitDiffSideBySideChange,
  multiProjectSessionsEnabled = false,
  onMultiProjectSessionsChange,
  onRunAgentLifecycleCommand,
  onRestartAgent,
  onGoHome,
}: FileTreeProps) {
  const fileTreeMenusApi = useFileTreeMenus({ props: { updateActionLabel, updateActionSummary } });
  const projectTreeTabApi = useProjectTreeTab({ props: { onProjectTreeTabChange, onRefresh } });
  const entryRendererApi = useEntryRenderer({ fileTreeMenusApi, projectTreeTabApi, props: { activeSessionKey, childrenByPath, expanded, fileMetas, onSelectFile, onSelectRoot, onToggleDir, renderRootExtraContent, renderRootWorktreeContent, rootId, rootSessionIndicators, selectedDirKey, selectedPath, showHiddenFiles, sortMode } });
  const fileTreePreferenceStateApi = useFileTreePreferenceState();
  const agentLifecycleStateApi = useAgentLifecycleState();
  const agentConfigFlowApi = useAgentConfigFlow({ fileTreeMenusApi, fileTreePreferenceStateApi, agentLifecycleStateApi, props: { agentConfigSwitchRequest, agentMenuRequest, onAgentConfigSwitched, onAgentMenuOpened } });
  const footerStateApi = useFooterState({ fileTreeMenusApi, props: { footerTop, onGoHome, relayActionHelp, relayActionLabel, relayNoRelayer, updateActionHelp, updateActionLabel } });
  const agentLifecycleApi = useAgentLifecycle({ fileTreeMenusApi, agentLifecycleStateApi, agentConfigFlowApi, props: { agentSettingsOnly, onRestartAgent, onRunAgentLifecycleCommand } });
  const fileTreeMenuBehaviorApi = useFileTreeMenuBehavior({ fileTreeMenusApi, agentLifecycleApi, props: { agentSettingsActive, agentSettingsOnly, agentsVersion } });
  const relayServicesApi = useRelayServices({ fileTreeMenuBehaviorApi });
  const fileTreePreferencesApi = useFileTreePreferences({ fileTreeMenusApi, fileTreePreferenceStateApi, agentLifecycleStateApi, agentConfigFlowApi, relayServicesApi });
  const agentConfigurationViewApi = useAgentConfigurationView({ agentLifecycleStateApi, agentConfigFlowApi, agentLifecycleApi, fileTreeMenuBehaviorApi, props: { agentSettingsOnly } });
  useAgentLifecycleOutsideClick({ agentLifecycleStateApi, agentLifecycleApi, fileTreeMenuBehaviorApi, props: { agentSettingsOnly } });
  const phonePanelsApi = usePhonePanels({ fileTreeMenusApi, fileTreePreferenceStateApi, agentLifecycleStateApi, agentConfigFlowApi, agentLifecycleApi, fileTreeMenuBehaviorApi, relayServicesApi, agentConfigurationViewApi, props: { relayBaseURL, relayNoRelayer, relayNodeId } });
  const { closeGlowDialog, glowDialogOpen, isMenuOpen, menuRef, phoneBackupOpen, setIsAppearanceMenuOpen, setIsLocaleMenuOpen, setIsMenuOpen, setIsSortMenuOpen, setPhoneBackupOpen, t } = fileTreeMenusApi;
  const { handleRefreshClick, projectTreeTab, setProjectTreeTab, setTreePressed, treePressed, treeRefreshing } = projectTreeTabApi;
  const { renderEntries } = entryRendererApi;
  const { agentLifecycleAgents, agentLifecycleBusy, agentLifecycleError, agentLifecycleNotice, agentProbingAgent } = agentLifecycleStateApi;
  const { agentConfigBusy, agentConfigError, agentConfigRestartingAgent } = agentConfigFlowApi;
  const { probeAgentFromSettings, restartAgentFromConfigList, runAgentLifecycleCommand } = agentLifecycleApi;
  const { inPhoneMore } = fileTreeMenuBehaviorApi;
  const { closePhonePanel, glowTitle, phonePanelTitle, settingsPanels, showGlowSettings } = phonePanelsApi;

  if (agentSettingsOnly) {
    return <IdeaAgentSettings agents={agentLifecycleAgents} busy={agentLifecycleBusy || agentConfigBusy}
      projectReady={!!rootId} notice={agentLifecycleNotice}
      probingAgent={agentProbingAgent}
      restartingAgent={agentConfigRestartingAgent}
      error={agentLifecycleError || agentConfigError}
      onProbe={probeAgentFromSettings} onRestart={restartAgentFromConfigList} onRun={runAgentLifecycleCommand} />;
  }
  return (
    <div className="workspace-projects" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <FileTreeAgentConfigDialog agentConfigFlowApi={agentConfigFlowApi} agentConfigurationViewApi={agentConfigurationViewApi} fileTreeMenusApi={fileTreeMenusApi} />
      {showGlowSettings ? <GlowSettingsDialog title={glowTitle} open={glowDialogOpen} onClose={closeGlowDialog} /> : null}
      {!isIDEManagedProject ? <div className="workspace-projects-title"><span>{t("fileTree.projects")}</span><StandaloneProjects compact onAdded={onProjectAdded} /></div> : null}
      <div className="workspace-files-toolbar" style={{ position: "relative", height: "36px", padding: "0 3px", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--mindfs-topbar-bg, transparent)", boxSizing: "border-box", flexShrink: 0, gap: 0, overflow: "visible" }}>
        <div style={{ display: "flex", alignItems: "center", minWidth: 0, flex: "1 1 auto", maxWidth: "calc(100% - 56px)", marginRight: "6px" }}>
          {isRemoteWebUi ? (
            <div className="remote-tool-crumb">
              {projectTreeTab === "files" ? (
                <span className="remote-tool-crumb-root">{t("fileTree.files")}</span>
              ) : (
                <>
                  <button type="button" className="remote-tool-crumb-back" onClick={() => setProjectTreeTab("files")} aria-label={t("fileTree.backToFiles")}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
                    {t("fileTree.files")}
                  </button>
                  <b className="remote-tool-crumb-name">
                    {projectTreeTab === "git" ? t("git.changes") : t("fileTree.worktrees")}
                  </b>
                </>
              )}
            </div>
          ) : null}
          <div
            role="tablist"
            className="workspace-project-tabs"
            data-onboarding="project-tabs"
            aria-label={t("fileTree.projectTabs")}
          >
            {([
              ["files", t("fileTree.files")],
              ["git", "git"],
              ["worktrees", t("fileTree.worktrees")],
            ] as const).map(([value, label]) => {
              const active = projectTreeTab === value;
              const flexGrow = value === "worktrees" ? 1.15 : 0.85;
              return (
                <React.Fragment key={value}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setProjectTreeTab(value)}
                    style={{ flex: `${flexGrow} 1 auto` }}
                  >
                    {label}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          data-onboarding="sidebar-refresh"
          onClick={() => void handleRefreshClick()}
          onMouseDown={() => setTreePressed(true)}
          onMouseUp={() => setTreePressed(false)}
          onMouseLeave={() => setTreePressed(false)}
          aria-label={t("common.refresh")}
          title={t("common.refresh")}
          style={{
            width: "22px",
            height: "28px",
            borderRadius: "8px",
            border: "none",
            background: "transparent",
            color: "var(--text-secondary)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "flex-end",
            cursor: "pointer",
            outline: "none",
            flexShrink: 0,
            padding: 0,
          }}
        >
          <span
            data-refresh-visual
            style={{
              width: "18px",
              height: "28px",
              borderRadius: "8px",
              background: treePressed || treeRefreshing ? "rgba(0, 0, 0, 0.06)" : "transparent",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={treeRefreshing ? { animation: "mindfs-update-spin 0.8s linear infinite" } : undefined}
            >
              <path
                fill="currentColor"
                d="M19.91 15.51h-4.53a1 1 0 0 0 0 2h2.4A8 8 0 0 1 4 12a1 1 0 0 0-2 0a10 10 0 0 0 16.88 7.23V21a1 1 0 0 0 2 0v-4.5a1 1 0 0 0-.97-.99M12 2a10 10 0 0 0-6.88 2.77V3a1 1 0 0 0-2 0v4.5a1 1 0 0 0 1 1h4.5a1 1 0 0 0 0-2h-2.4A8 8 0 0 1 20 12a1 1 0 0 0 2 0A10 10 0 0 0 12 2"
              />
            </svg>
          </span>
        </button>
        <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            data-onboarding="sidebar-menu"
            onClick={() => {
              setIsMenuOpen((open) => {
                const nextOpen = !open;
                if (nextOpen) {
                  setIsAppearanceMenuOpen(false);
                  setIsLocaleMenuOpen(false);
                  setIsSortMenuOpen(false);
                }
                return nextOpen;
              });
            }}
            aria-label={t("fileTree.menu.open")}
            aria-expanded={isMenuOpen}
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "8px",
              border: "none",
              background: isMenuOpen ? "rgba(0, 0, 0, 0.06)" : "transparent",
              color: "var(--text-secondary)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>
          <FileTreeSettingsMenu agentConfigFlowApi={agentConfigFlowApi} agentLifecycleApi={agentLifecycleApi} agentLifecycleStateApi={agentLifecycleStateApi} fileTreeMenuBehaviorApi={fileTreeMenuBehaviorApi} fileTreeMenusApi={fileTreeMenusApi} fileTreePreferenceStateApi={fileTreePreferenceStateApi} fileTreePreferencesApi={fileTreePreferencesApi} phonePanelsApi={phonePanelsApi} projectTreeTabApi={projectTreeTabApi} relayServicesApi={relayServicesApi} props={{ gitDiffSideBySide, multiProjectSessionsEnabled, onGitDiffSideBySideChange, onMultiProjectSessionsChange, onShowHiddenFilesChange, onSidebarsSwappedChange, onSortModeChange, relayNoRelayer, showHiddenFiles, sidebarsSwapped, sortMode }} />

        </div>
        {inPhoneMore ? <PhoneSheet title={phonePanelTitle || t("remote.phone.more")} open={!!phonePanelTitle} onClose={closePhonePanel}>
          <div className="phone-more-panels">{phoneBackupOpen ? <PhoneAgentBackup onSaved={() => setPhoneBackupOpen(false)} /> : settingsPanels}</div>
        </PhoneSheet> : settingsPanels}
      </div>
      <div style={{ padding: "8px", flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {entries.length === 0 ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
              textAlign: "center",
              color: "var(--text-secondary)",
              fontSize: "13px",
              fontWeight: 800,
              lineHeight: 1.5,
            }}
          >
            {t("fileTree.emptyProjectHint")}
          </div>
        ) : (
          renderEntries(entries, 0, rootId || "")
        )}
      </div>
      <FileTreeFooter fileTreeMenuBehaviorApi={fileTreeMenuBehaviorApi} fileTreeMenusApi={fileTreeMenusApi} footerStateApi={footerStateApi} props={{ footerTop, onGoHome, onRelayAction, onUpdateAction, publicStandaloneVersion, relayActionDisabled, relayActionHelp, relayActionLabel, updateActionBusy, updateActionDisabled, updateActionHelp, updateActionLabel, updateActionSummary }} />
      <style>{`
        @keyframes mindfs-update-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes mindfs-bound-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 1.5px rgba(37,99,235,0.14); }
          50% { opacity: 0.18; box-shadow: 0 0 0 4px rgba(37,99,235,0.08); }
        }
      `}</style>
    </div>
  );
}
