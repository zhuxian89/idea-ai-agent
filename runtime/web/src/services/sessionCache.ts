import { mergeHistoryAux, mergeHistoryExchanges } from "./sessionHistory";
import {
  ExchangeAux,
  Session,
  SessionListPayload,
  MultiRootSessionGroup,
} from "./sessionTypes";

export type CachedSessionRecord = {
  cacheKey: string;
  rootId: string;
  sessionKey: string;
  touchedAt: number;
  session: Session;
};

export type CachedSessionListRecord<T> = {
  cacheKey: string;
  touchedAt: number;
  payload: T;
};

export const remoteCacheScope = typeof window !== "undefined" ? /^\/n\/[^/]+(?:\/p\/[^/]+)?(?=\/|$)/.exec(window.location?.pathname || "")?.[0] || "" : "";

export const SESSION_CACHE_DB = "mindfs-session-cache" + remoteCacheScope;

export const SESSION_CACHE_STORE = "sessions";

export const SESSION_LIST_CACHE_STORE = "session-lists";

export const SESSION_CACHE_VERSION = 4;

export const MULTI_ROOT_SESSION_LIST_CACHE_KEY = "multi-root";

export let sessionDBPromise: Promise<IDBDatabase> | null = null;

export function buildSessionCacheKey(rootId: string, sessionKey: string): string {
  return `${rootId}::${sessionKey}`;
}

export function openSessionDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("indexeddb unavailable"));
  }
  if (sessionDBPromise) {
    return sessionDBPromise;
  }
  sessionDBPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(
      SESSION_CACHE_DB,
      SESSION_CACHE_VERSION,
    );
    request.onerror = () =>
      reject(request.error || new Error("failed to open indexeddb"));
    request.onupgradeneeded = (event) => {
      applySessionCacheUpgrade(
        request.result,
        (event as IDBVersionChangeEvent).oldVersion,
      );
    };
    request.onsuccess = () => resolve(request.result);
  });
  return sessionDBPromise;
}

// Version 4 rebuilds the derived session cache: older builds persisted native
// task-notification payloads as user bubbles, and an incremental sync from a
// cached maxSeq would keep them forever. Only the per-session store is dropped
// and recreated; session lists, drafts, attachments, and unrelated stores are
// preserved.
export function applySessionCacheUpgrade(
  db: IDBDatabase,
  oldVersion: number,
): void {
  if (
    oldVersion < SESSION_CACHE_VERSION &&
    db.objectStoreNames.contains(SESSION_CACHE_STORE)
  ) {
    db.deleteObjectStore(SESSION_CACHE_STORE);
  }
  if (!db.objectStoreNames.contains(SESSION_CACHE_STORE)) {
    db.createObjectStore(SESSION_CACHE_STORE, { keyPath: "cacheKey" });
  }
  if (!db.objectStoreNames.contains(SESSION_LIST_CACHE_STORE)) {
    db.createObjectStore(SESSION_LIST_CACHE_STORE, { keyPath: "cacheKey" });
  }
}

export function sessionRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("indexeddb request failed"));
  });
}

export function withSessionStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return openSessionDB().then((db) => {
    const tx = db.transaction(SESSION_CACHE_STORE, mode);
    const store = tx.objectStore(SESSION_CACHE_STORE);
    const completion = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error("indexeddb transaction failed"));
      tx.onabort = () =>
        reject(tx.error || new Error("indexeddb transaction aborted"));
    });
    return run(store).then(async (result) => {
      await completion;
      return result;
    });
  });
}

export function withSessionListStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return openSessionDB().then((db) => {
    const tx = db.transaction(SESSION_LIST_CACHE_STORE, mode);
    const store = tx.objectStore(SESSION_LIST_CACHE_STORE);
    const completion = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error("indexeddb transaction failed"));
      tx.onabort = () =>
        reject(tx.error || new Error("indexeddb transaction aborted"));
    });
    return run(store).then(async (result) => {
      await completion;
      return result;
    });
  });
}

export function buildSessionListCacheKey(rootId: string): string {
  return `root::${rootId}`;
}

export async function readCachedSessionList<T>(cacheKey: string): Promise<T | null> {
  try {
    const record = await withSessionListStore("readonly", (store) =>
      sessionRequestToPromise(
        store.get(cacheKey) as IDBRequest<CachedSessionListRecord<T> | undefined>,
      ),
    );
    return record?.payload || null;
  } catch {
    return null;
  }
}

