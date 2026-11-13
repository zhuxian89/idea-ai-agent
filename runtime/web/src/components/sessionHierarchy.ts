import type { SessionItem } from "./SessionList";

export type SessionRow =
  | { type: "session"; session: SessionItem; depth: number }
  | { type: "child-group"; parent: SessionItem; group: "running" | "ended"; count: number; expanded: boolean; depth: number }
  | { type: "child-more"; parent: SessionItem; depth: number };

// Both the single-project list and the project groups use the same hierarchy.
export function buildSessionRows(
  sessions: SessionItem[],
  selectedKey: string,
  collapsedRunning: Record<string, boolean>,
  expandedEnded: Record<string, boolean>,
  hasMore: Record<string, boolean>,
  stateKey: (session: SessionItem) => string,
): SessionRow[] {
  const byKey = new Map(sessions.map(session => [session.key, session]));
  const children = new Map<string, SessionItem[]>();
  const roots: SessionItem[] = [];
  for (const session of sessions) {
    const parent = session.parent_session_key;
    if (parent && byKey.has(parent)) {
      const siblings = children.get(parent) || [];
      siblings.push(session);
      children.set(parent, siblings);
    } else roots.push(session);
  }
  const selectedBranch = new Set<string>();
  let selected = byKey.get(selectedKey);
  while (selected && !selectedBranch.has(selected.key)) {
    selectedBranch.add(selected.key);
    selected = byKey.get(selected.parent_session_key || "");
  }
  const runningParents = new Set<string>();
  for (const session of sessions) {
    if (!session.pending) continue;
    let parent = byKey.get(session.parent_session_key || "");
    while (parent && !runningParents.has(parent.key)) {
      runningParents.add(parent.key);
      parent = byKey.get(parent.parent_session_key || "");
    }
  }
  const rows: SessionRow[] = [];
  const append = (session: SessionItem, depth: number) => {
    rows.push({ type: "session", session, depth });
    const descendants = children.get(session.key) || [];
    const key = stateKey(session);
    for (const group of ["running", "ended"] as const) {
      const members = descendants.filter(child => group === "running" ? child.pending : !child.pending);
      const expanded = group === "running" ? !collapsedRunning[key] : !!expandedEnded[key];
      if (!members.length && !(group === "ended" && hasMore[key])) continue;
      rows.push({ type: "child-group", parent: session, group, count: members.length, expanded, depth: depth + 1 });
      for (const child of members) {
        if (expanded || selectedBranch.has(child.key) || (group === "ended" && runningParents.has(child.key))) append(child, depth + 1);
      }
      if (group === "ended" && expanded && hasMore[key]) {
        rows.push({ type: "child-more", parent: session, depth: depth + 1 });
      }
    }
  };
  roots.forEach(session => append(session, 0));
  return rows;
}
