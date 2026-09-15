export type VoicePhase = "starting" | "recording" | "transcribing" | "done" | "configuration" | "error";
export type VoiceProvider = "tencent" | "siliconflow" | "custom";
export type VoiceEvent = { id: string; state: VoicePhase; provider?: VoiceProvider; level?: number; elapsedMs?: number; limitSeconds?: number; text?: string; error?: string };
const listeners = new Set<(event: VoiceEvent) => void>();
declare global { interface Window { ideaAgentVoiceEvent?: (event: VoiceEvent) => void } }
window.ideaAgentVoiceEvent = (event) => {
  if (!event || typeof event.id !== "string") return;
  listeners.forEach((listener) => listener(event));
};
export function subscribeVoice(listener: (event: VoiceEvent) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function sendVoice(action: "voiceStart" | "voiceStop" | "voiceCancel" | "voiceConfigure", id: string): boolean {
  if (!window.ideaAgent) return false;
  window.ideaAgent.postMessage({ action, id });
  return true;
}

/** Saved selection only. Undefined means the native bridge has not supplied a summary. */
export function getActiveVoiceProvider(): VoiceProvider | null | undefined {
  const provider = window.ideaAgent?.voiceProvider;
  if (provider === undefined) return undefined;
  return provider === "tencent" || provider === "siliconflow" || provider === "custom" ? provider : null;
}
