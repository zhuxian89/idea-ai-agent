import { useSyncExternalStore } from "react";

const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
const serverOnline = () => true;
function subscribe(notify: () => void) {
  const events = ["online", "offline", "pageshow", "focus"];
  for (const event of events) window.addEventListener(event, notify);
  document.addEventListener("visibilitychange", notify);
  return () => {
    for (const event of events) window.removeEventListener(event, notify);
    document.removeEventListener("visibilitychange", notify);
  };
}

// OS/browser network availability is independent of the localhost WebSocket.
// Online does not promise that a particular model provider is reachable.
export function useNetworkOnline() {
  return useSyncExternalStore(subscribe, online, serverOnline);
}
