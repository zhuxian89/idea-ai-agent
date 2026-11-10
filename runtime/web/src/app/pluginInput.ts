import { type PluginInput } from "../plugins/manager";
import { type FilePayload } from "../services/file";

export function toPluginInput(
  file: FilePayload,
  query: Record<string, string>,
): PluginInput {
  return {
    name: file.name,
    path: file.path,
    content: file.content,
    ext: file.ext || "",
    mime: file.mime || "",
    size: typeof file.size === "number" ? file.size : 0,
    truncated: !!file.truncated,
    next_cursor:
      typeof file.next_cursor === "number" ? file.next_cursor : undefined,
    query,
  };
}

export function inferReadModeFromPlugin(plugin: any): "incremental" | "full" {
  if (!plugin) return "incremental";
  if (plugin?.fileLoadMode === "full") return "full";
  if (plugin?.fileLoadMode === "incremental") return "incremental";
  return "incremental";
}

export function buildMatchInputFromPath(
  path: string,
  query: Record<string, string>,
): PluginInput {
  const normalized = (path || "").replace(/\\/g, "/");
  const name = normalized.split("/").pop() || normalized;
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return {
    name,
    path: normalized,
    content: "",
    ext,
    mime: "",
    size: 0,
    truncated: false,
    query,
  };
}

export function formatPluginViewContext(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2).trim();
  } catch {
    return String(value).trim();
  }
}

export function buildMessageWithViewContext(
  message: string,
  viewContext: unknown,
): string {
  const contextText = formatPluginViewContext(viewContext);
  if (!contextText) return message;
  return [contextText, "", message].join("\n");
}