export async function writeCachedSessionList<T>(cacheKey: string, payload: T): Promise<void> {
  try {
    await withSessionListStore("readwrite", (store) =>
      sessionRequestToPromise(store.put({
        cacheKey,
        touchedAt: Date.now(),
        payload,
      } satisfies CachedSessionListRecord<T>)),
    );
  } catch {}
}

export function getCachedSessionList(rootId: string): Promise<SessionListPayload | null> {
  if (!rootId) return Promise.resolve(null);
  return readCachedSessionList<SessionListPayload>(buildSessionListCacheKey(rootId));
}

export function saveCachedSessionList(rootId: string, payload: SessionListPayload): Promise<void> {
  if (!rootId) return Promise.resolve();
  return writeCachedSessionList(buildSessionListCacheKey(rootId), payload);
}

export function getCachedMultiRootSessionList(): Promise<MultiRootSessionGroup[] | null> {
  return readCachedSessionList<MultiRootSessionGroup[]>(MULTI_ROOT_SESSION_LIST_CACHE_KEY);
}

export function saveCachedMultiRootSessionList(groups: MultiRootSessionGroup[]): Promise<void> {
  return writeCachedSessionList(MULTI_ROOT_SESSION_LIST_CACHE_KEY, groups);
}

export function getSessionMaxSeq(session: Session | null | undefined): number {
  const exchanges = Array.isArray(session?.exchanges) ? session.exchanges : [];
  return exchanges.reduce((max, exchange) => {
    const seq = Number((exchange as any)?.seq || 0);
    return Number.isFinite(seq) && seq > max ? seq : max;
  }, 0);
}

export function cloneExchangeAux(
  exchangeAux?: Record<string, ExchangeAux[]>,
): Record<string, ExchangeAux[]> {
  const out: Record<string, ExchangeAux[]> = {};
  for (const [seq, items] of Object.entries(exchangeAux || {})) {
    out[seq] = Array.isArray(items) ? [...items] : [];
  }
  return out;
}

export function toPersistentExchangeAux(
  exchangeAux?: Record<string, ExchangeAux[]>,
): Record<string, ExchangeAux[]> {
  const out: Record<string, ExchangeAux[]> = {};
  for (const [seq, items] of Object.entries(exchangeAux || {})) {
    const seqNum = Number(seq || 0);
    if (!Number.isFinite(seqNum) || seqNum <= 0) {
      continue;
    }
    const nextItems = Array.isArray(items)
      ? items.filter((item) => Number(item?.seq || 0) > 0)
      : [];
    if (nextItems.length > 0) {
      out[String(seqNum)] = nextItems;
    }
  }
  return out;
}

export function appendExchangeAuxDelta(
  base?: Record<string, ExchangeAux[]>,
  incoming?: Record<string, ExchangeAux[]>,
): Record<string, ExchangeAux[]> {
  const out = cloneExchangeAux(base);
  for (const [seq, items] of Object.entries(incoming || {})) {
    if (!Array.isArray(items) || items.length === 0) {
      continue;
    }
    out[seq] = mergeHistoryAux(out[seq], items);
  }
  return out;
}

export function preferIncomingText(next?: string, prev?: string) {
  const normalizedNext = (next || "").trim();
  if (normalizedNext) {
    return next;
  }
  return prev;
}

export function withSessionMeta(
  base: Session | null | undefined,
  incoming: Session | null | undefined,
): Session | null {
  if (!base && !incoming) {
    return null;
  }
  if (!base) {
    return incoming
      ? {
          ...incoming,
          exchanges: Array.isArray(incoming.exchanges)
            ? [...incoming.exchanges]
            : [],
        }
      : null;
  }
  if (!incoming) {
    return {
      ...base,
      exchanges: Array.isArray(base.exchanges) ? [...base.exchanges] : [],
    };
  }
  return {
    ...base,
    ...incoming,
    agent: preferIncomingText(incoming.agent, base.agent),
    model: preferIncomingText((incoming as any).model, (base as any).model),
    mode: preferIncomingText((incoming as any).mode, (base as any).mode),
    effort: preferIncomingText((incoming as any).effort, (base as any).effort),
    fast_service:
      typeof (incoming as any).fast_service === "string"
        ? (incoming as any).fast_service
        : typeof (base as any).fast_service === "string"
          ? (base as any).fast_service
          : "",
    plan_mode:
      typeof (incoming as any).plan_mode === "boolean"
        ? (incoming as any).plan_mode
        : !!(base as any).plan_mode,
    name: preferIncomingText(incoming.name, base.name) || "",
    exchanges: Array.isArray(incoming.exchanges) ? [...incoming.exchanges] : [],
    exchange_aux: cloneExchangeAux(incoming.exchange_aux || base.exchange_aux),
  };
}

