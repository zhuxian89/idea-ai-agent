import type { ReactNode } from "react";
import { openIdeaFile } from "../../services/ideaBridge";
import type { MeetingPosition } from "../../services/collabMeeting";
import { AgentIcon } from "../AgentIcon";
import { CollabIcon } from "./CollabIcon";
import type { describeMeetingMember } from "./meetingDisplay";

export const meetingStanceLabels = { propose: "提出方案", agree: "同意", disagree: "有异议", unconfirmed: "未确认" };

export function MeetingPositionDetails({ position, member, rootId, showItem, actions, candidateLabel }: {
  position: MeetingPosition;
  member?: ReturnType<typeof describeMeetingMember>;
  rootId: string;
  showItem?: boolean;
  actions?: ReactNode;
  candidateLabel?: string;
}) {
  const subject = showItem
    ? [position.id, position.version_id].filter(Boolean).join(" · ")
    : (member?.label || position.slot_id);
  return <>
    <div className="meeting-position-head">
      <div className="meeting-position-who">
        {(member || subject) && <strong className="meeting-position-label" title={member?.title}>
          {member && <AgentIcon agentName={member.agent} aria-hidden="true" />}
          {subject && <span>{subject}</span>}
        </strong>}
        <span className="meeting-stance-pill" data-stance={position.stance}>{meetingStanceLabels[position.stance]}</span>
        {candidateLabel && <span className="meeting-position-tag">{candidateLabel}</span>}
        {position.source === "submission" && <span className="meeting-position-tag">本人提交</span>}
      </div>
      {actions}
    </div>
    {position.issue && <div className="meeting-position-alert">{position.issue}</div>}
    {position.quote && <blockquote className="meeting-position-quote">{position.quote}</blockquote>}
    {(position.checked || position.risk || position.reason) && <dl className="meeting-position-fields">
      {position.checked && <div className="meeting-position-field"><dt>检查</dt><dd>{position.checked}</dd></div>}
      {position.risk && <div className="meeting-position-field"><dt>剩余风险</dt><dd>{position.risk}</dd></div>}
      {position.reason && <div className="meeting-position-field"><dt>理由</dt><dd>{position.reason}</dd></div>}
    </dl>}
    <div className="meeting-citations">
      {!position.citations?.length && <span className="meeting-citation meeting-warning" data-verified="missing">出处待补</span>}
      {position.citations?.map((cite, index) => {
        const source = `${cite.file_path}:${cite.line_start}` +
          (cite.line_end && cite.line_end !== cite.line_start ? `–${cite.line_end}` : "");
        return <div key={index} className={`meeting-citation ${cite.citation_verified ? "meeting-verified" : "meeting-warning"}`}
          data-verified={cite.citation_verified ? "true" : "false"}>
          {cite.citation_verified ? <>
            <span className="meeting-citation-status">出处已核实</span>
            <button type="button" className="collab-quiet-link meeting-citation-link"
              onClick={() => openIdeaFile(rootId, `${cite.file_path}#L${cite.line_start}`)}>
              <CollabIcon name="file" /><span>{source}</span>
            </button>
          </> : <span>{`出处无效 · ${source}`}</span>}
          {cite.citation_note && <span className="meeting-citation-note">{cite.citation_note}</span>}
        </div>;
      })}
    </div>
  </>;
}
