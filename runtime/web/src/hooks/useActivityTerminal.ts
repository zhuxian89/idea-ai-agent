import { useEffect, useState } from "react";
import { sessionService } from "../services/session";

type Terminal = { kind: "done" | "error"; at: number; turnKey: string };

// A short acknowledgement of a live terminal event, never inferred from history
// or from a tool succeeding. SessionActivity stays mounted to receive this event.
export function useActivityTerminal({ sessionKey, rootId, turnKey, active }: {
  sessionKey: string; rootId: string; turnKey: string; active: boolean;
}) {
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  useEffect(() => {
    if (!sessionKey) return;
    return sessionService.subscribeEvents(({ type, sessionKey: key, payload }) => {
      if (key !== sessionKey || (rootId && payload?.root_id && payload.root_id !== rootId)) return;
      if (type === "session.user_message") {
        setTerminal(null);
        return;
      }
      if (!active) return;
      const stream = payload?.event as { type?: string } | undefined;
      const kind = type === "session.error" || (type === "session.stream" && stream?.type === "error")
        ? "error" : type === "session.done" ? "done" : null;
      if (kind) setTerminal(previous => previous?.turnKey === turnKey && previous.kind === "error"
        ? previous : { kind, at: Date.now(), turnKey });
    });
  }, [sessionKey, rootId, turnKey, active]);
  useEffect(() => {
    if (!terminal) return;
    const timer = window.setTimeout(() => setTerminal(null), terminal.kind === "error" ? 2500 : 1500);
    return () => window.clearTimeout(timer);
  }, [terminal]);
  return terminal?.turnKey === turnKey ? terminal : null;
}
