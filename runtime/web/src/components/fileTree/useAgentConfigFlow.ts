import React from "react";
import { AgentConfigPresentation } from "../fileTreeModel";
import {
  type AgentConfigStep,
  type AgentConfigSwitchTab,
  type AgentConfigSwitchSelection,
} from "../AgentConfigPopover";
import { type AgentStatus, fetchAgents } from "../../services/agents";
import {
  type AgentConfigBackup,
  type AgentAPIProvider,
  fetchAgentConfigBackups,
  fetchAgentAPIProviders,
  switchAgentAPIProvider,
  switchAgentConfig,
  deleteAgentConfigBackup,
  deleteAgentAPIProvider,
} from "../../services/agentConfig";
import type { ImportedAgentBackup } from "../../services/configTransfer";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useFileTreePreferenceState } from "./useFileTreePreferenceState";
import type { useAgentLifecycleState } from "./useAgentLifecycleState";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  fileTreePreferenceStateApi: ReturnType<typeof useFileTreePreferenceState>;
  agentLifecycleStateApi: ReturnType<typeof useAgentLifecycleState>;
  props: Pick<FileTreeProps, "onAgentConfigSwitched" | "onAgentMenuOpened"> & Required<Pick<FileTreeProps, "agentConfigSwitchRequest" | "agentMenuRequest">>;
};

