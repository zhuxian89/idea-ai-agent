export type ViewerSelection = {
  filePath: string;
  text?: string;
  startLine?: number;
  endLine?: number;
};

export type AttachedFileContext = {
  filePath: string;
  fileName: string;
  startLine?: number;
  endLine?: number;
  text?: string;
};

export type GitFileStat = {
  status: string;
  additions: number;
  deletions: number;
};

export type RelatedFileClickTarget = {
  path: string;
  head?: string;
  repo_path?: string;
  repo_name?: string;
  repo_kind?: string;
};

export function relatedFileSelectionKey(
  file: RelatedFileClickTarget | null | undefined,
): string {
  if (!file?.path) return "";
  return [
    file.repo_kind || "",
    file.repo_path || "",
    file.head || "",
    file.path,
  ].join("\0");
}

export const FILE_TOKEN_PATTERN = /\[(?:read file|file):\s*[^\]]+\]/i;

export function buildFileScrollKey(
  rootId: string | null | undefined,
  path: string | null | undefined,
): string {
  if (!rootId || !path) {
    return "";
  }
  return `${rootId}::${path}`;
}

export function normalizePath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function normalizePathForRoot(value: string, rootPath?: string): string {
  const normalized = normalizePath(value);
  if (!normalized) return "";
  const normalizedRoot = normalizePath(rootPath || "");
  if (!normalizedRoot) return normalized;
  if (normalized === normalizedRoot) return "";
  if (normalized.startsWith(`${normalizedRoot}/`)) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized;
}

export function relativeDisplayPathFromRoot(
  rootPath: string | undefined,
  absolutePath: string,
): string {
  const root = normalizePath(rootPath || "");
  const target = normalizePath(absolutePath);
  if (!target) return "";
  if (!root) return target;
  if (target === root) return ".";
  if (target.startsWith(`${root}/`)) {
    return target.slice(root.length + 1);
  }
  const rootParts = root.split("/").filter(Boolean);
  const targetParts = target.split("/").filter(Boolean);
  let shared = 0;
  while (
    shared < rootParts.length &&
    shared < targetParts.length &&
    rootParts[shared] === targetParts[shared]
  ) {
    shared += 1;
  }
  const upward = Array(Math.max(0, rootParts.length - shared)).fill("..");
  const downward = targetParts.slice(shared);
  return [...upward, ...downward].join("/") || ".";
}

export function joinDisplayPath(base: string, path: string): string {
  const normalizedBase = normalizePath(base);
  const normalizedPath = normalizePath(path);
  if (!normalizedBase) return normalizedPath;
  if (!normalizedPath) return normalizedBase;
  return `${normalizedBase}/${normalizedPath}`;
}

export function parseFileLocation(path: string): {
  path: string;
  targetLine?: number;
  targetColumn?: number;
} {
  const raw = String(path || "");
  const [base, fragment = ""] = raw.split("#", 2);
  if (fragment) {
    const match = /^L(\d+)(?:C(\d+))?$/i.exec(fragment.trim());
    if (match) {
      const targetLine = Number.parseInt(match[1], 10);
      const targetColumn = match[2] ? Number.parseInt(match[2], 10) : undefined;
      return {
        path: base,
        targetLine:
          Number.isFinite(targetLine) && targetLine > 0
            ? targetLine
            : undefined,
        targetColumn:
          targetColumn && Number.isFinite(targetColumn) && targetColumn > 0
            ? targetColumn
            : undefined,
      };
    }
  }

  const colonMatch = /^(.*):(\d+)(?::(\d+))?$/.exec(base.trim());
  if (!colonMatch) {
    return { path: base };
  }
  const targetLine = Number.parseInt(colonMatch[2], 10);
  const targetColumn = colonMatch[3]
    ? Number.parseInt(colonMatch[3], 10)
    : undefined;
  return {
    path: colonMatch[1],
    targetLine:
      Number.isFinite(targetLine) && targetLine > 0 ? targetLine : undefined,
    targetColumn:
      targetColumn && Number.isFinite(targetColumn) && targetColumn > 0
        ? targetColumn
        : undefined,
  };
}

export function parentDirsOfFile(path: string): string[] {
  const normalized = normalizePath(path);
  if (!normalized) return [];
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return [];
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    dirs.push(parts.slice(0, i).join("/"));
  }
  return dirs;
}

export function dirnameOfPath(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized) return ".";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return ".";
  return parts.slice(0, -1).join("/");
}

export function basenameOfPath(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

export function hasExplicitFileContext(message: string): boolean {
  return FILE_TOKEN_PATTERN.test(message);
}

export function waitForNextPaint(): Promise<void> {
  if (
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame !== "function"
  ) {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

export function buildDirectorySelectionKey(
  root: string,
  path: string,
  isRoot: boolean,
): string {
  return isRoot ? root : `${root}:${path}`;
}
