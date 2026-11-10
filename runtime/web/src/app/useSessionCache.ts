import React, { useCallback, useEffect } from "react";
import { type MessageKey, type MessageParams } from "../i18n";
import { mergeActivityFacts, mergeToolStatus } from "../services/activityFacts";
import { promoteComposerDraft } from "../services/composerDrafts";
import { reportError } from "../services/error";
import {
  sessionService,
  syncSession,
  type RelatedFile,
  type RelatedWorktree,
  type Session,
  type SyncSessionResult,
} from "../services/session";
import {
  Exchange,
  normalizeFastService,
  OpenSessionTab,
  PendingSend,
  SessionItem,
  toSessionItem,
} from "./sessionModel";

type Options = {
  rootSessionKey: (rootId: string, sessionKey: string) => string;
  sessionCacheRef: React.RefObject<Record<string, Session>>;
  drawerSessionByRootRef: React.RefObject<Record<string, SessionItem | null>>;
  cacheVersion: number;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionItem | null>>;
  pendingBySessionRef: React.RefObject<Record<string, PendingSend>>;
  selectedSessionRef: React.RefObject<SessionItem | null>;
  currentRootIdRef: React.RefObject<string | null>;
  setDrawerSessionForRoot: (
    rootID: string | null | undefined,
    session: Session | SessionItem | null,
  ) => void;
  setSessions: React.Dispatch<React.SetStateAction<SessionItem[]>>;
  setMultiProjectSessionPending: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
    pending: boolean,
  ) => void;
  bumpCacheVersion: () => void;
  staleSessionKeysRef: React.RefObject<Set<string>>;
  loadingSessionRef: React.RefObject<
    Partial<Record<string, Promise<SyncSessionResult>>>
  >;
  lastMainSessionSnapshotRef: React.RefObject<Session | null>;
  sessions: SessionItem[];
  currentSessionRef: React.RefObject<SessionItem | null>;
  t: (key: MessageKey, params?: MessageParams) => string;
  setPendingPlanMode: React.Dispatch<React.SetStateAction<boolean>>;
  loadedSessionRef: React.RefObject<Record<string, boolean>>;
  boundSessionByRootRef: React.RefObject<Record<string, string | null>>;
  setBoundSessionForRoot: (
    rootID: string | null | undefined,
    key: string | null,
  ) => void;
  selectedSessionByRootRef: React.RefObject<Record<string, string | null>>;
  setOpenSessionTabsByRoot: React.Dispatch<
    React.SetStateAction<Record<string, OpenSessionTab[]>>
  >;
};

