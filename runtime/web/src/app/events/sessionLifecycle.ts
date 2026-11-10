import React from "react";
import { type MessageKey, type MessageParams } from "../../i18n";
import { refreshIdeaFiles } from "../../services/ideaBridge";
import type {
  QueuedUserMessage,
  SessionServiceEvent,
} from "../../services/session";
import { type RelatedWorktree, type Session } from "../../services/session";
import {
  Exchange,
  normalizeFastService,
  normalizeMode,
  PendingSend,
  SessionItem,
  SessionQueueItem,
} from "../sessionModel";

type Options = {
  currentRootIdRef: React.RefObject<string | null>;
  loadSessionsForRoot: (
    rootID: string,
    options?: {
      beforeTime?: string;
      afterTime?: string;
      replace?: boolean;
      force?: boolean;
    },
  ) => Promise<void>;
  sessionListModeRef: React.RefObject<"local" | "import">;
  externalImportAgentRef: React.RefObject<string>;
  setImportingExternalSessionKeys: React.Dispatch<
    React.SetStateAction<Set<string>>
  >;
  setSelectedExternalImportKeys: React.Dispatch<
    React.SetStateAction<Set<string>>
  >;
  setConfirmingExternalImport: React.Dispatch<React.SetStateAction<boolean>>;
  loadExternalSessions: (
    rootID: string,
    agent: string,
    options?: { beforeTime?: string; afterTime?: string; replace?: boolean },
  ) => Promise<void>;
  multiProjectSessionsEnabled: boolean;
  loadMultiProjectSessionGroups: () => Promise<void>;
  rootSessionKey: (rootId: string, sessionKey: string) => string;
  optimisticDequeuedIdsRef: React.RefObject<Record<string, Set<string>>>;
  queueFrozenBySessionRef: React.RefObject<Record<string, boolean>>;
  queuedMessagesBySessionRef: React.RefObject<
    Record<string, QueuedUserMessage[]>
  >;
  setQueueVersion: React.Dispatch<React.SetStateAction<number>>;
  pendingRequestRef: React.RefObject<Record<string, PendingSend>>;
  pendingBySessionRef: React.RefObject<Record<string, PendingSend>>;
  setMultiProjectSessionPending: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
    pending: boolean,
  ) => void;
  pendingDraftRef: React.RefObject<PendingSend | null>;
  promotePendingSessionForRoot: (
    rootID: string,
    tempKey: string | undefined,
    sessionKey: string,
    fallback?: Session | null,
  ) => void;
  sessionCacheRef: React.RefObject<Record<string, Session>>;
  bumpCacheVersion: () => void;
  drawerSessionByRootRef: React.RefObject<Record<string, SessionItem | null>>;
  setDrawerSessionForRoot: (
    rootID: string | null | undefined,
    session: Session | SessionItem | null,
  ) => void;
  resolveRootForSessionKey: (sessionKey: string) => string | null;
  playCompletionSound: () => void;
  handleSessionStreamDone: (rootID: string, sessionKey: string) => void;
  advanceTurnVersion: (rootID: string, sessionKey: string) => number;
  reloadSessionForReplay: (
    rootID: string,
    sessionKey: string,
    completedVersion?: number,
  ) => Promise<void>;
  isCancelled: () => boolean;
  markSessionStale: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
  ) => void;
  sessionsRef: React.RefObject<SessionItem[]>;
  refreshMultiProjectReplyingSessions: () => Promise<void>;
  currentSessionRef: React.RefObject<SessionItem | null>;
  selectedSessionRef: React.RefObject<SessionItem | null>;
  t: (key: MessageKey, params?: MessageParams) => string;
  updateSessionAgentForKey: (
    rootID: string,
    sessionKey: string,
    agent: string,
    model?: string,
    agentMode?: string,
    effort?: string,
    fastService?: "" | "on" | "off",
    planMode?: boolean,
    shell?: string,
  ) => void;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionItem | null>>;
  boundSessionByRootRef: React.RefObject<Record<string, string | null>>;
  refreshRelatedWorktree: (
    rootId: string,
    worktreePath: string,
    force?: boolean,
  ) => Promise<void>;
  refreshSessionRelatedFiles: (
    rootID: string,
    sessionKey: string,
  ) => Promise<void>;
  updateSessionRelatedWorktreeForKey: (
    rootID: string,
    sessionKey: string,
    relatedWorktree: RelatedWorktree | null | undefined,
  ) => void;
};

