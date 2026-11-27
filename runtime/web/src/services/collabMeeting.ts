import type { CollabReviewItem } from "./collab";

export interface MeetingDetail {
  rounds: MeetingRound[];
  quick_run_id?: string;
}

export interface MeetingRound {
  number: number;
  inputs?: string[];
  turns: MeetingTurn[];
  items?: MeetingItem[];
  summary_doc?: string;
  summary_at?: string;
  decisions?: MeetingDecision[];
  author_override?: string;
  plan_resolutions?: { plan_id: string; action: "revise_plan" | "implement"; reason: string }[];
}

export interface MeetingTurn {
  id: string;
  kind: "proposal" | "review" | "author" | "answer" | "plan" | "confirmation";
  slot_id?: string;
  agent?: string;
  model?: string;
  status: "pending" | "running" | "waiting_user" | "failed" | "delivering" | "done";
  session_key?: string;
  doc: string;
  body?: string;
  live_seq?: number;
  at: string;
  reply_to?: string;
  mentions?: string[];
  positions?: MeetingPosition[];
  position_issue?: string;
  plan_id?: string;
  confirmed?: boolean;
  blind_reads?: string[];
  readonly_state?: "clean" | "modified" | "unobserved";
  readonly_note?: string;
}

export interface MeetingPosition {
  title?: string;
  id?: string;
  slot_id: string;
  turn_id?: string;
  doc?: string;
  stance: "propose" | "agree" | "disagree" | "unconfirmed";
  quote: string;
  checked?: string;
  risk?: string;
  reason?: string;
  citations?: CollabReviewItem[];
  version_id?: string;
  issue?: string;
  source?: "submission" | "author";
}

export interface MeetingItem {
  id: string;
  title: string;
  aligned: boolean;
  stalled?: boolean;
  proposal?: MeetingPosition;
  candidates?: MeetingPosition[];
  positions: MeetingPosition[] | null;
}

export interface MeetingDecision {
  item_id: string;
  choice: "adopt" | "custom" | "defer";
  slot_id?: string;
  turn_id?: string;
  version_id?: string;
  note?: string;
}

export type MeetingAction = { round: number } & (
  | { action: "retry_turn"; turn_id: string; attempt: string }
  | { action: "message"; text: string }
  | { action: "next" }
  | { action: "plan"; decisions?: MeetingDecision[]; override_all?: boolean; text?: string }
  | { action: "revise_plan"; plan_id: string; text: string }
  | { action: "finish" }
  | { action: "implement"; plan_id?: string; text?: string; quick_template_id?: string }
);
