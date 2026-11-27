import type { AgentStatus } from "../../services/agents";
import type { CollabMemberSlot } from "../../services/collab";
import { AgentIcon } from "../AgentIcon";
import { CollabIcon, CollabIconButton } from "./CollabIcon";
import { checkLocalSlotAvailability, collabPermissionLabel, compactCollabModelLabel, resolveCollabModelInfo } from "./collabModelDisplay";

interface ModelItem {
  member: CollabMemberSlot;
  label: string;
  badge: string;
  lead?: boolean;
  activity?: string;
  onProcess?: () => void;
}

interface Props {
  meeting?: boolean;
  items: ModelItem[];
  agents: AgentStatus[];
  busy: boolean;
  onEdit?: () => void;
}

export function CollabRunModelBar({ meeting = false, items, agents, busy, onEdit }: Props) {
  const label = meeting ? "参会模型配置" : "本次协作模型配置";
  const entries = items.map((item) => ({ ...item, availability: checkLocalSlotAvailability(item.member, agents) }));
  const warnings = entries.filter(({ availability }) => !availability.available)
    .map(({ label, availability }) => `${label}：${availability.reason}`);
  return <div className="collab-run-models" data-meeting={meeting} data-count={entries.length} role="group" aria-label={label}>
    <div className="collab-run-model-list" tabIndex={meeting ? 0 : undefined}>
      {entries.map(({ member, label, badge, lead, activity, onProcess, availability }) => {
        const info = resolveCollabModelInfo(member.agent, member.model, agents, undefined, { resolveDefaultFromAgent: meeting });
        const permission = collabPermissionLabel(member, meeting, agents);
        const showPermission = !meeting && member.role !== "reviewer" && permission !== "沿用 Agent 配置";
        const title = [label, info.agentLabel, info.modelLabel, member.effort, permission].filter(Boolean).join(" · ");
        const Chip = onProcess ? "button" : "div";
        return <Chip key={member.slot_id || member.role}
          className={`collab-run-model-chip${availability.available ? "" : " invalid"}${onProcess ? " clickable" : ""}`}
          type={onProcess ? "button" : undefined} onClick={onProcess}
          role={onProcess ? undefined : "group"} aria-label={onProcess ? `查看${label}发言过程：${title}` : title} title={title}>
          <span className="collab-run-model-role">
            <AgentIcon agentName={member.agent} aria-hidden="true" />
            <span aria-hidden="true">{badge}</span>
            {lead && <span className="collab-model-lead" role="img" aria-label="主笔" title="主笔"><CollabIcon name="edit" /></span>}
            {activity && <span className="collab-model-dot" data-state="active" role="img" aria-label={activity} title={activity} />}
          </span>
          <span className="collab-run-model-value">
            {compactCollabModelLabel(info)}{member.effort && <span className="collab-run-model-effort"> · {member.effort}</span>}
          </span>
          {showPermission && <span className="collab-permission-tag">{permission}</span>}
          {!availability.available && <span className="collab-model-dot" data-state="error" role="img"
            aria-label="不可用" title={availability.reason} />}
        </Chip>;
      })}
    </div>
    {meeting && warnings.length > 0 && <span className="collab-run-model-warning"
      role="img" aria-label="有参会模型不可用" title={warnings.join("\n")}><CollabIcon name="alert" /></span>}
    {onEdit && <CollabIconButton icon="edit" label="修改模型" className="collab-run-models-edit" disabled={busy} onClick={onEdit} />}
  </div>;
}
