import React from "react";
import { type AgentStatus } from "../../services/agents";

export function useAgentLifecycleState() {
  const [agentLifecycleOpen, setAgentLifecycleOpen] = React.useState(false);
  const [agentLifecycleAgents, setAgentLifecycleAgents] = React.useState<AgentStatus[]>([]);
  const [agentLifecycleBusy, setAgentLifecycleBusy] = React.useState(false);
  const [agentLifecycleRunningAgent, setAgentLifecycleRunningAgent] = React.useState("");
  const [agentLifecycleError, setAgentLifecycleError] = React.useState("");
  const [agentLifecycleNotice, setAgentLifecycleNotice] = React.useState("");
  const [agentRestartResultAgent, setAgentRestartResultAgent] = React.useState("");
  const [agentRestartResult, setAgentRestartResult] = React.useState(false);
  const [agentProbingAgent, setAgentProbingAgent] = React.useState("");
  const [agentProbeAcceptedAgent, setAgentProbeAcceptedAgent] = React.useState("");
  const agentLifecyclePopoverRef = React.useRef<HTMLDivElement | null>(null);

  return { agentLifecycleAgents, agentLifecycleBusy, agentLifecycleError, agentLifecycleNotice, agentLifecycleOpen, agentLifecyclePopoverRef, agentLifecycleRunningAgent, agentProbeAcceptedAgent, agentProbingAgent, agentRestartResult, agentRestartResultAgent, setAgentLifecycleAgents, setAgentLifecycleBusy, setAgentLifecycleError, setAgentLifecycleOpen, setAgentLifecycleRunningAgent, setAgentProbeAcceptedAgent, setAgentProbingAgent, setAgentRestartResult, setAgentRestartResultAgent };
}