export function appendSessionDelta(
  base: Session | null | undefined,
  incoming: Session | null | undefined,
): Session | null {
  const baseWithMeta = withSessionMeta(base, incoming);
  if (!baseWithMeta) {
    return null;
  }
  const baseExchanges = Array.isArray(base?.exchanges)
    ? base.exchanges.filter(
        (exchange) => Number((exchange as any)?.seq || 0) > 0,
      )
    : [];
  const incomingExchanges = Array.isArray(incoming?.exchanges)
    ? incoming.exchanges.filter(
        (exchange) => Number((exchange as any)?.seq || 0) > 0,
      )
    : [];
  const baseExchangeAux = toPersistentExchangeAux(base?.exchange_aux);
  const incomingExchangeAux = toPersistentExchangeAux(incoming?.exchange_aux);
  return {
    ...baseWithMeta,
    exchanges: mergeHistoryExchanges(baseExchanges, incomingExchanges),
    exchange_aux: appendExchangeAuxDelta(baseExchangeAux, incomingExchangeAux),
  };
}

export async function loadCachedSession(
  rootId: string,
  sessionKey: string,
): Promise<Session | null> {
  try {
    const record = await withSessionStore("readonly", (store) =>
      sessionRequestToPromise(
        store.get(buildSessionCacheKey(rootId, sessionKey)) as IDBRequest<
          CachedSessionRecord | undefined
        >,
      ),
    );
    return record?.session || null;
  } catch {
    return null;
  }
}

export async function saveCachedSession(
  rootId: string,
  session: Session | null | undefined,
): Promise<void> {
  if (!rootId || !session?.key) {
    return;
  }
  const persistentSession = toPersistentSession(session);
  const record: CachedSessionRecord = {
    cacheKey: buildSessionCacheKey(rootId, session.key),
    rootId,
    sessionKey: session.key,
    touchedAt: Date.now(),
    session: persistentSession,
  };
  try {
    await withSessionStore("readwrite", (store) =>
      sessionRequestToPromise(store.put(record)),
    );
  } catch {}
}

export async function deleteCachedSession(
  rootId: string,
  sessionKey: string,
): Promise<void> {
  try {
    await withSessionStore("readwrite", (store) =>
      sessionRequestToPromise(
        store.delete(buildSessionCacheKey(rootId, sessionKey)),
      ),
    );
  } catch {}
}

export async function clearCachedSessionsForRoot(rootId: string): Promise<void> {
  if (!rootId) {
    return;
  }
  try {
    await withSessionStore("readwrite", async (store) => {
      const entries =
        (await sessionRequestToPromise(
          store.getAll() as IDBRequest<CachedSessionRecord[]>,
        )) || [];
      await Promise.all(
        entries
          .filter((record) => record.rootId === rootId)
          .map((record) => sessionRequestToPromise(store.delete(record.cacheKey))),
      );
    });
    await withSessionListStore("readwrite", (store) =>
      sessionRequestToPromise(store.delete(buildSessionListCacheKey(rootId))),
    );
  } catch {}
}

export function cloneSession(session: Session): Session {
  return {
    ...session,
    exchanges: Array.isArray(session.exchanges) ? [...session.exchanges] : [],
    exchange_aux: cloneExchangeAux(session.exchange_aux),
  };
}

export function toPersistentSession(session: Session): Session {
  return {
    ...session,
    exchanges: Array.isArray(session.exchanges)
      ? session.exchanges.filter((exchange) => {
          const seq = Number((exchange as any)?.seq || 0);
          return Number.isFinite(seq) && seq > 0;
        })
      : [],
    exchange_aux: toPersistentExchangeAux(session.exchange_aux),
  };
}

export async function getCachedSession(
  rootId: string,
  sessionKey: string,
): Promise<Session | null> {
  const cached = await loadCachedSession(rootId, sessionKey);
  return cached ? cloneSession(cached) : null;
}
