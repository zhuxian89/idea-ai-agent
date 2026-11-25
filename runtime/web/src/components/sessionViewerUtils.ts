import { type TimelineItem } from "../hooks/useSessionStream";
import type { ToolCall } from "../services/session";
import type { AgentStatus } from "../services/agents";
import { type Locale } from "../i18n";
import { type SettingsChange } from "../services/sessionSettingsChange";
import { UploadAttachment, TranslateFn } from "./sessionViewerTypes";

export const NEAR_BOTTOM_DISTANCE = 120;

export function distanceFromSessionBottom(container: HTMLElement) {
  const viewportGap = window.visualViewport
    ? window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop
    : 0;
  return Math.max(0, container.scrollHeight - container.clientHeight - container.scrollTop - viewportGap);
}

export const uploadTokenPattern = /\[(?:read file|file):\s*([^\]]+)\]/g;

export function basename(path: string): string {
  const normalized = (path || "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
}

export function extractUploadAttachments(content: string): UploadAttachment[] {
  const attachments: UploadAttachment[] = [];
  uploadTokenPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = uploadTokenPattern.exec(content || "")) !== null) {
    const path = match[1].trim();
    attachments.push({
      path,
      name: basename(path),
      isImage: isImagePath(path),
    });
  }
  return attachments;
}

export function stripImageAttachmentTokens(content: string): string {
  if (!content) {
    return "";
  }
  const stripped = content.replace(
    uploadTokenPattern,
    (fullMatch, rawPath: string) => {
      const path = String(rawPath || "").trim();
      if (!isImagePath(path)) {
        return fullMatch;
      }
      return "";
    },
  );
  return stripped.replace(/\n{3,}/g, "\n\n").replace(/^[\n\s]+|[\n\s]+$/g, "");
}

export function stripUploadAttachmentTokens(content: string): string {
  if (!content) {
    return "";
  }
  return content
    .replace(uploadTokenPattern, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\n\s]+|[\n\s]+$/g, "");
}

export function modelDisplayName(
  agents: AgentStatus[] | undefined,
  agentName?: string,
  modelID?: string,
): string {
  const model = `${modelID || ""}`.trim();
  if (!model) {
    return "";
  }
  const agent = (agents || []).find(
    (item) => item.name === `${agentName || ""}`.trim(),
  );
  const match = (agent?.models || []).find((item) => item.id === model);
  return `${match?.name || ""}`.trim() || model;
}

export function formatAssistantExchangeMeta(
  item: TimelineItem,
  agents?: AgentStatus[],
  missingEffort = "",
): string {
  if (item.type !== "assistant_text") {
    return "";
  }
  const parts = [
    `${item.modelDisplayName || ""}`.trim() ||
      modelDisplayName(agents, item.agent, item.model),
    item.effort || ((item.agent === "codex" || item.agent === "claude") ? missingEffort : ""),
  ]
    .map((value) => `${value || ""}`.trim())
    .filter(Boolean);
  if (`${item.fastService || ""}`.trim().toLowerCase() === "on") {
    parts.push("fast");
  }
  return parts.join(" · ");
}

export function formatSettingsChange(change: SettingsChange, t: TranslateFn): string {
  const value = (raw: string) => raw || t("session.settingsDefault");
  if (change.field === "model") {
    return `${t("agent.model")} ${change.from} → ${change.to}`;
  }
  if (change.field === "effort") {
    return `${t("agent.effort")} ${value(change.from)} → ${value(change.to)}`;
  }
  const fast = (raw: string) => (raw === "on" ? t("agent.enabled") : raw === "off" ? t("agent.disabled") : value(raw));
  return `${t("agent.fastMode")} ${fast(change.from)} → ${fast(change.to)}`;
}

export function previousUserTimestamp(timeline: TimelineItem[], index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    const item = timeline[i];
    if (item.type === "user_text") {
      return item.timestamp || "";
    }
  }
  return "";
}

export const formatTime = (isoString: string | undefined, locale: Locale) => {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isThisYear = date.getFullYear() === now.getFullYear();
    const timeStr = date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    if (isToday) return timeStr;
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    if (isThisYear) return `${month}-${day} ${timeStr}`;
    return `${date.getFullYear()}-${month}-${day} ${timeStr}`;
  } catch {
    return "";
  }
};

export const formatToolCallFallbackResult = (toolCall: Partial<ToolCall>): string => {
  const kind = (toolCall.kind || "").toLowerCase();
  if (kind === "read") return "";
  const rawInput = toolCall.meta?.input;
  if (typeof rawInput === "string" && rawInput.trim() !== "") {
    const todoMarkdown = formatTodoToolCallInput(rawInput);
    if (todoMarkdown) return todoMarkdown;
    return rawInput;
  }
  const rawOutput = toolCall.meta?.output;
  if (typeof rawOutput === "string" && rawOutput.trim() !== "")
    return rawOutput;
  return "";
};

export const formatTodoToolCallInput = (rawInput: string): string => {
  try {
    const parsed = JSON.parse(rawInput) as {
      todos?: Array<{
        content?: string;
        status?: string;
        activeForm?: string;
      }>;
    };
    if (!Array.isArray(parsed?.todos) || parsed.todos.length === 0) {
      return "";
    }
    const lines = parsed.todos
      .map((todo) => {
        const content = `${todo?.content || ""}`.trim();
        const activeForm = `${todo?.activeForm || ""}`.trim();
        const status = `${todo?.status || ""}`.trim().toLowerCase();
        if (status === "completed") {
          const label = content || activeForm;
          return label ? `- [x] ${label}` : "";
        }
        if (status === "in_progress") {
          const label = activeForm || content;
          return label ? `- [ ] ${label} _(in progress)_` : "";
        }
        const label = content || activeForm;
        return label ? `- [ ] ${label}` : "";
      })
      .filter(Boolean);
    return lines.join("\n");
  } catch {
    return "";
  }
};

export function isAuxiliaryTimelineItem(item: TimelineItem | null): boolean {
  return (
    item?.type === "tool" ||
    item?.type === "thought" ||
    item?.type === "todo" ||
    item?.type === "plan" ||
    item?.type === "compact"
  );
}

export function timelineItemSpacing(
  previous: TimelineItem | null,
  current: TimelineItem,
): string {
  if (!previous) {
    return "0";
  }
  if (isAuxiliaryTimelineItem(previous) && isAuxiliaryTimelineItem(current)) {
    return "6px";
  }
  return "16px";
}

export function shouldDefaultCollapseRelatedFiles(
  isMobile: boolean,
  relatedFileCount: number,
): boolean {
  if (isMobile) {
    return relatedFileCount > 0;
  }
  return relatedFileCount > 5;
}
