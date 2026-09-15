export type TurnDiffFileKind = "added" | "modified" | "deleted" | "renamed";

export type TurnDiffFile = {
  path: string;
  oldPath?: string;
  kind: TurnDiffFileKind;
  additions: number;
  deletions: number;
  binary: boolean;
  diff: string;
};

export type TurnDiffSummary = {
  files: TurnDiffFile[];
  additions: number;
  deletions: number;
};

function unquoteGitPath(value: string): string {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed;
  const input = trimmed.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const escaped: Record<string, string> = {
    a: "\u0007", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\u000b", "\\": "\\", '"': '"',
  };
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== "\\") {
      bytes.push(...encoder.encode(input[index]));
      continue;
    }
    const octal = input.slice(index + 1).match(/^[0-7]{1,3}/)?.[0];
    if (octal) {
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }
    const next = input[index + 1];
    if (next) {
      bytes.push(...encoder.encode(escaped[next] ?? next));
      index += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function diffHeaderPath(value: string): string {
  let path = value.trim();
  const tab = path.indexOf("\t");
  if (tab >= 0) path = path.slice(0, tab);
  path = unquoteGitPath(path);
  if (path === "/dev/null") return path;
  return path.replace(/^[ab]\//, "");
}

function pathFromGitHeader(line: string): string {
  const rest = line.replace(/^diff --git /, "");
  const quoted = rest.match(/^(?:"a\/(?:[^"\\]|\\.)*")\s+("b\/(?:[^"\\]|\\.)*")$/);
  if (quoted) return diffHeaderPath(quoted[1]);
  if (!rest.startsWith("a/")) return "";
  for (let split = rest.indexOf(" b/"); split >= 0; split = rest.indexOf(" b/", split + 1)) {
    const oldPath = rest.slice(2, split);
    const newPath = rest.slice(split + 3);
    if (oldPath === newPath) return newPath;
  }
  const split = rest.lastIndexOf(" b/");
  return split >= 0 ? rest.slice(split + 3) : "";
}

function parseSection(lines: string[]): TurnDiffFile | null {
  if (!lines.length) return null;
  let oldPath = "";
  let newPath = "";
  let renamedFrom = "";
  let renamedTo = "";
  let additions = 0;
  let deletions = 0;
  let binary = false;
  let added = false;
  let deleted = false;

  for (const line of lines) {
    if (line.startsWith("--- ")) oldPath = diffHeaderPath(line.slice(4));
    else if (line.startsWith("+++ ")) newPath = diffHeaderPath(line.slice(4));
    else if (line.startsWith("rename from ")) renamedFrom = diffHeaderPath(line.slice(12));
    else if (line.startsWith("rename to ")) renamedTo = diffHeaderPath(line.slice(10));
    else if (line.startsWith("new file mode ")) added = true;
    else if (line.startsWith("deleted file mode ")) deleted = true;
    else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) binary = true;
    else if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }

  const fallback = pathFromGitHeader(lines[0]);
  const isRename = !!(renamedFrom || renamedTo);
  if (oldPath === "/dev/null") added = true;
  if (newPath === "/dev/null") deleted = true;
  const path = renamedTo || (newPath && newPath !== "/dev/null" ? newPath : "")
    || renamedFrom || (oldPath && oldPath !== "/dev/null" ? oldPath : "") || fallback;
  if (!path) return null;

  return {
    path,
    oldPath: isRename ? renamedFrom || (oldPath !== "/dev/null" ? oldPath : undefined) : undefined,
    kind: isRename ? "renamed" : added ? "added" : deleted ? "deleted" : "modified",
    additions,
    deletions,
    binary,
    diff: lines.join("\n").trimEnd(),
  };
}

export function parseTurnDiff(diff: string): TurnDiffSummary {
  const normalized = (diff || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const sections: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      sections.push(current);
      current = [];
    }
    if (line.startsWith("diff --git ") || current.length > 0) current.push(line);
  }
  if (current.length > 0) sections.push(current);

  // Some transports omit `diff --git` and begin directly with file headers.
  if (sections.length === 0 && normalized.trim()) sections.push(lines);
  const files = sections.map(parseSection).filter((file): file is TurnDiffFile => file !== null);
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
