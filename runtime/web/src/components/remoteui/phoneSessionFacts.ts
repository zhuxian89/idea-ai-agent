import { createContext, useEffect, useState } from "react";
import { sessionService, type StreamEvent } from "../../services/session";
import type { SessionItem } from "../SessionList";

export type PhoneSessionState = "wait" | "work" | "error" | "idle";
export type PhoneSessionFacts = { state: PhoneSessionState; preview?: string; project?: string; attentionId?: string };
export type PhoneSessionFilter = "" | Exclude<PhoneSessionState, "idle">;
export const phoneSessionFilters = ["wait", "work", "error"] as const;
export const PhoneSessionFactsContext = createContext<((session: SessionItem) => PhoneSessionFacts) | null>(null);
export const PhoneActivityHostContext = createContext<HTMLDivElement | null>(null);

export function usePhoneWaiting(enabled: boolean, resolveRoot: (key: string) => string | null) {
  const [waiting, setWaiting] = useState<Record<string, string>>({});
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return sessionService.subscribeEvents(({ type, payload, sessionKey }) => {
      if (!sessionKey) return;
      const root = typeof payload?.root_id === "string" ? payload.root_id : resolveRoot(sessionKey);
      if (!root) return;
      const key = `${root}::${sessionKey}`;
      const event = type === "session.stream" ? payload?.event as StreamEvent | undefined : undefined;
      if (event?.type === "tool_call" || event?.type === "tool_call_update") {
        const call = event.data;
        if (call.kind !== "ask_user") return;
        const active = ["running", "pending", "in_progress"].includes(call.status || "");
        setWaiting(previous => ({ ...previous, [key]: active ? call.callId : previous[key] === call.callId ? "" : previous[key] }));
        return;
      }
      if (type === "session.done" || type === "session.error" || type === "session.user_message" ||
          event?.type === "question_answered" || event?.type === "error") {
        setWaiting(previous => previous[key] ? { ...previous, [key]: "" } : previous);
        refresh(version => version + 1);
      }
    });
  }, [enabled, resolveRoot]);
  return waiting;
}
