import type { AgentStatus } from "../../services/agents";
import type { CollabRun } from "../../services/collab";
import type { MeetingDetail, MeetingRound, MeetingTurn } from "../../services/collabMeeting";
import { CollabRunModelBar } from "./CollabRunModelBar";
import { meetingMemberAlias, meetingTurnStatus } from "./meetingDisplay";

interface Props {
  run: CollabRun;
  meeting: MeetingDetail;
  current: MeetingRound;
  agents: AgentStatus[];
  busy: boolean;
  onProcess: (turn: MeetingTurn) => void;
  onEdit?: () => void;
}

export function MeetingModels({ run, meeting, current, agents, busy, onProcess, onEdit }: Props) {
  const allTurns = meeting.rounds.flatMap((round) => round.turns);
  const items = run.snapshot.members.map((member, index) => {
    const own = current.turns.filter((turn) => turn.slot_id === member.slot_id);
    const active = own.find((turn) => turn.status === "running" || turn.status === "delivering");
    const crossed = allTurns.find((turn) => turn.slot_id === member.slot_id && turn.session_key && turn.blind_reads?.length);
    const recording = crossed || (active?.session_key ? active : own.filter((turn) => turn.session_key).at(-1));
    return {
      member,
      label: meetingMemberAlias(index),
      badge: String(index + 1),
      lead: member.slot_id === run.snapshot.final_author_slot_id,
      activity: active && meetingTurnStatus[active.status],
      onProcess: recording && (() => onProcess(recording)),
    };
  });
  return <CollabRunModelBar meeting items={items} agents={agents} busy={busy} onEdit={onEdit} />;
}
