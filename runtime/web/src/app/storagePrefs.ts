import { useEffect, useState } from "react";
import { projectStorage } from "../services/remoteScope";

export const CHILD_SESSION_PAGE_SIZE = 100;
export const MULTI_PROJECT_SESSION_LIMIT = 6;
export const SESSION_PAGE_SIZE = 50;
export const MULTI_PROJECT_SESSION_STORAGE_KEY =
  "mindfs-multi-project-session-list";
export const PLUGIN_QUERY_STORAGE_PREFIX = "vp-progress:";
export const TREE_SORT_STORAGE_KEY = "mindfs-tree-sort-mode";
export const DIRECTORY_SORT_OVERRIDES_STORAGE_KEY =
  "mindfs-directory-sort-overrides";
export const FILE_SCROLL_STORAGE_KEY = "mindfs-file-scroll-positions";
export const LAST_ROOT_STORAGE_KEY = "mindfs-last-root-id";
export const GIT_STATUS_EXPANDED_STORAGE_KEY = "mindfs-git-status-expanded";
export const GIT_HISTORY_EXPANDED_STORAGE_KEY = "mindfs-git-history-expanded";
export const SIDEBARS_SWAPPED_STORAGE_KEY = "mindfs-sidebars-swapped";
export const GIT_DIFF_SIDE_BY_SIDE_STORAGE_KEY = "mindfs-git-diff-side-by-side";

export function loadPersistedFileScrollPositions(): Record<string, number> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = projectStorage().getItem(FILE_SCROLL_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const next: Record<string, number> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      const scrollTop = Number(value);
      if (!key || !Number.isFinite(scrollTop) || scrollTop < 0) {
        return;
      }
      next[key] = scrollTop;
    });
    return next;
  } catch {
    return {};
  }
}

export function persistFileScrollPositions(
  positions: Record<string, number>,
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    projectStorage().setItem(
      FILE_SCROLL_STORAGE_KEY,
      JSON.stringify(positions),
    );
  } catch {}
}

export function pluginQueryStorageKey(root: string, file: string): string {
  return `${PLUGIN_QUERY_STORAGE_PREFIX}${root}:${file}`;
}

export function loadPersistedPluginQuery(
  root: string,
  file: string,
): Record<string, string> {
  if (!root || !file) return {};
  try {
    const raw = projectStorage().getItem(pluginQueryStorageKey(root, file));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const next: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(
      ([key, value]) => {
        if (!key) return;
        next[key] = String(value);
      },
    );
    return next;
  } catch {
    return {};
  }
}

export function persistPluginQuery(
  root: string,
  file: string,
  query: Record<string, string>,
): void {
  if (!root || !file) return;
  try {
    projectStorage().setItem(
      pluginQueryStorageKey(root, file),
      JSON.stringify(query || {}),
    );
  } catch {}
}

export function removeLocalStorageByPrefix(prefix: string): void {
  if (typeof window === "undefined" || !prefix) {
    return;
  }
  try {
    for (const key of Array.from(
      { length: projectStorage().length },
      (_, index) => projectStorage().key(index),
    ).filter(Boolean) as string[]) {
      if (key.startsWith(prefix)) {
        projectStorage().removeItem(key);
      }
    }
  } catch {}
}

export function loadLastRootId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return projectStorage().getItem(LAST_ROOT_STORAGE_KEY) || "";
}

export function loadBooleanRecord(key: string): Record<string, boolean> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(projectStorage().getItem(key) || "{}") as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "boolean"),
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function loadStringBooleanRecord(
  key: string,
): Record<string, Record<string, boolean>> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(projectStorage().getItem(key) || "{}") as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.entries(parsed).map(([root, value]) => [
        root,
        value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).filter(
                ([, expanded]) => typeof expanded === "boolean",
              ),
            )
          : {},
      ]),
    ) as Record<string, Record<string, boolean>>;
  } catch {
    return {};
  }
}

export function loadSidebarsSwapped(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return projectStorage().getItem(SIDEBARS_SWAPPED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function loadGitDiffSideBySide(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return projectStorage().getItem(GIT_DIFF_SIDE_BY_SIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useResponsive() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkSize = () => {
      const width = window.innerWidth;
      setIsMobile(width < 768);
    };
    checkSize();
    window.addEventListener("resize", checkSize);
    return () => window.removeEventListener("resize", checkSize);
  }, []);
  return { isMobile };
}
