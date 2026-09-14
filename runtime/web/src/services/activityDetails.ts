import { sessionService, type ToolCall, type ToolCallContentItem } from "./session";

export type ActivityRef = { rootId: string; sessionKey: string; callId: string };
export type ActivityDetailResult =
  | { kind: "loaded"; toolCall: ToolCall }
  | { kind: "missing" }
  | { kind: "unavailable"; retryable: boolean; message: string };

type PendingDetail = { controller: AbortController; consumers: number; promise: Promise<ActivityDetailResult> };
const pending = new Map<string, PendingDetail>();

export function activityRefKey(ref: ActivityRef): string {
  return JSON.stringify([ref.rootId, ref.sessionKey, ref.callId]);
}

export function loadActivityDetails(ref: ActivityRef, signal?: AbortSignal): Promise<ActivityDetailResult> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  const key = activityRefKey(ref);
  let entry = pending.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, consumers: 0, promise: sessionService.getToolCallDetails(ref, controller.signal) };
    pending.set(key, entry);
  }
  const request = entry;
  request.consumers++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const release = () => {
      if (settled) return false;
      settled = true;
      signal?.removeEventListener("abort", abort);
      request.consumers--;
      if (request.consumers === 0) {
        if (pending.get(key) === request) pending.delete(key);
        request.controller.abort();
      }
      return true;
    };
    const abort = () => { if (release()) reject(new DOMException("Aborted", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    request.promise.then(result => {
      if (pending.get(key) === request) pending.delete(key);
      if (release()) resolve(result);
    }, error => {
      if (pending.get(key) === request) pending.delete(key);
      if (release()) reject(error);
    });
  });
}

// Compact command output is a prefix plus a marker. Use a full snapshot only
// when it includes the available stream text; an older snapshot cannot erase it.
export function detailContent(inline?: ToolCallContentItem[], full?: ToolCallContentItem[]): ToolCallContentItem[] | undefined {
  if (!inline?.length) return full;
  if (!full?.length) return inline;
  const text = (items: ToolCallContentItem[]) => items.map(item => "text" in item ? item.text || "" : "").join("");
  const prefix = text(inline).replace(/\n\.\.\.\(truncated\)$/, "");
  return prefix && text(full).startsWith(prefix) ? full : inline;
}
