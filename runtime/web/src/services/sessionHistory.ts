import type { ExchangeAux, Session } from "./session";
import { mergeActivityFacts, mergeToolStatus } from "./activityFacts";

// This is a per-session projection marker, not an IndexedDB schema version.
export const ACTIVITY_HISTORY_VERSION = 1;
export function hasCurrentActivityHistory(session: Session | null | undefined): boolean {
  return session?.activity_history_version === ACTIVITY_HISTORY_VERSION;
}

function auxKey(item: ExchangeAux): string {
  if (item.toolcall?.callId) return `tool:${item.toolcall.callId}`;
  // Items without native identity only coalesce when exactly equal. They must
  // not acquire a remote detail identity based on their position or title.
  return JSON.stringify(item);
}

export function mergeHistoryAux(base: ExchangeAux[] = [], incoming: ExchangeAux[] = []): ExchangeAux[] {
  const result: ExchangeAux[] = [];
  const updates = [...base, ...incoming];
  const find = (key: string) => result.findIndex(item => auxKey(item) === key);
  updates.forEach((item, i) => {
    const index = find(auxKey(item));
    if (index >= 0) {
      const previous = result[index];
      result[index] = previous.toolcall && item.toolcall ? {
        ...previous, ...item,
        toolcall: { ...previous.toolcall, ...item.toolcall,
          content: item.toolcall.content?.length ? item.toolcall.content : previous.toolcall.content,
          meta: { ...previous.toolcall.meta, ...item.toolcall.meta },
          activity: mergeActivityFacts(previous.toolcall.activity, item.toolcall.activity),
          status: mergeToolStatus(previous.toolcall.status, item.toolcall.status) || "unknown",
        },
      } : item;
      return;
    }
    let at = result.length;
    if (i >= base.length) {
      for (const next of updates.slice(i + 1)) {
        const nextIndex = find(auxKey(next));
        if (nextIndex >= 0) { at = nextIndex; break; }
      }
    }
    result.splice(at, 0, item);
  });
  return result;
}

export function mergeHistoryExchanges(base: Session["exchanges"] = [], incoming: Session["exchanges"] = []): Session["exchanges"] {
  const bySeq = new Map(base.map(item => [Number(item.seq), item]));
  for (const item of incoming) {
    const seq = Number(item.seq);
    bySeq.set(seq, { ...bySeq.get(seq), ...item });
  }
  return [...bySeq.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
}
