import { getAgentDefaults } from "../../services/agentDefaults";
import { agentDisplayName } from "../../services/agentSetup";
import type { AgentStatus } from "../../services/agents";
import type { CollabMemberSlot } from "../../services/collab";

export interface ResolvedCollabModelInfo {
  agentLabel: string;
  modelLabel: string;
  resolvedModelName: string;
  isDefaultModel: boolean;
}

export function resolveCollabModelInfo(
  agentName: string | undefined,
  modelId: string | undefined,
  agents: AgentStatus[],
  defaultModelText = "默认模型",
  options?: {
    resolveDefaultFromAgent?: boolean;
  },
): ResolvedCollabModelInfo {
  const normalizedAgent = `${agentName || ""}`.trim();
  const normalizedModel = `${modelId || ""}`.trim();
  const agentLabel = normalizedAgent ? agentDisplayName(normalizedAgent) : "";
  const agentStatus = agents.find((item) => item.name === normalizedAgent);
  const models = agentStatus?.models ?? [];

  if (normalizedModel) {
    const matched = models.find((item) => item.id === normalizedModel);
    const resolvedModelName = `${matched?.name || ""}`.trim() || normalizedModel;
    return {
      agentLabel,
      modelLabel: resolvedModelName,
      resolvedModelName,
      isDefaultModel: false,
    };
  }

  if (options?.resolveDefaultFromAgent === false) {
    return {
      agentLabel,
      modelLabel: defaultModelText,
      resolvedModelName: "",
      isDefaultModel: true,
    };
  }

  const fallbackId = `${agentStatus?.default_model_id || agentStatus?.current_model_id || ""}`.trim();
  const fallbackMatch = fallbackId ? models.find((item) => item.id === fallbackId) : undefined;
  const resolvedModelName = `${fallbackMatch?.name || ""}`.trim() || fallbackId;
  return {
    agentLabel,
    modelLabel: resolvedModelName ? `${defaultModelText} (${resolvedModelName})` : defaultModelText,
    resolvedModelName,
    isDefaultModel: true,
  };
}

export function formatCollabMemberBadge(
  member: {
    agent?: string;
    model?: string;
    effort?: string;
    read_only?: boolean;
  },
  agents: AgentStatus[],
  options?: {
    defaultModelText?: string;
    readOnlyText?: string;
    resolveDefaultFromAgent?: boolean;
  },
): string {
  const normalizedAgent = `${member.agent || ""}`.trim();
  if (!normalizedAgent) {
    return "";
  }
  const info = resolveCollabModelInfo(
    normalizedAgent,
    member.model,
    agents,
    options?.defaultModelText ?? "默认模型",
    { resolveDefaultFromAgent: options?.resolveDefaultFromAgent },
  );
  const parts = [info.agentLabel, info.modelLabel];
  const effort = `${member.effort || ""}`.trim();
  if (effort) {
    parts.push(effort);
  }
  if (member.read_only) {
    parts.push(options?.readOnlyText ?? "只读");
  }
  return parts.filter(Boolean).join(" · ");
}

export function resolveEffectiveSlotEffort(
  slot: Pick<CollabMemberSlot, "agent" | "model" | "effort">,
  agents: AgentStatus[],
): string {
  const normalizedAgent = `${slot.agent || ""}`.trim();
  const cleanedModel = `${slot.model || ""}`.trim();
  const cleanedEffort = `${slot.effort || ""}`.trim();
  const agentStatus = agents.find((item) => item.name === normalizedAgent);
  if (!agentStatus) {
    return cleanedEffort;
  }
  const models = agentStatus.models ?? [];
  const effectiveModelId =
    cleanedModel ||
    agentStatus.default_model_id ||
    agentStatus.current_model_id ||
    "";
  const modelStatus = models.find((item) => item.id === effectiveModelId);
  const availableEfforts = modelStatus?.efforts ?? agentStatus.efforts ?? [];
  const supportsEffort = availableEfforts.length > 0 && !!modelStatus?.supportEffort;
  if (!supportsEffort) {
    return "";
  }
  if (cleanedEffort && availableEfforts.includes(cleanedEffort)) {
    return cleanedEffort;
  }
  return getAgentDefaults(agentStatus, cleanedModel).effort;
}

export function collabPermissionLabel(slot: CollabMemberSlot): string {
  if (slot.role === "reviewer" || slot.permission_mode === "read-only") return "只读";
  if (slot.agent === "codex" && slot.permission_mode === "full-access") return "全权限";
  if (slot.agent === "codex" && slot.permission_mode === "default") return "工作区写入";
  return slot.permission_mode || "沿用 Agent 配置";
}

export function normalizeSlotForSubmission(
  slot: CollabMemberSlot,
  agents: AgentStatus[],
): CollabMemberSlot {
  return {
    ...slot,
    model: `${slot.model || ""}`.trim(),
    effort: resolveEffectiveSlotEffort(slot, agents),
  };
}

export function normalizeSlotAfterAgentChange(
  prevSlot: CollabMemberSlot,
  nextAgent: string,
  nextModel: string | undefined,
  agents: AgentStatus[],
): CollabMemberSlot {
  const cleanedModel = `${nextModel || ""}`.trim();
  const nextStatus = agents.find((item) => item.name === nextAgent);
  const models = nextStatus?.models ?? [];
  const effectiveModelId =
    cleanedModel ||
    nextStatus?.default_model_id ||
    nextStatus?.current_model_id ||
    "";
  const modelStatus = models.find((item) => item.id === effectiveModelId);
  const availableEfforts = modelStatus?.efforts ?? nextStatus?.efforts ?? [];
  const supportsEffort = availableEfforts.length > 0 && !!modelStatus?.supportEffort;
  const defaults = getAgentDefaults(nextStatus, cleanedModel);

  let nextEffort = prevSlot.effort || "";
  if (nextAgent !== prevSlot.agent) {
    nextEffort = supportsEffort ? defaults.effort : "";
  } else if (nextStatus && models.length > 0) {
    if (!supportsEffort) {
      nextEffort = "";
    } else if (nextEffort && !availableEfforts.includes(nextEffort)) {
      nextEffort = defaults.effort;
    }
  }

  return {
    ...prevSlot,
    agent: nextAgent,
    model: cleanedModel,
    effort: nextEffort,
    permission_mode: nextAgent === prevSlot.agent ? prevSlot.permission_mode : undefined,
  };
}
