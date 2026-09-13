import type { Locale } from "../i18n/types";
import type { AppearanceMode } from "./appearance";

type Preferences = { locale: Locale; appearance: AppearanceMode };
const pending = new Map<keyof Preferences, string>();

declare global {
  interface Window {
    ideaAgent?: {
      locale?: string | null;
      appearance?: string | null;
      theme?: "dark" | "light";
      postMessage: (payload: Record<string, unknown>) => void;
    };
  }
}

function persist<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  if (typeof window === "undefined") return;
  pending.set(key, value);
  flush();
}

function flush(): void {
  if (!window.ideaAgent) return;
  for (const [key, value] of pending) {
    window.ideaAgent[key] = value;
    window.ideaAgent.postMessage({ action: key === "locale" ? "setLocale" : "setAppearance", [key]: value });
    pending.delete(key);
  }
}

if (typeof window !== "undefined") window.addEventListener("ideaAgentReady", flush);

export const persistIdeaLocale = (locale: Locale): void => persist("locale", locale);
export const persistIdeaAppearance = (appearance: AppearanceMode): void => persist("appearance", appearance);
