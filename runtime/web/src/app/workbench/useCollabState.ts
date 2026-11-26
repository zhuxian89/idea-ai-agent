import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionItem } from "../sessionModel";
import { collabService, type CollabRun } from "../../services/collab";
import { sessionService } from "../../services/session";

interface Options {
  currentRootId: string | null;
  selectedSession: SessionItem | null;
  handleSelectSession: (session: SessionItem | null) => void;
  handleNewSession: () => void;
  onClearStageSession?: () => void;
  onReturnToSwitchedProject?: (rootId: string) => void;
}

export function useCollabState({
  currentRootId,
  selectedSession,
  handleSelectSession,
  handleNewSession,
  onClearStageSession,
  onReturnToSwitchedProject,
}: Options) {
  const [collabOpen, setCollabOpen] = useState(false);
  const [collabWaitingCount, setCollabWaitingCount] = useState(0);
  const [latestRunEvent, setLatestRunEvent] = useState<{
    seq: number;
    rootId: string;
    run: CollabRun;
  } | null>(null);
  const previousSingleSessionRef = useRef<SessionItem | null>(null);
  const openedRootIdRef = useRef<string | null>(null);

  useEffect(() => {
    setLatestRunEvent(null);
    if (!currentRootId) {
      setCollabWaitingCount(0);
      return;
    }
    let cancelled = false;
    void collabService
      .listRuns(currentRootId)
      .then((res) => {
        if (!cancelled) {
          setCollabWaitingCount(res.waiting_count || 0);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentRootId]);

  useEffect(() => {
    return sessionService.subscribeEvents((ev) => {
      if (ev.type !== "collab.run.updated") return;
      const payload = (ev.payload || {}) as {
        root_id?: string;
        run?: CollabRun;
        waiting_count?: number;
      };
      if (payload.root_id && payload.root_id === currentRootId) {
        if (typeof payload.waiting_count === "number") {
          setCollabWaitingCount(payload.waiting_count);
        }
        if (payload.run) {
          setLatestRunEvent((prev) => ({
            seq: (prev?.seq || 0) + 1,
            rootId: payload.root_id!,
            run: payload.run!,
          }));
        }
      }
    });
  }, [currentRootId]);

  const openCollab = useCallback(() => {
    const key = selectedSession?.key || selectedSession?.session_key || "";
    const isCollab =
      key.startsWith("collab-") ||
      selectedSession?.source === "collab_stage" ||
      selectedSession?.source === "collab_review";
    openedRootIdRef.current = currentRootId;
    previousSingleSessionRef.current = isCollab ? null : selectedSession;
    setCollabOpen(true);
  }, [currentRootId, selectedSession]);

  const bindStageSession = useCallback(
    (session: SessionItem | null) => {
      if (session) {
        handleSelectSession(session);
      } else if (onClearStageSession) {
        onClearStageSession();
      } else {
        handleNewSession();
      }
    },
    [handleSelectSession, handleNewSession, onClearStageSession],
  );

  const closeCollab = useCallback(() => {
    setCollabOpen(false);
    const switchedProject =
      Boolean(currentRootId) &&
      Boolean(openedRootIdRef.current) &&
      currentRootId !== openedRootIdRef.current;
    if (switchedProject && currentRootId) {
      onClearStageSession?.();
      if (onReturnToSwitchedProject) {
        onReturnToSwitchedProject(currentRootId);
      } else {
        handleNewSession();
      }
      return;
    }
    const prev = previousSingleSessionRef.current;
    if (prev && (prev.key || prev.session_key)) {
      handleSelectSession(prev);
    } else {
      handleNewSession();
    }
  }, [
    currentRootId,
    handleSelectSession,
    handleNewSession,
    onClearStageSession,
    onReturnToSwitchedProject,
  ]);

  return {
    collabOpen,
    collabWaitingCount,
    latestRunEvent,
    setCollabWaitingCount,
    openCollab,
    bindStageSession,
    closeCollab,
  };
}
