import { remoteProjectPrefix } from "./remoteScope";

const storageKey = () => `idea-remote-drafts:${remoteProjectPrefix()}`;

export function readRemoteDrafts(): Map<string, { text: string; attachments: never[] }> {
  if (!remoteProjectPrefix()) return new Map();
  const raw = window.sessionStorage.getItem(storageKey());
  if (!raw) return new Map();
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries.filter((entry): entry is [string, string] => Array.isArray(entry) &&
      entry.length === 2 && typeof entry[0] === "string" && typeof entry[1] === "string")
      .map(([key, text]) => [key, { text, attachments: [] }]));
  } catch { return new Map(); }
}

export function saveRemoteDrafts(entries: Iterable<[string, { text: string }]>): boolean {
  if (!remoteProjectPrefix()) return true;
  try {
    window.sessionStorage.setItem(storageKey(), JSON.stringify([...entries]
      .filter(([, draft]) => draft.text).map(([key, draft]) => [key, draft.text])));
    return true;
  } catch { return false; }
}
