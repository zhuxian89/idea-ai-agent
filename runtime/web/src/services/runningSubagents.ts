import type { TimelineItem } from "../hooks/useSessionStream";
import { readActivityFacts, toolActivityState } from "./activityFacts";

export type RunningSubagent = {
  // The id the CLI uses to stop it: the task id, or the tool-use id of the call that started it.
  stopRef: string;
  // The tool card's call id. The child session records it as its parent_tool_call_id.
  callId: string;
  title: string;
  subagentType: string;
  progress: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Subagents of the current turn that have not finished, in the order they started.
export function runningSubagents(timeline: readonly TimelineItem[]): RunningSubagent[] {
  const found = new Map<string, RunningSubagent>();
  for (const item of timeline) {
    if (item.type !== "tool") continue;
    const call = item.toolCall;
    if (call.kind !== "task" || call.rawType !== "claude_task") continue;
    const stopRef = text(call.meta?.taskId) || text(call.meta?.parentToolUseId) || call.callId;
    if (!stopRef) continue;
    const state = readActivityFacts(call.activity)?.outcome || toolActivityState(call.status || "");
    if (state !== "running") {
      found.delete(call.callId);
      continue;
    }
    found.set(call.callId, {
      stopRef,
      callId: call.callId,
      title: text(call.title) || text(call.meta?.taskDescription) || text(call.meta?.subagentType) || call.callId,
      subagentType: text(call.meta?.subagentType),
      progress: text(call.meta?.progress),
    });
  }
  return [...found.values()];
}
