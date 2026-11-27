import type { AgentStatus } from "../../services/agents";
import type { CollabMemberSlot, MeetingTopicMode } from "../../services/collab";
import { AgentSelector } from "../AgentSelector";
import { normalizeSlotAfterAgentChange, normalizeSlotForSubmission } from "./collabModelDisplay";
import { describeMeetingMember, meetingMemberAlias, meetingPermissionChoices } from "./meetingDisplay";

export function defaultCollabMembers(agents: AgentStatus[], group: boolean): CollabMemberSlot[] {
  const first = agents.find((agent) => agent.available)?.name || agents[0]?.name || "codex";
  const second = agents.find((agent) => agent.available && agent.name !== first)?.name || first;
  return [first, second].map((agent, index) => normalizeSlotForSubmission({
    slot_id: group ? `member-${index + 1}` : index === 0 ? "primary" : "reviewer",
    role: group ? "member" : index === 0 ? "primary" : "reviewer",
    agent,
  }, agents));
}

interface Props {
  agents: AgentStatus[];
  members: CollabMemberSlot[];
  author: string;
  rounds: number;
  topicMode: MeetingTopicMode;
  onTopicMode: (mode: MeetingTopicMode) => void;
  onMembers: (members: CollabMemberSlot[]) => void;
  onAuthor: (id: string) => void;
  onRounds: (rounds: number) => void;
  unavailable?: Record<string, string | undefined>;
}

export function MeetingMemberSettings({
  agents, members, author, rounds, topicMode, onTopicMode, onMembers, onAuthor, onRounds, unavailable,
}: Props) {
  return <>
    <div className="collab-slot-row meeting-slot-row">
      {members.map((slot, index) => {
        const alias = meetingMemberAlias(index);
        const update = (next: CollabMemberSlot) => onMembers(members.map((member) => member.slot_id === slot.slot_id ? next : member));
        return <div key={slot.slot_id} className={`collab-slot-card ${unavailable?.[slot.slot_id] ? "invalid" : ""}`}>
          <div className="collab-slot-heading">
            <span>{alias}</span>
            {members.length > 2 && <button
              type="button" className="collab-quiet-link" aria-label={`移除${alias}`}
              onClick={() => {
                const next = members.filter((member) => member.slot_id !== slot.slot_id);
                onMembers(next);
                if (author === slot.slot_id) onAuthor(next[0].slot_id);
              }}
            >移除</button>}
          </div>
          <AgentSelector
            agent={slot.agent}
            model={slot.model || ""}
            effort={slot.effort || ""}
            agents={agents}
            menuPlacement="bottom"
            viewportMenu
            showLabel
            showChevron
            defaultExpandOptions
            allowDefaultModel
            warnUnavailable={Boolean(unavailable?.[slot.slot_id])}
            onAgentChange={(agent, model) => update(normalizeSlotAfterAgentChange(slot, agent, model, agents))}
            onEffortChange={(effort) => update({ ...slot, effort })}
          />
          <label className="meeting-permission">
            权限
            <select aria-label={`${alias}权限`} value={slot.permission_mode || ""}
              onChange={(event) => update({ ...slot, permission_mode: event.target.value })}>
              {meetingPermissionChoices(slot, agents).map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          {unavailable?.[slot.slot_id] && <span className="meeting-error">{unavailable[slot.slot_id]}</span>}
        </div>;
      })}
    </div>
    <div className="meeting-settings">
      <button className="collab-btn-secondary" type="button" onClick={() => {
        let next = members.length + 1;
        while (members.some((member) => member.slot_id === `member-${next}`)) next++;
        onMembers([...members, { ...defaultCollabMembers(agents, true)[0], slot_id: `member-${next}` }]);
      }}>添加成员</button>
      <label>讨论方式 <select value={topicMode} onChange={(event) => onTopicMode(event.target.value as MeetingTopicMode)}>
        <option value="single">单议题</option>
        <option value="multi">多议题</option>
      </select></label>
      <label>主笔 <select value={author} onChange={(event) => onAuthor(event.target.value)}>
        {members.map((member, index) => <option key={member.slot_id} value={member.slot_id}>
          {describeMeetingMember(member, index, agents).label}
        </option>)}
      </select></label>
      <label>轮次上限 <input type="number" min={1} max={5} value={rounds}
        onChange={(event) => onRounds(event.currentTarget.valueAsNumber || 0)} /></label>
    </div>
  </>;
}
