import type { Locale } from "../i18n";
import type { ToolCall } from "./session";
import { readActivityFacts, toolActivityState, type ActivityAgent, type ActivityState, type ActivityOperation } from "./activityFacts";
import { buildActivitySummary } from "./toolActivitySummary";
export type { ActivityAgent, ActivityState, ActivityOperation } from "./activityFacts";

export type ActivityRef = { rootId: string; sessionKey: string; callId: string };
export type ActivityContext = {
  rootId: string;
  sessionKey: string;
  agent?: ActivityAgent;
  sourceTurnKey?: string;
  rootPath?: string;
  locale: Locale;
  requiresInteraction: boolean;
};
export type ToolActivityView = {
  key: string;
  ref?: ActivityRef;
  agent?: ActivityAgent;
  operation: ActivityOperation;
  state: ActivityState;
  summary: string;
  preview?: string;
  durationMs?: number;
  source: "agent" | "user_shell" | "unknown";
  hasDetails: boolean;
  requiresInteraction: boolean;
  sourceTurnKey?: string;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Shared by activity rows and the running session label. No output parsing,
// persistence, requests or clocks belong in this projection.
export function buildToolActivityView(call: ToolCall, context: ActivityContext): ToolActivityView {
  const facts = readActivityFacts(call.activity);
  const kind = call.kind.trim().toLowerCase();
  const rawType = stringValue(call.meta?.rawType) || call.rawType;
  // Claude's existing adapter keeps MCP names in the title; Codex carries a
  // dedicated raw type. Both can use the shared row without a protocol change.
  const isMcp = rawType === "mcpToolCall" || stringValue(call.title).startsWith("mcp__");
  const operation: ActivityOperation = facts?.operation || (isMcp ? "mcp"
    : ["edit", "delete", "move"].includes(kind) ? "file_change"
    : ["execute", "read", "list", "search", "web_search", "fetch", "file_change", "mcp", "task"].includes(kind) ? kind as ActivityOperation : "other");
  const state = facts?.outcome || toolActivityState(call.status);
  const { summary, preview } = buildActivitySummary(call, facts, { operation, state, locale: context.locale, rootPath: context.rootPath });
  const ref = context.rootId && context.sessionKey && call.callId
    ? { rootId: context.rootId, sessionKey: context.sessionKey, callId: call.callId }
    : undefined;
  return {
    key: JSON.stringify([context.rootId, context.sessionKey, call.callId]),
    ref,
    agent: facts?.agent || context.agent,
    operation,
    state,
    summary,
    preview,
    source: facts?.source || (call.meta?.source === "userShell" ? "user_shell" : "unknown"),
    durationMs: facts?.durationMs,
    hasDetails: Boolean(ref || call.content?.length || call.locations?.length || stringValue(call.meta?.command) || stringValue(call.meta?.input)),
    requiresInteraction: context.requiresInteraction,
    sourceTurnKey: facts?.nativeTurnId ? JSON.stringify(["native", facts.agent, facts.nativeTurnId]) : context.sourceTurnKey,
  };
}
