import { persistIdeaAppearance } from "./ideaPreferences";

export type AppearanceMode = "dark" | "light" | "system" | "meadow" | "moss";

export const APPEARANCE_STORAGE_KEY = "mindfs-appearance-mode";
export const APPEARANCE_CHANGE_EVENT = "mindfs:appearance-changed";

const appearanceModes = new Set<AppearanceMode>(["dark", "light", "system", "meadow", "moss"]);
let ideaTheme: "dark" | "light" | undefined;
const themeColors: Record<AppearanceMode, string> = {
  dark: "#0f172a",
  light: "#f3f4f6",
  system: "#f3f4f6",
  meadow: "#f4efe6",
  moss: "#dfe5d4",
};

export function normalizeAppearanceMode(value: unknown): AppearanceMode {
  return appearanceModes.has(value as AppearanceMode) ? (value as AppearanceMode) : "system";
}

export function getAppearanceMode(): AppearanceMode {
  if (typeof window === "undefined") {
    return "system";
  }
  if (appearanceModes.has(window.ideaAgent?.appearance as AppearanceMode)) {
    return window.ideaAgent!.appearance as AppearanceMode;
  }
  try {
    return normalizeAppearanceMode(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function getEffectiveAppearanceMode(mode: AppearanceMode = getAppearanceMode()): "dark" | "light" | "meadow" | "moss" {
  if (mode === "dark" || mode === "light" || mode === "meadow" || mode === "moss") {
    return mode;
  }
  if (typeof window === "undefined") {
    return "light";
  }
  const hostTheme = ideaTheme || window.ideaAgent?.theme;
  if (hostTheme === "dark" || hostTheme === "light") return hostTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function syncThemeColor(mode: AppearanceMode = getAppearanceMode()): void {
  if (typeof document === "undefined") {
    return;
  }
  const color = themeColors[getEffectiveAppearanceMode(mode)];
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((meta) => {
    meta.content = color;
    meta.removeAttribute("media");
  });
}

export function applyAppearanceMode(mode: AppearanceMode = getAppearanceMode()): void {
  if (typeof document === "undefined") {
    return;
  }
  if (mode === "system" && !ideaTheme && !window.ideaAgent?.theme) {
    document.documentElement.removeAttribute("data-theme");
    syncThemeColor(mode);
    return;
  }
  document.documentElement.setAttribute("data-theme", getEffectiveAppearanceMode(mode));
  syncThemeColor(mode);
}

export function setAppearanceMode(mode: AppearanceMode): void {
  if (typeof window === "undefined") {
    return;
  }
  const nextMode = normalizeAppearanceMode(mode);
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, nextMode);
  } catch {
    // Keep the current page responsive even when storage is unavailable.
  }
  persistIdeaAppearance(nextMode);
  applyAppearanceMode(nextMode);
  window.dispatchEvent(new CustomEvent<AppearanceMode>(APPEARANCE_CHANGE_EVENT, { detail: nextMode }));
}

export function setIdeaTheme(theme: "dark" | "light"): void {
  ideaTheme = theme;
  applyAppearanceMode();
}

export function restoreIdeaAppearance(): void {
  if (!window.ideaAgent) return;
  const saved = window.ideaAgent.appearance;
  try {
    if (appearanceModes.has(saved as AppearanceMode)) {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, saved!);
    } else {
      const legacy = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
      if (appearanceModes.has(legacy as AppearanceMode)) persistIdeaAppearance(legacy as AppearanceMode);
    }
  } catch { /* The host preference remains usable without web storage. */ }
  applyAppearanceMode();
  window.dispatchEvent(new CustomEvent<AppearanceMode>(APPEARANCE_CHANGE_EVENT, { detail: getAppearanceMode() }));
}
