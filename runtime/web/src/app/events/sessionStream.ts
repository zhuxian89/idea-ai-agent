import React from "react";
import { type MessageKey, type MessageParams } from "../../i18n";
import { applyAnsweredQuestion } from "../../services/answeredQuestion";
import { reportError } from "../../services/error";
import type { QueuedUserMessage } from "../../services/session";
import { type Session } from "../../services/session";
import { Exchange, PendingSend, SessionItem } from "../sessionModel";
import type { SessionCache } from "../useSessionCache";

type Options = {
  rootSessionKey: (rootId: string, sessionKey: string) => string;
  cancelRequestedBySessionRef: React.RefObject<Record<string, boolean>>;
  pendingBySessionRef: React.RefObject<Record<string, PendingSend>>;
  queuedMessagesBySessionRef: React.RefObject<
    Record<string, QueuedUserMessage[]>
  >;
  queueFrozenBySessionRef: React.RefObject<Record<string, boolean>>;
  optimisticDequeuedIdsRef: React.RefObject<Record<string, Set<string>>>;
  markSessionPending: (rootID: string, sessionKey: string) => void;
  sessionCacheRef: React.RefObject<Record<string, Session>>;
  setSelectedPendingByKey: (sessionKey: string, pending: boolean) => void;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionItem | null>>;
  currentRootIdRef: React.RefObject<string | null>;
  drawerSessionByRootRef: React.RefObject<Record<string, SessionItem | null>>;
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
  resolveRootForSessionKey: (sessionKey: string) => string | null;
  pendingDraftRef: React.RefObject<PendingSend | null>;
  suppressedAutoBindSessionByRootRef: React.RefObject<
    Record<string, string | null>
  >;
  boundSessionByRootRef: React.RefObject<Record<string, string | null>>;
  setBoundSessionForRoot: (
    rootID: string | null | undefined,
    key: string | null,
  ) => void;
  selectedSessionRef: React.RefObject<SessionItem | null>;
  t: (key: MessageKey, params?: MessageParams) => string;
  promotePendingSessionForRoot: (
    rootID: string,
    tempKey: string | undefined,
    sessionKey: string,
    fallback?: Session | null,
  ) => void;
  appendAgentChunkForSession: SessionCache["appendAgentChunkForSession"];
  appendThoughtChunkForSession: SessionCache["appendThoughtChunkForSession"];
  appendToolCallForSession: SessionCache["appendToolCallForSession"];
  appendTodoUpdateForSession: SessionCache["appendTodoUpdateForSession"];
  appendPlanUpdateForSession: SessionCache["appendPlanUpdateForSession"];
  appendCompactNoticeForSession: SessionCache["appendCompactNoticeForSession"];
  attachContextWindowToLatestAssistant: SessionCache["attachContextWindowToLatestAssistant"];
};

