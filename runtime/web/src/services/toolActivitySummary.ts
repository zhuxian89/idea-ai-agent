import { translateWithLocale, type Locale, type MessageKey, type MessageParams } from "../i18n";
import type { ToolCall } from "./session";
import type { ActivityFactsV1, ActivityOperation, ActivityState } from "./activityFacts";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    // Old tool inputs may contain entire files. Never parse unbounded payloads
    // just to label a collapsed row, and never inspect output/content here.
    if (value.length > 32768) return {};
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactActivityText(value: string): string {
  const characters = Array.from(value.replace(/\s+/g, " ").trim());
  return characters.length > 100 ? characters.slice(0, 99).join("") + "…" : characters.join("");
}

function displayPath(value: string, rootPath?: string): string {
  const path = value.replace(/\\/g, "/");
  const normalizedRoot = text(rootPath).replace(/\\/g, "/");
  const root = normalizedRoot.replace(/\/+$/, "") || (normalizedRoot.startsWith("/") ? "/" : "");
  if (!root) return path;
  const windows = /^[a-z]:/i.test(root) || root.startsWith("//");
  const comparablePath = windows ? path.toLowerCase() : path;
  const comparableRoot = windows ? root.toLowerCase() : root;
  if (comparablePath === comparableRoot) return ".";
  const prefix = comparableRoot.endsWith("/") ? comparableRoot : comparableRoot + "/";
  return comparablePath.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function commandInfo(command: string): { preview?: string; kind: "simple" | "script" | "unknown" } {
  if (!command) return { kind: "unknown" };
  let candidate = command;
  // Only unwrap a single quoted shell payload with no nested quoting/expansion.
  // This is a preview, never a parser or an executable command transformation.
  const wrapper = command.match(/^(?:\/[\w./-]+\/)?(?:sh|bash|zsh)\s+-(?:c|lc|cl)\s+(['"])([^\r\n]*)\1$/);
  if (wrapper && !/['"`$\\]/.test(wrapper[2])) candidate = wrapper[2].trim();
  const preview = compactActivityText(candidate.split(/\r?\n/).find(line => line.trim()) || "");
  const multiline = /[\r\n]/.test(command.trim());
  const compound = /[;&|<>`$(){}]/.test(candidate);
  const interpreter = /(?:^|[\/\s])(?:pwsh|powershell)(?:\.exe)?\b|\b(?:python\d*|node|ruby|perl)\s+-(?:c|e)\b|\b(?:sh|bash|zsh)\s+-/.test(candidate);
  if (multiline || compound || interpreter) return { preview, kind: "script" };
  // Quotes and escapes outside the narrow wrapper above are deliberately not
  // decoded. A generic label is preferable to an incorrect command meaning.
  if (/['"\\]/.test(candidate)) return { preview, kind: "unknown" };
  return { preview, kind: "simple" };
}

const genericLabels: Record<ActivityOperation, MessageKey> = {
  execute: "toolActivity.command", read: "toolActivity.read", list: "toolActivity.list",
  search: "toolActivity.search", web_search: "toolActivity.webSearch", fetch: "toolActivity.fetch",
  file_change: "toolActivity.fileChange", mcp: "toolActivity.integration", task: "toolActivity.task", other: "toolActivity.other",
};

export function buildActivitySummary(call: ToolCall, facts: ActivityFactsV1 | undefined, context: {
  operation: ActivityOperation; state: ActivityState; locale: Locale; rootPath?: string;
}): { summary: string; preview?: string } {
  const { operation, state, locale, rootPath } = context;
  const t = (key: MessageKey, params?: MessageParams) => translateWithLocale(locale, key, params);
  const meta = call.meta || {};
  const args = inputRecord(meta.input);
  const command = operation === "execute" ? commandInfo(text(meta.command) || text(args.command)) : undefined;
  const result = (summary: string) => ({ summary: compactActivityText(summary), preview: command?.preview });
  const description = text(facts?.displayLabel?.text) || text(meta.description) ||
    (["execute", "task"].includes(operation) ? text(args.description) : "");
  if (description) return result(description);

  const actions = facts?.actions;
  if (actions?.length) {
    if (actions.length > 1) {
      const type = actions[0].type;
      const key = actions.every(action => action.type === type)
        ? ({ read: "toolActivity.readMany", list: "toolActivity.listMany", search: "toolActivity.searchMany" } as const)[type]
        : "toolActivity.actionsMany";
      return result(t(key, { count: actions.length }));
    }
    const action = actions[0];
    const path = displayPath(text(action.path), rootPath);
    if (action.type === "read") {
      const target = path || text(action.name);
      return result(target ? t("toolActivity.readTarget", { target }) : t("toolActivity.read"));
    }
    if (action.type === "list") return result(path ? t("toolActivity.listTarget", { target: path }) : t("toolActivity.list"));
    const query = text(action.query);
    return result(query ? t(path ? "toolActivity.searchIn" : "toolActivity.searchQuery", { query, path }) : t("toolActivity.search"));
  }

  if (operation === "mcp") {
    const legacy = (text(meta.toolName) || text(call.title)).match(/^mcp__(.+?)__(.+)$/);
    const name = text(facts?.tool?.displayName) || text(meta.toolDisplayName);
    const title = text(call.title);
    const tool = text(facts?.tool?.name) || text(meta.tool) || legacy?.[2] || (title === "mcp_tool" ? "" : title);
    const server = text(facts?.tool?.server) || text(meta.server) || legacy?.[1] || "";
    return result(name || (server && tool ? t("toolActivity.mcpName", { server, tool }) : tool || server || t("toolActivity.integration")));
  }
  if (operation === "execute") {
    const completed = state === "completed";
    if (command?.kind === "script") return result(t(completed ? "toolActivity.scriptCompleted" : "toolActivity.script"));
    if (command?.kind === "simple" && command.preview) {
      return result(t(completed ? "toolActivity.commandTargetCompleted" : "toolActivity.commandTarget", { command: command.preview }));
    }
    return result(t(completed ? "toolActivity.commandCompleted" : "toolActivity.command"));
  }

  const path = displayPath(text(meta.filePath) || text(meta.path) || text(args.file_path) || text(args.path) || text(call.locations?.[0]?.path), rootPath);
  const query = text(meta.pattern) || text(meta.query) || text(args.pattern) || text(args.query);
  if (operation === "read" && path) return result(t("toolActivity.readTarget", { target: path }));
  if (operation === "list" && path) return result(t("toolActivity.listTarget", { target: path }));
  if (operation === "search" && query) return result(t(path ? "toolActivity.searchIn" : "toolActivity.searchQuery", { query, path }));
  if (operation === "web_search" && query) return result(t("toolActivity.webSearchQuery", { query }));
  if (operation === "fetch") {
    const url = text(meta.url) || text(args.url);
    if (url) return result(t("toolActivity.fetchTarget", { target: url }));
  }
  if (operation === "file_change") {
    const paths = new Set(call.locations?.map(location => text(location.path)).filter(Boolean));
    if (paths.size > 1) return result(t("toolActivity.changeMany", { count: paths.size }));
    if (path) return result(t("toolActivity.changeTarget", { target: path }));
  }
  if (operation === "task") {
    const tool = text(facts?.tool?.name) || text(meta.tool);
    const taskLabels: Record<string, MessageKey> = {
      spawn_agent: "toolActivity.taskStart", wait: "toolActivity.taskWait",
      send_input: "toolActivity.taskInput", close_agent: "toolActivity.taskClose", resume_agent: "toolActivity.taskResume",
    };
    if (Object.prototype.hasOwnProperty.call(taskLabels, tool)) return result(t(taskLabels[tool]));
    const subject = text(meta.subject) || text(args.subject);
    if (subject) return result(t("toolActivity.taskTarget", { target: subject }));
  }
  // Legacy titles remain a conservative fallback; never parse commands out of
  // a formatted title or scrape a large result to manufacture a better label.
  const title = text(call.title);
  const genericTitle = /^(?:read|read file|读取文件|list|list files|grep|glob|search|search files|web search|webfetch|fetch|edit|write|file_change|task|agent|tool)$/i.test(title);
  return result(title && !genericTitle ? title : t(genericLabels[operation]));
}
