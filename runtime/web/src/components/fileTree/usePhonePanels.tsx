import { isRemoteWebUi } from "../../services/remoteUi";
import { fileTreeMenuButtonStyle } from "../WebPushMenuItem";
import { ConfigTransferDialog } from "../ConfigTransferDialog";
import { IdleSessionReleasePopover } from "../IdleSessionReleasePopover";
import { SessionNamingPopover } from "../SessionNamingPopover";
import { RelayLocalServicesDialog } from "../RelayLocalServicesDialog";
import { AgentLifecyclePopover } from "../AgentLifecyclePopover";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useFileTreePreferenceState } from "./useFileTreePreferenceState";
import type { useAgentLifecycleState } from "./useAgentLifecycleState";
import type { useAgentConfigFlow } from "./useAgentConfigFlow";
import type { useAgentLifecycle } from "./useAgentLifecycle";
import type { useFileTreeMenuBehavior } from "./useFileTreeMenuBehavior";
import type { useRelayServices } from "./useRelayServices";
import type { useAgentConfigurationView } from "./useAgentConfigurationView";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  fileTreePreferenceStateApi: ReturnType<typeof useFileTreePreferenceState>;
  agentLifecycleStateApi: ReturnType<typeof useAgentLifecycleState>;
  agentConfigFlowApi: ReturnType<typeof useAgentConfigFlow>;
  agentLifecycleApi: ReturnType<typeof useAgentLifecycle>;
  fileTreeMenuBehaviorApi: ReturnType<typeof useFileTreeMenuBehavior>;
  relayServicesApi: ReturnType<typeof useRelayServices>;
  agentConfigurationViewApi: ReturnType<typeof useAgentConfigurationView>;
  props: Required<Pick<FileTreeProps, "relayBaseURL" | "relayNoRelayer" | "relayNodeId">>;
};

export function usePhonePanels({ fileTreeMenusApi, fileTreePreferenceStateApi, agentLifecycleStateApi, agentConfigFlowApi, agentLifecycleApi, fileTreeMenuBehaviorApi, relayServicesApi, agentConfigurationViewApi, props }: Deps) {
  const { glowConfig, phoneBackupOpen, setGlowDialogOpen, setIsMenuOpen, setPhoneBackupOpen, t } = fileTreeMenusApi;
  const { idleReleaseHours, idleReleaseOpen, sessionNamingOpen, setIdleReleaseHours, setIdleReleaseOpen, setSessionNamingOpen } = fileTreePreferenceStateApi;
  const { agentLifecycleAgents, agentLifecycleBusy, agentLifecycleError, agentLifecycleOpen, agentLifecyclePopoverRef, agentLifecycleRunningAgent } = agentLifecycleStateApi;
  const { agentConfigPopoverRef, agentConfigPresentation, closeAgentConfigFlow, openAgentConfigFlow, setTransferMode, transferMode } = agentConfigFlowApi;
  const { closeAgentLifecycleFlow, openAgentLifecycleFlow, runAgentLifecycleCommand } = agentLifecycleApi;
  const { inPhoneMore } = fileTreeMenuBehaviorApi;
  const { closeRelayServices, relayServicesOpen, relayServicesPopoverRef, setRelayServicesEditing } = relayServicesApi;
  const { agentConfiguration } = agentConfigurationViewApi;
  const { relayBaseURL, relayNoRelayer, relayNodeId } = props;

  const showGlowSettings = isRemoteWebUi;
  const glowTitle = t("glow.activityTitle");
  const glowSettingsButton = showGlowSettings ? (
    <button
      type="button"
      className={inPhoneMore ? undefined : "remote-shell-only"}
      aria-haspopup="dialog"
      style={{ ...fileTreeMenuButtonStyle, width: "100%" }}
      onClick={() => { setGlowDialogOpen(true); setIsMenuOpen(false); }}
    >
      <span style={{ flex: 1 }}>{glowTitle}</span>
      <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
        {glowConfig.on ? `${t(`glow.fx.${glowConfig.fx}` as const)} · ${t(`glow.speed.${glowConfig.speed}` as const)}` : t("glow.off")}
      </span>
    </button>
  ) : null;
  const phonePanelTitle = phoneBackupOpen ? t("fileTree.addAgentConfig")
    : agentConfigPresentation === "sidebar" ? t("fileTree.switchAgentConfig")
    : transferMode ? t(transferMode === "export" ? "configTransfer.exportAgent" : "configTransfer.importAgent")
    : idleReleaseOpen ? t("idleSessionResourceRelease.title")
    : sessionNamingOpen ? t("sessionNaming.title")
    : relayServicesOpen ? t("fileTree.relayLocalServices")
    : agentLifecycleOpen ? t("fileTree.agentInstallUpdate") : "";
  const closePhonePanel = () => {
    setPhoneBackupOpen(false);
    closeAgentConfigFlow();
    setTransferMode(null);
    setIdleReleaseOpen(false);
    setSessionNamingOpen(false);
    closeRelayServices();
    closeAgentLifecycleFlow();
  };
  const settingsPanels = <>
    {agentConfigPresentation === "sidebar" ? (
          <div ref={agentConfigPopoverRef} style={{ position: "absolute", top: "calc(100% + 6px)", left: "8px", right: "3px", zIndex: 35 }}>
            {agentConfiguration}
          </div>
        ) : null}
        {transferMode && (
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: "8px", right: "3px", zIndex: 40 }}>
            <ConfigTransferDialog key={transferMode} embedded={inPhoneMore} mode={transferMode} onClose={() => setTransferMode(null)} onUseBackup={(backup) => {
              setTransferMode(null);
              openAgentConfigFlow(backup);
            }} />
          </div>
        )}
        {idleReleaseOpen ? (
          <IdleSessionReleasePopover
            initialHours={idleReleaseHours}
            onSaved={setIdleReleaseHours}
            onClose={() => setIdleReleaseOpen(false)}
          />
        ) : null}
        {sessionNamingOpen ? (
          <SessionNamingPopover onClose={() => setSessionNamingOpen(false)} />
        ) : null}
        {relayServicesOpen ? (
          <div
            ref={relayServicesPopoverRef}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: "8px",
              right: "3px",
              zIndex: 35,
            }}
          >
            <RelayLocalServicesDialog
              open={relayServicesOpen}
              nodeId={relayNodeId}
              relayBaseURL={relayBaseURL}
              noRelayer={relayNoRelayer}
              onCancel={closeRelayServices}
              onEditingChange={setRelayServicesEditing}
            />
          </div>
        ) : null}
        {agentLifecycleOpen ? (
          <div
            ref={agentLifecyclePopoverRef}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: "8px",
              right: "3px",
              zIndex: 35,
            }}
          >
            <AgentLifecyclePopover
              agents={agentLifecycleAgents}
              busy={agentLifecycleBusy}
              runningAgent={agentLifecycleRunningAgent}
              error={agentLifecycleError}
              onRefresh={openAgentLifecycleFlow}
              onRun={(agent, action) => {
                void runAgentLifecycleCommand(agent, action);
              }}
            />
          </div>
        ) : null}
  </>;

  return { closePhonePanel, glowSettingsButton, glowTitle, phonePanelTitle, settingsPanels, showGlowSettings };
}
