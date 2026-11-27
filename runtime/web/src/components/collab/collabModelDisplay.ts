import { getAgentDefaults } from "../../services/agentDefaults";
import { agentDisplayName } from "../../services/agentSetup";
import type { AgentStatus } from "../../services/agents";
import type { CollabMemberSlot } from "../../services/collab";
import type { MeetingTurn } from "../../services/collabMeeting";

export function meetingTurnModel(turn: MeetingTurn, member?: CollabMemberSlot) {
  if (turn.agent) return { agent: turn.agent, model: turn.model };
  return { agent: member?.agent, model: turn.model || member?.model };
}

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

export function compactCollabModelLabel(info: ResolvedCollabModelInfo): string {
  if (info.isDefaultModel) return "默认模型";
  return info.modelLabel
    .replace(/^claude[- ](?=(?:opus|sonnet|haiku)[- ])/i, "")
    .replace(/^(opus|sonnet|haiku)[- ](\d+)[-.](\d+)(?=$|[- ])/i,
      (_, family: string, major: string, minor: string) => `${family[0].toUpperCase()}${family.slice(1).toLowerCase()} ${major}.${minor}`)
    .replace(/^gpt-(?=\d+(?:\.\d+)?-codex(?:$|-))/i, "");
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

export function collabPermissionLabel(slot: CollabMemberSlot, meeting = false, agents: AgentStatus[] = []): string {
  if (meeting ? !slot.permission_mode : slot.role === "reviewer") return "严格只读";
  if (slot.permission_mode === "read-only") return "只读";
  if (slot.agent === "codex" && slot.permission_mode === "full-access") return "全权限";
  if (slot.agent === "codex" && slot.permission_mode === "default") return "工作区写入";
  const mode = slot.permission_mode;
  if (!mode || mode === "agent-default") return "沿用 Agent 配置";
  return agents.find((agent) => agent.name === slot.agent)?.modes?.find((entry) => entry.id === mode)?.name || mode;
}

export function checkLocalSlotAvailability(
  slot: CollabMemberSlot,
  agents: AgentStatus[],
): { available: boolean; reason?: string } {
  if (!agents.length) return { available: true };
  const st = agents.find((a) => a.name === slot.agent);
  if (!st) {
    return { available: false, reason: `未配置的 Agent：${slot.agent}` };
  }
  if (st.probe_pending) {
    return { available: true };
  }
  if (!st.installed) {
    return { available: false, reason: `Agent ${slot.agent} 未安装` };
  }
  if (!st.available) {
    return {
      available: false,
      reason: `Agent ${slot.agent} 当前不可用${st.error ? `：${st.error}` : ""}`,
    };
  }
  if (slot.model && (st.models?.length ?? 0) > 0) {
    const found = st.models!.some((m) => m.id === slot.model);
    if (!found) {
      return {
        available: false,
        reason: `模型 ${slot.model} 不在 ${slot.agent} 当前可用列表中，请手动选择替代模型`,
      };
    }
  }
  if (
    slot.permission_mode &&
    slot.permission_mode !== "agent-default" &&
    st.modes?.length &&
    !st.modes.some((item) => item.id === slot.permission_mode)
  ) {
    return { available: false, reason: `权限档位 ${slot.permission_mode} 已不可用，请重新选择` };
  }
  return { available: true };
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
