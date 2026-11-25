import { PhoneMoreGroup } from "../remoteui/PhoneMoreHost";
import { fileTreeMenuButtonStyle } from "../WebPushMenuItem";
import { ConfigSwitchIcon, ConfigArchiveIcon, AgentInstallIcon } from "../FileTreeIcons";
import type { useFileTreeMenuBehavior } from "./useFileTreeMenuBehavior";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useAgentConfigFlow } from "./useAgentConfigFlow";
import type { useAgentLifecycle } from "./useAgentLifecycle";
import type { useFileTreePreferences } from "./useFileTreePreferences";
import type { useFileTreePreferenceState } from "./useFileTreePreferenceState";
import type { useRelayServices } from "./useRelayServices";
import type { useAgentLifecycleState } from "./useAgentLifecycleState";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  agentConfigFlowApi: ReturnType<typeof useAgentConfigFlow>;
  agentLifecycleApi: ReturnType<typeof useAgentLifecycle>;
  agentLifecycleStateApi: ReturnType<typeof useAgentLifecycleState>;
  fileTreeMenuBehaviorApi: ReturnType<typeof useFileTreeMenuBehavior>;
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  fileTreePreferenceStateApi: ReturnType<typeof useFileTreePreferenceState>;
  fileTreePreferencesApi: ReturnType<typeof useFileTreePreferences>;
  relayServicesApi: ReturnType<typeof useRelayServices>;
  props: Required<Pick<FileTreeProps, "relayNoRelayer">>;
};

export function FileTreeProjectGroup({ agentConfigFlowApi, agentLifecycleApi, agentLifecycleStateApi, fileTreeMenuBehaviorApi, fileTreeMenusApi, fileTreePreferenceStateApi, fileTreePreferencesApi, relayServicesApi, props }: Deps) {
  const { closeAgentConfigFlow, openAgentConfigFlow, setTransferMode } = agentConfigFlowApi;
  const { closeAgentLifecycleFlow, openAgentLifecycleFlow } = agentLifecycleApi;
  const { setAgentLifecycleOpen } = agentLifecycleStateApi;
  const { inPhoneMore } = fileTreeMenuBehaviorApi;
  const { setIsAppearanceMenuOpen, setIsLocaleMenuOpen, setIsMenuOpen, setIsSortMenuOpen, setPhoneBackupOpen, t } = fileTreeMenusApi;
  const { idleReleaseHours } = fileTreePreferenceStateApi;
  const { openIdleSessionResourceRelease, openSessionNaming } = fileTreePreferencesApi;
  const { setRelayServicesEditing, setRelayServicesOpen } = relayServicesApi;
  const { relayNoRelayer } = props;
  return (
    <PhoneMoreGroup phone={inPhoneMore} name="agent" title="Agent">
    {inPhoneMore && <button type="button" onClick={() => setPhoneBackupOpen(true)} style={fileTreeMenuButtonStyle}>
      <span aria-hidden="true">＋</span><span>{t("fileTree.addAgentConfig")}</span>
    </button>}
    <button
      type="button"
      onClick={() => openAgentConfigFlow()}
      style={fileTreeMenuButtonStyle}
    >
      <ConfigSwitchIcon />
      <span>{t("fileTree.switchAgentConfig")}</span>
    </button>
    {(["export", "import"] as const).map(mode => (
      <button key={mode} type="button" style={fileTreeMenuButtonStyle} onClick={() => {
        setTransferMode(mode);
        setIsMenuOpen(false);
        closeAgentConfigFlow();
        closeAgentLifecycleFlow();
      }}>
        <ConfigArchiveIcon />
        <span>{t(mode === "export" ? "configTransfer.exportAgent" : "configTransfer.importAgent")}</span>
      </button>
    ))}
    <button
      type="button"
      onClick={openAgentLifecycleFlow}
      style={fileTreeMenuButtonStyle}
    >
      <AgentInstallIcon />
      <span>{t("fileTree.agentInstallUpdate")}</span>
    </button>
    <button
      type="button"
      onClick={openSessionNaming}
      style={fileTreeMenuButtonStyle}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h7" />
        <path d="m17 16 2 2 3-4" />
      </svg>
      <span>{t("fileTree.sessionNamingAgent")}</span>
    </button>
    <button
      type="button"
      onClick={openIdleSessionResourceRelease}
      style={fileTreeMenuButtonStyle}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span>{t("fileTree.idleSessionResourceRelease")}</span>
      <span
        style={{
          marginLeft: "auto",
          color: "var(--text-secondary)",
          fontSize: "11px",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {idleReleaseHours || "72"}h
      </span>
    </button>
    {!relayNoRelayer ? <button
      type="button"
      onClick={() => {
        setRelayServicesOpen(true);
        setRelayServicesEditing(false);
        closeAgentConfigFlow();
        setAgentLifecycleOpen(false);
        setIsMenuOpen(false);
        setIsAppearanceMenuOpen(false);
        setIsLocaleMenuOpen(false);
        setIsSortMenuOpen(false);
      }}
      style={fileTreeMenuButtonStyle}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 17V7a2 2 0 0 1 2-2h6" />
        <path d="M8 21h8a2 2 0 0 0 2-2v-6" />
        <path d="M14 3h7v7" />
        <path d="m21 3-9 9" />
      </svg>
      <span>{t("fileTree.relayLocalServices")}</span>
    </button> : null}
    </PhoneMoreGroup>
  );
}
