import type { AgentStatus } from "./agents";

export function getAgentDefaults(agent?: AgentStatus | null, model?: string) {
  const native = agent?.protocol === "codex-sdk" || agent?.protocol === "claude-sdk" ||
    agent?.name === "codex" || agent?.name === "claude";
  const modelId = model || agent?.default_model_id || agent?.current_model_id;
  const efforts = agent?.models?.find(item => item.id === modelId)?.efforts ?? agent?.efforts ?? [];
  const defaultEffort = agent?.default_effort || "";
  return {
    model: native ? "" : agent?.default_model_id || agent?.current_model_id || "",
    mode: agent?.modes?.[0]?.id || "",
    effort: efforts.includes("high") ? "high"
      : efforts.includes(defaultEffort) ? defaultEffort : efforts[0] || "",
    fastService: agent?.supports_fast_service ? "off" : "",
  } as const;
}
