import React from "react";
import {
  fetchAgentCatalog,
  type AgentStatus,
  probeAgent as requestAgentProbe,
} from "../../services/agents";
import { type AgentLifecycleCommandAction } from "../AgentLifecyclePopover";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useAgentLifecycleState } from "./useAgentLifecycleState";
import type { useAgentConfigFlow } from "./useAgentConfigFlow";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  agentLifecycleStateApi: ReturnType<typeof useAgentLifecycleState>;
  agentConfigFlowApi: ReturnType<typeof useAgentConfigFlow>;
  props: Pick<FileTreeProps, "onRestartAgent" | "onRunAgentLifecycleCommand"> & Required<Pick<FileTreeProps, "agentSettingsOnly">>;
};

export function useAgentLifecycle({ fileTreeMenusApi, agentLifecycleStateApi, agentConfigFlowApi, props }: Deps) {
  const { setIsMenuOpen, t } = fileTreeMenusApi;
  const { agentLifecycleAgents, agentProbeAcceptedAgent, agentProbingAgent, agentRestartResultAgent, setAgentLifecycleAgents, setAgentLifecycleBusy, setAgentLifecycleError, setAgentLifecycleOpen, setAgentLifecycleRunningAgent, setAgentProbeAcceptedAgent, setAgentProbingAgent, setAgentRestartResult, setAgentRestartResultAgent } = agentLifecycleStateApi;
  const { agentConfigRestartingAgent, setAgentConfigError, setAgentConfigPresentation, setAgentConfigRestartingAgent } = agentConfigFlowApi;
  const { agentSettingsOnly, onRestartAgent, onRunAgentLifecycleCommand } = props;

  const loadAgentLifecycleCatalog = React.useCallback(() => {
    setAgentLifecycleError("");
    setAgentLifecycleBusy(true);
    fetchAgentCatalog(true, { throwOnError: true })
      .then((items) => {
        setAgentLifecycleAgents(items);
      })
      .catch((error) => {
        setAgentLifecycleError(error instanceof Error ? error.message : t("agentConfig.loadAgentFailed"));
      })
      .finally(() => setAgentLifecycleBusy(false));
  }, [t]);
  const openAgentLifecycleFlow = React.useCallback(() => {
    setAgentConfigPresentation(null);
    setAgentLifecycleOpen(true);
    setIsMenuOpen(false);
    loadAgentLifecycleCatalog();
  }, [loadAgentLifecycleCatalog]);
  const closeAgentLifecycleFlow = React.useCallback(() => {
    setAgentLifecycleOpen(false);
    setAgentLifecycleError("");
    setAgentLifecycleRunningAgent("");
  }, []);
  React.useEffect(() => {
    if (!agentRestartResultAgent || agentConfigRestartingAgent === agentRestartResultAgent) return;
    const status = agentLifecycleAgents.find((item) => item.name === agentRestartResultAgent);
    if (!status || status.probe_pending) return;
    setAgentRestartResult(!!status.available);
    setAgentRestartResultAgent("");
  }, [agentConfigRestartingAgent, agentLifecycleAgents, agentRestartResultAgent, t]);
  const runAgentLifecycleCommand = React.useCallback(async (agent: AgentStatus, action: AgentLifecycleCommandAction) => {
    const commands = action === "install" ? agent.install_commands || [] : agent.update_commands || [];
    if (commands.length === 0) {
      setAgentLifecycleError(t("agentConfig.noCommand"));
      return;
    }
    setAgentLifecycleBusy(true);
    setAgentLifecycleRunningAgent(agent.name);
    setAgentLifecycleError("");
    try {
      await onRunAgentLifecycleCommand?.(agent.name, action, commands);
      closeAgentLifecycleFlow();
    } catch (error) {
      setAgentLifecycleError(error instanceof Error ? error.message : t("agentConfig.commandStartFailed"));
    } finally {
      setAgentLifecycleBusy(false);
      setAgentLifecycleRunningAgent("");
    }
  }, [closeAgentLifecycleFlow, onRunAgentLifecycleCommand, t]);
  const restartAgentFromConfigList = React.useCallback(async (agentName: string) => {
    if (!agentName || !onRestartAgent || agentConfigRestartingAgent) {
      return;
    }
    setAgentConfigRestartingAgent(agentName);
    setAgentRestartResultAgent(agentName);
    setAgentRestartResult(false);
    setAgentConfigError("");
    try {
      await onRestartAgent(agentName);
    } catch (error) {
      setAgentRestartResultAgent("");
      setAgentConfigError(error instanceof Error ? error.message : t("agentConfig.restartFailed"));
    } finally {
      setAgentConfigRestartingAgent("");
    }
  }, [agentConfigRestartingAgent, agentSettingsOnly, onRestartAgent, t]);
  const probeAgentFromSettings = React.useCallback(async (agentName: string) => {
    if (!agentName || agentProbingAgent) {
      return;
    }
    setAgentProbingAgent(agentName);
    setAgentProbeAcceptedAgent("");
    setAgentLifecycleError("");
    try {
      await requestAgentProbe(agentName);
      const items = await fetchAgentCatalog(true, { throwOnError: true });
      setAgentLifecycleAgents(items);
      setAgentProbeAcceptedAgent(agentName);
    } catch (error) {
      setAgentProbingAgent("");
      setAgentLifecycleError(error instanceof Error ? error.message : t("agentConfig.probeFailed"));
    }
  }, [agentProbingAgent, t]);
  React.useEffect(() => {
    if (!agentProbingAgent || agentProbeAcceptedAgent !== agentProbingAgent) {
      return;
    }
    const status = agentLifecycleAgents.find((item) => item.name === agentProbingAgent);
    if (!status || status.probe_pending) {
      return;
    }
    setAgentProbingAgent("");
    setAgentProbeAcceptedAgent("");
  }, [agentLifecycleAgents, agentProbeAcceptedAgent, agentProbingAgent]);

  return { closeAgentLifecycleFlow, loadAgentLifecycleCatalog, openAgentLifecycleFlow, probeAgentFromSettings, restartAgentFromConfigList, runAgentLifecycleCommand };
}
