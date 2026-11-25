import { isRelayNodePage } from "../services/base";
import type { RelayStatusPayload } from "../services/bootstrap";
import { storeRelayNodes } from "../services/launcherNodeSync";
import { isIOSAppRuntime, isNativeShellRuntime } from "../services/runtime";
import type { ManagedRootPayload } from "./projectModel";

export const APP_DOCUMENT_TITLE = "Local AI Agent";
export const RELAY_LAST_NODE_ID_STORAGE_KEY = "mindfs.relay.last_node_id";

export function formatDocumentTitle(
  relayStatus: RelayStatusPayload | null,
): string {
  if (!isRelayNodePage()) {
    return APP_DOCUMENT_TITLE;
  }
  const nodeName = String(relayStatus?.node_name || "").trim();
  return nodeName ? `${nodeName} - ${APP_DOCUMENT_TITLE}` : APP_DOCUMENT_TITLE;
}

export function relayNodeIdFromPathname(pathname: string): string {
  const match = /^\/n\/([^/]+)/.exec(String(pathname || ""));
  return match?.[1] || "";
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    navigatorWithStandalone.standalone === true ||
    isIOSAppRuntime()
  );
}

export function isRelayPWAContext(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    isStandaloneDisplayMode() &&
    (/^\/n\/[^/]+/.test(window.location.pathname) ||
      window.location.pathname === "/nodes" ||
      window.location.pathname === "/login")
  );
}

export function checkRelaySession(): Promise<Response> {
  return fetch("/api/auth/me", { cache: "no-store" });
}

export function isRelayNodesPage(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (window.location.pathname.replace(/\/+$/, "") || "/") === "/nodes";
}

export function relayNodeURL(rootID: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  const trimmed = String(rootID || "").trim();
  if (!trimmed) {
    return "";
  }
  return new URL(
    `/n/${encodeURIComponent(trimmed)}/`,
    window.location.origin,
  ).toString();
}

export function syncRelayNodesToNative(dirs: ManagedRootPayload[]): void {
  if (
    (!isNativeShellRuntime() && !isRelayPWAContext()) ||
    !isRelayNodesPage()
  ) {
    return;
  }
  const nodes = dirs
    .map((dir) => {
      const id = String(dir.id || "").trim();
      const url = relayNodeURL(id);
      const name = String(
        dir.display_name ||
          dir.root_path?.split("/").filter(Boolean).pop() ||
          id,
      ).trim();
      if (!id || !url || !name) {
        return null;
      }
      return { name, url };
    })
    .filter((node): node is { name: string; url: string } => node !== null);
  void storeRelayNodes(nodes);
}
