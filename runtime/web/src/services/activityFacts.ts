export type ActivityAgent = "codex" | "claude";
export type ActivityState = "running" | "completed" | "failed" | "declined" | "cancelled" | "interrupted" | "unknown";
export type ActivityOperation = "execute" | "read" | "list" | "search" | "web_search" | "fetch" | "file_change" | "mcp" | "task" | "other";
export type ActivityAction =
  | { type: "read"; name?: string; path?: string }
  | { type: "list"; path?: string }
  | { type: "search"; query?: string; path?: string };
export type ActivityFactsV1 = {
  schemaVersion: 1;
  agent: ActivityAgent;
  origin: "live" | "imported";
  operation: ActivityOperation;
  source: "agent" | "user_shell" | "unknown";
  nativeTurnId?: string;
  parentCallId?: string;
  actions?: ActivityAction[];
  displayLabel?: { text: string; source: "native" | "tool_argument" | "tool_metadata" };
  tool?: { name: string; server?: string; displayName?: string };
  outcome?: Exclude<ActivityState, "running" | "unknown">;
  durationMs?: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function choice(value: unknown, values: string[]): boolean {
  return typeof value === "string" && values.includes(value);
}

function optionalStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => value[key] === undefined || typeof value[key] === "string");
}

export function toolActivityState(status: string): ActivityState {
  switch (status.trim().toLowerCase()) {
    case "pending": case "running": case "in_progress": case "inprogress": return "running";
    case "complete": case "completed": case "success": return "completed";
    case "failed": case "error": return "failed";
    case "declined": case "denied": return "declined";
    case "cancelled": case "canceled": return "cancelled";
    case "interrupted": return "interrupted";
    default: return "unknown";
  }
}

export function mergeToolStatus(previous: string | undefined, incoming: string | undefined): string | undefined {
  const oldState = toolActivityState(previous || "");
  const nextState = toolActivityState(incoming || "");
  return !incoming || (oldState !== "running" && oldState !== "unknown" && nextState === "running") ? previous : incoming;
}

// The wire boundary is deliberately checked even though callers have TS types:
// old caches, future servers and damaged records must still render safely.
export function readActivityFacts(value: unknown): ActivityFactsV1 | undefined {
  if (!record(value) || value.schemaVersion !== 1 ||
    !choice(value.agent, ["codex", "claude"]) ||
    !choice(value.origin, ["live", "imported"]) ||
    !choice(value.operation, ["execute", "read", "list", "search", "web_search", "fetch", "file_change", "mcp", "task", "other"]) ||
    !choice(value.source, ["agent", "user_shell", "unknown"]) ||
    !optionalStrings(value, ["nativeTurnId", "parentCallId"])) return undefined;

  if (value.actions !== undefined && (!Array.isArray(value.actions) || !value.actions.every(action =>
    record(action) && choice(action.type, ["read", "list", "search"]) && optionalStrings(action, ["name", "path", "query"])))) return undefined;
  if (value.displayLabel !== undefined && (!record(value.displayLabel) || typeof value.displayLabel.text !== "string" ||
    !choice(value.displayLabel.source, ["native", "tool_argument", "tool_metadata"]))) return undefined;
  if (value.tool !== undefined && (!record(value.tool) || typeof value.tool.name !== "string" || !optionalStrings(value.tool, ["server", "displayName"]))) return undefined;
  if (value.outcome !== undefined && !choice(value.outcome, ["completed", "failed", "declined", "cancelled", "interrupted"])) return undefined;

  const facts = value as ActivityFactsV1;
  return {
    schemaVersion: 1, agent: facts.agent, origin: facts.origin, operation: facts.operation, source: facts.source,
    nativeTurnId: facts.nativeTurnId, parentCallId: facts.parentCallId,
    actions: facts.actions?.map(action => ({ ...action })),
    displayLabel: facts.displayLabel ? { ...facts.displayLabel } : undefined,
    tool: facts.tool ? { ...facts.tool } : undefined,
    outcome: facts.outcome,
    durationMs: typeof facts.durationMs === "number" && Number.isFinite(facts.durationMs) && facts.durationMs >= 0 ? facts.durationMs : undefined,
  };
}

export function mergeActivityFacts(previous: unknown, incoming: unknown): ActivityFactsV1 | undefined {
  const base = readActivityFacts(previous);
  if (incoming === undefined) return base;
  if (!record(incoming)) return undefined;
  // Drop explicit undefined properties as well as missing ones. They occur in
  // in-memory projections although JSON itself cannot carry undefined.
  const next = Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined));
  return readActivityFacts({
    ...base, ...next,
    ...(next.displayLabel !== undefined && record(next.displayLabel) ? { displayLabel: { ...base?.displayLabel, ...next.displayLabel } } : {}),
    ...(next.tool !== undefined && record(next.tool) ? { tool: { ...base?.tool, ...next.tool } } : {}),
  });
}
