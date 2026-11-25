import type { DirectorySortMode, FileEntry } from "../services/directorySort";
import type { ManagedRootPayload } from "./projectModel";
import type { URLState } from "./runtimeTypes";

export function extractHTTPStatusFromErrorMessage(
  message: string,
): number | null {
  const match = /status=(\d{3})|(?:^|:\s)(\d{3})\s[A-Z]/.exec(
    String(message || ""),
  );
  const raw = match?.[1] || match?.[2];
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePluginQuery(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const query: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key.startsWith("vp_")) {
      query[key.slice("vp_".length)] = value;
    }
  });
  return query;
}

export function parseCursor(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function normalizeCursor(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export function isDirectorySortMode(
  value: string | null | undefined,
): value is DirectorySortMode {
  return (
    value === "name-asc" ||
    value === "name-desc" ||
    value === "mtime-desc" ||
    value === "mtime-asc" ||
    value === "size-desc" ||
    value === "size-asc"
  );
}

export function readURLState(): URLState {
  const params = new URLSearchParams(window.location.search);
  return {
    root: params.get("root") || "",
    file: params.get("file") || "",
    session: params.get("session") || "",
    cursor: parseCursor(params.get("cursor")),
    pluginQuery: parsePluginQuery(window.location.search),
  };
}

export function buildURLSearch(next: URLState): string {
  const params = new URLSearchParams();
  // Session/file navigation rewrites the URL. Preserve the native host flags
  // so a reload still hides the web toolbar and subscribes to title actions.
  const current = new URLSearchParams(window.location.search);
  if (current.get("ide") === "1") params.set("ide", "1");
  if (current.get("ide_chrome") === "1") params.set("ide_chrome", "1");
  const ideaTheme = current.get("ide_theme");
  if (ideaTheme === "dark" || ideaTheme === "light")
    params.set("ide_theme", ideaTheme);
  if (next.root) params.set("root", next.root);
  if (next.file) params.set("file", next.file);
  if (next.session) params.set("session", next.session);
  if (next.cursor > 0) params.set("cursor", String(next.cursor));
  Object.entries(next.pluginQuery).forEach(([key, value]) => {
    if (!key) return;
    params.set(`vp_${key}`, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function mapManagedRootsToEntries(
  dirs: ManagedRootPayload[],
): FileEntry[] {
  return dirs.map((dir) => ({
    name: dir.display_name || dir.id.split("/").filter(Boolean).pop() || dir.id,
    path: dir.id,
    is_dir: true,
    is_root: true,
    size: typeof dir.size === "number" ? dir.size : undefined,
    mtime: typeof dir.mtime === "string" ? dir.mtime : undefined,
  }));
}

export function comparableManagedRootPath(value: string | undefined): string {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}