export function useSessionCache({
  rootSessionKey,
  sessionCacheRef,
  drawerSessionByRootRef,
  cacheVersion,
  setSelectedSession,
  pendingBySessionRef,
  selectedSessionRef,
  currentRootIdRef,
  setDrawerSessionForRoot,
  setSessions,
  setMultiProjectSessionPending,
  bumpCacheVersion,
  staleSessionKeysRef,
  loadingSessionRef,
  lastMainSessionSnapshotRef,
  sessions,
  currentSessionRef,
  t,
  setPendingPlanMode,
  loadedSessionRef,
  boundSessionByRootRef,
  setBoundSessionForRoot,
  selectedSessionByRootRef,
  setOpenSessionTabsByRoot,
}: Options) {
  const getSessionSnapshot = useCallback(
    (
      rootId: string | null | undefined,
      session: Session | SessionItem | null | undefined,
    ) => {
      if (!rootId || !session) return null;
      const key = (session as any).key || (session as any).session_key;
      if (!key) return null;
      const ck = rootSessionKey(rootId, key);
      const cached = sessionCacheRef.current[ck];
      const drawerSession = drawerSessionByRootRef.current[rootId];
      const fallbackExchanges = Array.isArray((session as any).exchanges)
        ? ((session as any).exchanges as Exchange[])
        : [];
      const exchanges = Array.isArray((cached as any)?.exchanges)
        ? ((cached as any).exchanges as Exchange[]) || []
        : fallbackExchanges;
      const pending =
        drawerSession?.key === key
          ? !!(drawerSession as any)?.pending
          : typeof (session as any)?.pending === "boolean"
            ? !!(session as any).pending
            : typeof (cached as any)?.pending === "boolean"
              ? !!(cached as any).pending
              : undefined;
      return {
        ...(session as any),
        ...(cached as any),
        ...(drawerSession?.key === key ? (drawerSession as any) : null),
        key,
        search_seq: (session as any).search_seq,
        search_target_id: (session as any).search_target_id,
        search_snippet: (session as any).search_snippet,
        search_match_type: (session as any).search_match_type,
        exchanges,
        pending,
      } as any;
    },
    [rootSessionKey, cacheVersion],
  );

  const setSelectedPendingByKey = useCallback(
    (sessionKey: string, pending: boolean) => {
      setSelectedSession((prev) => {
        const prevKey = prev?.key || prev?.session_key;
        if (!prev || prevKey !== sessionKey) return prev;
        return { ...(prev as any), pending } as SessionItem;
      });
    },
    [],
  );

  const resolvePendingForSession = useCallback(
    (
      rootID: string | null | undefined,
      sessionKey: string | null | undefined,
      fallback?: boolean,
    ): boolean => {
      const resolvedRoot = String(rootID || "");
      const resolvedKey = String(sessionKey || "");
      if (!resolvedRoot || !resolvedKey) {
        return !!fallback;
      }
      const cacheKey = rootSessionKey(resolvedRoot, resolvedKey);
      if (pendingBySessionRef.current[cacheKey]) {
        return true;
      }
      const drawer = drawerSessionByRootRef.current[resolvedRoot] as
        | ({ pending?: boolean; key?: string; session_key?: string } & Record<
            string,
            unknown
          >)
        | null
        | undefined;
      if (
        drawer &&
        (drawer.key || drawer.session_key) === resolvedKey &&
        typeof drawer.pending === "boolean"
      ) {
        return drawer.pending;
      }
      const selected = selectedSessionRef.current as
        | ({
            pending?: boolean;
            key?: string;
            session_key?: string;
            root_id?: string;
          } & Record<string, unknown>)
        | null
        | undefined;
      if (
        selected &&
        ((selected.root_id as string | undefined) ||
          currentRootIdRef.current) === resolvedRoot &&
        (selected.key || selected.session_key) === resolvedKey &&
        typeof selected.pending === "boolean"
      ) {
        return selected.pending;
      }
      const cached = sessionCacheRef.current[cacheKey] as
        | ({ pending?: boolean } & Record<string, unknown>)
        | null
        | undefined;
      if (cached && typeof cached.pending === "boolean") {
        return cached.pending;
      }
      return !!fallback;
    },
    [rootSessionKey],
  );

  const clearLocalPendingForSession = useCallback(
    (
      rootID: string | null | undefined,
      sessionKey: string | null | undefined,
    ) => {
      const resolvedRoot = String(rootID || "");
      const resolvedKey = String(sessionKey || "");
      if (!resolvedRoot || !resolvedKey) {
        return;
      }
      const clearPendingAck = <T>(session: T): T => {
        const exchanges = (session as any)?.exchanges;
        if (!Array.isArray(exchanges)) {
          return session;
        }
        return {
          ...(session as any),
          exchanges: exchanges.map((exchange: any) =>
            exchange?.pending_ack === true
              ? { ...exchange, pending_ack: false }
              : exchange,
          ),
        } as T;
      };
      const cacheKey = rootSessionKey(resolvedRoot, resolvedKey);
      delete pendingBySessionRef.current[cacheKey];
      const cached = sessionCacheRef.current[cacheKey];
      if (
        cached &&
        (cached.key || (cached as any).session_key) === resolvedKey
      ) {
        sessionCacheRef.current[cacheKey] = clearPendingAck({
          ...(cached as any),
          pending: false,
        } as Session);
      }
      setSelectedSession((prev) => {
        const prevKey = prev?.key || prev?.session_key;
        const prevRoot =
          (prev?.root_id as string | undefined) || currentRootIdRef.current;
        if (!prev || prevKey !== resolvedKey || prevRoot !== resolvedRoot) {
          return prev;
        }
        return clearPendingAck({
          ...(prev as any),
          pending: false,
        } as SessionItem);
      });
      const drawer = drawerSessionByRootRef.current[resolvedRoot];
      if (
        drawer &&
        (drawer.key || (drawer as any).session_key) === resolvedKey
      ) {
        setDrawerSessionForRoot(
          resolvedRoot,
          clearPendingAck({
            ...(drawer as any),
            pending: false,
          } as Session),
        );
      }
      if (currentRootIdRef.current === resolvedRoot) {
        setSessions((prev) =>
          prev.map((item) => {
            const itemKey = item.key || item.session_key;
            if (itemKey !== resolvedKey) {
              return item;
            }
            return clearPendingAck({
              ...(item as any),
              pending: false,
            } as SessionItem);
          }),
        );
      }
      setMultiProjectSessionPending(resolvedRoot, resolvedKey, false);
      bumpCacheVersion();
    },
    [
      bumpCacheVersion,
      rootSessionKey,
      setDrawerSessionForRoot,
      setMultiProjectSessionPending,
    ],
  );

  const markSessionStale = useCallback(
    (
      rootID: string | null | undefined,
      sessionKey: string | null | undefined,
    ) => {
      const resolvedRoot = String(rootID || "");
      const resolvedKey = String(sessionKey || "");
      if (!resolvedRoot || !resolvedKey || resolvedKey.startsWith("pending-")) {
        return;
      }
      staleSessionKeysRef.current.add(
        rootSessionKey(resolvedRoot, resolvedKey),
      );
    },
    [rootSessionKey],
  );

  const clearSessionStale = useCallback(
    (
      rootID: string | null | undefined,
      sessionKey: string | null | undefined,
    ) => {
      const resolvedRoot = String(rootID || "");
      const resolvedKey = String(sessionKey || "");
      if (!resolvedRoot || !resolvedKey) {
        return;
      }
      staleSessionKeysRef.current.delete(
        rootSessionKey(resolvedRoot, resolvedKey),
      );
    },
    [rootSessionKey],
  );

  const isSessionStale = useCallback(
    (
      rootID: string | null | undefined,
      sessionKey: string | null | undefined,
    ): boolean => {
      const resolvedRoot = String(rootID || "");
      const resolvedKey = String(sessionKey || "");
      if (!resolvedRoot || !resolvedKey) {
        return false;
      }
      return staleSessionKeysRef.current.has(
        rootSessionKey(resolvedRoot, resolvedKey),
      );
    },
    [rootSessionKey],
  );

  const restoreActiveSession = useCallback(
    async (
      rootID: string | null | undefined,
      sessionKey: string | null | undefined,
      canApply: () => boolean = () => true,
    ): Promise<Session | null> => {
      const resolvedRoot = String(rootID || "");
      const resolvedKey = String(sessionKey || "");
      if (!resolvedRoot || !resolvedKey || resolvedKey.startsWith("pending-")) {
        return null;
      }
      const cacheKey = rootSessionKey(resolvedRoot, resolvedKey);
      const cachedBeforeSync = sessionCacheRef.current[cacheKey];
      const resumeCursor = sessionService.getEventCursor(
        resolvedRoot,
        resolvedKey,
      );
      const inflight = loadingSessionRef.current[cacheKey];
      const request =
        inflight ||
        syncSession(resolvedRoot, resolvedKey).finally(() => {
          delete loadingSessionRef.current[cacheKey];
        });
      if (!inflight) {
        loadingSessionRef.current[cacheKey] = request;
      }
      const syncResult = await request;
      if (!canApply()) return null;
      let fullSession = syncResult?.session;
      if (!fullSession) {
        return null;
      }
      if (resumeCursor) {
        const incomingExchanges = Array.isArray((fullSession as any).exchanges)
          ? ((fullSession as any).exchanges as Exchange[])
          : [];
        const hasPendingTurn = incomingExchanges.some(
          (exchange) => Number((exchange as any)?.seq || 0) === 0,
        );
        const localTransient = Array.isArray(
          (cachedBeforeSync as any)?.exchanges,
        )
          ? ((cachedBeforeSync as any).exchanges as Exchange[]).filter(
              (exchange) => Number((exchange as any)?.seq || 0) === 0,
            )
          : [];
        if (hasPendingTurn && localTransient.length > 0) {
          fullSession = {
            ...(fullSession as any),
            exchanges: [
              ...incomingExchanges.filter(
                (exchange) => Number((exchange as any)?.seq || 0) > 0,
              ),
              ...localTransient,
            ],
          } as Session;
        } else {
          sessionService.clearEventCursor(resolvedRoot, resolvedKey);
        }
      }
      const serverPending =
        typeof (fullSession as any)?.pending === "boolean"
          ? !!(fullSession as any).pending
          : undefined;
      if (serverPending === false) {
        clearLocalPendingForSession(resolvedRoot, resolvedKey);
      }
      const pending =
        serverPending === false
          ? false
          : resolvePendingForSession(
              resolvedRoot,
              resolvedKey,
              !!serverPending,
            );
      sessionCacheRef.current[cacheKey] = {
        ...(fullSession as any),
        key: resolvedKey,
        pending,
      } as Session;
      bumpCacheVersion();
      await sessionService.markSessionReady(resolvedRoot, resolvedKey);
      return {
        ...(fullSession as any),
        key: resolvedKey,
        pending,
      } as Session;
    },
    [
      bumpCacheVersion,
      clearLocalPendingForSession,
      resolvePendingForSession,
      rootSessionKey,
    ],
  );

  const updateSessionRelatedFilesForKey = useCallback(
    (rootID: string, sessionKey: string, relatedFiles: RelatedFile[]) => {
      if (!rootID || !sessionKey) return;
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const cached = sessionCacheRef.current[cacheKey];
      const nextRelatedFiles = Array.isArray(relatedFiles)
        ? [...relatedFiles]
        : [];
      if (cached) {
        sessionCacheRef.current[cacheKey] = {
          ...(cached as any),
          related_files: nextRelatedFiles,
        } as Session;
      }
      const lastMain = lastMainSessionSnapshotRef.current;
      const lastMainKey = lastMain?.key || lastMain?.session_key;
      const lastMainRoot =
        (lastMain?.root_id as string | undefined) || currentRootIdRef.current;
      if (lastMain && lastMainKey === sessionKey && lastMainRoot === rootID) {
        lastMainSessionSnapshotRef.current = {
          ...(lastMain as any),
          related_files: nextRelatedFiles,
        } as Session;
      }
      setSelectedSession((prev) => {
        const prevKey = prev?.key || prev?.session_key;
        const prevRoot =
          (prev?.root_id as string | undefined) || currentRootIdRef.current;
        if (!prev || prevKey !== sessionKey || prevRoot !== rootID) return prev;
        return {
          ...(prev as any),
          related_files: nextRelatedFiles,
        } as SessionItem;
      });
      const current = drawerSessionByRootRef.current[rootID];
      if (current && current.key === sessionKey) {
        setDrawerSessionForRoot(rootID, {
          ...(current as any),
          related_files: nextRelatedFiles,
        } as Session);
      }
      bumpCacheVersion();
    },
    [rootSessionKey, setDrawerSessionForRoot, bumpCacheVersion],
  );

  const updateSessionRelatedWorktreeForKey = useCallback(
    (
      rootID: string,
      sessionKey: string,
      relatedWorktree: RelatedWorktree | null | undefined,
    ) => {
      if (!rootID || !sessionKey || !relatedWorktree) return;
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const cached = sessionCacheRef.current[cacheKey];
      if (cached) {
        sessionCacheRef.current[cacheKey] = {
          ...(cached as any),
          related_worktree: relatedWorktree,
        } as Session;
      }

      const lastMain = lastMainSessionSnapshotRef.current;
      const lastMainKey = lastMain?.key || lastMain?.session_key;
      const lastMainRoot =
        (lastMain?.root_id as string | undefined) || currentRootIdRef.current;
      if (lastMain && lastMainKey === sessionKey && lastMainRoot === rootID) {
        lastMainSessionSnapshotRef.current = {
          ...(lastMain as any),
          related_worktree: relatedWorktree,
        } as Session;
      }

      setSelectedSession((prev) => {
        const prevKey = prev?.key || prev?.session_key;
        const prevRoot =
          (prev?.root_id as string | undefined) || currentRootIdRef.current;
        if (!prev || prevKey !== sessionKey || prevRoot !== rootID) return prev;
        return {
          ...(prev as any),
          related_worktree: relatedWorktree,
        } as SessionItem;
      });

      const current = drawerSessionByRootRef.current[rootID];
      if (current && current.key === sessionKey) {
        setDrawerSessionForRoot(rootID, {
          ...(current as any),
          related_worktree: relatedWorktree,
        } as Session);
      }
      bumpCacheVersion();
    },
    [rootSessionKey, setDrawerSessionForRoot, bumpCacheVersion],
  );

  const updateSessionAgentForKey = useCallback(
    (
      rootID: string,
      sessionKey: string,
      agent: string,
      model?: string,
      agentMode?: string,
      effort?: string,
      fastService?: "" | "on" | "off",
      planMode?: boolean,
      shell?: string,
    ) => {
      if (!rootID || !sessionKey || !agent) return;
      const hasPlanMode = typeof planMode === "boolean";
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const cached = sessionCacheRef.current[cacheKey];
      if (cached) {
        sessionCacheRef.current[cacheKey] = {
          ...(cached as any),
          agent,
          model: model || "",
          mode: agentMode || "",
          effort: effort || "",
          fast_service: fastService || "",
          ...(hasPlanMode ? { plan_mode: planMode } : {}),
          updated_at: new Date().toISOString(),
        } as Session;
      }
      setSelectedSession((prev) => {
        const prevKey = prev?.key || prev?.session_key;
        const prevRoot =
          (prev?.root_id as string | undefined) || currentRootIdRef.current;
        if (!prev || prevKey !== sessionKey || prevRoot !== rootID) return prev;
        return {
          ...(prev as any),
          agent,
          model: model || "",
          mode: agentMode || "",
          effort: effort || "",
          fast_service: fastService || "",
          ...(hasPlanMode ? { plan_mode: planMode } : {}),
        } as SessionItem;
      });
      const current = drawerSessionByRootRef.current[rootID];
      if (
        current &&
        current.key === sessionKey &&
        (current.agent !== agent ||
          (current as any).model !== (model || "") ||
          (current as any).mode !== (agentMode || "") ||
          (current as any).effort !== (effort || "") ||
          ((current as any).fast_service || "") !== (fastService || "") ||
          (hasPlanMode && !!(current as any).plan_mode !== planMode))
      ) {
        setDrawerSessionForRoot(rootID, {
          ...(current as any),
          agent,
          model: model || "",
          mode: agentMode || "",
          effort: effort || "",
          fast_service: fastService || "",
          ...(hasPlanMode ? { plan_mode: planMode } : {}),
        } as Session);
      }
      bumpCacheVersion();
    },
    [rootSessionKey, setDrawerSessionForRoot, bumpCacheVersion],
  );

  const syncSessionHeaderFromListItem = useCallback(
    (rootID: string, item: SessionItem | null | undefined) => {
      const sessionKey = item?.key || item?.session_key || "";
      const sessionName = typeof item?.name === "string" ? item.name : "";
      if (!rootID || !sessionKey || !sessionName) return;

      const cacheKey = rootSessionKey(rootID, sessionKey);
      const cached = sessionCacheRef.current[cacheKey];
      let changed = false;
      if (cached && cached.name !== sessionName) {
        sessionCacheRef.current[cacheKey] = {
          ...(cached as any),
          name: sessionName,
          updated_at: item?.updated_at || cached.updated_at,
        } as Session;
        changed = true;
      }

      setSelectedSession((prev) => {
        const prevKey = prev?.key || prev?.session_key;
        const prevRoot =
          (prev?.root_id as string | undefined) || currentRootIdRef.current;
        if (!prev || prevKey !== sessionKey || prevRoot !== rootID) return prev;
        if (prev.name === sessionName) return prev;
        return {
          ...(prev as any),
          name: sessionName,
          updated_at: item?.updated_at || prev.updated_at,
        } as SessionItem;
      });

      const drawer = drawerSessionByRootRef.current[rootID];
      if (drawer?.key === sessionKey && drawer.name !== sessionName) {
        setDrawerSessionForRoot(rootID, {
          ...(drawer as any),
          name: sessionName,
          updated_at: item?.updated_at || drawer.updated_at,
        } as Session);
        changed = true;
      }

      if (changed) {
        bumpCacheVersion();
      }
    },
    [rootSessionKey, setDrawerSessionForRoot, bumpCacheVersion],
  );

  useEffect(() => {
    const rootID = currentRootIdRef.current;
    if (!rootID || sessions.length === 0) return;
    for (const item of sessions) {
      syncSessionHeaderFromListItem(rootID, item);
    }
  }, [sessions, syncSessionHeaderFromListItem]);

  const handleSetPlanMode = useCallback(
    async (
      enabled: boolean,
      targetSessionKey?: string,
      targetRootId?: string,
    ) => {
      const activeRoot = targetRootId || currentRootIdRef.current;
      const session =
        currentSessionRef.current ||
        drawerSessionByRootRef.current[activeRoot || ""];
      const sessionKey =
        targetSessionKey || session?.key || (session as any)?.session_key;
      if (!activeRoot) {
        reportError("session.sync_failed", t("session.planModeSelectFirst"));
        return;
      }
      if (!sessionKey || String(sessionKey).startsWith("pending-")) {
        setPendingPlanMode(enabled);
        return;
      }
      const now = new Date().toISOString();
      const cacheKey = rootSessionKey(activeRoot, sessionKey);
      const cached = sessionCacheRef.current[cacheKey];
      if (cached) {
        sessionCacheRef.current[cacheKey] = {
          ...(cached as any),
          plan_mode: enabled,
          updated_at: now,
        } as Session;
      }
      setSelectedSession((prev) => {
        const prevKey = prev?.key || prev?.session_key;
        const prevRoot = (prev?.root_id as string | undefined) || activeRoot;
        if (!prev || prevKey !== sessionKey || prevRoot !== activeRoot)
          return prev;
        return {
          ...(prev as any),
          plan_mode: enabled,
          updated_at: now,
        } as SessionItem;
      });
      const drawer = drawerSessionByRootRef.current[activeRoot];
      if (drawer?.key === sessionKey) {
        setDrawerSessionForRoot(activeRoot, {
          ...(drawer as any),
          plan_mode: enabled,
          updated_at: now,
        } as Session);
      }
      bumpCacheVersion();
      const sent = await sessionService.setPlanMode(
        activeRoot,
        sessionKey,
        enabled,
      );
      if (!sent) {
        reportError(
          "network.disconnected",
          t("session.planModeSwitchFailedNotReady"),
        );
      }
    },
    [rootSessionKey, setDrawerSessionForRoot, bumpCacheVersion, t],
  );

  const promotePendingSessionForRoot = useCallback(
    (
      rootID: string,
      tempKey: string | undefined,
      sessionKey: string,
      fallback?: Session | null,
    ) => {
      const pendingKey = (tempKey || "").trim();
      if (!rootID || !pendingKey || !sessionKey || pendingKey === sessionKey) {
        return;
      }

      const pendingCacheKey = rootSessionKey(rootID, pendingKey);
      promoteComposerDraft(rootID, pendingKey, sessionKey);
      const realCacheKey = rootSessionKey(rootID, sessionKey);
      const pendingCached = sessionCacheRef.current[pendingCacheKey];
      const realCached = sessionCacheRef.current[realCacheKey];
      const drawer = drawerSessionByRootRef.current[rootID];
      const selected = selectedSessionRef.current;
      const selectedKey = selected?.key || selected?.session_key;
      const selectedRoot =
        (selected?.root_id as string | undefined) || currentRootIdRef.current;
      const pendingName =
        (typeof (pendingCached as any)?.name === "string" &&
        (pendingCached as any).name
          ? (pendingCached as any).name
          : "") ||
        (drawer?.key === pendingKey && typeof (drawer as any)?.name === "string"
          ? ((drawer as any).name as string)
          : "") ||
        (selectedKey === pendingKey &&
        selectedRoot === rootID &&
        typeof selected?.name === "string"
          ? selected.name
          : "") ||
        t("session.new");
      const realExchanges = Array.isArray((realCached as any)?.exchanges)
        ? ((realCached as any).exchanges as Exchange[])
        : [];
      const pendingExchanges = Array.isArray((pendingCached as any)?.exchanges)
        ? ((pendingCached as any).exchanges as Exchange[])
        : [];
      const latestReal =
        pendingCached && realCached
          ? ({
              ...(pendingCached as any),
              ...(realCached as any),
              exchanges:
                realExchanges.length > 0 ? realExchanges : pendingExchanges,
            } as Session)
          : realCached || pendingCached || fallback || drawer;
      let cacheChanged = false;

      if (pendingCached) {
        sessionCacheRef.current[realCacheKey] = {
          ...(latestReal as any),
          key: sessionKey,
          name:
            (typeof (realCached as any)?.name === "string" &&
            (realCached as any).name
              ? (realCached as any).name
              : "") || pendingName,
        } as Session;
        delete sessionCacheRef.current[pendingCacheKey];
        delete loadedSessionRef.current[pendingCacheKey];
        delete loadingSessionRef.current[pendingCacheKey];
        cacheChanged = true;
      }

      if (boundSessionByRootRef.current[rootID] === pendingKey) {
        setBoundSessionForRoot(rootID, sessionKey);
      }
      if (selectedSessionByRootRef.current[rootID] === pendingKey) {
        selectedSessionByRootRef.current[rootID] = sessionKey;
      }
      setOpenSessionTabsByRoot((prev) => {
        const current = prev[rootID] || [];
        if (
          !current.some((item) => (item.key || item.session_key) === pendingKey)
        ) {
          return prev;
        }
        const seen = new Set<string>();
        const promoted = current
          .map((item) => {
            const itemKey = item.key || item.session_key;
            if (itemKey !== pendingKey) return item;
            return {
              ...item,
              key: sessionKey,
              session_key: sessionKey,
              root_id: rootID,
              name:
                (typeof (latestReal as any)?.name === "string" &&
                (latestReal as any).name
                  ? (latestReal as any).name
                  : "") || pendingName,
              title:
                typeof (latestReal as any)?.title === "string"
                  ? (latestReal as any).title
                  : item.title,
              agent:
                typeof (latestReal as any)?.agent === "string"
                  ? (latestReal as any).agent
                  : item.agent,
              type: (latestReal as any)?.type || item.type,
              pending: true,
            } as OpenSessionTab;
          })
          .filter((item) => {
            const itemKey = item.key || item.session_key;
            if (!itemKey || seen.has(itemKey)) return false;
            seen.add(itemKey);
            return true;
          });
        return { ...prev, [rootID]: promoted };
      });
      if (drawer?.key === pendingKey) {
        setDrawerSessionForRoot(rootID, {
          ...(drawer as any),
          ...(latestReal as any),
          key: sessionKey,
          name:
            (typeof (latestReal as any)?.name === "string" &&
            (latestReal as any).name
              ? (latestReal as any).name
              : "") || pendingName,
        } as Session);
      }
      if (currentRootIdRef.current === rootID) {
        setSessions((prev) =>
          prev.map((item) => {
            const itemKey = item.key || item.session_key;
            if (itemKey !== pendingKey) {
              return item;
            }
            return {
              ...(item as any),
              ...(latestReal as any),
              key: sessionKey,
              session_key: sessionKey,
              root_id: rootID,
              name:
                (typeof (latestReal as any)?.name === "string" &&
                (latestReal as any).name
                  ? (latestReal as any).name
                  : "") || pendingName,
              pending: true,
            } as SessionItem;
          }),
        );
      }

      setSelectedSession((prev) => {
        const prevKey = prev?.key || prev?.session_key;
        const prevRoot =
          (prev?.root_id as string | undefined) || currentRootIdRef.current;
        if (!prev || prevKey !== pendingKey || prevRoot !== rootID) return prev;
        return toSessionItem(rootID, {
          ...(prev as any),
          ...(latestReal as any),
          key: sessionKey,
          session_key: sessionKey,
          root_id: rootID,
          name:
            (typeof (latestReal as any)?.name === "string" &&
            (latestReal as any).name
              ? (latestReal as any).name
              : "") || pendingName,
        });
      });

      if (cacheChanged) {
        bumpCacheVersion();
      }
    },
    [
      rootSessionKey,
      setBoundSessionForRoot,
      setDrawerSessionForRoot,
      bumpCacheVersion,
    ],
  );

  const resolveRuntimeMetaForSession = useCallback(
    (
      rootID: string,
      sessionKey: string,
      fallback?: {
        agent?: string;
        model?: string;
        mode?: string;
        effort?: string;
        fast_service?: "" | "on" | "off";
      },
    ) => {
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const cachedSession = sessionCacheRef.current[cacheKey] as any;
      const exchanges = Array.isArray(cachedSession?.exchanges)
        ? ((cachedSession.exchanges || []) as Exchange[])
        : [];
      const latestMatchingExchange = [...exchanges]
        .reverse()
        .find(
          (item) =>
            item?.agent ||
            item?.model ||
            item?.mode ||
            item?.effort ||
            item?.fast_service,
        );
      const candidates = [
        fallback,
        latestMatchingExchange as any,
        sessionCacheRef.current[cacheKey] as any,
        currentSessionRef.current?.key === sessionKey
          ? (currentSessionRef.current as any)
          : null,
        (selectedSessionRef.current?.key ||
          selectedSessionRef.current?.session_key) === sessionKey
          ? (selectedSessionRef.current as any)
          : null,
      ];

      const pickText = (field: "agent" | "model" | "mode" | "effort") => {
        for (const item of candidates) {
          const value = `${item?.[field] || ""}`.trim();
          if (value) return value;
        }
        return "";
      };
      const pickFastService = (): "" | "on" | "off" => {
        for (const item of candidates) {
          const value = normalizeFastService(item?.fast_service);
          if (value) return value;
        }
        return "";
      };
      return {
        agent: pickText("agent"),
        model: pickText("model"),
        mode: pickText("mode"),
        effort: pickText("effort"),
        fast_service: pickFastService(),
      };
    },
    [rootSessionKey],
  );

  const appendAgentChunkForSession = useCallback(
    (
      rootID: string,
      sessionKey: string,
      content: string,
      runtimeHint?: {
        agent?: string;
        model?: string;
        mode?: string;
        effort?: string;
        fast_service?: "" | "on" | "off";
      },
    ) => {
      if (!content) return;
      const now = new Date().toISOString();
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const runtimeMeta = resolveRuntimeMetaForSession(
        rootID,
        sessionKey,
        runtimeHint,
      );
      const updateList = (prevList: Exchange[]) => {
        const list = [...(prevList || [])];
        const last = list.length > 0 ? list[list.length - 1] : null;
        if (last && (last.role === "agent" || last.role === "assistant")) {
          list[list.length - 1] = {
            ...last,
            agent: runtimeMeta.agent || last.agent,
            model: runtimeMeta.model || last.model,
            mode: runtimeMeta.mode || last.mode,
            effort: runtimeMeta.effort || last.effort,
            fast_service: runtimeMeta.fast_service || last.fast_service,
            content: `${last.content || ""}${content}`,
            timestamp: now,
          };
          return list;
        }
        list.push({
          role: "agent",
          agent: runtimeMeta.agent,
          model: runtimeMeta.model,
          mode: runtimeMeta.mode,
          effort: runtimeMeta.effort,
          fast_service: runtimeMeta.fast_service,
          content,
          timestamp: now,
        });
        return list;
      };
      const cached = sessionCacheRef.current[cacheKey];
      const base =
        cached ||
        ({
          key: sessionKey,
          type: "chat",
          agent: runtimeMeta.agent,
          model: runtimeMeta.model,
          mode: runtimeMeta.mode,
          effort: runtimeMeta.effort,
          fast_service: runtimeMeta.fast_service,
          name: "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          exchanges: [],
        } as any);
      const nextList = updateList(
        ((base as any).exchanges || []) as Exchange[],
      );
      sessionCacheRef.current[cacheKey] = {
        ...(base as any),
        agent: runtimeMeta.agent || (base as any).agent,
        model: runtimeMeta.model || (base as any).model,
        mode: runtimeMeta.mode || (base as any).mode,
        effort: runtimeMeta.effort || (base as any).effort,
        fast_service: runtimeMeta.fast_service || (base as any).fast_service,
        exchanges: nextList,
        updated_at: new Date().toISOString(),
      } as Session;
      bumpCacheVersion();
    },
    [rootSessionKey, resolveRuntimeMetaForSession, bumpCacheVersion],
  );

  const appendThoughtChunkForSession = useCallback(
    (
      rootID: string,
      sessionKey: string,
      content: string,
      thoughtID?: string,
    ) => {
      if (!content) return;
      const now = new Date().toISOString();
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const updateList = (prevList: Exchange[]) => {
        const list = [...(prevList || [])];
        if (thoughtID) {
          const existingIndex = list.findIndex(
            (item) => item.role === "thought" && item.thought_id === thoughtID,
          );
          if (existingIndex >= 0) {
            const existing = list[existingIndex];
            const existingContent = existing.content || "";
            let nextContent = existingContent;
            if (content.includes(existingContent)) {
              nextContent = content;
            } else if (!existingContent.includes(content)) {
              nextContent = `${existingContent}${content}`;
            }
            list[existingIndex] = {
              ...existing,
              content: nextContent,
              timestamp: now,
            };
            return list;
          }
        }
        const last = list.length > 0 ? list[list.length - 1] : null;
        if (
          last &&
          last.role === "thought" &&
          (!thoughtID || !last.thought_id)
        ) {
          list[list.length - 1] = {
            ...last,
            content: `${last.content || ""}${content}`,
            thought_id: thoughtID || last.thought_id,
            timestamp: now,
          };
          return list;
        }
        list.push({
          role: "thought",
          content,
          thought_id: thoughtID,
          timestamp: now,
        });
        return list;
      };
      const cached = sessionCacheRef.current[cacheKey];
      const base =
        cached ||
        ({
          key: sessionKey,
          type: "chat",
          agent: "",
          name: "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          exchanges: [],
        } as any);
      const nextList = updateList(
        ((base as any).exchanges || []) as Exchange[],
      );
      sessionCacheRef.current[cacheKey] = {
        ...(base as any),
        exchanges: nextList,
        updated_at: new Date().toISOString(),
      } as Session;
      bumpCacheVersion();
    },
    [rootSessionKey, bumpCacheVersion],
  );

  const appendToolCallForSession = useCallback(
    (rootID: string, sessionKey: string, toolCall: any, update: boolean) => {
      if (!toolCall) return;
      const now = new Date().toISOString();
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const mergeToolCall = (existing: any, incoming: any) => {
        const merged = { ...(existing || {}), ...incoming };
        merged.activity = mergeActivityFacts(
          existing?.activity,
          incoming?.activity,
        );
        const incomingMeta = (incoming?.meta || {}) as Record<string, unknown>;
        if (existing?.meta || incoming?.meta) {
          merged.meta = { ...(existing?.meta || {}), ...incomingMeta };
        }
        const isUserShellStream =
          incomingMeta.source === "userShell" &&
          incomingMeta.phase === "stream";
        if (isUserShellStream) {
          const mergedContent =
            incomingMeta.replaySnapshot === true
              ? [...((incoming?.content || []) as any[])]
              : [
                  ...((existing?.content || []) as any[]),
                  ...((incoming?.content || []) as any[]),
                ];
          const totalText = mergedContent
            .map((item) => item?.text || "")
            .join("");
          if (totalText.length > 256 * 1024) {
            merged.content = [
              { type: "text", text: totalText.slice(-256 * 1024) },
            ];
          } else {
            merged.content = mergedContent;
          }
          merged.meta = { ...(existing?.meta || {}), ...incomingMeta };
        }
        if (!incoming.kind && existing?.kind) merged.kind = existing.kind;
        if (!incoming.title && existing?.title) merged.title = existing.title;
        merged.status = mergeToolStatus(existing?.status, incoming?.status);
        return merged;
      };
      const updateList = (prevList: Exchange[]) => {
        const list = [...(prevList || [])];
        const callId =
          toolCall.callId || toolCall.toolCallId || toolCall.tool_call_id || "";
        if (callId) {
          for (let i = list.length - 1; i >= 0; i--) {
            if (
              list[i]?.role === "tool" &&
              (list[i]?.toolCall?.callId === callId ||
                list[i]?.toolCall?.toolCallId === callId ||
                list[i]?.toolCall?.tool_call_id === callId)
            ) {
              list[i] = {
                ...list[i],
                timestamp: now,
                toolCall: mergeToolCall(list[i].toolCall, toolCall),
              };
              return list;
            }
          }
        }
        list.push({ role: "tool", content: "", timestamp: now, toolCall });
        return list;
      };
      const cached = sessionCacheRef.current[cacheKey];
      const base =
        cached ||
        ({
          key: sessionKey,
          type: "chat",
          agent: "",
          name: "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          exchanges: [],
        } as any);
      const nextList = updateList(
        ((base as any).exchanges || []) as Exchange[],
      );
      sessionCacheRef.current[cacheKey] = {
        ...(base as any),
        exchanges: nextList,
        updated_at: new Date().toISOString(),
      } as Session;
      bumpCacheVersion();
    },
    [rootSessionKey, bumpCacheVersion],
  );

  const appendTodoUpdateForSession = useCallback(
    (rootID: string, sessionKey: string, todoUpdate: any) => {
      if (!todoUpdate) return;
      const now = new Date().toISOString();
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const updateList = (prevList: Exchange[]) => {
        const list = [...(prevList || [])];
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i]?.role !== "todo") continue;
          list[i] = {
            ...list[i],
            timestamp: now,
            todoUpdate,
          };
          return list;
        }
        list.push({ role: "todo", content: "", timestamp: now, todoUpdate });
        return list;
      };
      const cached = sessionCacheRef.current[cacheKey];
      const base =
        cached ||
        ({
          key: sessionKey,
          type: "chat",
          agent: "",
          name: "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          exchanges: [],
        } as any);
      const nextList = updateList(
        ((base as any).exchanges || []) as Exchange[],
      );
      sessionCacheRef.current[cacheKey] = {
        ...(base as any),
        exchanges: nextList,
        updated_at: new Date().toISOString(),
      } as Session;
      bumpCacheVersion();
    },
    [rootSessionKey, bumpCacheVersion],
  );

  const appendPlanUpdateForSession = useCallback(
    (rootID: string, sessionKey: string, planUpdate: any) => {
      if (!planUpdate) return;
      const content = `${planUpdate.content || ""}`;
      if (!content) return;
      const now = new Date().toISOString();
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const updateList = (prevList: Exchange[]) => {
        const list = [...(prevList || [])];
        const planId = `${planUpdate.id || ""}`;
        if (planId) {
          for (let i = list.length - 1; i >= 0; i -= 1) {
            if (list[i]?.role !== "plan") continue;
            if (`${list[i]?.planUpdate?.id || ""}` !== planId) continue;
            const existingContent = `${list[i].planUpdate?.content || ""}`;
            const nextContent = planUpdate.delta
              ? `${existingContent}${content}`
              : content;
            list[i] = {
              ...list[i],
              timestamp: now,
              planUpdate: {
                ...list[i].planUpdate,
                ...planUpdate,
                content: nextContent,
              },
            };
            return list;
          }
        }
        const last = list.length > 0 ? list[list.length - 1] : null;
        if (last?.role === "plan" && !planId) {
          const existingContent = `${last.planUpdate?.content || ""}`;
          list[list.length - 1] = {
            ...last,
            timestamp: now,
            planUpdate: {
              ...last.planUpdate,
              ...planUpdate,
              content: planUpdate.delta
                ? `${existingContent}${content}`
                : content,
            },
          };
          return list;
        }
        list.push({ role: "plan", content: "", timestamp: now, planUpdate });
        return list;
      };
      const cached = sessionCacheRef.current[cacheKey];
      const base =
        cached ||
        ({
          key: sessionKey,
          type: "chat",
          agent: "",
          name: "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          exchanges: [],
        } as any);
      sessionCacheRef.current[cacheKey] = {
        ...(base as any),
        exchanges: updateList(((base as any).exchanges || []) as Exchange[]),
        updated_at: new Date().toISOString(),
      } as Session;
      bumpCacheVersion();
    },
    [rootSessionKey, bumpCacheVersion],
  );

  const appendCompactNoticeForSession = useCallback(
    (rootID: string, sessionKey: string, compactNotice: any) => {
      if (!compactNotice) return;
      const now = new Date().toISOString();
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const updateList = (prevList: Exchange[]) => {
        const list = [...(prevList || [])];
        const compactId = `${compactNotice.id || ""}`;
        if (compactId) {
          for (let i = list.length - 1; i >= 0; i -= 1) {
            if (list[i]?.role !== "compact") continue;
            if (`${list[i]?.compactNotice?.id || ""}` !== compactId) continue;
            list[i] = {
              ...list[i],
              timestamp: now,
              compactNotice: { ...list[i].compactNotice, ...compactNotice },
            };
            return list;
          }
        }
        list.push({
          role: "compact",
          content: "",
          timestamp: now,
          compactNotice,
        });
        return list;
      };
      const cached = sessionCacheRef.current[cacheKey];
      const base =
        cached ||
        ({
          key: sessionKey,
          type: "chat",
          agent: "",
          name: "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          exchanges: [],
        } as any);
      sessionCacheRef.current[cacheKey] = {
        ...(base as any),
        exchanges: updateList(((base as any).exchanges || []) as Exchange[]),
        updated_at: new Date().toISOString(),
      } as Session;
      bumpCacheVersion();
    },
    [rootSessionKey, bumpCacheVersion],
  );

  const attachContextWindowToLatestAssistant = useCallback(
    (
      rootID: string,
      sessionKey: string,
      contextWindow?: { totalTokens?: number; modelContextWindow?: number },
    ) => {
      const totalTokens = Number(contextWindow?.totalTokens);
      const modelContextWindow = Number(contextWindow?.modelContextWindow);
      if (
        !Number.isFinite(totalTokens) ||
        totalTokens < 0 ||
        !Number.isFinite(modelContextWindow) ||
        modelContextWindow <= 0
      ) {
        return;
      }
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const stampList = (prevList: Exchange[]) => {
        const list = [...(prevList || [])];
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const item = list[i];
          if (item?.role === "user") break;
          if (
            (item?.role === "agent" || item?.role === "assistant") &&
            String(item?.content || "").trim()
          ) {
            list[i] = {
              ...item,
              context_window: {
                totalTokens,
                modelContextWindow,
              },
            };
            break;
          }
        }
        return list;
      };
      const cached = sessionCacheRef.current[cacheKey];
      if (cached) {
        const exchanges = stampList(
          ((cached as any).exchanges || []) as Exchange[],
        );
        sessionCacheRef.current[cacheKey] = {
          ...(cached as any),
          exchanges,
          context_window: {
            totalTokens,
            modelContextWindow,
          },
          updated_at: new Date().toISOString(),
        } as Session;
      }
      setSelectedSession((prev) => {
        const prevRoot =
          (prev?.root_id as string | undefined) || currentRootIdRef.current;
        if (
          !prev ||
          prevRoot !== rootID ||
          (prev.key || prev.session_key) !== sessionKey
        ) {
          return prev;
        }
        return {
          ...(prev as any),
          exchanges: stampList(((prev as any).exchanges || []) as Exchange[]),
          context_window: {
            totalTokens,
            modelContextWindow,
          },
        } as SessionItem;
      });
      const drawer = drawerSessionByRootRef.current[rootID];
      if (drawer && drawer.key === sessionKey) {
        setDrawerSessionForRoot(rootID, {
          ...(drawer as any),
          exchanges: stampList(((drawer as any).exchanges || []) as Exchange[]),
          context_window: {
            totalTokens,
            modelContextWindow,
          },
        } as Session);
      }
      bumpCacheVersion();
    },
    [bumpCacheVersion, rootSessionKey],
  );
  return {
    getSessionSnapshot,
    setSelectedPendingByKey,
    resolvePendingForSession,
    clearLocalPendingForSession,
    markSessionStale,
    clearSessionStale,
    isSessionStale,
    restoreActiveSession,
    updateSessionRelatedFilesForKey,
    updateSessionRelatedWorktreeForKey,
    updateSessionAgentForKey,
    handleSetPlanMode,
    promotePendingSessionForRoot,
    appendAgentChunkForSession,
    appendThoughtChunkForSession,
    appendToolCallForSession,
    appendTodoUpdateForSession,
    appendPlanUpdateForSession,
    appendCompactNoticeForSession,
    attachContextWindowToLatestAssistant,
  };
}

export type SessionCache = ReturnType<typeof useSessionCache>;
