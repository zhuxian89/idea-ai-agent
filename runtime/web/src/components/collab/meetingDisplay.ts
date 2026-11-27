import type { AgentStatus } from "../../services/agents";
import type { CollabMemberSlot } from "../../services/collab";
import type { MeetingPosition, MeetingTurn } from "../../services/collabMeeting";
import { collabPermissionLabel, compactCollabModelLabel, meetingTurnModel, resolveCollabModelInfo } from "./collabModelDisplay";

export const meetingTurnStatus = {
  pending: "待发言",
  running: "发言中",
  delivering: "交付中",
  waiting_user: "待继续",
  failed: "发言失败",
  done: "已交付",
} satisfies Record<MeetingTurn["status"], string>;

export function meetingMemberAlias(index: number) {
  return `成员${index + 1}`;
}

export function meetingPermissionChoices(member: CollabMemberSlot, agents: AgentStatus[]) {
  const modes = agents.find((agent) => agent.name === member.agent)?.modes || [];
  return ["", "agent-default", ...modes.map((mode) => mode.id)].map((id) => ({
    id,
    label: collabPermissionLabel({ ...member, permission_mode: id }, true, agents),
  }));
}

export function describeMeetingMember(member: CollabMemberSlot, index: number, agents: AgentStatus[], turn?: MeetingTurn) {
  const { agent, model } = turn ? meetingTurnModel(turn, member) : member;
  const info = resolveCollabModelInfo(agent, model, agents, undefined, { resolveDefaultFromAgent: !turn?.agent });
  const alias = meetingMemberAlias(index);
  return {
    agent: agent || member.agent,
    agentLabel: info.agentLabel,
    alias,
    label: `${alias} · ${compactCollabModelLabel(info)}`,
    title: `${alias} · ${info.agentLabel} · ${info.modelLabel}`,
    modelLabel: info.modelLabel,
  };
}

export function meetingCandidateLabel(candidates: MeetingPosition[] | undefined, version?: string) {
  const index = candidates?.findIndex((candidate) => candidate.version_id === version) ?? -1;
  if (!candidates || index < 0) return "";
  return [`方案 ${index + 1}`, candidates[index].title].filter(Boolean).join(" · ");
}
