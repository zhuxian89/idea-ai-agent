/** The project prefix is also the namespace for browser-owned project state. */
export function remoteNodePrefix(pathname = typeof window === "undefined" ? "" : window.location.pathname): string {
  return /^\/n\/[^/]+(?=\/|$)/.exec(pathname)?.[0] || "";
}

export function remoteProjectPrefix(pathname = typeof window === "undefined" ? "" : window.location.pathname): string {
  return /^\/n\/[^/]+\/p\/[^/]+(?=\/|$)/.exec(pathname)?.[0] || "";
}

export function remoteProjectId(): string {
  const prefix = remoteProjectPrefix();
  return prefix ? decodeURIComponent(prefix.slice(prefix.lastIndexOf("/") + 1)) : "";
}

export function remoteStorageScope(): string {
  return remoteProjectPrefix() || remoteNodePrefix();
}

// Use a view of storage rather than changing browser globals. Enumerations and
// prefix removal see only this project, so clearing A cannot evict B's state.
export function scopedStorage(storage: Storage, scope: string): Storage {
  if (!scope) return storage;
  const prefix = `idea-remote:${scope}:`;
  const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter((key): key is string => key !== null && key.startsWith(prefix));
  return {
    get length() { return keys().length; },
    key(index) { const key = keys()[index]; return key === undefined ? null : key.slice(prefix.length); },
    getItem(key) { return storage.getItem(prefix + key); },
    setItem(key, value) { storage.setItem(prefix + key, value); },
    removeItem(key) { storage.removeItem(prefix + key); },
    clear() { for (const key of keys()) storage.removeItem(key); },
  };
}

export function projectStorage(): Storage {
  return scopedStorage(window.localStorage, remoteProjectPrefix());
}
