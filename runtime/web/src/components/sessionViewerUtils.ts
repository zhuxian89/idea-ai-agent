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

export interface ParsedInlineTokenSpan {
  start: number;
  end: number;
  kind: "file" | "skill";
  value: string;
}

const fileTokenOpenerRe = /\[(read file|file):\s*/g;
const anyTokenOpenerRe = /\[(read file|file|use skill):\s*/g;

export function formatUploadAttachmentToken(rawPath: string): string {
  const cleaned = `${rawPath || ""}`.replace(/[\r\n]+/g, " ").trim();
  return cleaned ? `[file: ${cleaned}]` : "";
}

export function findInlineTokenSpans(
  content: string,
  includeSkill = false,
): ParsedInlineTokenSpan[] {
  const text = content || "";
  if (!text) return [];
  const spans: ParsedInlineTokenSpan[] = [];
  let lineStart = 0;

  while (lineStart <= text.length) {
    const nlIndex = text.indexOf("\n", lineStart);
    const lineEnd = nlIndex === -1 ? text.length : nlIndex;
    const nextLineStart = nlIndex === -1 ? text.length + 1 : nlIndex + 1;
    const rawLine = text.slice(lineStart, lineEnd);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trim();

    let pos = 0;
    while (pos < line.length) {
      const openerRe = includeSkill ? anyTokenOpenerRe : fileTokenOpenerRe;
      openerRe.lastIndex = pos;
      const match = openerRe.exec(line);
      if (!match) break;

      const openIdx = match.index;
      const valueStart = openIdx + match[0].length;
      const kind: "file" | "skill" = match[1] === "use skill" ? "skill" : "file";

      let depth = 1;
      let closeIdx = -1;
      for (let i = valueStart; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === "[") {
          depth += 1;
        } else if (ch === "]") {
          depth -= 1;
          if (depth === 0) {
            closeIdx = i;
            break;
          }
        }
      }

      anyTokenOpenerRe.lastIndex = valueStart;
      const hasLaterOpener = anyTokenOpenerRe.test(line);
      const isStandalone =
        line.slice(0, openIdx).trim() === "" &&
        trimmed.endsWith("]") &&
        !hasLaterOpener;

      if (isStandalone) {
        const lastBracket = line.lastIndexOf("]");
        if (closeIdx < 0) {
          closeIdx = lastBracket;
        } else if (closeIdx < lastBracket) {
          const rest = line.slice(closeIdx + 1, lastBracket);
          const nextCh = line[closeIdx + 1];
          if ((nextCh !== " " && nextCh !== "\t") || !rest.includes("[")) {
            closeIdx = lastBracket;
          }
        }
      } else if (closeIdx < 0) {
        closeIdx = line.indexOf("]", valueStart);
      }

      if (closeIdx < 0) {
        break;
      }

      const value = line.slice(valueStart, closeIdx).trim();
      if (value) {
        spans.push({
          start: lineStart + openIdx,
          end: lineStart + closeIdx + 1,
          kind,
          value,
        });
      }
      pos = closeIdx + 1;
    }

    lineStart = nextLineStart;
  }

  return spans;
}

export function basename(path: string): string {
  const normalized = (path || "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
}

export function extractUploadAttachments(content: string): UploadAttachment[] {
  return findInlineTokenSpans(content || "", false).map((span) => ({
    path: span.value,
    name: basename(span.value),
    isImage: isImagePath(span.value),
  }));
}

export function stripImageAttachmentTokens(content: string): string {
  if (!content) {
    return "";
  }
  const spans = findInlineTokenSpans(content, false);
  if (spans.length === 0) {
    return content.replace(/\n{3,}/g, "\n\n").replace(/^[\n\s]+|[\n\s]+$/g, "");
  }
  let stripped = "";
  let last = 0;
  for (const span of spans) {
    if (span.start > last) {
      stripped += content.slice(last, span.start);
    }
    if (!isImagePath(span.value)) {
      stripped += content.slice(span.start, span.end);
    }
    last = span.end;
  }
  if (last < content.length) {
    stripped += content.slice(last);
  }
  return stripped.replace(/\n{3,}/g, "\n\n").replace(/^[\n\s]+|[\n\s]+$/g, "");
}

export function stripUploadAttachmentTokens(content: string): string {
  if (!content) {
    return "";
  }
  const spans = findInlineTokenSpans(content, false);
  if (spans.length === 0) {
    return content.replace(/\n{3,}/g, "\n\n").replace(/^[\n\s]+|[\n\s]+$/g, "");
  }
  let stripped = "";
  let last = 0;
  for (const span of spans) {
    if (span.start > last) {
      stripped += content.slice(last, span.start);
    }
    last = span.end;
  }
  if (last < content.length) {
    stripped += content.slice(last);
  }
  return stripped.replace(/\n{3,}/g, "\n\n").replace(/^[\n\s]+|[\n\s]+$/g, "");
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
