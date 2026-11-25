import { type SessionMode } from "./ModeSelector";
import { type CandidateItem } from "../services/candidates";
import { type MessageKey } from "../i18n";
import { PendingAttachment } from "./actionBarTypes";

export function getSelectionPreview(text?: string): string {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return "...";
  }
  return `${Array.from(trimmed).slice(0, 3).join("")}...`;
}

export const modePlaceholderKeys: Record<SessionMode, MessageKey> = {
  chat: "action.placeholder.chat",
  plugin: "action.placeholder.plugin",
  command: "action.placeholder.command",
};

export const chatBlurPlaceholderKeys: MessageKey[] = [
  "action.placeholder.chat",
  "action.placeholder.tip",
];

export const MOBILE_BREAKPOINT = 768;

export const CANDIDATE_FETCH_DEBOUNCE_MS = 512;

export function buildPendingAttachment(file: File): PendingAttachment {
  const isImage = file.type.startsWith("image/");
  const fallbackExt = file.type.split("/")[1] || "png";
  const fileName = file.name || `pasted-image-${Date.now()}.${fallbackExt}`;
  const normalizedFile = file.name
    ? file
    : new File([file], fileName, {
      type: file.type || "image/png",
      lastModified: file.lastModified || Date.now(),
    });
  return {
    id: `${normalizedFile.name}-${normalizedFile.size}-${normalizedFile.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    file: normalizedFile,
    isImage,
    previewUrl: isImage ? URL.createObjectURL(normalizedFile) : undefined,
  };
}

export function candidateNameColor(candidateType: CandidateItem["type"], isDark: boolean): string {
  switch (candidateType) {
    case "slash_command":
      return isDark ? "#93c5fd" : "#1d4ed8";
    case "prompt":
      return isDark ? "#fcd34d" : "#b45309";
    case "skill":
      return isDark ? "#c4b5fd" : "#7c3aed";
    default:
      return "var(--text-primary)";
  }
}

export function replaceActiveTokenText(input: string, activeToken: { type: "file" | "slash" | "prompt" | "command"; query: string } | null, value: string): string {
  if (!activeToken) return input;
  const trigger = activeToken.type === "file" ? "@" : activeToken.type === "prompt" ? "#" : activeToken.type === "slash" ? "/" : "";
  if (!trigger) return value;
  const needle = `${trigger}${activeToken.query}`;
  const index = input.lastIndexOf(needle);
  if (index < 0) {
    return `${input}${value} `;
  }
  return `${input.slice(0, index)}${value} ${input.slice(index + needle.length)}`;
}

export function parsePlanCommand(input: string): boolean | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "/plan" || normalized.startsWith("/plan ")) {
    return true;
  }
  return null;
}

export function stripPlanCommandPrefix(input: string): string {
  const trimmed = input.trim();
  if (trimmed.toLowerCase() === "/plan") {
    return "";
  }
  if (trimmed.toLowerCase().startsWith("/plan ")) {
    return trimmed.slice(5).trimStart();
  }
  return trimmed;
}
