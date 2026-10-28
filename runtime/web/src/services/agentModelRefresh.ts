import { probeAgent, type AgentStatus } from "./agents";
import { protectedJSON } from "./api";
import { appPath } from "./base";

const pendingRefreshes = new Map<string, Promise<void>>();

// Use the existing startup/probe pipeline, not a second model discovery path.
// The POST only acknowledges the request; wait for its published status before
// reporting success. Polling also works when a WebSocket event is missed.
export function refreshAgentModels(agent: string): Promise<void> {
  const pending = pendingRefreshes.get(agent);
  if (pending) return pending;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  const request = (async () => {
    await probeAgent(agent, controller.signal);
    while (!controller.signal.aborted) {
      const data = await protectedJSON<{ agents: AgentStatus[] }>(appPath("/api/agents"), {
        signal: controller.signal, cache: "no-store",
      });
      const status = data.agents.find(item => item.name === agent);
      if (!status) throw new Error("Agent is no longer installed");
      if (!status.probe_pending) {
        if (status.models_error || status.error || !status.available) {
          throw new Error(status.models_error || status.error || "Agent is unavailable");
        }
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new DOMException("Model refresh timed out", "AbortError");
  })().finally(() => {
    clearTimeout(timeout);
    pendingRefreshes.delete(agent);
  });
  pendingRefreshes.set(agent, request);
  return request;
}
