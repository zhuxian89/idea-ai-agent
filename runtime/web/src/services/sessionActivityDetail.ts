import type { TimelineItem } from "../hooks/useSessionStream";
import { translateWithLocale, type Locale } from "../i18n";
import type { ToolActivityView } from "./toolActivity";

/** Use only current-turn native facts; no logs, prose inference, clocks or requests. */
export function sessionActivityDetail(input: {
  timeline: TimelineItem[];
  tool: Pick<ToolActivityView, "summary" | "summaryIsSpecific"> | null;
  locale: Locale;
}): string {
  if (input.tool?.summaryIsSpecific) return input.tool.summary;
  let latestTodo: Extract<TimelineItem, { type: "todo" }> | undefined;
  let hasUser = false;
  for (let index = input.timeline.length - 1; index >= 0; index--) {
    const item = input.timeline[index];
    if (item.type === "user_text") { hasUser = true; break; }
    if (!latestTodo && item.type === "todo") latestTodo = item;
  }
  // An empty or completed latest snapshot clears the previous step. Do not
  // choose a pending step, reuse a prior turn, or interpret free-form plan text.
  const steps = hasUser ? latestTodo?.todoUpdate.items
    .filter(item => item.status === "in_progress")
    .map(item => (item.activeForm?.trim() || item.content.trim()).replace(/\s+/g, " "))
    .filter(Boolean) || [] : [];
  if (steps.length) {
    return translateWithLocale(input.locale, "session.activityPlanStep", { step: steps.join(" · ") });
  }
  return input.tool?.summary || "";
}
