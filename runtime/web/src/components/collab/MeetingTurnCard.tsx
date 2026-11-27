import { useEffect, useState } from "react";
import type { AgentStatus } from "../../services/agents";
import type { CollabRun } from "../../services/collab";
import type { MeetingRound, MeetingTurn } from "../../services/collabMeeting";
import { isRemoteWebUi } from "../../services/remoteUi";
import { AgentIcon } from "../AgentIcon";
import { MarkdownViewer } from "../MarkdownViewer";
import { CollabIconButton } from "./CollabIcon";
import { describeMeetingMember, meetingTurnStatus } from "./meetingDisplay";

export function MeetingMessageBody({ text, root, path }: { text: string; root: string; path: string }) {
  return <div className="meeting-message-content">
    <MarkdownViewer content={text} currentPath={path} root={root} />
  </div>;
}

interface TurnCardProps {
  turn: MeetingTurn;
  round: MeetingRound;
  run: CollabRun;
  agents: AgentStatus[];
  isCurrentRound: boolean;
  selected?: boolean;
  body: string;
  memberName: (slot?: string) => string;
  busy: boolean;
  onOpenDoc?: () => void;
  onOpenProcess?: () => void;
  onRetry?: () => void;
}

function TurnElapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const start = Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(since) ? since : `${since}Z`);
  if (!Number.isFinite(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return <span className="meeting-turn-elapsed"> · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>;
}

export function MeetingTurnCard({
  turn, round, run, agents, isCurrentRound, selected = false, body, memberName, busy, onOpenProcess, onRetry,
}: TurnCardProps) {
  const isAuthor = turn.kind === "author";
  const clickable = !isAuthor && !!onOpenProcess;
  const SelectTag = clickable ? "button" : "div";
  const memberIndex = run.snapshot.members.findIndex((item) => item.slot_id === turn.slot_id);
  const member = run.snapshot.members[memberIndex];
  const speaker = member && describeMeetingMember(member, memberIndex, agents, turn);
  const missing = turn.status !== "done" && (turn.kind === "proposal" || turn.kind === "review") &&
    (!isCurrentRound || run.current_step !== turn.kind && !!round.summary_doc ||
      turn.status === "waiting_user" || turn.status === "failed");
  const active = turn.status === "running" || turn.status === "delivering";
  const glow = isRemoteWebUi && active;

  return <article id={`meeting-${turn.id}`} data-kind={turn.kind} tabIndex={-1}
    className={`collab-card meeting-message st-${active ? "running" : turn.status}${selected ? " selected" : ""}${clickable ? " clickable" : ""}${glow ? " remote-glow-frame" : ""}`}
    data-glow-active={glow ? "" : undefined}
    onClick={clickable ? () => onOpenProcess() : undefined}>
    <div className="meeting-message-head">
      <SelectTag className="collab-tc-select meeting-turn-select" type={clickable ? "button" : undefined}>
        {speaker ? <AgentIcon agentName={speaker.agent} aria-label={speaker.agentLabel} width={18} height={18} /> : <span className="meeting-author-avatar">作</span>}
        <strong className="meeting-turn-title" title={speaker?.title}>{speaker?.label ?? memberName(turn.slot_id)}</strong>
        {!isAuthor && <span className="meeting-turn-status">{meetingTurnStatus[turn.status]}{active && <TurnElapsed since={turn.at} />}</span>}
      </SelectTag>
      {onRetry ? <div className="meeting-icon-actions" onClick={(event) => event.stopPropagation()}>
        <CollabIconButton icon="refresh" label={turn.status === "running" ? "检查并重试" : "重试此成员"}
          disabled={busy} onClick={onRetry} />
      </div> : null}
    </div>
    {isAuthor && body ? <MeetingMessageBody text={body} root={run.root_id} path={`.mindfs/runs/${run.id}/${turn.doc}`} /> : null}
    {(missing || turn.position_issue || !!turn.blind_reads?.length || turn.readonly_state && turn.readonly_state !== "clean") &&
      <div className="meeting-footnote">
        {missing && <span className="meeting-warning">未交付</span>}
        {turn.position_issue && <span className="meeting-warning">{turn.position_issue}</span>}
        {!!turn.blind_reads?.length && <span className="meeting-warning" title={turn.blind_reads.join("\n")}>{turn.kind === "review" ? "读过他人互评" : "读过他人草案"}</span>}
        {turn.readonly_state && turn.readonly_state !== "clean" && <span className="meeting-warning" title={turn.readonly_note}>
          {turn.readonly_state === "modified" ? "检测到工作区变更" : "工作区对比不完整"}</span>}
      </div>}
  </article>;
}