export function createSessionStreamHandlers({
  rootSessionKey,
  cancelRequestedBySessionRef,
  pendingBySessionRef,
  queuedMessagesBySessionRef,
  queueFrozenBySessionRef,
  optimisticDequeuedIdsRef,
  markSessionPending,
  sessionCacheRef,
  setSelectedPendingByKey,
  setSelectedSession,
  currentRootIdRef,
  drawerSessionByRootRef,
  setDrawerSessionForRoot,
  setSessions,
  setMultiProjectSessionPending,
  bumpCacheVersion,
  resolveRootForSessionKey,
  pendingDraftRef,
  suppressedAutoBindSessionByRootRef,
  boundSessionByRootRef,
  setBoundSessionForRoot,
  selectedSessionRef,
  t,
  promotePendingSessionForRoot,
  appendAgentChunkForSession,
  appendThoughtChunkForSession,
  appendToolCallForSession,
  appendTodoUpdateForSession,
  appendPlanUpdateForSession,
  appendCompactNoticeForSession,
  attachContextWindowToLatestAssistant,
}: Options) {
  const handleSessionStreamDone = (rootID: string, sessionKey: string) => {
    const cacheKey = rootSessionKey(rootID, sessionKey);
    const wasCanceled = !!cancelRequestedBySessionRef.current[cacheKey];
    if (wasCanceled) {
      delete cancelRequestedBySessionRef.current[cacheKey];
    }
    delete pendingBySessionRef.current[cacheKey];
    const clearPendingAck = <T>(session: T): T => {
      const exchanges = (session as any)?.exchanges;
      if (!wasCanceled || !Array.isArray(exchanges)) {
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
    const queued = queuedMessagesBySessionRef.current[cacheKey] || [];
    const queueFrozen = !!queueFrozenBySessionRef.current[cacheKey];
    const hiddenQueued = optimisticDequeuedIdsRef.current[cacheKey];
    const hasQueuedContinuation =
      (queued.length > 0 && !queueFrozen) ||
      !!(hiddenQueued && hiddenQueued.size > 0);
    if (hasQueuedContinuation && !wasCanceled) {
      markSessionPending(rootID, sessionKey);
      return;
    }
    const cached = sessionCacheRef.current[cacheKey];
    if (cached && cached.key === sessionKey) {
      sessionCacheRef.current[cacheKey] = clearPendingAck({
        ...(cached as any),
        pending: false,
      } as Session);
    }
    setSelectedPendingByKey(sessionKey, false);
    setSelectedSession((prev) => {
      const prevKey = prev?.key || prev?.session_key;
      const prevRoot =
        (prev?.root_id as string | undefined) || currentRootIdRef.current;
      if (
        !prev ||
        prevKey !== sessionKey ||
        prevRoot !== rootID ||
        !(prev as any).pending
      ) {
        return prev;
      }
      return clearPendingAck({
        ...(prev as any),
        pending: false,
      } as SessionItem);
    });
    const drawer = drawerSessionByRootRef.current[rootID];
    if (drawer && drawer.key === sessionKey) {
      const latest = wasCanceled
        ? sessionCacheRef.current[cacheKey] || drawer
        : drawer;
      setDrawerSessionForRoot(
        rootID,
        clearPendingAck({
          ...(latest as any),
          pending: false,
        } as Session),
      );
    }
    if (currentRootIdRef.current === rootID) {
      setSessions((prev) =>
        prev.map((item) => {
          const itemKey = item.key || item.session_key;
          if (itemKey !== sessionKey) {
            return item;
          }
          return clearPendingAck({
            ...(item as any),
            pending: false,
          } as SessionItem);
        }),
      );
    }
    setMultiProjectSessionPending(rootID, sessionKey, false);
    bumpCacheVersion();
  };

  const handleSessionStream = (payload: any) => {
    const streamKey =
      typeof payload?.session_key === "string" ? payload.session_key : "";
    const activeRoot =
      typeof payload?.root_id === "string" && payload.root_id
        ? payload.root_id
        : resolveRootForSessionKey(streamKey) || currentRootIdRef.current;
    if (!streamKey || !activeRoot) return;
    const ck = rootSessionKey(activeRoot, streamKey);
    if (payload.event?.type === "question_answered") {
      const cached = sessionCacheRef.current[ck];
      if (cached) {
        sessionCacheRef.current[ck] = applyAnsweredQuestion(
          cached,
          payload.event.data,
        );
        bumpCacheVersion();
      }
      const drawer = drawerSessionByRootRef.current[activeRoot];
      if (drawer && drawer.key === streamKey) {
        setDrawerSessionForRoot(
          activeRoot,
          applyAnsweredQuestion(drawer, payload.event.data),
        );
      }
      return;
    }
    let pending = pendingBySessionRef.current[ck];
    if (!pending) {
      const draft = pendingDraftRef.current;
      if (
        draft &&
        draft.rootId === activeRoot &&
        streamKey !==
          (suppressedAutoBindSessionByRootRef.current[activeRoot] || "")
      ) {
        pending = draft;
        pendingBySessionRef.current[ck] = draft;
        pendingDraftRef.current = null;
        console.info("[session/stream] attach_pending_draft", {
          rootId: activeRoot,
          streamKey,
          requestId: draft.requestId,
          tempKey: draft.tempKey || null,
        });
      }
    }
    const boundKey = boundSessionByRootRef.current[activeRoot] || "";
    const suppressedAutoBindKey =
      suppressedAutoBindSessionByRootRef.current[activeRoot] || "";
    if (
      streamKey !== suppressedAutoBindKey &&
      (!boundKey ||
        (typeof boundKey === "string" && boundKey.startsWith("pending-")))
    ) {
      if (suppressedAutoBindKey && streamKey !== suppressedAutoBindKey) {
        suppressedAutoBindSessionByRootRef.current[activeRoot] = null;
      }
      setBoundSessionForRoot(activeRoot, streamKey);
      if (pending) {
        const pendingName =
          (drawerSessionByRootRef.current[activeRoot]?.key ===
            pending.tempKey &&
          typeof (drawerSessionByRootRef.current[activeRoot] as any)?.name ===
            "string"
            ? ((drawerSessionByRootRef.current[activeRoot] as any)
                .name as string)
            : "") ||
          ((selectedSessionRef.current?.key ||
            selectedSessionRef.current?.session_key) === pending.tempKey &&
          ((selectedSessionRef.current?.root_id as string | undefined) ||
            currentRootIdRef.current) === activeRoot &&
          typeof selectedSessionRef.current?.name === "string"
            ? selectedSessionRef.current.name
            : "") ||
          t("session.new");
        const userEx = {
          role: "user",
          content: pending.message,
          timestamp: pending.timestamp,
          model: pending.model,
          mode: pending.agentMode,
          effort: pending.effort,
          fast_service: pending.fastService || "",
          shell: pending.shell || "",
        };
        const cached =
          sessionCacheRef.current[ck] ||
          ({
            key: streamKey,
            type: pending.mode,
            agent: pending.agent,
            model: pending.model,
            mode: pending.agentMode,
            effort: pending.effort,
            fast_service: pending.fastService || "",
            shell: pending.shell || "",
            name: pendingName,
            created_at: pending.timestamp,
            updated_at: pending.timestamp,
            exchanges: [],
          } as any);
        const prevExchanges = Array.isArray((cached as any).exchanges)
          ? ((cached as any).exchanges as Exchange[])
          : [];
        sessionCacheRef.current[ck] = {
          ...(cached as any),
          exchanges: prevExchanges.length > 0 ? prevExchanges : [userEx],
          updated_at: new Date().toISOString(),
        } as Session;
        bumpCacheVersion();
      }
      const seeded = sessionCacheRef.current[ck];
      if (seeded) {
        setDrawerSessionForRoot(activeRoot, {
          ...(seeded as any),
          pending: true,
        } as Session);
      }
    }
    if (pending?.tempKey) {
      console.info("[session/stream] promote_pending", {
        rootId: activeRoot,
        tempKey: pending.tempKey,
        streamKey,
        requestId: pending.requestId,
      });
      promotePendingSessionForRoot(
        activeRoot,
        pending.tempKey,
        streamKey,
        sessionCacheRef.current[ck] || null,
      );
    }
    const event = payload.event;
    if (!event?.type) return;
    const markStreamPending = () => {
      if (event.type === "message_done" || event.type === "error") return;
      markSessionPending(activeRoot, streamKey);
    };
    const updateDrawerIfShowingStream = () => {
      const drawerKey = drawerSessionByRootRef.current[activeRoot]?.key || "";
      if (
        drawerKey !== streamKey &&
        (!pending?.tempKey || drawerKey !== pending.tempKey)
      ) {
        return;
      }
      const latest = sessionCacheRef.current[ck];
      if (latest) {
        setDrawerSessionForRoot(activeRoot, {
          ...(latest as any),
          pending: true,
        } as Session);
      }
    };
    markStreamPending();
    switch (event.type) {
      case "message_chunk":
        appendAgentChunkForSession(
          activeRoot,
          streamKey,
          event.data?.content || "",
          pending
            ? {
                agent: pending.agent,
                model: pending.model,
                mode: pending.agentMode,
                effort: pending.effort,
                fast_service: pending.fastService || "",
              }
            : undefined,
        );
        updateDrawerIfShowingStream();
        break;
      case "thought_chunk":
        appendThoughtChunkForSession(
          activeRoot,
          streamKey,
          event.data?.content || "",
          event.data?.id || "",
        );
        updateDrawerIfShowingStream();
        break;
      case "tool_call":
        appendToolCallForSession(
          activeRoot,
          streamKey,
          event.data || {},
          false,
        );
        updateDrawerIfShowingStream();
        break;
      case "tool_call_update":
        appendToolCallForSession(activeRoot, streamKey, event.data || {}, true);
        updateDrawerIfShowingStream();
        break;
      case "todo_update":
        appendTodoUpdateForSession(activeRoot, streamKey, event.data || {});
        updateDrawerIfShowingStream();
        break;
      case "plan_update":
        appendPlanUpdateForSession(activeRoot, streamKey, event.data || {});
        updateDrawerIfShowingStream();
        break;
      case "compact_notice":
        appendCompactNoticeForSession(activeRoot, streamKey, event.data || {});
        updateDrawerIfShowingStream();
        break;
      case "message_done":
        attachContextWindowToLatestAssistant(
          activeRoot,
          streamKey,
          event.data?.contextWindow,
        );
        break;
      case "error":
        reportError(
          "session.resume_failed",
          event.data?.message || t("session.resumeFailed"),
          {
            details: {
              rootId: activeRoot,
              sessionKey: streamKey,
              eventType: event.type,
            },
          },
        );
        handleSessionStreamDone(activeRoot, streamKey);
        break;
    }
  };
  return { handleSessionStreamDone, handleSessionStream };
}