export function useAgentConfigFlow({ fileTreeMenusApi, fileTreePreferenceStateApi, agentLifecycleStateApi, props }: Deps) {
  const { setIsAppearanceMenuOpen, setIsLocaleMenuOpen, setIsMenuOpen, setIsSortMenuOpen, t } = fileTreeMenusApi;
  const { setIdleReleaseOpen } = fileTreePreferenceStateApi;
  const { setAgentLifecycleOpen } = agentLifecycleStateApi;
  const { agentConfigSwitchRequest, agentMenuRequest, onAgentConfigSwitched, onAgentMenuOpened } = props;

  const [transferMode, setTransferMode] = React.useState<"export" | "import" | null>(null);
  const [agentConfigPresentation, setAgentConfigPresentation] = React.useState<AgentConfigPresentation | null>(null);
  const [agentConfigStep, setAgentConfigStep] = React.useState<AgentConfigStep>("agent");
  const [agentConfigAgents, setAgentConfigAgents] = React.useState<AgentStatus[]>([]);
  const [agentConfigAgent, setAgentConfigAgent] = React.useState("");
  const [agentConfigSwitchTab, setAgentConfigSwitchTab] = React.useState<AgentConfigSwitchTab>("backup");
  const [agentConfigBackups, setAgentConfigBackups] = React.useState<AgentConfigBackup[]>([]);
  const [agentAPIProviders, setAgentAPIProviders] = React.useState<AgentAPIProvider[]>([]);
  const [selectedAgentConfigID, setSelectedAgentConfigID] = React.useState("");
  const [selectedAgentAPIProviderID, setSelectedAgentAPIProviderID] = React.useState("");
  const [agentConfigSwitchSelection, setAgentConfigSwitchSelection] = React.useState<AgentConfigSwitchSelection | null>(null);
  const [agentConfigPreferredProviderIDs, setAgentConfigPreferredProviderIDs] = React.useState<string[]>([]);
  const [agentConfigConfirmMessage, setAgentConfigConfirmMessage] = React.useState("");
  const [agentConfigBusy, setAgentConfigBusy] = React.useState(false);
  const [agentConfigRestartingAgent, setAgentConfigRestartingAgent] = React.useState("");
  const [agentConfigError, setAgentConfigError] = React.useState("");
  const agentConfigPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const agentConfigDialogRef = React.useRef<HTMLDialogElement | null>(null);
  const agentConfigTitleId = React.useId();
  React.useEffect(() => {
    if (agentMenuRequest === null) return;
    setAgentConfigPresentation(null);
    setAgentLifecycleOpen(false);
    setIsAppearanceMenuOpen(false);
    setIsLocaleMenuOpen(false);
    setIsSortMenuOpen(false);
    setIsMenuOpen(true);
    onAgentMenuOpened?.();
  }, [agentMenuRequest, onAgentMenuOpened]);
  const chooseAgentForConfig = React.useCallback(async (agentName: string, agents = agentConfigAgents, backupID?: string) => {
    setAgentConfigAgent(agentName);
    setAgentConfigError("");
    setAgentConfigBusy(true);
    try {
      const selectedAgent = agents.find((item) => item.name === agentName);
      const supportsAPIProvider = Boolean(selectedAgent?.supports_api_provider_switch);
      const [backups, providers] = await Promise.all([
        fetchAgentConfigBackups(agentName),
        supportsAPIProvider ? fetchAgentAPIProviders(agentName) : Promise.resolve([]),
      ]);
      setAgentConfigBackups(backups);
      setAgentAPIProviders(providers);
      const preferredBackup = backups.find((backup) => backup.id === backupID);
      setSelectedAgentConfigID(preferredBackup?.id || "");
      const preferredProvider = preferredBackup ? undefined : providers.find((provider) => agentConfigPreferredProviderIDs.includes(provider.id));
      setSelectedAgentAPIProviderID(preferredProvider?.id || "");
      setAgentConfigSwitchSelection(preferredBackup ? { type: "backup", id: preferredBackup.id }
        : preferredProvider ? { type: "api_provider", id: preferredProvider.id } : null);
      const showProviders = !preferredBackup && supportsAPIProvider &&
        (selectedAgent?.last_config_selection?.type === "api_provider" || agentConfigPreferredProviderIDs.length > 0);
      setAgentConfigSwitchTab(showProviders ? "api_provider" : "backup");
      setAgentConfigStep("details");
    } catch (error) {
      setAgentConfigError(error instanceof Error ? error.message : t("agentConfig.loadConfigFailed"));
    } finally {
      setAgentConfigBusy(false);
    }
  }, [agentConfigAgents, agentConfigPreferredProviderIDs, t]);
  const openAgentConfigFlow = React.useCallback((backup?: ImportedAgentBackup, presentation: AgentConfigPresentation = "sidebar") => {
    setIdleReleaseOpen(false);
    setAgentLifecycleOpen(false);
    setAgentConfigPresentation(presentation);
    setAgentConfigStep("agent");
    setAgentConfigAgent("");
    setAgentConfigSwitchTab("backup");
    setAgentConfigBackups([]);
    setAgentAPIProviders([]);
    setSelectedAgentConfigID("");
    setSelectedAgentAPIProviderID("");
    setAgentConfigSwitchSelection(null);
    setAgentConfigPreferredProviderIDs([]);
    setAgentConfigConfirmMessage("");
    setAgentConfigError("");
    setAgentConfigRestartingAgent("");
    setIsMenuOpen(false);
    setAgentConfigBusy(true);
    fetchAgents(true, { throwOnError: true })
      .then((items) => {
        const installed = items.filter((item) => item.installed);
        setAgentConfigAgents(installed);
        if (backup) {
          const installedAgent = installed.find((agent) => agent.name === backup.agent);
          if (installedAgent) return chooseAgentForConfig(installedAgent.name, installed, backup.id);
          setAgentConfigError(t("configTransfer.agentNotInstalled", { agent: backup.agent }));
        }
      })
      .catch((error) => {
        setAgentConfigError(error instanceof Error ? error.message : t("agentConfig.loadAgentFailed"));
      })
      .finally(() => setAgentConfigBusy(false));
  }, [chooseAgentForConfig, t]);
  React.useEffect(() => {
    if (!agentConfigSwitchRequest) {
      return;
    }
    const providerIDs = (agentConfigSwitchRequest.providerIDs || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    setAgentLifecycleOpen(false);
    setAgentConfigPresentation("sidebar");
    setAgentConfigStep("agent");
    setAgentConfigAgent("");
    setAgentConfigSwitchTab("api_provider");
    setAgentConfigBackups([]);
    setAgentAPIProviders([]);
    setSelectedAgentConfigID("");
    setSelectedAgentAPIProviderID("");
    setAgentConfigSwitchSelection(null);
    setAgentConfigPreferredProviderIDs(providerIDs);
    setAgentConfigConfirmMessage("");
    setAgentConfigError("");
    setAgentConfigRestartingAgent("");
    setIsMenuOpen(false);
    setAgentConfigBusy(true);
    fetchAgents(true)
      .then((items) => {
        setAgentConfigAgents(items.filter((item) => item.installed));
      })
      .catch((error) => {
        setAgentConfigError(error instanceof Error ? error.message : t("agentConfig.loadAgentFailed"));
      })
      .finally(() => setAgentConfigBusy(false));
  }, [agentConfigSwitchRequest?.nonce, t]);
  const closeAgentConfigFlow = React.useCallback(() => {
    agentConfigDialogRef.current?.close();
    setAgentConfigPresentation(null);
    setAgentConfigStep("agent");
    setAgentConfigError("");
    setAgentConfigConfirmMessage("");
    setAgentConfigSwitchSelection(null);
    setAgentConfigSwitchTab("backup");
    setAgentConfigRestartingAgent("");
  }, []);
  React.useLayoutEffect(() => {
    const dialog = agentConfigDialogRef.current;
    if (agentConfigPresentation !== "dialog" || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [agentConfigPresentation]);
  const runAgentConfigSwitch = React.useCallback(async (confirmOverwrite = false) => {
    if (!agentConfigSwitchSelection) {
      setAgentConfigError(t("agentConfig.selectConfig"));
      return;
    }
    setAgentConfigBusy(true);
    setAgentConfigError("");
    try {
      if (agentConfigSwitchSelection.type === "api_provider") {
        await switchAgentAPIProvider({ agent: agentConfigAgent, providerID: agentConfigSwitchSelection.id });
        onAgentConfigSwitched?.(agentConfigAgent);
        closeAgentConfigFlow();
        return;
      }
      const result = await switchAgentConfig({ id: agentConfigSwitchSelection.id, confirmOverwrite });
      if (result.needs_confirm) {
        const paths = result.backup?.sources?.map(source => source.sourcePath) || [];
        setAgentConfigConfirmMessage(paths.length
          ? [t("agentConfig.confirmFileTargets"), ...paths].join("\n")
          : result.message || t("agentConfig.targetExists"));
        setAgentConfigStep("confirm");
        return;
      }
      onAgentConfigSwitched?.(agentConfigAgent);
      closeAgentConfigFlow();
    } catch (error) {
      setAgentConfigError(error instanceof Error ? error.message : t("agentConfig.switchFailed"));
    } finally {
      setAgentConfigBusy(false);
    }
  }, [agentConfigAgent, agentConfigSwitchSelection, closeAgentConfigFlow, onAgentConfigSwitched, t]);
  const deleteSelectedAgentConfigBackup = React.useCallback(async (id: string) => {
    const trimmedID = String(id || "").trim();
    if (!trimmedID) {
      return;
    }
    setAgentConfigBusy(true);
    setAgentConfigError("");
    try {
      const result = await deleteAgentConfigBackup(trimmedID);
      const nextBackups = (result.backups || agentConfigBackups)
        .filter((item) => item.agent === agentConfigAgent && item.id !== trimmedID);
      setAgentConfigBackups(nextBackups);
      if (selectedAgentConfigID === trimmedID) {
        setSelectedAgentConfigID("");
        setAgentConfigSwitchSelection(null);
      }
    } catch (error) {
      setAgentConfigError(error instanceof Error ? error.message : t("agentConfig.deleteConfigFailed"));
    } finally {
      setAgentConfigBusy(false);
    }
  }, [agentConfigAgent, agentConfigBackups, selectedAgentConfigID, t]);
  const deleteSelectedAgentAPIProvider = React.useCallback(async (id: string) => {
    const trimmedID = String(id || "").trim();
    if (!trimmedID) {
      return;
    }
    setAgentConfigBusy(true);
    setAgentConfigError("");
    try {
      const result = await deleteAgentAPIProvider(trimmedID);
      const nextProviders = (result.providers || agentAPIProviders)
        .filter((item) => item.id !== trimmedID);
      setAgentAPIProviders(nextProviders);
      if (selectedAgentAPIProviderID === trimmedID) {
        setSelectedAgentAPIProviderID("");
        setAgentConfigSwitchSelection(null);
      }
    } catch (error) {
      setAgentConfigError(error instanceof Error ? error.message : t("agentConfig.deleteProviderFailed"));
    } finally {
      setAgentConfigBusy(false);
    }
  }, [agentAPIProviders, selectedAgentAPIProviderID, t]);
  const selectAgentConfigBackup = React.useCallback((id: string) => {
    setSelectedAgentConfigID(id);
    setSelectedAgentAPIProviderID("");
    setAgentConfigSwitchSelection(id ? { type: "backup", id } : null);
  }, []);
  const selectAgentAPIProvider = React.useCallback((id: string) => {
    setSelectedAgentAPIProviderID(id);
    setSelectedAgentConfigID("");
    setAgentConfigSwitchSelection(id ? { type: "api_provider", id } : null);
  }, []);

  return { agentAPIProviders, agentConfigAgent, agentConfigAgents, agentConfigBackups, agentConfigBusy, agentConfigConfirmMessage, agentConfigDialogRef, agentConfigError, agentConfigPopoverRef, agentConfigPresentation, agentConfigRestartingAgent, agentConfigStep, agentConfigSwitchTab, agentConfigTitleId, chooseAgentForConfig, closeAgentConfigFlow, deleteSelectedAgentAPIProvider, deleteSelectedAgentConfigBackup, openAgentConfigFlow, runAgentConfigSwitch, selectAgentAPIProvider, selectAgentConfigBackup, selectedAgentAPIProviderID, selectedAgentConfigID, setAgentConfigError, setAgentConfigPresentation, setAgentConfigRestartingAgent, setAgentConfigSwitchTab, setTransferMode, transferMode };
}
