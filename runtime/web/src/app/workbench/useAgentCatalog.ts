import { useState, useEffect, useCallback } from "react";
import { type AgentStatus, fetchAgents, restartAgent } from "../../services/agents";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useRelayConnection } from "./useRelayConnection";
import type { useSessionMessaging } from "./useSessionMessaging";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  relayConnectionApi: ReturnType<typeof useRelayConnection>;
  sessionMessagingApi: ReturnType<typeof useSessionMessaging>;
};

export function useAgentCatalog({ appFoundationApi, currentRootApi, sessionSelectionApi, relayConnectionApi, sessionMessagingApi }: Deps) {
  const { boundSessionByRootRef, currentSessionRef, selectedSessionByRootRef, selectedSessionRef, suppressedAutoBindSessionByRootRef, t } = appFoundationApi;
  const { currentRootIdRef } = currentRootApi;
  const { setBoundSessionForRoot, setDrawerOpenForRoot, setDrawerSessionForRoot, setInteractionMode, setSelectedSession } = sessionSelectionApi;
  const { e2eeState } = relayConnectionApi;
  const { handleSendMessage } = sessionMessagingApi;

  const [availableAgents, setAvailableAgents] = useState<AgentStatus[]>([]);
  const [agentsVersion, setAgentsVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!e2eeState.configured || (e2eeState.required && !e2eeState.unlocked)) {
      return;
    }
    fetchAgents(true)
      .then((items) => {
        if (cancelled) return;
        setAvailableAgents(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    agentsVersion,
    e2eeState.configured,
    e2eeState.required,
    e2eeState.unlocked,
  ]);
  const handleRunAgentLifecycleCommand = useCallback(
    async (
      agentName: string,
      action: "install" | "update",
      commands: string[],
    ) => {
      const activeRoot = currentRootIdRef.current;
      if (!activeRoot) {
        throw new Error(t("root.noProjectForCommand"));
      }
      const script = commands
        .map((command) => command.trim())
        .filter(Boolean)
        .join("\n");
      if (!script) {
        throw new Error(t("agentConfig.noCommand"));
      }
      const previousBoundKey = boundSessionByRootRef.current[activeRoot];
      if (previousBoundKey && !previousBoundKey.startsWith("pending-")) {
        suppressedAutoBindSessionByRootRef.current[activeRoot] =
          previousBoundKey;
      }
      selectedSessionRef.current = null;
      currentSessionRef.current = null;
      setSelectedSession(null);
      selectedSessionByRootRef.current[activeRoot] = null;
      setBoundSessionForRoot(activeRoot, null);
      setDrawerSessionForRoot(activeRoot, null);
      setInteractionMode("drawer");
      setDrawerOpenForRoot(activeRoot, true);
      await handleSendMessage(script, "command", "");
      console.info("[agent/lifecycle] command dispatched", {
        agent: agentName,
        action,
        commandCount: commands.length,
      });
    },
    [
      handleSendMessage,
      setBoundSessionForRoot,
      setDrawerOpenForRoot,
      setDrawerSessionForRoot,
      t,
    ],
  );
  const handleRestartAgent = useCallback(async (agentName: string) => {
    await restartAgent(agentName);
    const items = await fetchAgents(true);
    setAvailableAgents(items);
    setAgentsVersion((v) => v + 1);
  }, []);

  return { agentsVersion, availableAgents, handleRestartAgent, handleRunAgentLifecycleCommand, setAgentsVersion };
}
