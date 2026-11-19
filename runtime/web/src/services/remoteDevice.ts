import { useSyncExternalStore } from "react";
import { isRemoteWebUi } from "./remoteUi";

export type RemoteDevice = "phone" | "tablet" | "desktop";
export type RemoteDeviceMode = RemoteDevice | "auto";
export const remoteDeviceModes = ["auto", "desktop", "tablet", "phone"] as const;

const key = "mindfs-remote-device";
const changed = "mindfs:remote-device-changed";

function validMode(value: unknown): value is RemoteDeviceMode {
  return remoteDeviceModes.some(mode => mode === value);
}

export function getRemoteDeviceMode(): RemoteDeviceMode {
  if (!isRemoteWebUi || typeof window === "undefined") return "auto";
  const requested = new URLSearchParams(window.location.search).get("device");
  if (validMode(requested)) return requested;
  const stored = localStorage.getItem(key);
  return validMode(stored) ? stored : "auto";
}

export function setRemoteDeviceMode(mode: RemoteDeviceMode) {
  if (!isRemoteWebUi) return;
  localStorage.setItem(key, mode);
  const url = new URL(location.href);
  if (url.searchParams.has("device")) {
    url.searchParams.delete("device");
    history.replaceState(history.state, "", url);
  }
  window.dispatchEvent(new Event(changed));
}

export function getRemoteDevice(): RemoteDevice | null {
  if (!isRemoteWebUi || typeof window === "undefined") return null;
  const mode = getRemoteDeviceMode();
  if (mode !== "auto") return mode;
  const agent = navigator.userAgent;
  if (/iPhone|iPod/i.test(agent)) return "phone";
  if (/iPad/i.test(agent)) return "tablet";
  const touches = navigator.maxTouchPoints;
  const touch = (touches > 0 && window.matchMedia("(pointer: coarse) and (hover: none)").matches)
    || (touches > 1 && navigator.platform === "MacIntel")
    || /Android/i.test(agent);
  return touch ? (Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet") : "desktop";
}

function subscribe(update: () => void) {
  if (!isRemoteWebUi) return () => {};
  const pointer = window.matchMedia("(pointer: coarse) and (hover: none)");
  const sync = () => {
    const device = getRemoteDevice();
    if (device) document.documentElement.dataset.device = device;
    update();
  };
  sync();
  pointer.addEventListener("change", sync);
  for (const name of [changed, "resize", "popstate", "storage"]) window.addEventListener(name, sync);
  return () => {
    pointer.removeEventListener("change", sync);
    for (const name of [changed, "resize", "popstate", "storage"]) window.removeEventListener(name, sync);
  };
}

export function useRemoteDevice() {
  return useSyncExternalStore(subscribe, getRemoteDevice, () => null);
}

export function useRemoteDeviceMode() {
  return useSyncExternalStore(subscribe, getRemoteDeviceMode, () => "auto");
}
