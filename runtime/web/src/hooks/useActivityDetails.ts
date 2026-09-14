import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { activityRefKey, detailContent, loadActivityDetails, type ActivityDetailResult, type ActivityRef } from "../services/activityDetails";
import { toolActivityState } from "../services/activityFacts";
import type { ToolCall } from "../services/session";

type DetailState = { key: string; result?: ActivityDetailResult; snapshot?: ToolCall; loading: boolean; checkedTerminal?: boolean; attempt?: number };

export function useActivityDetails(ref: ActivityRef, enabled: boolean, inline: ToolCall) {
  const key = activityRefKey(ref);
  const running = !inline.activity?.outcome && toolActivityState(inline.status || "") === "running";
  const latest = useRef({ running });
  useLayoutEffect(() => { latest.current = { running }; });
  const [state, setState] = useState<DetailState>({ key, loading: false });
  const current = useRef(state);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const previous = current.current;
    if (previous.key === key && previous.result && previous.attempt === attempt &&
      previous.checkedTerminal === !latest.current.running &&
      (previous.result.kind !== "loaded" || previous.checkedTerminal)) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = (next: DetailState) => {
      current.current = next;
      setState(next);
    };
    const run = async () => {
      const terminalAtStart = !latest.current.running;
      const previous = current.current.key === key ? current.current : undefined;
      publish({ ...previous, key, loading: true });
      let result: ActivityDetailResult;
      try {
        result = await loadActivityDetails(ref, controller.signal);
      } catch {
        if (!active) return;
        result = { kind: "unavailable", retryable: true, message: "toolActivity.detailsUnavailable" };
      }
      if (!active) return;
      publish({ key, result, loading: false, checkedTerminal: terminalAtStart, attempt,
        snapshot: result.kind === "loaded" ? result.toolCall : previous?.snapshot });
      // Check the final snapshot even when a terminal event arrived during I/O.
      // Otherwise only successful running details schedule another read.
      if (!terminalAtStart && !latest.current.running) timer = setTimeout(run, 0);
      else if (latest.current.running && result.kind === "loaded") timer = setTimeout(run, 1000);
    };
    void run();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
    // Content/status changes are read via latest; they must not restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, attempt]);

  // A terminal transition after a settled read needs one final check. In-flight
  // work notices the transition itself, so it cannot accidentally join its old read.
  useEffect(() => {
    if (enabled && !running && current.current.key === key && !current.current.loading && current.current.checkedTerminal === false) retry();
  }, [key, enabled, running, retry]);

  // Keyed during render, not merely reset by an effect: no frame of A's output
  // can be displayed when React reuses this component for B.
  const visible = state.key === key ? state : undefined;
  const snapshot = visible?.snapshot;
  // Background refresh must not insert/remove a loading row above the text
  // the user is reading. Initial loads and explicit retries retain feedback.
  return { result: visible?.result, loading: enabled && (visible?.loading ?? true) && (!snapshot || visible?.result?.kind !== "loaded"), retry,
    toolCall: snapshot ? { ...snapshot, content: detailContent(inline.content, snapshot.content) } : undefined };
}
