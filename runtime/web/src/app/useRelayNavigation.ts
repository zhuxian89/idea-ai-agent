import { useCallback, useEffect, useRef } from "react";
import { checkRelaySession, isRelayPWAContext, relayNodeIdFromPathname } from "./relayContext";
import { isRelayNodePage } from "../services/base";
import { isIOSAppRuntime } from "../services/runtime";
import { standaloneUpdateInProgress } from "../services/standaloneUpdate";

/**
 * Sends the page back to the Relay login or node list when the Relay session or node is gone,
 * and keeps the iOS shell's Relay login fresh while the page is visible.
 */
export function useRelayNavigation() {
  const relayWSAuthCheckRef = useRef(false);
  const relayWSAuthCheckedAtRef = useRef(0);

  const redirectToRelayLogin = useCallback(() => {
    const next = encodeURIComponent(
      `${window.location.pathname}${window.location.search}`,
    );
    window.location.replace(`/login?next=${next}`);
  }, []);

  const redirectToRelayNodes = useCallback(() => {
    window.location.replace("/nodes");
  }, []);

  useEffect(() => {
    // Node pages are forwarded without checking the Relay account cookie.
    if (!isIOSAppRuntime() || !isRelayNodePage()) return;
    const renewSession = () => {
      if (document.visibilityState === "visible") {
        void checkRelaySession().catch(() => {}); // The connection handles offline recovery.
      }
    };
    renewSession();
    document.addEventListener("visibilitychange", renewSession);
    return () => document.removeEventListener("visibilitychange", renewSession);
  }, []);

  const handleRelayWebSocketClosed = useCallback(async () => {
    if (!isRelayNodePage() || relayWSAuthCheckRef.current || standaloneUpdateInProgress()) {
      return;
    }
    // A flapping connection closes again and again; one verdict per half minute is enough, and
    // each check costs two requests through the same tunnel that is struggling.
    const now = Date.now();
    if (now - relayWSAuthCheckedAtRef.current < 30_000) return;
    relayWSAuthCheckedAtRef.current = now;
    relayWSAuthCheckRef.current = true;
    try {
      const response = await checkRelaySession();
      if (standaloneUpdateInProgress()) return;
      if (response.status === 401) {
        redirectToRelayLogin();
        return;
      }
      if (!response.ok) return;
      const nodeID = relayNodeIdFromPathname(window.location.pathname);
      if (!nodeID) {
        return;
      }
      const nodeResponse = await fetch(`/n/${encodeURIComponent(nodeID)}/`, {
        cache: "no-cache",
        headers: {
          Accept: "application/json",
        },
      });
      if (standaloneUpdateInProgress()) return;
      if (
        nodeResponse.status === 403 ||
        nodeResponse.status === 404 ||
        nodeResponse.status === 502 ||
        nodeResponse.status === 503
      ) {
        redirectToRelayNodes();
      }
    } catch {
      // Network failures and connector outages also close the socket. Keep the
      // normal reconnect path unless the auth probe can prove the session died.
    } finally {
      relayWSAuthCheckRef.current = false;
    }
  }, [redirectToRelayLogin, redirectToRelayNodes]);

  const handleRelayNavigationFailure = useCallback(
    async (status: number, errorCode?: string | null) => {
      if (!isRelayPWAContext() || standaloneUpdateInProgress()) {
        return false;
      }
      const code = String(errorCode || "").trim();
      if (status === 401 || code === "unauthorized") {
        try {
          const response = await checkRelaySession();
          if (standaloneUpdateInProgress() || response.status !== 401) {
            return false;
          }
        } catch {
          return false;
        }
        redirectToRelayLogin();
        return true;
      }
      if (
        status === 403 ||
        status === 404 ||
        status === 502 ||
        status === 503 ||
        code === "forbidden" ||
        code === "node_not_found" ||
        code === "node_offline" ||
        code === "connector_unavailable"
      ) {
        redirectToRelayNodes();
        return true;
      }
      return false;
    },
    [redirectToRelayLogin, redirectToRelayNodes],
  );

  return { handleRelayWebSocketClosed, handleRelayNavigationFailure };
}
