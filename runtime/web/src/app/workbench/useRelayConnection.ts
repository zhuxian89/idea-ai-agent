import { useState, useEffect } from "react";
import {
  type RelayStatusPayload,
  type BootstrapState,
  bootstrapService,
} from "../../services/bootstrap";
import { type E2EEState, e2eeService } from "../../services/e2ee";
import { useRelayNavigation } from "../useRelayNavigation";
import { sessionService } from "../../services/session";
import {
  formatDocumentTitle,
  isRelayPWAContext,
  relayNodeIdFromPathname,
  RELAY_LAST_NODE_ID_STORAGE_KEY,
} from "../relayContext";
import { syncNativeReplyPollerE2EE } from "../../services/replyPoller";
import { projectStorage } from "../../services/remoteScope";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useFileViewerState } from "./useFileViewerState";

type Deps = {
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
};

export function useRelayConnection({ currentRootApi, fileViewerStateApi }: Deps) {
  const { currentRootId } = currentRootApi;
  const { setStatus } = fileViewerStateApi;

  const [relayStatus, setRelayStatus] = useState<RelayStatusPayload | null>(
    null,
  );
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>(() =>
    bootstrapService.snapshot(),
  );
  const [e2eeState, setE2eeState] = useState<E2EEState>(() =>
    e2eeService.snapshot(),
  );
  const { handleRelayWebSocketClosed, handleRelayNavigationFailure } =
    useRelayNavigation();
  useEffect(() => {
    if (!currentRootId) return;
    sessionService.connect(currentRootId);
  }, [currentRootId]);
  useEffect(
    () => () => {
      sessionService.disconnect();
      setStatus("disconnected");
    },
    [],
  );
  useEffect(() => {
    return bootstrapService.subscribe((state) => {
      setBootstrapState(state);
      setRelayStatus(state.relayStatus);
      setE2eeState(state.e2ee);
    });
  }, []);
  useEffect(() => {
    document.title = formatDocumentTitle(relayStatus);
  }, [relayStatus]);
  useEffect(() => {
    return e2eeService.subscribe((state) => {
      setE2eeState(state);
    });
  }, []);
  useEffect(() => {
    void syncNativeReplyPollerE2EE().catch((err) => {
      console.warn("[ReplyPoller] Failed to sync E2EE state:", err);
    });
  }, [e2eeState.nodeId, e2eeState.required, e2eeState.unlocked]);
  useEffect(() => {
    if (!isRelayPWAContext()) {
      return;
    }
    const nodeID = relayNodeIdFromPathname(window.location.pathname);
    if (!nodeID) {
      return;
    }
    projectStorage().setItem(RELAY_LAST_NODE_ID_STORAGE_KEY, nodeID);
  }, []);

  return { bootstrapState, e2eeState, handleRelayNavigationFailure, handleRelayWebSocketClosed, relayStatus };
}
