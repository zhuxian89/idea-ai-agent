import type { TimelineItem } from "../hooks/useSessionStream";
import { buildToolActivityView, type ActivityContext, type ActivityAgent, type ToolActivityView } from "./toolActivity";

export type ActivitySegmentEntry =
  | { type: "activity"; view: ToolActivityView }
  | { type: "boundary"; key: string };
export type ActivityGroup = {
  type: "activity_group";
  key: string;
  sourceTurnKey: string;
  agent: ActivityAgent;
  items: ToolActivityView[];
};
type ActivityEntry = Extract<ActivitySegmentEntry, { type: "activity" }>;
const ordinaryOperations = new Set(["execute", "read", "list", "search", "web_search", "fetch", "mcp"]);

function ordinarySegment(view: ToolActivityView): boolean {
  return Boolean(view.ref && view.agent && view.sourceTurnKey && !view.requiresInteraction &&
    view.source !== "user_shell" && ordinaryOperations.has(view.operation) &&
    (view.state === "running" || view.state === "completed"));
}

function sameSegment(left: ToolActivityView, right: ToolActivityView): boolean {
  return left.ref?.rootId === right.ref?.rootId && left.ref?.sessionKey === right.ref?.sessionKey &&
    left.agent === right.agent && left.sourceTurnKey === right.sourceTurnKey;
}

export function groupCompletedActivities(entries: readonly ActivitySegmentEntry[], context: {
  closedTurnKeys: ReadonlySet<string>; minGroupSize: 3;
}): readonly (ActivitySegmentEntry | ActivityGroup)[] {
  // Updates describe the same invocation. Keep its first position and latest
  // view, including a corrected terminal outcome, without counting it again.
  const latest = new Map<string, ActivityEntry>();
  for (const entry of entries) if (entry.type === "activity" && entry.view.ref) latest.set(entry.view.key, entry);
  const seen = new Set<string>();
  const output: (ActivitySegmentEntry | ActivityGroup)[] = [];
  let segment: ActivityEntry[] = [];
  const flush = (closed: boolean) => {
    if (!closed) output.push(...segment);
    else {
      let completed: ActivityEntry[] = [];
      const flushCompleted = () => {
        if (completed.length >= context.minGroupSize) {
          const first = completed[0].view;
          output.push({ type: "activity_group", key: JSON.stringify([
            "activity_group", first.ref!.rootId, first.ref!.sessionKey, first.agent, first.sourceTurnKey, first.key,
          ]), agent: first.agent!, sourceTurnKey: first.sourceTurnKey!, items: completed.map(entry => entry.view) });
        } else output.push(...completed);
        completed = [];
      };
      for (const entry of segment) {
        if (entry.view.state === "completed") completed.push(entry);
        else { flushCompleted(); output.push(entry); }
      }
      flushCompleted();
    }
    segment = [];
  };
  for (let entry of entries) {
    if (entry.type === "activity" && entry.view.ref) {
      if (seen.has(entry.view.key)) continue;
      seen.add(entry.view.key);
      entry = latest.get(entry.view.key)!;
    }
    if (entry.type === "boundary" || !ordinarySegment(entry.view)) {
      flush(true);
      output.push(entry);
    } else {
      if (segment.length && !sameSegment(segment[0].view, entry.view)) flush(true);
      segment.push(entry);
    }
  }
  flush(Boolean(segment[0]?.view.sourceTurnKey && context.closedTurnKeys.has(segment[0].view.sourceTurnKey)));
  return output;
}

export function projectActivityTimeline(timeline: readonly TimelineItem[], context: Omit<ActivityContext, "requiresInteraction"> & {
  tailClosed: boolean;
}) {
  const originals = new Map<string, { item: TimelineItem; index: number }>();
  const entries: ActivitySegmentEntry[] = [];
  const closedTurnKeys = new Set<string>();
  timeline.forEach((item, index) => {
    const localKey = JSON.stringify(["timeline", context.rootId, context.sessionKey, item.id]);
    if (item.type !== "tool") {
      originals.set(localKey, { item, index });
      entries.push({ type: "boundary", key: localKey });
      return;
    }
    const call = item.toolCall;
    const kind = call.kind.toLowerCase();
    // Preserve existing special renderers even with contradictory/old facts.
    // Inspect content item types only, never command output or diff text.
    const special = ["edit", "delete", "move", "file_change", "task", "ask_user", "todo", "switch_mode"].includes(kind) ||
      call.meta?.source === "userShell" || call.meta?.rawType === "collabToolCall" || call.meta?.type === "collabAgentToolCall" ||
      call.content?.some(content => content.type === "diff") || call.meta?.requiresInteraction === true;
    const view = buildToolActivityView(call, { ...context, agent: item.agent, sourceTurnKey: item.sourceTurnKey, requiresInteraction: Boolean(special) });
    if (!call.callId) view.key = localKey;
    const previous = originals.get(view.key);
    originals.set(view.key, { item: previous ? { ...item, id: previous.item.id } : item, index: previous?.index ?? index });
    entries.push({ type: "activity", view });
    if (context.tailClosed && view.sourceTurnKey) closedTurnKeys.add(view.sourceTurnKey);
  });
  return { rows: groupCompletedActivities(entries, { closedTurnKeys, minGroupSize: 3 }), originals };
}