export function createSessionLifecycleHandler({
  currentRootIdRef,
  loadSessionsForRoot,
  sessionListModeRef,
  externalImportAgentRef,
  setImportingExternalSessionKeys,
  setSelectedExternalImportKeys,
  setConfirmingExternalImport,
  loadExternalSessions,
  multiProjectSessionsEnabled,
  loadMultiProjectSessionGroups,
  rootSessionKey,
  optimisticDequeuedIdsRef,
  queueFrozenBySessionRef,
  queuedMessagesBySessionRef,
  setQueueVersion,
  pendingRequestRef,
  pendingBySessionRef,
  setMultiProjectSessionPending,
  pendingDraftRef,
  promotePendingSessionForRoot,
  sessionCacheRef,
  bumpCacheVersion,
  drawerSessionByRootRef,
  setDrawerSessionForRoot,
  resolveRootForSessionKey,
  playCompletionSound,
  handleSessionStreamDone,
  advanceTurnVersion,
  reloadSessionForReplay,
  isCancelled,
  markSessionStale,
  sessionsRef,
  refreshMultiProjectReplyingSessions,
  currentSessionRef,
  selectedSessionRef,
  t,
  updateSessionAgentForKey,
  setSelectedSession,
  boundSessionByRootRef,
  refreshRelatedWorktree,
  refreshSessionRelatedFiles,
  updateSessionRelatedWorktreeForKey,
}: Options) {
  return (event: SessionServiceEvent) => {
    const payload = (event.payload || {}) as any;
    switch (event.type) {
      case "session.imported": {
        const rootID =
          typeof payload?.root_id === "string" ? payload.root_id : "";
        const agentName =
          typeof payload?.agent === "string" ? payload.agent : "";
        const agentSessionID =
          typeof payload?.agent_session_id === "string"
            ? payload.agent_session_id.trim()
            : "";
        if (!rootID) {
          break;
        }
        if (rootID === currentRootIdRef.current) {
          void loadSessionsForRoot(rootID, { replace: true });
          if (
            sessionListModeRef.current === "import" &&
            agentSessionID &&
            (!agentName || agentName === externalImportAgentRef.current)
          ) {
            setImportingExternalSessionKeys((current) => {
              if (!current.has(agentSessionID)) {
                return current;
              }
              const next = new Set(current);
              next.delete(agentSessionID);
              return next;
            });
            setSelectedExternalImportKeys((current) => {
              if (!current.has(agentSessionID)) {
                return current;
              }
              const next = new Set(current);
              next.delete(agentSessionID);
              return next;
            });
            setConfirmingExternalImport(false);
            if (externalImportAgentRef.current) {
              void loadExternalSessions(
                rootID,
                externalImportAgentRef.current,
                {
                  replace: true,
                },
              );
            }
          }
        }
        if (multiProjectSessionsEnabled) {
          void loadMultiProjectSessionGroups();
        }
        break;
      }
      case "session.created": {
        const rootID =
          typeof payload?.root_id === "string" ? payload.root_id : "";
        if (rootID && rootID === currentRootIdRef.current) {
          void loadSessionsForRoot(rootID, { replace: true });
        }
        if (rootID && multiProjectSessionsEnabled) {
          void loadMultiProjectSessionGroups();
        }
        break;
      }
      case "session.queue.updated": {
        const rootID =
          typeof payload?.root_id === "string" ? payload.root_id : "";
        const sessionKey =
          typeof payload?.session_key === "string" ? payload.session_key : "";
        if (!rootID || !sessionKey) {
          break;
        }
        const incomingQueue = Array.isArray(payload?.queue)
          ? (payload.queue.filter(
              (item: any) =>
                item &&
                typeof item.id === "string" &&
                typeof item.content === "string",
            ) as SessionQueueItem[])
          : [];
        const cacheKey = rootSessionKey(rootID, sessionKey);
        const hidden = optimisticDequeuedIdsRef.current[cacheKey];
        const queue =
          hidden && hidden.size > 0
            ? incomingQueue.filter((item) => !hidden.has(item.id))
            : incomingQueue;
        queueFrozenBySessionRef.current[cacheKey] =
          payload?.queue_frozen === true;
        if (hidden) {
          for (const queueId of Array.from(hidden)) {
            if (!incomingQueue.some((item) => item.id === queueId)) {
              hidden.delete(queueId);
            }
          }
          if (hidden.size === 0) {
            delete optimisticDequeuedIdsRef.current[cacheKey];
          }
        }
        queuedMessagesBySessionRef.current[cacheKey] = queue;
        setQueueVersion((v) => v + 1);
        break;
      }
      case "session.accepted": {
        const requestId =
          typeof payload?.request_id === "string" ? payload.request_id : "";
        const pending = pendingRequestRef.current[requestId];
        if (!requestId || !pending) {
          console.warn("[session/ws] accepted_without_pending", {
            requestId,
            payloadSessionKey:
              typeof payload?.session_key === "string"
                ? payload.session_key
                : null,
          });
          break;
        }
        console.info("[session/ws] accepted", {
          requestId,
          rootId: pending.rootId,
          sessionKey: pending.sessionKey || null,
          tempKey: pending.tempKey || null,
        });
        delete pendingRequestRef.current[requestId];
        const acceptedTimestamp =
          typeof payload?.timestamp === "string" &&
          !Number.isNaN(Date.parse(payload.timestamp))
            ? payload.timestamp
            : pending.timestamp;
        const acceptedSessionKey =
          typeof payload?.session_key === "string" ? payload.session_key : "";
        if (!pending.sessionKey && pending.tempKey && acceptedSessionKey) {
          const cacheKey = rootSessionKey(pending.rootId, acceptedSessionKey);
          pendingBySessionRef.current[cacheKey] = {
            ...pending,
            timestamp: acceptedTimestamp,
            sessionKey: acceptedSessionKey,
          };
          setMultiProjectSessionPending(pending.rootId, pending.tempKey, false);
          setMultiProjectSessionPending(
            pending.rootId,
            acceptedSessionKey,
            true,
          );
          if (pendingDraftRef.current?.requestId === pending.requestId) {
            pendingDraftRef.current = null;
          }
          promotePendingSessionForRoot(
            pending.rootId,
            pending.tempKey,
            acceptedSessionKey,
            sessionCacheRef.current[cacheKey] || null,
          );
        }
        const markAccepted = (
          sess: Session | SessionItem | null | undefined,
        ): Session | null => {
          if (!sess) return null;
          const exchanges = Array.isArray((sess as any).exchanges)
            ? ((sess as any).exchanges as Exchange[]).map((exchange) =>
                exchange.pending_ack === true &&
                exchange.content === pending.message &&
                exchange.timestamp === pending.timestamp
                  ? {
                      ...exchange,
                      timestamp: acceptedTimestamp,
                      pending_ack: false,
                    }
                  : exchange,
              )
            : [];
          return {
            ...(sess as any),
            exchanges,
            updated_at: acceptedTimestamp,
          } as Session;
        };
        const acceptedTargetKey = pending.sessionKey || acceptedSessionKey;
        if (acceptedTargetKey) {
          const cacheKey = rootSessionKey(pending.rootId, acceptedTargetKey);
          const accepted = markAccepted(sessionCacheRef.current[cacheKey]);
          if (accepted) {
            sessionCacheRef.current[cacheKey] = accepted;
            bumpCacheVersion();
          }
        }
        const latestDrawer = drawerSessionByRootRef.current[pending.rootId];
        const drawerKey = latestDrawer?.key || "";
        if (
          drawerKey &&
          (drawerKey === pending.sessionKey ||
            drawerKey === pending.tempKey ||
            drawerKey === acceptedSessionKey)
        ) {
          const accepted = markAccepted(latestDrawer);
          if (accepted) {
            setDrawerSessionForRoot(pending.rootId, accepted);
          }
        }
        break;
      }
      case "session.error": {
        const requestId =
          typeof payload?.request_id === "string" ? payload.request_id : "";
        const pending = requestId ? pendingRequestRef.current[requestId] : null;
        if (!requestId || !pending) {
          console.warn("[session/ws] error_without_pending", {
            requestId,
            payloadSessionKey:
              typeof payload?.session_key === "string"
                ? payload.session_key
                : null,
          });
          break;
        }
        console.warn("[session/ws] error", {
          requestId,
          rootId: pending.rootId,
          sessionKey: pending.sessionKey || null,
          tempKey: pending.tempKey || null,
        });
        delete pendingRequestRef.current[requestId];
        const targetKey = pending.tempKey || "";
        const failedKey = pending.sessionKey || targetKey;
        const rootID = pending.rootId;
        if (failedKey) {
          setMultiProjectSessionPending(rootID, failedKey, false);
        }
        const latestDrawer = drawerSessionByRootRef.current[rootID];
        if (targetKey && latestDrawer?.key === targetKey) {
          const exchanges = Array.isArray((latestDrawer as any).exchanges)
            ? ((latestDrawer as any).exchanges as Exchange[]).map((exchange) =>
                exchange.pending_ack === true &&
                exchange.content === pending.message &&
                exchange.timestamp === pending.timestamp
                  ? { ...exchange, pending_ack: false }
                  : exchange,
              )
            : [];
          setDrawerSessionForRoot(rootID, {
            ...(latestDrawer as any),
            pending: false,
            exchanges,
          } as Session);
        }
        break;
      }
      case "session.done": {
        if (payload?.replay !== true) refreshIdeaFiles();
        const sessionKey =
          typeof payload?.session_key === "string" ? payload.session_key : "";
        const rootID =
          typeof payload?.root_id === "string" && payload.root_id
            ? payload.root_id
            : resolveRootForSessionKey(sessionKey) ||
              currentRootIdRef.current ||
              "";
        if (rootID && sessionKey) {
          if (payload?.replay !== true) {
            playCompletionSound();
          }
          setMultiProjectSessionPending(rootID, sessionKey, false);
          handleSessionStreamDone(rootID, sessionKey);
          if (payload?.replay !== true) {
            const version = advanceTurnVersion(rootID, sessionKey);
            // Workspace diffs are saved after native message_done. Read the
            // final history only after the host's session.done, without
            // injecting or rewriting any native Agent event.
            void reloadSessionForReplay(rootID, sessionKey, version).catch(
              () => {
                if (!isCancelled()) markSessionStale(rootID, sessionKey);
              },
            );
          }
          const newest = sessionsRef.current[0]?.updated_at || "";
          void loadSessionsForRoot(
            rootID,
            newest ? { afterTime: newest } : { replace: true },
          );
          if (multiProjectSessionsEnabled) {
            void loadMultiProjectSessionGroups();
          }
        } else if (currentRootIdRef.current) {
          const newest = sessionsRef.current[0]?.updated_at || "";
          void loadSessionsForRoot(
            currentRootIdRef.current,
            newest ? { afterTime: newest } : { replace: true },
          );
          if (multiProjectSessionsEnabled) {
            void refreshMultiProjectReplyingSessions();
            void loadMultiProjectSessionGroups();
          }
        }
        break;
      }
      case "session.user_message":
        if (
          typeof payload?.session_key === "string" &&
          typeof payload?.root_id === "string"
        ) {
          const rootID = payload.root_id;
          const sessionKey = payload.session_key;
          advanceTurnVersion(rootID, sessionKey);
          setMultiProjectSessionPending(rootID, sessionKey, true);
          const exchange = payload.exchange;
          const sessionMeta = payload.session;
          const cacheKey = rootSessionKey(rootID, sessionKey);
          console.info("[session/ws] user_message", {
            rootID,
            sessionKey,
            sessionAgent: sessionMeta?.agent || "",
            exchangeAgent: exchange?.agent || "",
            cachedAgent:
              (sessionCacheRef.current[cacheKey] as any)?.agent || "",
            currentAgent:
              currentSessionRef.current?.key === sessionKey
                ? (currentSessionRef.current as any)?.agent || ""
                : "",
            selectedAgent:
              (selectedSessionRef.current?.key ||
                selectedSessionRef.current?.session_key) === sessionKey
                ? (selectedSessionRef.current as any)?.agent || ""
                : "",
          });
          const cached =
            sessionCacheRef.current[cacheKey] ||
            ({
              key: sessionKey,
              type: sessionMeta?.type || "chat",
              agent: sessionMeta?.agent || exchange?.agent || "",
              model: sessionMeta?.model || exchange?.model || "",
              mode: sessionMeta?.mode || exchange?.mode || "",
              effort: sessionMeta?.effort || exchange?.effort || "",
              fast_service:
                normalizeFastService(sessionMeta?.fast_service) ||
                normalizeFastService(exchange?.fast_service),
              plan_mode:
                typeof sessionMeta?.plan_mode === "boolean"
                  ? sessionMeta.plan_mode
                  : false,
              name: sessionMeta?.name || t("session.new"),
              created_at:
                sessionMeta?.created_at ||
                exchange?.timestamp ||
                new Date().toISOString(),
              updated_at:
                sessionMeta?.updated_at ||
                exchange?.timestamp ||
                new Date().toISOString(),
              exchanges: [],
            } as any);
          const prevExchanges = Array.isArray((cached as any).exchanges)
            ? ((cached as any).exchanges as Exchange[])
            : [];
          const duplicate = prevExchanges.some(
            (item) =>
              item.role === "user" &&
              item.content === exchange?.content &&
              item.timestamp === exchange?.timestamp,
          );
          sessionCacheRef.current[cacheKey] = {
            ...(cached as any),
            ...(sessionMeta || {}),
            key: sessionKey,
            agent:
              sessionMeta?.agent ||
              exchange?.agent ||
              (cached as any).agent ||
              "",
            model:
              sessionMeta?.model ||
              exchange?.model ||
              (cached as any).model ||
              "",
            mode:
              sessionMeta?.mode || exchange?.mode || (cached as any).mode || "",
            effort:
              sessionMeta?.effort ||
              exchange?.effort ||
              (cached as any).effort ||
              "",
            fast_service:
              normalizeFastService(sessionMeta?.fast_service) ||
              normalizeFastService(exchange?.fast_service) ||
              normalizeFastService((cached as any).fast_service),
            plan_mode:
              typeof sessionMeta?.plan_mode === "boolean"
                ? sessionMeta.plan_mode
                : !!(cached as any).plan_mode,
            exchanges: duplicate
              ? prevExchanges
              : [
                  ...prevExchanges,
                  {
                    role: "user",
                    agent: exchange?.agent || "",
                    model: exchange?.model || "",
                    mode: exchange?.mode || "",
                    effort: exchange?.effort || "",
                    fast_service: exchange?.fast_service || "",
                    content: exchange?.content || "",
                    timestamp: exchange?.timestamp || new Date().toISOString(),
                    pending_ack: false,
                  },
                ],
            updated_at:
              sessionMeta?.updated_at ||
              exchange?.timestamp ||
              new Date().toISOString(),
          } as Session;
          const runtimeAgent = sessionMeta?.agent || exchange?.agent || "";
          if (runtimeAgent) {
            updateSessionAgentForKey(
              rootID,
              sessionKey,
              runtimeAgent,
              sessionMeta?.model || exchange?.model || "",
              sessionMeta?.mode || exchange?.mode || "",
              sessionMeta?.effort || exchange?.effort || "",
              normalizeFastService(sessionMeta?.fast_service) ||
                normalizeFastService(exchange?.fast_service),
              typeof sessionMeta?.plan_mode === "boolean"
                ? sessionMeta.plan_mode
                : undefined,
            );
          }
          bumpCacheVersion();
          const newest = sessionsRef.current[0]?.updated_at || "";
          void loadSessionsForRoot(
            rootID,
            newest ? { afterTime: newest } : { replace: true },
          );
          if (multiProjectSessionsEnabled) {
            void loadMultiProjectSessionGroups();
          }
        }
        break;
      case "session.meta.updated":
        if (
          typeof payload?.root_id === "string" &&
          typeof payload?.session?.key === "string"
        ) {
          const rootID = payload.root_id;
          const sessionKey = payload.session.key;
          const cacheKey = rootSessionKey(rootID, sessionKey);
          const cached =
            sessionCacheRef.current[cacheKey] ||
            ({
              key: sessionKey,
              root_id: rootID,
              type: normalizeMode(payload.session.type),
              name:
                typeof payload.session.name === "string"
                  ? payload.session.name
                  : "",
              created_at:
                payload.session.updated_at || new Date().toISOString(),
              updated_at:
                payload.session.updated_at || new Date().toISOString(),
              exchanges: [],
            } as Session);
          sessionCacheRef.current[cacheKey] = {
            ...cached,
            name:
              typeof payload.session.name === "string"
                ? payload.session.name
                : cached.name,
            agent:
              typeof payload.session.agent === "string"
                ? payload.session.agent
                : (cached as any).agent,
            model:
              typeof payload.session.model === "string"
                ? payload.session.model
                : (cached as any).model,
            mode:
              typeof payload.session.mode === "string"
                ? payload.session.mode
                : (cached as any).mode,
            effort:
              typeof payload.session.effort === "string"
                ? payload.session.effort
                : (cached as any).effort,
            fast_service:
              normalizeFastService(payload.session.fast_service) ||
              normalizeFastService((cached as any).fast_service),
            plan_mode:
              typeof payload.session.plan_mode === "boolean"
                ? payload.session.plan_mode
                : !!(cached as any).plan_mode,
            parent_session_key:
              typeof payload.session.parent_session_key === "string"
                ? payload.session.parent_session_key
                : (cached as any).parent_session_key,
            parent_tool_call_id:
              typeof payload.session.parent_tool_call_id === "string"
                ? payload.session.parent_tool_call_id
                : (cached as any).parent_tool_call_id,
            source:
              typeof payload.session.source === "string"
                ? payload.session.source
                : (cached as any).source,
            task_id:
              typeof payload.session.task_id === "string"
                ? payload.session.task_id
                : (cached as any).task_id,
            related_worktree:
              payload.session.related_worktree !== undefined
                ? payload.session.related_worktree
                : (cached as any).related_worktree,
            pinned_at:
              payload.session.pinned_at !== undefined
                ? payload.session.pinned_at || undefined
                : (cached as any).pinned_at,
            updated_at: payload.session.updated_at || cached.updated_at,
          } as Session;
          bumpCacheVersion();
          if (
            (selectedSessionRef.current?.key ||
              selectedSessionRef.current?.session_key) === sessionKey
          ) {
            setSelectedSession((prev) =>
              prev
                ? ({
                    ...(prev as any),
                    name:
                      typeof payload.session.name === "string"
                        ? payload.session.name
                        : prev.name,
                    agent:
                      typeof payload.session.agent === "string"
                        ? payload.session.agent
                        : (prev as any).agent,
                    model:
                      typeof payload.session.model === "string"
                        ? payload.session.model
                        : (prev as any).model,
                    mode:
                      typeof payload.session.mode === "string"
                        ? payload.session.mode
                        : (prev as any).mode,
                    effort:
                      typeof payload.session.effort === "string"
                        ? payload.session.effort
                        : (prev as any).effort,
                    fast_service:
                      normalizeFastService(payload.session.fast_service) ||
                      normalizeFastService((prev as any).fast_service),
                    plan_mode:
                      typeof payload.session.plan_mode === "boolean"
                        ? payload.session.plan_mode
                        : !!(prev as any).plan_mode,
                    parent_session_key:
                      typeof payload.session.parent_session_key === "string"
                        ? payload.session.parent_session_key
                        : (prev as any).parent_session_key,
                    parent_tool_call_id:
                      typeof payload.session.parent_tool_call_id === "string"
                        ? payload.session.parent_tool_call_id
                        : (prev as any).parent_tool_call_id,
                    source:
                      typeof payload.session.source === "string"
                        ? payload.session.source
                        : (prev as any).source,
                    task_id:
                      typeof payload.session.task_id === "string"
                        ? payload.session.task_id
                        : (prev as any).task_id,
                    related_worktree:
                      payload.session.related_worktree !== undefined
                        ? payload.session.related_worktree
                        : (prev as any).related_worktree,
                    pinned_at:
                      payload.session.pinned_at !== undefined
                        ? payload.session.pinned_at || undefined
                        : (prev as any).pinned_at,
                    updated_at: payload.session.updated_at || prev.updated_at,
                  } as SessionItem)
                : prev,
            );
          }
          if (boundSessionByRootRef.current[rootID] === sessionKey) {
            const latest = sessionCacheRef.current[cacheKey];
            if (latest) {
              setDrawerSessionForRoot(rootID, latest);
            }
          }
          const relatedWorktreePath =
            typeof payload.session.related_worktree?.path === "string"
              ? payload.session.related_worktree.path.trim()
              : "";
          if (relatedWorktreePath) {
            void refreshRelatedWorktree(rootID, relatedWorktreePath, false);
          }
          const newest = sessionsRef.current[0]?.updated_at || "";
          void loadSessionsForRoot(
            rootID,
            newest ? { afterTime: newest } : { replace: true },
          );
          if (multiProjectSessionsEnabled) {
            void loadMultiProjectSessionGroups();
          }
        }
        break;
      case "session.related_files.updated": {
        const rootID =
          typeof payload?.root_id === "string" ? payload.root_id : "";
        const sessionKey =
          typeof payload?.session_key === "string" ? payload.session_key : "";
        if (rootID && sessionKey) {
          void refreshSessionRelatedFiles(rootID, sessionKey);
          const cachedSession =
            sessionCacheRef.current[rootSessionKey(rootID, sessionKey)];
          const parentSessionKey = String(
            cachedSession?.parent_session_key || "",
          ).trim();
          if (parentSessionKey) {
            void refreshSessionRelatedFiles(rootID, parentSessionKey);
          }
          if (
            payload?.related_worktree &&
            typeof payload.related_worktree === "object"
          ) {
            updateSessionRelatedWorktreeForKey(
              rootID,
              sessionKey,
              payload.related_worktree as RelatedWorktree,
            );
          }
        }
        break;
      }
    }
  };
}
