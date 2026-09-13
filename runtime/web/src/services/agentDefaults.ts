import type { AgentStatus } from "./agents";

export function getAgentDefaults(agent?: AgentStatus | null) {
  const native = agent?.protocol === "codex-sdk" || agent?.protocol === "claude-sdk" ||
    agent?.name === "codex" || agent?.name === "claude";
  return {
    model: native ? "" : agent?.default_model_id || agent?.current_model_id || "",
    effort: native ? "" : agent?.default_effort || "",
    fastService: (native ? "" : agent?.default_fast_service || "") as "" | "on" | "off",
  } as const;
}
