import { appPath, isRelayNodePage } from "./base";
import { protectedJSON } from "./api";
import { isIOSAppRuntime } from "./runtime";

export type BarkTypes = {
  approval: boolean;
  ask_user: boolean;
  failed: boolean;
  done: boolean;
};

export type BarkStatus = {
  configured: boolean;
  key_hint?: string;
  server: string;
  enabled: boolean;
  types: BarkTypes;
  link_mode: "app" | "web";
  has_link: boolean;
};

export type BarkUpdate = {
  enabled?: boolean;
  device_key?: string;
  server?: string;
  types?: Partial<BarkTypes>;
  open_base?: string;
  link_mode?: "app" | "web";
};

/**
 * Where a tapped notification should land, as seen from this client. Only a
 * Relay node page knows an address the phone can reach; a local page does not,
 * so it leaves the stored link untouched. The iOS App asks for its URL scheme,
 * every other client for the plain page.
 */
function linkContext(): Pick<BarkUpdate, "open_base" | "link_mode"> {
  if (typeof window === "undefined" || !isRelayNodePage()) {
    return {};
  }
  return {
    open_base: new URL(appPath("/"), window.location.origin).toString(),
    link_mode: isIOSAppRuntime() ? "app" : "web",
  };
}

export function getBarkStatus(): Promise<BarkStatus> {
  return protectedJSON<BarkStatus>(appPath("/api/bark"), { cache: "no-store" });
}

export function updateBark(update: BarkUpdate): Promise<BarkStatus> {
  return protectedJSON<BarkStatus>(appPath("/api/bark"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...linkContext(), ...update }),
  });
}

/** Refreshes only the tap target, e.g. when the settings are opened from the App. */
export function syncBarkLink(): Promise<BarkStatus> | null {
  const context = linkContext();
  if (!context.open_base) {
    return null;
  }
  return protectedJSON<BarkStatus>(appPath("/api/bark"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(context),
  });
}

export async function sendBarkTest(): Promise<void> {
  await protectedJSON(appPath("/api/bark/test"), { method: "POST" });
}
