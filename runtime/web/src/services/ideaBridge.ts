import { restoreIdeaAppearance, setIdeaTheme } from "./appearance";
export { persistIdeaLocale } from "./ideaPreferences";

export const isIdeaRuntime = true;
export type IdeaContextTarget = "current" | "new";
const pendingContexts: { text: string; target: IdeaContextTarget }[] = [];
let receiveContext: ((text: string, target: IdeaContextTarget) => void) | undefined;

// Native title-bar clicks and early editor-capture requests can arrive before
// this page has subscribed or before the IDE injects window.ideaAgent. Keep
// small bounded queues so no click is lost; the IDE side queues symmetrically
// until the page reports loaded.
const bridgeQueueLimit = 20;
const nativeCommands = ["new", "history", "settings", "chat"];
const pendingNativeCommands: string[] = [];
const pendingHostMessages: Record<string, unknown>[] = [];
let nativeCommandHandler: ((command: string) => void) | undefined;

declare global {
  interface Window {
    ideaAgentReceiveContext?: (text: string, target?: IdeaContextTarget) => void;
    ideaAgentSetTheme?: (theme: "dark" | "light") => void;
    ideaAgentNativeCommand?: (command: string) => void;
  }
}

window.ideaAgentReceiveContext = (text, target = "current") => {
  if (typeof text !== "string" || !text.trim()) return;
  if (target !== "current" && target !== "new") return;
  if (receiveContext) receiveContext(text, target);
  else pendingContexts.push({ text, target });
};
window.ideaAgentSetTheme = (theme) => setIdeaTheme(theme);

export function subscribeIdeaContext(receive: (text: string, target: IdeaContextTarget) => void): () => void {
  receiveContext = receive;
  pendingContexts.splice(0).forEach(({ text, target }) => receive(text, target));
  return () => { if (receiveContext === receive) receiveContext = undefined; };
}

window.ideaAgentNativeCommand = (command) => {
  if (typeof command !== "string" || !nativeCommands.includes(command)) return;
  if (nativeCommandHandler) nativeCommandHandler(command);
  else {
    pendingNativeCommands.push(command);
    if (pendingNativeCommands.length > bridgeQueueLimit) pendingNativeCommands.shift();
  }
};

export function subscribeIdeaNativeCommand(handler: (command: string) => void): () => void {
  nativeCommandHandler = handler;
  pendingNativeCommands.splice(0).forEach(handler);
  return () => { if (nativeCommandHandler === handler) nativeCommandHandler = undefined; };
}

export function isIdeaChromeHost(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("ide_chrome") === "1";
  } catch {
    return false;
  }
}

function postToHost(payload: Record<string, unknown>): void {
  if (window.ideaAgent) {
    window.ideaAgent.postMessage(payload);
    return;
  }
  // The IDE injects window.ideaAgent and fires "ideaAgentReady" after load.
  if (pendingHostMessages.some((item) => JSON.stringify(item) === JSON.stringify(payload))) return;
  pendingHostMessages.push(payload);
  if (pendingHostMessages.length > bridgeQueueLimit) pendingHostMessages.shift();
}

function flushPendingHostMessages(): void {
  if (!window.ideaAgent) return;
  pendingHostMessages.splice(0).forEach(postToHost);
}

if (typeof window.addEventListener === "function") {
  window.addEventListener("ideaAgentReady", flushPendingHostMessages, { once: true });
  window.addEventListener("ideaAgentReady", restoreIdeaAppearance);
}

export function requestIdeaEditorContext(): void {
  postToHost({ action: "addContext" });
}

export function requestIdeaFileContext(): void {
  postToHost({ action: "addFileContext" });
}

export function openIdeaFile(rootId: string, path: string): void {
  postToHost({ action: "openFile", rootId, path });
}

export function compareTurnDiffInIdea(input: {
  rootId: string;
  sessionKey: string;
  snapshotId: string;
  path: string;
}): void {
  postToHost({ action: "compareTurnDiff", ...input });
}

export function compareGitFileInIdea(input: {
  rootId: string;
  path: string;
  repoPath?: string;
  repoKind?: string;
}): void {
  postToHost({ action: "compareGitFile", ...input });
}

export function refreshIdeaFiles(): void {
  window.ideaAgent?.postMessage({ action: "refresh" });
}
