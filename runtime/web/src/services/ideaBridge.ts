import { setAppearanceMode } from "./appearance";

export const isIdeaRuntime = true;
const pendingContexts: string[] = [];
let receiveContext: ((text: string) => void) | undefined;

declare global {
  interface Window {
    ideaAgent?: { postMessage: (payload: Record<string, unknown>) => void };
    ideaAgentReceiveContext?: (text: string) => void;
    ideaAgentSetTheme?: (theme: "dark" | "light") => void;
  }
}

window.ideaAgentReceiveContext = (text) => {
  if (typeof text !== "string" || !text.trim()) return;
  if (receiveContext) receiveContext(text);
  else pendingContexts.push(text);
};
window.ideaAgentSetTheme = (theme) => setAppearanceMode(theme);

export function subscribeIdeaContext(receive: (text: string) => void): () => void {
  receiveContext = receive;
  pendingContexts.splice(0).forEach(receive);
  return () => { if (receiveContext === receive) receiveContext = undefined; };
}

export function openIdeaFile(rootId: string, path: string): void {
  window.ideaAgent?.postMessage({ action: "openFile", rootId, path });
}

export function refreshIdeaFiles(): void {
  window.ideaAgent?.postMessage({ action: "refresh" });
}
