import React from "react";
import type { SessionServiceEvent } from "../../services/session";
import { WSStatus } from "../runtimeTypes";
import { SessionItem } from "../sessionModel";

type Options = {
  setStatus: React.Dispatch<React.SetStateAction<WSStatus>>;
  setAgentsVersion: React.Dispatch<React.SetStateAction<number>>;
  refreshManagedRoots: () => Promise<void>;
  currentRootIdRef: React.RefObject<string | null>;
  sessionsRef: React.RefObject<SessionItem[]>;
  loadSessionsForRoot: (
    rootID: string,
    options?: {
      beforeTime?: string;
      afterTime?: string;
      replace?: boolean;
      force?: boolean;
    },
  ) => Promise<void>;
  multiProjectSessionsEnabled: boolean;
  refreshMultiProjectReplyingSessions: () => Promise<void>;
  loadMultiProjectSessionGroups: () => Promise<void>;
  replayTargetsForAllRoots: () => void;
  handleRelayWebSocketClosed: () => Promise<void>;
};

export function createConnectionEventHandler({
  setStatus,
  setAgentsVersion,
  refreshManagedRoots,
  currentRootIdRef,
  sessionsRef,
  loadSessionsForRoot,
  multiProjectSessionsEnabled,
  refreshMultiProjectReplyingSessions,
  loadMultiProjectSessionGroups,
  replayTargetsForAllRoots,
  handleRelayWebSocketClosed,
}: Options) {
  return (event: SessionServiceEvent) => {
    switch (event.type) {
      case "ws.connecting":
        setStatus("connecting");
        break;
      case "ws.connected":
        setStatus("connected");
        setAgentsVersion((v) => v + 1);
        void refreshManagedRoots();
        if (currentRootIdRef.current) {
          const newest = sessionsRef.current[0]?.updated_at || "";
          void loadSessionsForRoot(
            currentRootIdRef.current,
            newest ? { afterTime: newest } : { replace: true },
          );
        }
        if (multiProjectSessionsEnabled) {
          void refreshMultiProjectReplyingSessions();
          void loadMultiProjectSessionGroups();
        }
        replayTargetsForAllRoots();
        break;
      case "ws.reconnecting":
        setStatus("reconnecting");
        break;
      case "ws.reconnected":
        setStatus("connected");
        setAgentsVersion((v) => v + 1);
        void refreshManagedRoots();
        if (currentRootIdRef.current) {
          const newest = sessionsRef.current[0]?.updated_at || "";
          void loadSessionsForRoot(
            currentRootIdRef.current,
            newest ? { afterTime: newest } : { replace: true },
          );
        }
        if (multiProjectSessionsEnabled) {
          void refreshMultiProjectReplyingSessions();
          void loadMultiProjectSessionGroups();
        }
        replayTargetsForAllRoots();
        break;
      case "ws.closed":
        setStatus(currentRootIdRef.current ? "reconnecting" : "disconnected");
        void handleRelayWebSocketClosed();
        break;
    }
  };
}
