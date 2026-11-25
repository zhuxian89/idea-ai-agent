import React from "react";
import { isRemoteWebUi } from "../../services/remoteUi";
import { OPEN_AGENT_CONFIG_SWITCH_EVENT } from "../remoteui/RemoteTopBar";
import { AgentConfigPopover } from "../AgentConfigPopover";
import type { useAgentLifecycleState } from "./useAgentLifecycleState";
import type { useAgentConfigFlow } from "./useAgentConfigFlow";
import type { useAgentLifecycle } from "./useAgentLifecycle";
import type { useFileTreeMenuBehavior } from "./useFileTreeMenuBehavior";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  agentLifecycleStateApi: ReturnType<typeof useAgentLifecycleState>;
  agentConfigFlowApi: ReturnType<typeof useAgentConfigFlow>;
  agentLifecycleApi: ReturnType<typeof useAgentLifecycle>;
  fileTreeMenuBehaviorApi: ReturnType<typeof useFileTreeMenuBehavior>;
  props: Required<Pick<FileTreeProps, "agentSettingsOnly">>;
};

export function useAgentConfigurationView({ agentLifecycleStateApi, agentConfigFlowApi, agentLifecycleApi, fileTreeMenuBehaviorApi, props }: Deps) {
  const { agentRestartResult } = agentLifecycleStateApi;
  const { agentAPIProviders, agentConfigAgent, agentConfigAgents, agentConfigBackups, agentConfigBusy, agentConfigConfirmMessage, agentConfigError, agentConfigPopoverRef, agentConfigPresentation, agentConfigRestartingAgent, agentConfigStep, agentConfigSwitchTab, chooseAgentForConfig, closeAgentConfigFlow, deleteSelectedAgentAPIProvider, deleteSelectedAgentConfigBackup, openAgentConfigFlow, runAgentConfigSwitch, selectAgentAPIProvider, selectAgentConfigBackup, selectedAgentAPIProviderID, selectedAgentConfigID, setAgentConfigSwitchTab } = agentConfigFlowApi;
  const { restartAgentFromConfigList } = agentLifecycleApi;
  const { inPhoneMore } = fileTreeMenuBehaviorApi;
  const { agentSettingsOnly } = props;

  React.useEffect(() => {
    if (!isRemoteWebUi || agentSettingsOnly) return;
    const open = () => openAgentConfigFlow(undefined, "dialog");
    window.addEventListener(OPEN_AGENT_CONFIG_SWITCH_EVENT, open);
    return () => window.removeEventListener(OPEN_AGENT_CONFIG_SWITCH_EVENT, open);
  }, [agentSettingsOnly, openAgentConfigFlow]);
  React.useEffect(() => {
    if (inPhoneMore || agentSettingsOnly || agentConfigPresentation !== "sidebar" || agentConfigStep !== "agent") {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!agentConfigPopoverRef.current?.contains(event.target as Node)) {
        closeAgentConfigFlow();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [inPhoneMore, agentSettingsOnly, agentConfigPresentation, agentConfigStep, closeAgentConfigFlow]);
  const agentConfiguration = agentConfigPresentation ? (
    <AgentConfigPopover
      inDialog={agentConfigPresentation === "dialog" || inPhoneMore}
      step={agentConfigStep}
      agents={agentConfigAgents}
      selectedAgent={agentConfigAgent}
      switchTab={agentConfigSwitchTab}
      backups={agentConfigBackups}
      apiProviders={agentAPIProviders}
      selectedBackupID={selectedAgentConfigID}
      selectedAPIProviderID={selectedAgentAPIProviderID}
      confirmMessage={agentConfigConfirmMessage}
      busy={agentConfigBusy}
      restartingAgent={agentConfigRestartingAgent}
      error={agentConfigError}
      restartResult={agentRestartResult}
      onChooseAgent={(name) => {
        void chooseAgentForConfig(name);
      }}
      onSwitchTabChange={setAgentConfigSwitchTab}
      onSelectedBackupChange={selectAgentConfigBackup}
      onSelectedAPIProviderChange={selectAgentAPIProvider}
      onDeleteBackup={(id) => {
        void deleteSelectedAgentConfigBackup(id);
      }}
      onDeleteAPIProvider={(id) => {
        void deleteSelectedAgentAPIProvider(id);
      }}
      onSwitch={() => {
        void runAgentConfigSwitch(false);
      }}
      onRestartAgent={restartAgentFromConfigList}
      onConfirm={() => {
        void runAgentConfigSwitch(true);
      }}
      onCancel={closeAgentConfigFlow}
    />
  ) : null;

  return { agentConfiguration };
}
